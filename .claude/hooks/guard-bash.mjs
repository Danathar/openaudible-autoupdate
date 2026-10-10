#!/usr/bin/env node
// PreToolUse hook for Claude Code's Bash tool (wired up in .claude/settings.json).
//
// Threat model: this hook prevents an agent that is following instructions
// from carelessly or accidentally (a) writing to the wrong GitHub repository,
// (b) running destructive git commands, or (c) running the real updater,
// `sudo`, or a package-manager install/upgrade on the developer's machine. It
// is NOT a sandbox against deliberate obfuscation (eval of built strings,
// shell variables, scripts written to disk and executed, aliases, ...). The
// real boundaries are token scope / the Hive GitHub App's repository access
// and review of the changes; findings that need deliberate obfuscation are out
// of scope here.
//
// Why: openaudible-autoupdate.sh runs `sudo dnf install -y` on whatever
// machine it runs on, and the developer's machine is an immutable
// Fedora-based host with the real OpenAudible rpm installed. Running the
// script "to see what happens" would install a package for real. And a bare
// `gh` write in a clone resolves its target from git remotes or gh's default,
// which is how an agent files issues or PRs on the wrong repository.
//
// Protocol (https://docs.anthropic.com/en/docs/claude-code/hooks): the hook
// receives JSON on stdin ({ tool_name, tool_input: { command } }). Exit 0 lets
// the call proceed; exit 2 blocks it and feeds stderr back to the model.
//
// What is blocked (fail closed when unsure):
//   GitHub / git
//   - gh pr|issue|discussion|release|workflow|run|label|repo|secret|variable|
//     ruleset|cache subcommands that are not read-only and do not target
//     Danathar/openaudible-autoupdate via --repo/-R or a GH_REPO= prefix; a
//     write whose arguments name a github.com URL of another repository.
//   - gh api with a mutating method (or -f/-F/--input body) against anything
//     outside repos/Danathar/openaudible-autoupdate; GraphQL mutations.
//   - git push with force, --mirror, a remote other than `origin`, a URL
//     remote, or no explicit remote.
//   - git config / git remote changes that re-point `origin` or push URLs.
//   Updater and host-modifying commands
//   - Executing openaudible-autoupdate.sh (or the installed
//     `openaudible-autoupdate` name): directly, via bash/sh/zsh/dash, source,
//     `.`, env/timeout/xargs/other wrappers, systemd-run, or via
//     `distrobox enter` / `toolbox run`. The only exemptions are:
//       1. a container run: `podman run ...` / `docker run ...` (the script
//          then runs against the container's own throwaway rpm database; the
//          command word is podman/docker, so it is never analysed as the
//          script), and
//       2. an inline `PATH=<dir>[:...]` (or `export PATH=...`) whose FIRST
//          entry is a directory under a `tests/` path component, contains no
//          `..`, and, when it can be resolved on disk, holds executable
//          stubs for at least `sudo`, `dnf` and `rpm`. Stubs shadow the real
//          commands, so nothing is installed.
//     distrobox/toolbox enter the developer's real long-lived container, so
//     they never qualify for either exemption. `podman exec` / `docker exec`
//     are refused for the same reason (distrobox containers are podman
//     containers). `sh -n` / `bash -n` (syntax check) and tools that merely
//     read the file (shellcheck, cat, grep, bats, ...) are fine.
//   - sudo / doas / pkexec in any position of a wrapper chain.
//   - dnf/dnf5/yum/microdnf subcommands other than read-only queries (list,
//     info, search, repoquery, provides, check-update, repolist, ...).
//   - rpm install/upgrade/freshen/erase modes (-i -U -F -e and long forms);
//     query (-q), verify (-V) and checksig (-K) modes are fine.
//   - rpm-ostree and bootc subcommands other than status/db/search/--version.
//   - systemctl enable/start/restart/link/... of anything named
//     openaudible-autoupdate*, with or without --user.
//
// Read-only gh commands (view, list, status, diff, checks, api GET, ...) are
// always allowed. The command is split into segments on && || ; | & newlines,
// subshells and command substitutions; shell -c / eval strings are analysed
// recursively. Quoted text is data, so a quoted "sudo" or script name inside
// an `echo` or a read-only command is fine.

import { basename, join, isAbsolute } from 'node:path';
import { readFileSync, accessSync, constants as fsConstants } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REPO = 'danathar/openaudible-autoupdate';
export const SCRIPT = 'openaudible-autoupdate';

const GUIDANCE =
    'Hard rules for this repository: never run openaudible-autoupdate.sh, sudo or a package install on the host ' +
    '(it runs `sudo dnf install -y`); test it only with stubs on PATH (tests/) or inside `podman run`/`docker run`. ' +
    'GitHub writes go to Danathar/openaudible-autoupdate (add `--repo Danathar/openaudible-autoupdate`), ' +
    'and git pushes only to `origin`.';

// gh command groups whose non-read actions mutate a repository.
// Value = actions that are read-only (or purely local) and need no --repo.
const GH_GROUPS = {
    pr: ['view', 'list', 'status', 'diff', 'checks', 'checkout'],
    issue: ['view', 'list', 'status'],
    release: ['view', 'list', 'download', 'verify', 'verify-asset'],
    workflow: ['view', 'list'],
    run: ['view', 'list', 'watch', 'download'],
    label: ['list'],
    repo: ['view', 'list', 'clone', 'gitignore', 'license'],
    secret: ['list'],
    variable: ['list', 'get'],
    ruleset: ['list', 'view', 'check'],
    cache: ['list'],
    discussion: ['view', 'list'],
    codespace: ['list', 'view', 'logs', 'ports'],
};

// gh groups outside GH_GROUPS that may run without a repo target.
// true = every action is read-only or local; array = only those actions.
const GH_OTHER_READONLY = {
    auth: ['status'],
    browse: true,
    search: true,
    status: true,
    config: ['get', 'list'],
    alias: ['list'],
    extension: ['list', 'search', 'browse'],
    'ssh-key': ['list'],
    'gpg-key': ['list'],
    org: ['list'],
    project: ['list', 'view', 'field-list', 'item-list'],
    attestation: ['verify', 'inspect', 'trusted-root'],
    completion: true,
    help: true,
    version: true,
};

// Words that may precede the real command and carry no meaning for us.
const KEYWORDS = new Set(['{', '}', '!', 'if', 'then', 'else', 'elif', 'do', 'while', 'until', 'time']);
// Wrappers that run another command; we look through them for gh/git/shells.
const WRAPPERS = new Set([
    'env', 'command', 'builtin', 'exec', 'nohup', 'sudo', 'nice', 'xargs',
    'timeout', 'setsid', 'stdbuf', 'ionice', 'chronic',
]);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Split a shell command line into segments of words.
 * Quotes and backslashes are resolved; operators and parentheses end a segment;
 * heredoc bodies are skipped. This is a deliberately small approximation of
 * shell parsing, good enough to find command names and their flags.
 */
export function tokenize(input) {
    const segments = [];
    let words = [];
    let word = null; // null = no word in progress ('' = empty quoted word)
    const pendingHeredocs = [];

    const endWord = () => {
        if (word !== null) words.push(word);
        word = null;
    };
    const endSegment = () => {
        endWord();
        if (words.length) segments.push(words);
        words = [];
    };
    const append = (ch) => {
        word = (word ?? '') + ch;
    };

    let i = 0;
    while (i < input.length) {
        const c = input[i];

        if (c === "'") {
            const end = input.indexOf("'", i + 1);
            const stop = end === -1 ? input.length : end;
            append(input.slice(i + 1, stop));
            i = stop + 1;
        } else if (c === '"') {
            i++;
            append('');
            while (i < input.length && input[i] !== '"') {
                if (input[i] === '\\' && i + 1 < input.length) {
                    const next = input[i + 1];
                    if ('"\\$`'.includes(next)) i++;
                    else if (next === '\n') {
                        i += 2;
                        continue;
                    }
                }
                append(input[i]);
                i++;
            }
            i++;
        } else if (c === '\\') {
            if (input[i + 1] === '\n') {
                i += 2; // line continuation
            } else {
                append(input[i + 1] ?? '');
                i += 2;
            }
        } else if (c === '#' && word === null) {
            while (i < input.length && input[i] !== '\n') i++; // comment
        } else if (c === '\n') {
            endSegment();
            i++;
            // Skip the bodies of heredocs started on the line that just ended.
            while (pendingHeredocs.length) {
                const delim = pendingHeredocs.shift();
                while (i < input.length) {
                    let eol = input.indexOf('\n', i);
                    if (eol === -1) eol = input.length;
                    const line = input.slice(i, eol).replace(/^\t+/, '');
                    i = eol + 1;
                    if (line === delim) break;
                }
            }
        } else if (c === '<' && input[i + 1] === '<' && input[i + 2] !== '<') {
            i += 2;
            if (input[i] === '-') i++;
            while (input[i] === ' ' || input[i] === '\t') i++;
            let delim = '';
            let quote = null;
            while (i < input.length) {
                const d = input[i];
                if (quote) {
                    if (d === quote) quote = null;
                    else delim += d;
                } else if (d === "'" || d === '"') quote = d;
                else if (/[\s;&|()<>]/.test(d)) break;
                else delim += d;
                i++;
            }
            endWord();
            if (delim) pendingHeredocs.push(delim);
        } else if (c === ' ' || c === '\t') {
            endWord();
            i++;
        } else if (c === '&' || c === '|' || c === ';' || c === '(' || c === ')') {
            endSegment();
            i++;
        } else if (c === '`') {
            endSegment(); // substitution contents are analysed separately
            i++;
        } else if (c === '$' && input[i + 1] === '(') {
            endSegment();
            i += 2;
        } else {
            append(c);
            i++;
        }
    }
    endSegment();
    return segments;
}

/**
 * Find the bodies of $(...) and `...` substitutions, including ones inside
 * double quotes (but not single quotes), so they can be analysed as commands.
 */
export function extractSubstitutions(input) {
    const found = [];
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < input.length; i++) {
        const c = input[i];
        if (c === '\\' && !inSingle) {
            i++;
        } else if (c === "'" && !inDouble) {
            inSingle = !inSingle;
        } else if (c === '"' && !inSingle) {
            inDouble = !inDouble;
        } else if (!inSingle && c === '$' && input[i + 1] === '(') {
            let depth = 1;
            let j = i + 2;
            // Match the closing paren, ignoring parens in quotes or escaped.
            let q = null;
            for (; j < input.length && depth > 0; j++) {
                const d = input[j];
                if (d === '\\' && q !== "'") j++;
                else if (q) {
                    if (d === q) q = null;
                } else if (d === "'" || d === '"') q = d;
                else if (d === '(') depth++;
                else if (d === ')') depth--;
            }
            found.push(input.slice(i + 2, j - 1));
            i = j - 1; // nested substitutions are found by the recursive analysis
        } else if (!inSingle && c === '`') {
            const end = input.indexOf('`', i + 1);
            const stop = end === -1 ? input.length : end;
            found.push(input.slice(i + 1, stop));
            i = stop;
        }
    }
    return found;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isAssignment = (w) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(w);

/** Normalise OWNER/REPO, HOST/OWNER/REPO, or a github URL to "owner/repo". */
export function normalizeRepo(value) {
    return String(value)
        .trim()
        .toLowerCase()
        .replace(/^(?:https?:\/\/|git@|ssh:\/\/git@)?github\.com[/:]/, '')
        .replace(/\.git$/, '')
        .replace(/\/+$/, '');
}

/** True if a word is a github.com URL (or git@/ssh form) for a repository other than REPO. */
export function namesOtherRepo(word) {
    const m = /^(?:https?:\/\/|git@|ssh:\/\/git@)github\.com[/:]([^/\s]+\/[^/\s]+?)(?:\.git)?(?:\/.*)?$/i.exec(
        String(word)
    );
    return m !== null && m[1].toLowerCase() !== REPO;
}

function isTarget(value) {
    return normalizeRepo(value) === REPO;
}

/**
 * Extract the effective --repo/-R value from gh args, or null. gh honours the
 * LAST repeated flag, so a fork flag followed by another repo must not pass:
 * if any value is not the fork, that one is returned; otherwise the last.
 */
function repoFlag(args) {
    const values = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--repo' || a === '-R') values.push(args[++i] ?? '');
        else if (a.startsWith('--repo=')) values.push(a.slice(7));
        else if (a.startsWith('-R') && a.length > 2 && !a.startsWith('--')) values.push(a.slice(2));
    }
    if (!values.length) return null;
    return values.find((v) => !isTarget(v)) ?? values[values.length - 1];
}

const block = (reason) => ({ blocked: true, reason: `${reason}\n${GUIDANCE}` });

// ---------------------------------------------------------------------------
// gh
// ---------------------------------------------------------------------------

function checkGhApi(args) {
    let method = null;
    let hasBody = false;
    const positionals = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '-X' || a === '--method') method = (args[++i] ?? '').toUpperCase();
        else if (a.startsWith('--method=')) method = a.slice(9).toUpperCase();
        else if (/^-X./.test(a)) method = a.slice(2).toUpperCase();
        else if (['-f', '-F', '--field', '--raw-field', '--input'].includes(a)) {
            hasBody = true;
            i++;
        } else if (/^--(field|raw-field|input)=/.test(a) || /^-[fF]./.test(a)) hasBody = true;
        else if (['-H', '--header', '--hostname', '-q', '--jq', '-t', '--template', '--cache'].includes(a)) i++;
        else if (!a.startsWith('-')) positionals.push(a);
    }
    const endpoint = (positionals[0] ?? '').replace(/^\/+/, '');
    const mutating = method ? !['GET', 'HEAD'].includes(method) : hasBody;
    const isGraphql = endpoint.toLowerCase() === 'graphql';

    if (isGraphql) {
        // GraphQL is always POST; allow queries, refuse mutations (target unknowable).
        if (args.some((a) => /\bmutation\b/i.test(a))) {
            return block('Blocked: `gh api graphql` mutation. The target repository cannot be verified.');
        }
        // The query must be a visible literal: a body from a file/stdin (--input,
        // query=@file) or a shell variable could hide a mutation.
        const query = args.map((a) => /^query=([\s\S]*)$/.exec(a)).find(Boolean);
        const opaque =
            args.some((a) => a === '--input' || a.startsWith('--input=')) ||
            !query ||
            /^[@$]/.test(query[1]);
        if (opaque) {
            return block('Blocked: `gh api graphql` without an inline literal `-f query=...`; the request cannot be inspected for mutations.');
        }
        return null;
    }
    if (!mutating) return null;

    // `{owner}/{repo}` placeholders resolve to gh's default repo, which may be a different repository.
    const m = /^repos\/([^/]+\/[^/?#]+)(?:[/?#]|$)/i.exec(endpoint);
    if (m && m[1].toLowerCase() === REPO) return null;

    return block(
        `Blocked: mutating \`gh api\` call (${method ?? 'implicit POST'}) to "${endpoint || '?'}"; ` +
            'only paths under repos/Danathar/openaudible-autoupdate are allowed.'
    );
}

function checkGh(args, envRepo) {
    // Locate group and action (first two non-flag words).
    // The value of --repo/-R is not a command word, wherever the flag sits
    // (`gh -R chrisvel/tududi pr create` must still resolve to group "pr").
    const plain = args.filter((a, n) => !a.startsWith('-') && !['--repo', '-R'].includes(args[n - 1]));
    const group = plain[0];
    if (!group) return null;

    if (group === 'api') return checkGhApi(args.slice(args.indexOf('api') + 1));
    if (!Object.hasOwn(GH_GROUPS, group)) {
        // Fail closed: groups outside GH_GROUPS pass only via the explicit
        // read-only allowlist (GH_OTHER_READONLY). This also covers `gh alias set`,
        // which could define an alias that hides a write.
        const allowed = GH_OTHER_READONLY[group];
        if (allowed === true || (Array.isArray(allowed) && allowed.includes(plain[1] ?? ''))) return null;
        return block(
            `Blocked: \`gh ${group} ${plain[1] ?? ''}\` is not on the read-only allowlist ` +
                '(unknown or mutating gh command; the target repository cannot be verified).'
        );
    }

    const action = plain[1] ?? '';
    const flagRepo = repoFlag(args);
    const target = flagRepo ?? envRepo;

    if (group === 'repo' && action === 'set-default') {
        const rest = plain.slice(2);
        if (args.includes('--view') || args.includes('-v')) return null;
        if (rest.length === 1 && isTarget(rest[0])) return null;
        return block('Blocked: `gh repo set-default` must be `gh repo set-default Danathar/openaudible-autoupdate` (or --view).');
    }

    if (GH_GROUPS[group].includes(action)) return null; // read-only

    // A write whose arguments name another repository's github.com URL
    // (`gh pr merge https://github.com/other/x/pull/1`): gh uses the URL, not
    // --repo, so it is refused even when --repo points at this repository.
    const other = args.find(namesOtherRepo);
    if (other !== undefined) {
        return block(`Blocked: \`gh ${group} ${action}\` names another repository ("${other}").`);
    }

    if (group === 'repo') {
        // Repo-scoped writes take the repo as a positional argument.
        const positional = plain.slice(2);
        if (isTarget(flagRepo ?? '') || (positional.length && isTarget(positional[0])) || isTarget(envRepo ?? '')) return null;
        return block(`Blocked: \`gh repo ${action}\` without an explicit Danathar/openaudible-autoupdate target.`);
    }

    if (target === null) {
        return block(`Blocked: \`gh ${group} ${action}\` has no --repo/-R/GH_REPO; gh would resolve the repository from git remotes or its default.`);
    }
    if (!isTarget(target)) {
        return block(`Blocked: \`gh ${group} ${action}\` targets "${target}", not Danathar/openaudible-autoupdate.`);
    }
    if (group === 'pr' && action === 'create') return checkPrCreate(args);
    return null;
}

/** Convention: PRs are created with an explicit `--base main` and `--head <branch>`. */
function checkPrCreate(args) {
    // Flags whose value must be skipped so e.g. `--body "-Bump deps"` is not read as `-B`.
    const takesValue = new Set([
        '--title', '-t', '--body', '-b', '--body-file', '-F', '--label', '-l', '--assignee', '-a',
        '--reviewer', '-r', '--milestone', '-m', '--project', '-p', '--template', '-T',
    ]);
    const flagValue = (long, short) => {
        let found = null;
        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (a === long || a === short) found = args[i + 1] ?? '';
            else if (a.startsWith(`${long}=`)) found = a.slice(long.length + 1);
            else if (a.startsWith(short) && a.length > 2 && !a.startsWith('--')) found = a.slice(2); // -Bdevelop
            if (a === long || a === short || takesValue.has(a)) i++; // skip this flag's value
        }
        return found; // gh honours the last occurrence of a repeated flag
    };
    const base = flagValue('--base', '-B');
    const head = flagValue('--head', '-H');
    if (base !== 'main') {
        return block('Blocked: `gh pr create` needs an explicit `--base main`.');
    }
    if (!head) {
        return block('Blocked: `gh pr create` needs an explicit `--head <branch>`.');
    }
    return null;
}

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------

// git config keys that can redirect where a push goes or how it authenticates.
// (push.* keys such as push.default or push.autoSetupRemote cannot change the target.)
const RISKY_GIT_CONFIG = /^(remote\.|url\.|credential\.|core\.sshcommand$)/i;

function checkGit(args, inlineEnv = {}, exported = {}) {
    // Walk global options to find the subcommand, vetting `-c key=value`.
    let i = 0;
    while (i < args.length && args[i].startsWith('-')) {
        const a = args[i];
        let configKey = null;
        if (a === '-c' || a === '--config-env') configKey = (args[i + 1] ?? '').split('=')[0];
        else if (a.startsWith('--config-env=')) configKey = a.slice(13).split('=')[0];
        if (configKey !== null && RISKY_GIT_CONFIG.test(configKey)) {
            return block(`Blocked: \`git ${a} ${configKey}=...\` could redirect pushes or credentials.`);
        }
        i += ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env'].includes(a) ? 2 : 1;
    }
    const sub = args[i];
    const rest = args.slice(i + 1);

    if (sub === 'push') {
        const envKey = Object.keys({ ...exported, ...inlineEnv }).find((k) => /^(GIT_CONFIG_|GIT_SSH)/i.test(k));
        if (envKey) return block(`Blocked: \`git push\` with ${envKey}= could redirect the push.`);
        return checkGitPush(rest);
    }
    if (sub === 'remote') return checkGitRemote(rest);
    if (sub === 'config') return checkGitConfig(rest);
    return null;
}

/** Writes to push-redirecting config keys (`git config remote.origin.url ...`). */
function checkGitConfig(rest) {
    const readOnly = ['--get', '--get-all', '--get-regexp', '--get-urlmatch', '--list', '-l', '--show-origin', '--show-scope'];
    if (rest.some((a) => readOnly.includes(a))) return null;

    // Collect positionals, skipping the values of options that take one
    // (`git config -f .git/config remote.origin.url <url>`).
    const valueFlags = ['-f', '--file', '--blob', '--type', '--default', '--comment', '--value', '--url'];
    const positionals = [];
    for (let k = 0; k < rest.length; k++) {
        const a = rest[k];
        if (valueFlags.includes(a)) k++;
        else if (!a.startsWith('-')) positionals.push(a);
    }

    // Modern syntax: `git config set|unset|replace-all|... <key> [value]`.
    const verbs = ['set', 'unset', 'replace-all', 'add', 'rename-section', 'remove-section', 'edit'];
    const readVerbs = ['get', 'list'];
    let modifies = false;
    const verbRenames = positionals[0] === 'rename-section';
    if (positionals.length && readVerbs.includes(positionals[0])) return null;
    if (positionals.length && verbs.includes(positionals[0])) {
        if (positionals[0] === 'edit') {
            return block('Blocked: `git config edit` could redirect pushes or credentials.');
        }
        positionals.shift();
        modifies = true;
    }
    const key = positionals[0];
    // Legacy syntax: a write is `key value`, or --unset/--add/--replace-all/section edits.
    modifies =
        modifies ||
        positionals.length > 1 ||
        rest.some((a) => /^--(unset|unset-all|add|replace-all|remove-section|rename-section)$/.test(a));
    if (key !== undefined && RISKY_GIT_CONFIG.test(key) && modifies) {
        return block(`Blocked: \`git config ${key}\` write could redirect pushes or credentials.`);
    }
    // Section renames move settings between names: check both the old and the new
    // section (`git config rename-section foo remote.origin` adopts foo.pushurl).
    const renames = verbRenames || rest.includes('--rename-section');
    if (renames && positionals.some((p) => RISKY_GIT_CONFIG.test(`${p}.x`))) {
        return block('Blocked: `git config rename-section` involving a remote/url/credential section could redirect pushes.');
    }
    if (rest.includes('--edit') || rest.includes('-e')) {
        return block('Blocked: `git config --edit` could redirect pushes or credentials.');
    }
    return null;
}

function checkGitPush(rest) {
    const positionals = [];
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (['-o', '--push-option', '--receive-pack', '--exec'].includes(a)) i++;
        else if (a === '--repo' || a.startsWith('--repo=')) {
            return block('Blocked: `git push --repo` redirects the push; name the remote `origin` instead.');
        } else if (a === '--force' || a.startsWith('--force-with-lease') || a === '--force-if-includes') {
            return block('Blocked: force push.');
        } else if (a === '--mirror') {
            return block('Blocked: `git push --mirror` overwrites the remote.');
        } else if (/^-[a-zA-Z]*f[a-zA-Z]*$/.test(a)) {
            return block('Blocked: force push (-f).');
        } else if (!a.startsWith('-')) positionals.push(a);
    }
    const [remote, ...refspecs] = positionals;
    if (remote === undefined) {
        return block('Blocked: `git push` without an explicit remote; use `git push origin <branch>`.');
    }
    if (remote !== 'origin') {
        return block(`Blocked: \`git push ${remote}\`; only the \`origin\` remote may be pushed to.`);
    }
    if (refspecs.some((r) => r.startsWith('+'))) {
        return block('Blocked: force push via "+" refspec.');
    }
    return null;
}

function checkGitRemote(rest) {
    const sub = rest[0];
    const flags = [];
    const plain = [];
    for (let k = 1; k < rest.length; k++) {
        const a = rest[k];
        if (a.startsWith('-')) {
            flags.push(a);
            if (['-t', '-m', '--track', '--master'].includes(a)) k++; // option takes a value
        } else plain.push(a);
    }
    const [name, url] = plain;
    const originHint =
        '`origin` is https://github.com/Danathar/openaudible-autoupdate; it must not be removed, renamed or re-pointed.';

    // Anything that could remove, replace or re-point `origin` would defeat the
    // "push only to origin" rule (`git push origin` would then reach another repo).
    if (['remove', 'rm', 'rename'].includes(sub) && plain.includes('origin')) {
        return block(`Blocked: \`git remote ${sub}\` involving origin. ${originHint}`);
    }
    if (sub === 'add' && name === 'origin' && !isTarget(url ?? '')) {
        return block(`Blocked: \`git remote add origin\` with a URL that is not this repository. ${originHint}`);
    }
    if (sub !== 'set-url') return null;
    if (url === undefined) return null;
    const push = flags.includes('--push');
    if (push && url !== 'DISABLE' && !(name === 'origin' && isTarget(url))) {
        return block(
            `Blocked: \`git remote set-url --push ${name}\` to a real URL. ` +
                'Use `DISABLE`, or the Danathar/openaudible-autoupdate URL for origin.'
        );
    }
    if (name === 'origin' && !isTarget(url)) {
        return block(`Blocked: \`origin\` may only point at https://github.com/Danathar/openaudible-autoupdate.`);
    }
    return null;
}

// ---------------------------------------------------------------------------
// Updater / host-modifying commands
// ---------------------------------------------------------------------------

const PRIVILEGE = new Set(['sudo', 'doas', 'pkexec']);
const DNF = new Set(['dnf', 'dnf5', 'dnf-3', 'yum', 'microdnf']);
const CONTAINER_ENTER = new Set(['distrobox', 'distrobox-enter', 'distrobox-host-exec', 'toolbox']);
const CONTAINER_ENGINES = new Set(['podman', 'docker', 'nerdctl']);
// Words a wrapper (env, timeout, xargs, ...) can hide; we look through the wrapper to them.
const LOOKTHROUGH = new Set([
    'gh', 'git', ...SHELLS, 'eval', 'source', 'rpm', 'rpm-ostree', 'bootc', 'systemctl', 'systemd-run',
    ...PRIVILEGE, ...DNF, ...CONTAINER_ENTER, ...CONTAINER_ENGINES,
]);

/** True for `openaudible-autoupdate.sh` / `openaudible-autoupdate` in any path form. */
function isScriptName(word) {
    return basename(String(word)).replace(/\.sh$/, '') === SCRIPT;
}

const STUB_COMMANDS = ['sudo', 'dnf', 'rpm'];

/**
 * True if the FIRST entry of a PATH value is a stubs directory: inside the
 * project, under a `tests/<dir>` path, no `..`, no unresolved expansions other
 * than a leading $PWD / $CLAUDE_PROJECT_DIR, and holding executable stubs for
 * sudo, dnf and rpm (so the script's `sudo dnf install` cannot reach the real ones).
 */
export function stubsDirOk(pathValue) {
    if (!pathValue) return false;
    let dir = pathValue.split(':')[0];
    const root = (process.env.CLAUDE_PROJECT_DIR || process.cwd()).replace(/\/+$/, '');
    dir = dir.replace(/^\$(?:\{(?:PWD|CLAUDE_PROJECT_DIR)\}|PWD|CLAUDE_PROJECT_DIR)(?=\/|$)/, root);
    if (!dir || dir.includes('..') || /[$`~]/.test(dir)) return false;
    const abs = isAbsolute(dir) ? dir : join(root, dir);
    if (!abs.startsWith(`${root}/`) || !/(^|\/)tests\/[^/]/.test(abs.slice(root.length + 1))) return false;
    return STUB_COMMANDS.every((name) => {
        try {
            accessSync(join(abs, name), fsConstants.X_OK);
            return true;
        } catch {
            return false;
        }
    });
}

function checkUpdaterRun(envPath, state, what) {
    if (!state.noStubs && stubsDirOk(envPath)) return null;
    return block(
        `Blocked: ${what} would execute openaudible-autoupdate.sh, which runs \`sudo dnf install -y\` on this machine. ` +
            'Run it only inside `podman run`/`docker run`, or with PATH=<dir>:$PATH where <dir> is under tests/ ' +
            `inside this project and holds executable ${STUB_COMMANDS.join(', ')} stubs. ` +
            '`distrobox enter` / `toolbox run` reach the real container and never qualify.'
    );
}

/** `distrobox enter x -- cmd`, `toolbox run cmd`, `distrobox-host-exec cmd`: analyse cmd as running for real. */
function checkContainerEnter(cmd, args, state) {
    let inner = [];
    const dd = args.indexOf('--');
    if (cmd === 'distrobox-host-exec') {
        inner = args.slice(args.findIndex((a) => !a.startsWith('-')) === -1 ? args.length : args.findIndex((a) => !a.startsWith('-')));
    } else if (cmd === 'toolbox') {
        if (args.find((a) => !a.startsWith('-')) === 'run') {
            if (dd !== -1) inner = args.slice(dd + 1);
            else {
                let k = args.indexOf('run') + 1;
                while (k < args.length && args[k].startsWith('-')) k += ['-c', '--container', '-d', '--distro', '-r', '--release'].includes(args[k]) ? 2 : 1;
                inner = args.slice(k);
            }
        }
    } else if (cmd === 'distrobox-enter' || args[0] === 'enter') {
        if (dd !== -1) inner = args.slice(dd + 1);
    } else {
        return null; // other distrobox subcommands (create, list, ephemeral, ...) do not run our commands
    }
    if (inner.length) {
        const real = Object.assign(Object.create(state), { noStubs: true, exportedPath: undefined });
        return checkSegment(inner, real);
    }
    const named = args.find(isScriptName);
    if (named !== undefined) return checkUpdaterRun(undefined, { noStubs: true }, `\`${cmd} ... ${named}\``);
    return null;
}

function firstWord(args, valueFlags) {
    for (let i = 0; i < args.length; i++) {
        if (valueFlags.includes(args[i])) i++;
        else if (!args[i].startsWith('-')) return { sub: args[i], rest: args.slice(i + 1) };
    }
    return { sub: undefined, rest: [] };
}

const DNF_READ = ['list', 'info', 'search', 'repoquery', 'provides', 'whatprovides', 'check-update', 'check-upgrade', 'repolist', 'repoinfo', 'help'];

function checkDnf(cmd, args) {
    const { sub, rest } = firstWord(args, [
        '-c', '--config', '--installroot', '--releasever', '-x', '--exclude', '--repo', '--enablerepo',
        '--disablerepo', '--forcearch', '--destdir', '--downloaddir',
    ]);
    if (sub === undefined || DNF_READ.includes(sub)) return null;
    if ((sub === 'history' || sub === 'repo') && ['list', 'info'].includes(rest[0])) return null;
    return block(`Blocked: \`${cmd} ${sub}\` changes packages on this machine; only read-only queries (${DNF_READ.join(', ')}) are allowed.`);
}

function checkRpm(args) {
    const longs = args.filter((a) => a.startsWith('--'));
    const shorts = args.filter((a) => /^-[a-zA-Z]+$/.test(a)).join('');
    const writesLong = ['--install', '--upgrade', '--freshen', '--erase', '--reinstall', '--import', '--rebuilddb'];
    const query = /[qVK]/.test(shorts) || longs.some((l) => ['--query', '--verify', '--checksig'].includes(l));
    if (longs.some((l) => writesLong.includes(l)) || (!query && /[iUFe]/.test(shorts))) {
        return block('Blocked: `rpm` install/upgrade/erase modes change packages on this machine; query (-q), verify (-V) and checksig (-K) are fine.');
    }
    return null;
}

function checkImageTool(cmd, args) {
    const { sub } = firstWord(args, []);
    const readOnly = cmd === 'bootc' ? ['status'] : ['status', 'db', 'search'];
    if (sub === undefined || readOnly.includes(sub)) return null;
    return block(`Blocked: \`${cmd} ${sub}\` changes the booted image or layered packages; only ${readOnly.join('/')} are allowed.`);
}

const SYSTEMCTL_CHANGING = [
    'enable', 'reenable', 'start', 'restart', 'try-restart', 'reload-or-restart', 'try-reload-or-restart',
    'link', 'edit', 'add-wants', 'add-requires', 'preset', 'unmask', 'isolate', 'revert',
];

function checkSystemctl(args) {
    const { sub } = firstWord(args, ['-H', '--host', '-M', '--machine', '-p', '--property', '-t', '--type', '-s', '--signal', '-n', '--lines', '-o', '--output', '--state']);
    if (sub !== undefined && SYSTEMCTL_CHANGING.includes(sub) && args.some((a) => a.includes(SCRIPT))) {
        return block(`Blocked: \`systemctl ${sub}\` of an ${SCRIPT}* unit would schedule the real updater on this machine (user or system scope).`);
    }
    return null;
}

// ---------------------------------------------------------------------------
// Segment / command analysis
// ---------------------------------------------------------------------------

function checkSegment(words, state) {
    let w = words.slice();
    const inlineEnv = {};
    for (;;) {
        while (w.length && (isAssignment(w[0]) || KEYWORDS.has(w[0]))) {
            if (isAssignment(w[0])) {
                const eq = w[0].indexOf('=');
                inlineEnv[w[0].slice(0, eq)] = w[0].slice(eq + 1);
            }
            w.shift();
        }
        if (!w.length) return null;
        const cmd = basename(w[0]);
        if (PRIVILEGE.has(cmd)) {
            return block(`Blocked: \`${cmd}\` (privilege escalation) is never run by agents in this repository.`);
        }
        if (!WRAPPERS.has(cmd)) break;
        // `env -S 'gh pr create'` / `--split-string=...` runs a command string.
        // Only env's own leading options and NAME=value words are scanned; the
        // wrapped command's arguments (e.g. `--title -Sx`) are not env options.
        if (cmd === 'env') {
            for (let k = 1; k < w.length; k++) {
                const a = w[k];
                if (isAssignment(a)) continue;
                if (!a.startsWith('-')) break; // first word of the wrapped command
                if (['-u', '--unset', '-C', '--chdir'].includes(a)) {
                    k++;
                    continue;
                }
                let script = null;
                let rest = k + 1;
                if (a === '-S' || a === '--split-string') {
                    script = w[k + 1] ?? '';
                    rest = k + 2;
                } else if (a.startsWith('--split-string=')) script = a.slice(15);
                else if (/^-S./.test(a)) script = a.slice(2);
                if (script === null) continue;
                // Check the string on its own, then as the head of the command
                // that still has the remaining words appended.
                const alone = checkCommand(script, state);
                if (alone) return alone;
                const head = tokenize(script).flat();
                return checkSegment([...head, ...w.slice(rest)], state);
            }
        }
        // Look through the wrapper for the real command.
        const idx = w.findIndex((x, n) => n > 0 && (LOOKTHROUGH.has(basename(x)) || isScriptName(x)));
        for (const x of w.slice(1, idx === -1 ? w.length : idx)) {
            if (isAssignment(x)) {
                const eq = x.indexOf('=');
                inlineEnv[x.slice(0, eq)] = x.slice(eq + 1);
            }
        }
        if (idx === -1) return null;
        w = w.slice(idx);
    }

    const cmd = basename(w[0]);
    const args = w.slice(1);
    const envPath = inlineEnv.PATH ?? state.exportedPath;
    // Nested analysis (`bash -c '...'`, `eval`) sees this segment's PATH, but
    // anything it exports stays inside it, as in a real subshell.
    const nested = (extra = {}) => Object.assign(Object.create(state), { exportedPath: envPath }, extra);

    if (cmd === 'export' || ((cmd === 'declare' || cmd === 'typeset') && args.some((a) => /^-[a-zA-Z]*x/.test(a)))) {
        for (const a of args) {
            if (a.startsWith('GH_REPO=')) state.exportedGhRepo = a.slice(8);
            if (a.startsWith('PATH=')) state.exportedPath = a.slice(5);
            if (/^(GIT_CONFIG_|GIT_SSH)/i.test(a)) (state.exportedEnv ??= {})[a.split('=')[0]] = a;
        }
        return null;
    }
    if (cmd === 'gh') {
        const envRepo = inlineEnv.GH_REPO ?? state.exportedGhRepo ?? null;
        return checkGh(args, envRepo);
    }
    if (cmd === 'git') return checkGit(args, inlineEnv, state.exportedEnv ?? {});
    if (isScriptName(w[0])) return checkUpdaterRun(envPath, state, `Running ${w[0]}`);
    if (cmd === 'source' || cmd === '.') {
        return args.some(isScriptName) ? checkUpdaterRun(envPath, state, `Sourcing ${args.find(isScriptName)}`) : null;
    }
    if (SHELLS.has(cmd)) {
        const c = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
        // The script is the first non-option word after -c (`sh -c -- 'cmd'`, `sh -c -x 'cmd'`).
        const script = c === -1 ? undefined : args.slice(c + 1).find((a) => !a.startsWith('-'));
        if (script !== undefined) return checkCommand(script, nested());
        // `bash -n file` only parses the file; any other shell invocation runs it.
        const syntaxOnly = args.some((a) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(a));
        const target = args.find(isScriptName);
        if (!syntaxOnly && target !== undefined) return checkUpdaterRun(envPath, state, `\`${cmd} ${target}\``);
        return null;
    }
    if (cmd === 'eval') return checkCommand(args.join(' '), nested());
    if (DNF.has(cmd)) return checkDnf(cmd, args);
    if (cmd === 'rpm') return checkRpm(args);
    if (cmd === 'rpm-ostree' || cmd === 'bootc') return checkImageTool(cmd, args);
    if (cmd === 'systemctl') return checkSystemctl(args);
    if (cmd === 'systemd-run') {
        const target = args.find((a) => isScriptName(a) || a.includes(SCRIPT));
        return target === undefined ? null : block(`Blocked: \`systemd-run ${target}\` would run openaudible-autoupdate.sh outside any stub or container.`);
    }
    if (CONTAINER_ENTER.has(cmd)) return checkContainerEnter(cmd, args, state);
    if (CONTAINER_ENGINES.has(cmd)) {
        // `exec`/`attach` reach long-lived containers, including the distrobox
        // container (distrobox containers are podman containers).
        const sub = args.find((a) => !a.startsWith('-'));
        if (sub === 'exec' || sub === 'attach') {
            return block(`Blocked: \`${cmd} ${sub}\` enters an existing container, possibly the real distrobox one; use \`${cmd} run\` with a throwaway container.`);
        }
        return null;
    }
    return null;
}

/** Analyse a command line. Returns null if allowed, else { blocked, reason }. */
export function checkCommand(command, state = {}) {
    for (const sub of extractSubstitutions(command)) {
        const r = checkCommand(sub, state);
        if (r) return r;
    }
    for (const words of tokenize(command)) {
        const r = checkSegment(words, state);
        if (r) return r;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
    let payload;
    try {
        payload = JSON.parse(readFileSync(0, 'utf8'));
    } catch {
        process.stderr.write('guard-bash: could not parse hook input as JSON; blocking (fail closed).\n');
        process.exit(2);
    }
    if (payload?.tool_name && payload.tool_name !== 'Bash') process.exit(0);
    const command = payload?.tool_input?.command;
    if (typeof command !== 'string' || !command.trim()) process.exit(0);

    const result = checkCommand(command);
    if (result) {
        process.stderr.write(`guard-bash: ${result.reason}\n`);
        process.exit(2);
    }
    process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
