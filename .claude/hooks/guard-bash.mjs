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
//     remote, or no explicit remote; git push that deletes remote refs
//     (--delete, -d, --prune, an `origin :ref` refspec). A long push option is
//     also refused when abbreviated, as git accepts it (`--force-w`, `--mirr`,
//     `--del`, `--rep=URL`).
//   - git config / git remote changes that re-point `origin` or push URLs.
//   - git options that write a file, read outside the repository or run a
//     program on the pre-approved read commands: --output[=FILE], --no-index,
//     --ext-diff, git grep -O/--open-files-in-pager, --exec-path=DIR, and
//     `-c` keys such as diff.external, core.pager, alias.*, protocol.*
//     (protocol.ext.allow=always); GIT_* / PAGER / EDITOR variables (inline or
//     exported) other than identity and no-op pagers (GIT_EXTERNAL_DIFF=,
//     GIT_TRACE=FILE, GIT_DIR=, ...).
//   - --upload-pack (and its abbreviations such as --upl), --exec and
//     clone/ls-remote -u on git fetch|pull|clone|ls-remote|archive, which run
//     the program they name.
//   - git, node or a shell run through xargs: xargs appends words read at run
//     time (`printf '%s\n' --output=FILE | xargs git log`), so none of the
//     argument checks here could see them.
//   - `bash -n` (pre-approved syntax check) with a word beginning with +
//     (`+n`, `+o noexec` turn -n off and run the script) or one bash could
//     expand into such a word ({, }, *, ?, [, $, backtick).
//   node
//   - `node --test` with any option outside the test-runner allowlist
//     (--import, --require/-r, --loader, module reporters,
//     --test-reporter-destination=FILE, ...), and node with NODE_OPTIONS or
//     another NODE_* variable set inline or exported.
//   Updater and host-modifying commands
//   - Executing openaudible-autoupdate.sh (or the installed
//     `openaudible-autoupdate` name): directly, via bash/sh/zsh/dash/ksh/fish/...,
//     source,
//     `.`, env/timeout/xargs/other wrappers, systemd-run, or via
//     `distrobox enter` / `toolbox run`. The only exemptions are:
//       1. the e2e harness: `podman run ...` / `docker run ...` with a
//          `tests/e2e` path (the script then runs against the container's own
//          throwaway rpm database), and
//       2. an inline `PATH=<dir>[:...]` (or `export PATH=...`) whose FIRST
//          entry is an absolute path (or `$CLAUDE_PROJECT_DIR/...`) inside
//          the project under a `tests/<dir>` component, contains no `..`,
//          and holds executable stubs for `sudo`, `dnf` and `rpm` (checked on
//          disk). Relative entries never qualify: the shell resolves them
//          against its own cwd. Stubs shadow the real commands, so nothing
//          is installed.
//     `distrobox enter` / `toolbox run|enter` / `distrobox-enter` are refused
//     outright: they enter the developer's real long-lived container.
//     `podman exec` / `docker exec` are refused for the same reason (distrobox
//     containers are podman containers). A `podman|docker run` whose arguments
//     mention the updater is allowed only when they also contain a
//     `tests/e2e` path. `sh -n` / `bash -n` (syntax check) and tools that merely
//     read the file (shellcheck, cat, grep, ...) are fine. bats is not one of
//     them: it sources every file it is given (and a --setup-suite-file, and
//     runs a -F formatter path) to collect tests, so the file's top-level code
//     runs. `bats openaudible-autoupdate.sh` therefore needs the same stubs on
//     PATH as running the script directly; `bats tests/unit` is unaffected.
//     A word the shell could expand into the updater's path counts as naming
//     it: a pattern matching its name (`openaudible-*.sh`), a `{...}` brace
//     expansion, or a `$X` / `$(...)` in the file name.
//   - sudo / doas / pkexec / run0 / su / runuser in any position of a wrapper
//     chain, including behind systemd-run, flatpak-spawn and `find -exec`.
//   - dnf/dnf5/yum/microdnf subcommands other than read-only queries (list,
//     info, search, repoquery, provides, check-update, repolist, ...).
//   - rpm install/upgrade/freshen/erase modes (-i -U -F -e and long forms),
//     refused even when a query flag is also present; plain query (-q, -qi),
//     verify (-V) and checksig (-K) are fine.
//   - rpm-ostree / bootc / pkcon subcommands other than read-only ones
//     (rpm-ostree: status, db; bootc: status; pkcon: search, get-*, ...). On
//     an Aurora/Bluefin host `rpm-ostree install` layers packages.
//   - systemctl enable/start/restart/link/... of anything named
//     openaudible-autoupdate*, with or without --user.
//
// Parsing notes: redirections (`>log`, `2>&1`, `&>f`, `<file`) end the word
// and are not arguments, so `./openaudible-autoupdate.sh>log` is still the
// script. A shell with no script operand that reads the updater on stdin
// (`cat openaudible-autoupdate.sh | bash`, `bash -s < openaudible-autoupdate.sh`,
// `bash -c "$(cat openaudible-autoupdate.sh)"`) counts as running it. Quoted
// heredoc bodies are data. Wrappers (env, timeout, xargs, time, flock, watch,
// taskset, chrt, unshare, nsenter, setpriv, chroot, busybox, exec -a, ...) are
// looked through to the command they run, not to a later argument; so are
// `find -exec|-execdir|-ok|-okdir CMD ... ;`, the body after `function NAME`
// and the command after `coproc`. Behind any other program (`setarch x86_64`,
// `prlimit`, `strace -o log`, `script -qc '...'`), each later word naming a
// command this hook checks, and each command string a word carries, is checked
// as though it stood alone; the updater named there is not, since `less FILE`
// and a program that runs FILE look alike. A command name is read as the shell
// reads it before looking it up, so `{git,}`, `$'\x67it'`, `$"git"` and
// `/usr/bin/g?t` are checked as git, here or behind any program; a command
// name whose brace groups can build a checked command in any of their forms
// (`{x,git}`), or make too many forms to read, is refused. Wrapper
// options are read as getopt reads them, so a packed (`env -iu X`) or
// abbreviated (`env --uns X`) option's value is not taken for the command.
// Deliberate obfuscation (variables, built strings, scripts written then run)
// stays out of scope.
//
// Read-only gh commands (view, list, status, diff, checks, api GET, ...) are
// always allowed. The command is split into segments on && || ; | & newlines,
// subshells and command substitutions; shell -c, eval, watch and
// `flock FILE -c` strings are analysed recursively. Quoted text is data, so a quoted "sudo" or script name inside
// an `echo` or a read-only command is fine.
//
// Layout: the reading described in these notes (words, quotes, `$'...'`,
// substitutions and heredocs, brace and wildcard names, wrappers and the
// commands they run, shell and fish command strings, the git option, config
// and environment rules, the time budget) lives in shell-reader.mjs. That file
// names no repository and is kept byte-identical in every repository that
// carries this guard (its sha256 is pinned by
// .claude/hooks/tests/shell-reader.test.mjs); a reading fix is made in
// Danathar/akmods first and then copied. This file holds this repository's
// rules (the list above), its messages, a stricter command-name reading kept on
// top of the shared one (see CHECKED_NAMES below) and the hook's entry point,
// and imports the reader.

import { basename, join, isAbsolute, resolve } from 'node:path';
import { readFileSync, accessSync, realpathSync, constants as fsConstants } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Reading the command line as the shell would is shared with the other
// repositories that carry this guard; see shell-reader.mjs.
import {
    ARGUMENT_ONLY_PROGRAMS, BUDGET_MS, COMMAND_STRING_SEPARATORS, commandNameReader, commandStrings, EXEC_GIT_CONFIG,
    expandWrapperOptions, extractSubstitutions, FIND_EXEC, fishScripts, firstWord, GIT_EXEC_OPTION, GIT_SHORT_UPLOAD_PACK,
    GIT_UPLOAD_PACK_OPTION, GIT_UPLOAD_PACK_SUBCOMMANDS, isAssignment, KEYWORDS, MAX_BRACE_FORMS, MAX_UNLISTED_INNER,
    OverBudget, REFUSED_GIT_OPTION, RISKY_GIT_CONFIG, riskyEnv, SAFE_ENV, SHELLS, spend, startBudget, tokenize, unquoted,
    WATCHED_ENV, WRAPPERS, wrapperTarget,
} from './shell-reader.mjs';

// Kept importable from here, where they were defined before the split.
export { BUDGET_MS, extractSubstitutions, tokenize } from './shell-reader.mjs';

export const REPO = 'danathar/openaudible-autoupdate';
export const SCRIPT = 'openaudible-autoupdate';

const GUIDANCE =
    'Hard rules for this repository: never run openaudible-autoupdate.sh, sudo or a package install on the host ' +
    '(it runs `sudo dnf install -y`); test it only with stubs on PATH (tests/) or the tests/e2e container harness. ' +
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
        if (configKey !== null && EXEC_GIT_CONFIG.test(configKey)) {
            return block(`Blocked: \`git ${a} ${configKey}=...\` makes git run a program or read other config.`);
        }
        if (a.startsWith('--exec-path=')) {
            return block('Blocked: `git --exec-path=DIR` runs git commands from another directory.');
        }
        i += ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env'].includes(a) ? 2 : 1;
    }
    const sub = args[i];
    const rest = args.slice(i + 1);

    const env = { ...exported, ...inlineEnv };
    if (sub === 'push') {
        const pushKey = Object.keys(env).find((k) => /^(GIT_CONFIG_|GIT_SSH)/i.test(k));
        if (pushKey) return block(`Blocked: \`git push\` with ${pushKey}= could redirect the push.`);
    }
    const envKey = riskyEnv(env);
    if (envKey) {
        return block(
            `Blocked: \`git\` with ${envKey} set; it can make git run a program, write a file or read another repository/config. ` +
                'Only GIT_AUTHOR_*/GIT_COMMITTER_* identity and PAGER/GIT_PAGER/GIT_EDITOR=cat|true are allowed.'
        );
    }
    const refused = args.find((a) => REFUSED_GIT_OPTION.test(a)) ?? (sub === 'grep' ? rest.find((a) => /^-[a-zA-Z]*O/.test(a)) : undefined);
    if (refused !== undefined) {
        return block(
            `Blocked: \`git ${sub ?? ''} ${refused}\` writes a file, reads outside the repository or runs a program. ` +
                'Read the output on stdout instead (pipe it, or use the Write tool to save it).'
        );
    }
    if (GIT_UPLOAD_PACK_SUBCOMMANDS.has(sub)) {
        const program = rest.find(
            (a) =>
                GIT_UPLOAD_PACK_OPTION.test(a) ||
                ((sub === 'ls-remote' || sub === 'archive') && GIT_EXEC_OPTION.test(a)) ||
                ((sub === 'clone' || sub === 'ls-remote') && GIT_SHORT_UPLOAD_PACK.test(a))
        );
        if (program !== undefined) {
            return block(
                `Blocked: \`git ${sub} ${program}\` runs the program it names (--upload-pack, --exec, clone/ls-remote -u). ` +
                    'Use plain `git fetch [remote]`.'
            );
        }
    }
    if (sub === 'push') return checkGitPush(rest);
    if (sub === 'remote') return checkGitRemote(rest);
    if (sub === 'config') return checkGitConfig(rest);
    return null;
}

/** Writes to push-redirecting config keys (`git config remote.origin.url ...`). */
function checkGitConfig(rest) {
    // Only flags that pick a read mode. --show-origin/--show-scope are display
    // modifiers: `git config --show-scope remote.origin.url URL` still writes.
    const readOnly = ['--get', '--get-all', '--get-regexp', '--get-urlmatch', '--list', '-l'];
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

// Long `git push` options that force, mirror, delete or redirect. git accepts any
// unambiguous abbreviation of a long option (`--force-w`, `--del`, `--mirr`), so a
// word that is a prefix of one of these is refused, not just the full spelling.
const PUSH_DANGER = [
    ['--force', 'force push'], ['--force-with-lease', 'force push'], ['--force-if-includes', 'force push'],
    ['--mirror', '`git push --mirror` overwrites the remote'], ['--delete', 'deleting remote refs'],
    ['--prune', 'deleting remote refs (--prune)'], ['--repo', '`git push --repo` redirects the push; name the remote `origin` instead'],
];

function checkGitPush(rest) {
    const positionals = [];
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (['-o', '--push-option', '--receive-pack', '--exec'].includes(a)) {
            i++;
            continue;
        }
        if (a.startsWith('--') && a.length > 2) {
            const name = a.split('=')[0];
            const hit = name.length >= 3 ? PUSH_DANGER.find(([full]) => full.startsWith(name)) : undefined;
            if (hit) return block(`Blocked: \`git push ${a}\`: ${hit[1]}.`);
        } else if (/^-[a-zA-Z]*f[a-zA-Z]*$/.test(a)) {
            return block('Blocked: force push (-f).');
        } else if (/^-[a-zA-Z]*d[a-zA-Z]*$/.test(a)) {
            return block('Blocked: `git push -d` deletes remote refs.');
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
    if (refspecs.some((r) => r.startsWith(':'))) {
        return block('Blocked: `git push origin :ref` deletes a remote ref.');
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
// node --test
// ---------------------------------------------------------------------------

// `node --test` is pre-approved in .claude/settings.json, but node options load
// and run any code (`--import`, `--require`/`-r`, `--loader`, a module
// `--test-reporter`, `--test-global-setup`, `--experimental-config-file`) or
// write files (`--test-reporter-destination=FILE`, `--cpu-prof-dir`,
// `--redirect-warnings`). In test mode only the test-runner options below are
// allowed; everything else, and any NODE_* variable such as NODE_OPTIONS, is
// refused. Value: null = any value, RegExp = the value must match.
const NODE_TEST_OPTIONS = {
    '--test': false,
    '--test-only': false,
    '--watch': false,
    '--test-force-exit': false,
    '--experimental-test-coverage': false,
    '--no-warnings': false,
    '--enable-source-maps': false,
    '--test-name-pattern': null,
    '--test-skip-pattern': null,
    '--test-coverage-include': null,
    '--test-coverage-exclude': null,
    '--test-concurrency': /^\d+$/,
    '--test-timeout': /^\d+$/,
    '--test-shard': /^\d+\/\d+$/,
    '--test-isolation': /^(process|none)$/,
    '--experimental-test-isolation': /^(process|none)$/,
    '--test-coverage-lines': /^\d+(\.\d+)?$/,
    '--test-coverage-branches': /^\d+(\.\d+)?$/,
    '--test-coverage-functions': /^\d+(\.\d+)?$/,
    '--test-reporter': /^(spec|tap|dot|junit|lcov)$/,
    '--test-reporter-destination': /^(stdout|stderr)$/,
};

function checkNode(cmd, args, env) {
    const envKey = Object.keys(env).find((k) => /^NODE_/.test(k) && !SAFE_ENV.has(k));
    if (envKey) {
        return block(`Blocked: \`${cmd}\` with ${envKey} set; NODE_OPTIONS and other NODE_* variables can load code or write files.`);
    }
    if (!args.includes('--test')) return null; // not the pre-approved test runner; Claude Code asks
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (!a.startsWith('-') || a === '-' || a === '--') continue; // test files / patterns
        const eq = a.indexOf('=');
        const name = eq === -1 ? a : a.slice(0, eq);
        const rule = Object.hasOwn(NODE_TEST_OPTIONS, name) ? NODE_TEST_OPTIONS[name] : undefined;
        let ok = rule !== undefined;
        if (ok && rule === false) ok = eq === -1;
        else if (ok) {
            const value = eq === -1 ? args[++i] : a.slice(eq + 1);
            ok = value !== undefined && (rule === null || rule.test(value));
        }
        if (!ok) {
            return block(
                `Blocked: \`${cmd} --test ... ${a}\`; only test-runner options (name/skip pattern, concurrency, timeout, shard, ` +
                    'isolation, coverage, --watch, --test-only, reporters spec|tap|dot|junit|lcov to stdout|stderr) are allowed. ' +
                    'Other node options can run code (--import, --require, --loader, module reporters) or write files.'
            );
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Updater / host-modifying commands
// ---------------------------------------------------------------------------

const PRIVILEGE = new Set(['sudo', 'doas', 'pkexec', 'run0', 'su', 'runuser']);
const DNF = new Set(['dnf', 'dnf5', 'dnf-3', 'yum', 'microdnf']);
const CONTAINER_ENTER = new Set(['distrobox', 'distrobox-enter', 'distrobox-host-exec', 'toolbox']);
const CONTAINER_ENGINES = new Set(['podman', 'docker', 'nerdctl']);
// Words a wrapper (env, timeout, xargs, ...) can hide; we look through the wrapper to them.
const LOOKTHROUGH = new Set([
    'gh', 'git', 'node', 'nodejs', ...SHELLS, 'eval', 'source', 'bats', 'rpm', 'rpm-ostree', 'bootc', 'pkcon', 'systemctl', 'systemd-run',
    ...PRIVILEGE, 'flatpak-spawn', ...DNF, ...CONTAINER_ENTER, ...CONTAINER_ENGINES,
]);

/** True if a tokenized segment names the updater as an argument or reads it with `<`. */
function segmentReadsUpdater(seg) {
    return seg.some(mayNameScript) || (seg.stdinFrom !== undefined && mayNameScript(seg.stdinFrom));
}

/** True if a command line (a substitution body) reads or names the updater. */
function readsUpdater(commandLine) {
    return tokenize(commandLine).some(segmentReadsUpdater);
}

/**
 * The updater named in a bats argument, in any spelling bats accepts: an
 * operand, `--opt=FILE` (--setup-suite-file=, --formatter=, ...) or a short
 * option with its value attached (`-F./openaudible-autoupdate.sh`).
 */
function batsUpdaterArg(args) {
    return args.find((a) => {
        const eq = a.indexOf('=');
        return mayNameScript(a) || (a.startsWith('--') && eq !== -1 && mayNameScript(a.slice(eq + 1))) ||
            (/^-[^-]/.test(a) && mayNameScript(a.slice(2)));
    });
}

/** True for `openaudible-autoupdate.sh` / `openaudible-autoupdate` in any path form. */
function isScriptName(word) {
    return basename(String(word)).replace(/\.sh$/, '') === SCRIPT;
}

/**
 * True if the shell could turn this word into the updater's path: it names
 * the updater, or its file name (the part after the last `/`) is a pattern
 * that matches the updater's name (`openaudible-*.sh`, `openaudible-autoupdat?`,
 * `openaudible-autoupdate.s[h]`), or holds an expansion whose value we cannot
 * see (`$X`, `$(...)`). Brace expansion can build any name, so any `{...}`
 * counts. The tokenizer has already dropped quotes, so a quoted `*` counts too.
 */
function mayNameScript(word) {
    const w = String(word);
    if (isScriptName(w)) return true;
    if (/[{}]/.test(w)) return true;
    const name = w.slice(w.lastIndexOf('/') + 1);
    if (name.includes('$')) return true;
    if (!/[*?[]/.test(name)) return false;
    return globMatch(name, `${SCRIPT}.sh`) || globMatch(name, SCRIPT);
}

/**
 * A pathname pattern as a regular expression that matches at least every
 * name the shell would match: `*` and `?` as in the shell, and a bracket
 * expression (with `[:class:]` parts and a leading `]` handled) as any one
 * character. An unclosed `[` is a literal, as in the shell.
 */
function globMatch(pattern, text) {
    // Match a pathname pattern against one name in linear time, so an input
    // cannot blow the hook's time budget (a pattern of many `*` compiled to a
    // regexp — `.*.*.*…` — backtracks exponentially against a non-matching
    // name, and that regexp runs inside a single `.test()` call that the
    // per-step budget check can never interrupt, so the hook runs past its
    // timeout and Claude Code then runs the command unchecked). This is the
    // classic single-star-pointer algorithm: `*` matches any run, `?` and a
    // bracket expression match one character, every other character is literal,
    // and an unclosed `[` is literal — the same semantics the old regexp gave.
    let p = 0;
    let t = 0;
    let star = -1;
    let afterStar = 0;
    const consumesOne = (i) =>
        pattern[i] === '?' || (pattern[i] === '[' && bracketEnd(pattern, i) !== -1);
    while (t < text.length) {
        if (p < pattern.length && consumesOne(p)) {
            p = pattern[p] === '[' ? bracketEnd(pattern, p) + 1 : p + 1;
            t++;
        } else if (p < pattern.length && pattern[p] === '*') {
            star = p;
            afterStar = t;
            p++;
        } else if (p < pattern.length && pattern[p] === text[t]) {
            p++;
            t++;
        } else if (star !== -1) {
            p = star + 1;
            afterStar++;
            t = afterStar;
        } else {
            return false;
        }
    }
    while (pattern[p] === '*') p++;
    return p === pattern.length;
}

/** Index of the `]` closing the bracket expression opened at `start`, or -1. */
function bracketEnd(pattern, start) {
    let j = start + 1;
    if (pattern[j] === '!' || pattern[j] === '^') j++;
    if (pattern[j] === ']') j++;
    while (j < pattern.length) {
        if (pattern[j] === '[' && ':=.'.includes(pattern[j + 1] ?? 'x')) {
            // An unclosed `[:` / `[=` / `[.` is no class: the shell takes the
            // `[` as one more member of the set (`[[:a]` matches `[`, `:` or `a`).
            const close = pattern.indexOf(`${pattern[j + 1]}]`, j + 2);
            j = close === -1 ? j + 1 : close + 2;
        } else if (pattern[j] === ']') {
            return j;
        } else {
            j++;
        }
    }
    return -1;
}

const STUB_COMMANDS = ['sudo', 'dnf', 'rpm'];

/**
 * True if the FIRST entry of a PATH value is a stubs directory: an absolute
 * path (or one anchored at $CLAUDE_PROJECT_DIR) inside the project, under a
 * `tests/<dir>` path, no `..`, no other expansions, and holding executable
 * stubs for sudo, dnf and rpm (so the script's `sudo dnf install` cannot reach
 * the real ones). Relative entries are refused: they resolve against the
 * shell's cwd, not the project root.
 */
export function stubsDirOk(pathValue) {
    if (!pathValue) return false;
    let dir = pathValue.split(':')[0];
    const root = (process.env.CLAUDE_PROJECT_DIR || process.cwd()).replace(/\/+$/, '');
    dir = dir.replace(/^\$(?:\{CLAUDE_PROJECT_DIR\}|CLAUDE_PROJECT_DIR)(?=\/|$)/, root);
    if (!isAbsolute(dir) || dir.includes('..') || /[$`~]/.test(dir)) return false;
    // Resolve symlinks: a `tests/stubs` link (or stub file) pointing outside the
    // project must not make the real sudo/dnf/rpm satisfy the exemption.
    let realRoot;
    let abs;
    try {
        realRoot = realpathSync(root);
        abs = realpathSync(dir);
    } catch {
        return false;
    }
    const within = (path) => path.startsWith(`${realRoot}/`);
    if (!within(abs) || !/(^|\/)tests\/[^/]/.test(abs.slice(realRoot.length + 1))) return false;
    return STUB_COMMANDS.every((name) => {
        try {
            const file = realpathSync(join(abs, name));
            accessSync(file, fsConstants.X_OK);
            return within(file);
        } catch {
            return false;
        }
    });
}

function checkUpdaterRun(envPath, state, what) {
    if (!state.noStubs && stubsDirOk(envPath)) return null;
    return block(
        `Blocked: ${what} would execute openaudible-autoupdate.sh, which runs \`sudo dnf install -y\` on this machine. ` +
            'Run it only through the tests/e2e container harness, or with PATH=<dir>:$PATH where <dir> is under tests/ ' +
            `inside this project and holds executable ${STUB_COMMANDS.join(', ')} stubs. ` +
            '`distrobox enter` / `toolbox run` reach the real container and never qualify.'
    );
}

/** `distrobox enter`, `toolbox run|enter`: the real container, always refused; `distrobox-host-exec cmd`: cmd is analysed as running for real. */
function checkContainerEnter(cmd, args, state) {
    const sub = args.find((a) => !a.startsWith('-'));
    if (cmd === 'distrobox-enter' || (cmd === 'distrobox' && sub === 'enter') || (cmd === 'toolbox' && (sub === 'run' || sub === 'enter'))) {
        return block(`Blocked: \`${cmd}${sub ? ` ${sub}` : ''}\` enters the developer's real long-lived container (real rpm database, working sudo); use \`podman run\` of tests/e2e instead.`);
    }
    if (cmd !== 'distrobox-host-exec') return null; // other distrobox/toolbox subcommands (create, list, ephemeral, ...) run nothing of ours
    const at = args.findIndex((a) => !a.startsWith('-'));
    const inner = at === -1 ? [] : args.slice(at);
    if (!inner.length) {
        return block('Blocked: `distrobox-host-exec` with no command starts a shell on the host, which runs whatever reaches its stdin; name the command to run.');
    }
    const real = Object.assign(Object.create(state), { noStubs: true, exportedPath: undefined });
    return checkSegment(inner, real);
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
    const shorts = args.filter((a) => /^-[a-zA-Z]+$/.test(a));
    const writesLong = ['--install', '--upgrade', '--freshen', '--erase', '--reinstall', '--import', '--rebuilddb'];
    const queryLong = longs.some((l) => ['--query', '--verify', '--checksig'].includes(l));
    // -U/-F/-e change packages wherever they appear, even next to -q; -i is
    // "info" only when a query/verify/checksig flag is also present
    // (`rpm -qi`, `rpm -q -i`).
    const queryMode = queryLong || shorts.some((s) => /[qVK]/.test(s));
    const writes = shorts.some((s) => /[UFe]/.test(s) || (/i/.test(s) && !queryMode));
    if (longs.some((l) => writesLong.includes(l)) || writes) {
        return block('Blocked: `rpm` install/upgrade/erase modes change packages on this machine; query (-q), verify (-V) and checksig (-K) are fine.');
    }
    return null;
}


function checkImageTool(cmd, args) {
    const { sub } = firstWord(args, []);
    const readOnly = {
        'rpm-ostree': ['status', 'db', 'help'],
        bootc: ['status', 'help'],
        pkcon: ['search', 'resolve', 'what-provides', 'get-details', 'get-files', 'get-packages', 'get-updates', 'get-update-detail', 'repo-list', 'help'],
    }[cmd];
    if (sub === undefined || readOnly.includes(sub)) return null;
    return block(`Blocked: \`${cmd} ${sub}\` changes the booted image or installed packages; only ${readOnly.join('/')} are allowed.`);
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

/**
 * `find ... -exec|-execdir|-ok|-okdir CMD ARGS ;` (or `{} +`) runs CMD for each
 * file: analyse each such command like a segment of its own.
 */
function checkFindExec(args, state) {
    for (let i = 0; i < args.length; i++) {
        if (!FIND_EXEC.includes(args[i])) continue;
        let end = i + 1;
        while (end < args.length && args[end] !== ';' && !(args[end] === '+' && args[end - 1] === '{}')) end++;
        const r = checkSegment(args.slice(i + 1, end), Object.create(state));
        if (r) return r;
        i = end;
    }
    return null;
}

// Bash reads a command word before it looks the program up: it decodes
// `$'...'` escapes (`$'\x67it'` is `git`; the shared tokenizer does that),
// drops quotes and backslashes, expands brace groups (`{git,}` is `git`, the
// empty word dropped; `{git,diff}` is `git diff`) and matches a word holding a
// wildcard against the filesystem (`/usr/bin/g?t` is `/usr/bin/git`). A name
// read as typed is then not the program that runs, so each reading that names
// a command this hook checks is checked as that command (#135). A bare
// wildcard (`g?t`) matches files in the working directory, but the word it
// expands to is then looked up on the PATH like any other: after `touch git`,
// `g?t push --force` runs /usr/bin/git. So a bare wildcard is read too. A name
// built from a variable is still not followed.
//
// The shared reader (commandNameReader() in shell-reader.mjs) reads brace and
// wildcard names too, and a word is checked when either reading finds a
// checked command in it. The reading kept here is stricter in three ways the
// shared one does not cover: it expands `{X..Y}` sequences and nested groups,
// it re-checks the words an expansion makes as the command line they start
// (`{git,diff} --no-index` is `git diff --no-index`), and it matches a bracket
// expression with a class (`[[:alpha:]]it`) as any one character.
const CHECKED_NAMES = new Set([...LOOKTHROUGH, 'find', 'watch', 'flock', ...WRAPPERS]);
const { builtCommandName, namesCheckedCommand } = commandNameReader(CHECKED_NAMES);
// Brace groups multiply. Only the first words of an expansion name the
// command, so at most MAX_BRACE_FORMS are kept; a word whose groups make more
// than MAX_BRACE_LEAVES forms, empty ones included, is refused unread.
const MAX_BRACE_LEAVES = 1024;

/** Whether this word, as typed, names a command checkSegment() checks, looks through or refuses. */
function isCheckedName(a) {
    return CHECKED_NAMES.has(basename(a));
}

/** The words of a `{X..Y[..STEP]}` sequence body, at most MAX_BRACE_FORMS + 1 of them, or null if it is none. */
function braceSequence(body) {
    const m = /^(-?\d+|[A-Za-z])\.\.(-?\d+|[A-Za-z])(?:\.\.(-?\d+))?$/.exec(body);
    if (!m || /\d/.test(m[1]) !== /\d/.test(m[2])) return null;
    const numeric = /\d/.test(m[1]);
    const from = numeric ? Number(m[1]) : m[1].charCodeAt(0);
    const to = numeric ? Number(m[2]) : m[2].charCodeAt(0);
    const step = (from <= to ? 1 : -1) * (Math.abs(Number(m[3] ?? 1)) || 1);
    const words = [];
    for (let v = from; (from <= to ? v <= to : v >= to) && words.length <= MAX_BRACE_FORMS; v += step) {
        words.push(numeric ? String(v) : String.fromCharCode(v));
    }
    return words;
}

/**
 * The words bash's brace expansion makes of this word, in order and with empty
 * ones dropped: at most MAX_BRACE_FORMS of them, or null when the groups make
 * more than MAX_BRACE_LEAVES forms. A `{` with no matching `}`, or whose group
 * holds neither a top-level `,` nor a sequence, is a literal, as in bash.
 */
function expandBraces(word) {
    const words = [];
    let leaves = 0;
    // false once the expansion is cut short: enough words, or too many forms.
    const walk = (w) => {
        spend();
        for (let open = w.indexOf('{'); open !== -1; open = w.indexOf('{', open + 1)) {
            let depth = 0;
            let close = -1;
            const cuts = [];
            for (let j = open; j < w.length && close === -1; j++) {
                if (w[j] === '{') depth++;
                else if (w[j] === '}' && --depth === 0) close = j;
                else if (w[j] === ',' && depth === 1) cuts.push(j);
            }
            if (close === -1) continue;
            let alternatives = null;
            if (cuts.length) {
                alternatives = [];
                let from = open + 1;
                for (const cut of [...cuts, close]) {
                    alternatives.push(w.slice(from, cut));
                    from = cut + 1;
                }
            } else {
                alternatives = braceSequence(w.slice(open + 1, close));
            }
            if (!alternatives) continue;
            for (const alternative of alternatives) {
                if (!walk(w.slice(0, open) + alternative + w.slice(close + 1))) return false;
            }
            return true;
        }
        if (++leaves > MAX_BRACE_LEAVES) return false;
        if (w !== '') words.push(w);
        return words.length < MAX_BRACE_FORMS;
    };
    walk(word);
    return leaves > MAX_BRACE_LEAVES ? null : words;
}

/**
 * The checked commands a word holding a wildcard in its last part could match
 * (`/usr/bin/g?t` and, after `touch git`, `g?t` match git): every one that
 * globMatch() or the shared reader's builtCommandName() matches. With
 * `anyPattern` false, a last part of `*`s alone matches none: `cat docs/*`
 * lists a directory, it names no one program.
 */
function globNames(word, anyPattern = true) {
    const name = word.slice(word.lastIndexOf('/') + 1);
    if (!/[*?[]/.test(name) || (!anyPattern && /^\*+$/.test(name))) return [];
    const shared = new Set(builtCommandName(word, true)?.globs ?? []);
    return [...CHECKED_NAMES].filter((checked) => globMatch(name, checked) || shared.has(checked));
}

/**
 * The command lines the shell could start from this command word, each as the
 * words that start it, when the word as typed names no checked command and a
 * reading of it does: `{git,}` reads as `git`, `{git,diff}` as `git diff`,
 * `/usr/bin/g?t` as `git`. (`$'\x67it'` is already `git` once the shared
 * tokenizer has read it.) Empty when no reading names one; null when the word's
 * braces make too many forms to read. `anyPattern` is passed to globNames().
 */
function shellReadings(word, anyPattern = true) {
    if (!/[$"'\\{}*?[]/.test(word) || isCheckedName(word)) return [];
    const words = expandBraces(unquoted(word));
    if (words === null) return null;
    if (!words.length || /\s/.test(words[0])) return [];
    if (isCheckedName(words[0])) return [words];
    return globNames(words[0], anyPattern).map((name) => [name, ...words.slice(1)]);
}

/** Whether the shell could read this word, typed later on a line, as a checked command (see shellReadings()). */
function readsAsCheckedCommand(word) {
    const readings = shellReadings(word, false);
    return readings === null || readings.length > 0;
}

/**
 * For a segment whose command is a program this hook neither checks nor steps
 * over (`setarch x86_64 git push ...`, `prlimit ...`, `script -qc '...'`), the
 * refusal for the checked command it would run, or null. Each later word that
 * names a checked command is checked from there to the end, with the
 * assignments in front of the program, and each command string a later word
 * carries is checked as a command line of its own. A command that passes alone
 * still passes behind any program. Only over-refusing is guessed at: an option
 * value that reads as a checked command (`man sudo`) is refused too. The
 * updater named behind such a program is not read: the hook cannot tell
 * `less openaudible-autoupdate.sh` from a program that runs it.
 */
function checkUnlistedProgram(w, inlineEnv, state) {
    const cmd = w[0];
    if (ARGUMENT_ONLY_PROGRAMS.has(cmd)) return null;
    const env = Object.entries(inlineEnv).map(([name, value]) => `${name}=${value}`);
    let checked = 0;
    for (let n = 1; n < w.length; n++) {
        spend();
        let refusal = null;
        if (namesCheckedCommand(w[n]) || namesCheckedCommand(unquoted(w[n])) || readsAsCheckedCommand(w[n])) {
            if (++checked > MAX_UNLISTED_INNER) {
                return block(
                    `Blocked: more than ${MAX_UNLISTED_INNER} commands this hook checks behind \`${basename(cmd)}\`, ` +
                        'too many to read. Run them as commands of their own.'
                );
            }
            let start = n;
            while (start > 1 && isAssignment(w[start - 1])) start--;
            refusal = checkSegment([...env, ...w.slice(start)], Object.create(state));
        }
        if (!refusal) {
            for (const text of commandStrings(w[n])) {
                spend();
                const named = (piece) => namesCheckedCommand(piece) || readsAsCheckedCommand(piece);
                const names = (t) => t.split(COMMAND_STRING_SEPARATORS).some((piece) => piece && named(piece));
                // Tokenized too, so `$'\x67it'` is read as the `git` it decodes to,
                // and the first word of each command in it as one the shell runs (`* push`).
                const segments = tokenize(text);
                if (
                    !names(text) &&
                    !names(unquoted(text)) &&
                    !segments.flat().some(named) &&
                    !segments.some((seg) => seg.length && builtCommandName(seg[0], true) !== null)
                )
                    continue;
                refusal = checkCommand(text, Object.create(state));
                if (refusal) break;
            }
        }
        if (refusal) {
            return {
                ...refusal,
                reason:
                    `\`${basename(cmd)}\` runs a command that is refused on its own, and bypass and auto modes ` +
                    `prompt for neither, so it is checked as though it stood alone. ${refusal.reason}`,
            };
        }
    }
    return null;
}

function checkSegment(words, state) {
    spend();
    const { pipedFrom, stdinFrom, hereString, heredocBody } = words;
    let w = words.slice();
    const inlineEnv = {};
    // Set once the segment runs through xargs: xargs appends words it reads at
    // run time, so no argument check below sees the real command line.
    let xargsFed = false;
    for (;;) {
        while (w.length && (isAssignment(w[0]) || KEYWORDS.has(w[0]) || w[0] === 'function' || w[0] === 'coproc')) {
            if (isAssignment(w[0])) {
                const eq = w[0].indexOf('=');
                inlineEnv[w[0].slice(0, eq)] = w[0].slice(eq + 1);
            }
            // `function NAME { CMD; }`: the body follows the name. `coproc NAME { CMD; }`
            // names a compound command; `coproc CMD` runs CMD.
            if (w[0] === 'function' || (w[0] === 'coproc' && w[2] === '{')) w.shift();
            w.shift();
        }
        if (!w.length) return null;
        // A command word the shell reads as a checked command (`{git,}`,
        // `$'\x67it'`, `/usr/bin/g?t`) is checked as that command too; see
        // shellReadings(). The word as typed is still read below, as before.
        const readings = shellReadings(w[0]);
        if (readings === null) {
            return block(
                `Blocked: \`${w[0]}\` is a command name whose brace groups make more than ${MAX_BRACE_LEAVES} forms, ` +
                    'too many to read. Spell the command name out.'
            );
        }
        for (const head of readings) {
            const env = Object.entries(inlineEnv).map(([name, value]) => `${name}=${value}`);
            const again = Object.assign([...env, ...(xargsFed ? ['xargs'] : []), ...head, ...w.slice(1)], {
                pipedFrom,
                stdinFrom,
                hereString,
                heredocBody,
            });
            const r = checkSegment(again, state);
            if (r) {
                return {
                    ...r,
                    reason: `The shell reads the command name \`${w[0]}\` as \`${head.join(' ')}\`, so it is checked as that command. ${r.reason}`,
                };
            }
        }
        // The shared reader's reading of the same word: brace groups that can
        // build a checked command in any of their forms, not only the first
        // (`{x,git}` is `x git`), or that make more forms than it reads, are
        // refused, since the words they add are not modelled here.
        if (builtCommandName(w[0], true)?.braces) {
            return block(
                `Blocked: the shell reads the command name \`${w[0]}\` through brace groups that can build a command ` +
                    'this hook checks (or make too many forms to read). Spell the command name out.'
            );
        }
        const cmd = basename(w[0]);
        if (PRIVILEGE.has(cmd)) {
            return block(`Blocked: \`${cmd}\` (privilege escalation) is never run by agents in this repository.`);
        }
        if (!WRAPPERS.has(cmd)) break;
        w = expandWrapperOptions(cmd, w);
        // `env -S 'gh pr create'` / `--split-string=...` runs a command string.
        // Only env's own leading options and NAME=value words are scanned; the
        // wrapped command's arguments (e.g. `--title -Sx`) are not env options.
        if (cmd === 'env') {
            for (let k = 1; k < w.length; k++) {
                const a = w[k];
                if (isAssignment(a)) continue;
                if (!a.startsWith('-')) break; // first word of the wrapped command
                if (['-u', '--unset', '-C', '--chdir', '-a', '--argv0'].includes(a)) {
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
        // Look through the wrapper to the command it runs: skip its own options
        // (and their values), NAME=value words, and operands such as timeout's duration.
        const idx = wrapperTarget(w);
        for (const x of w.slice(1, idx === -1 ? w.length : idx)) {
            if (isAssignment(x)) {
                const eq = x.indexOf('=');
                inlineEnv[x.slice(0, eq)] = x.slice(eq + 1);
            }
        }
        if (idx === -1) return null;
        // `watch CMD...` joins its words and runs them with `sh -c` (with -x it runs
        // them directly; the words are also looked through below, so both readings
        // are checked). `flock FILE -c CMD` runs CMD with `sh -c`. Either string
        // sees this segment's PATH, as the shell it starts does.
        const wrapped = () => Object.assign(Object.create(state), { exportedPath: inlineEnv.PATH ?? state.exportedPath });
        if (cmd === 'watch') {
            const r = checkCommand(w.slice(idx).join(' '), wrapped());
            if (r) return r;
        } else if (cmd === 'flock' && (w[idx] === '-c' || w[idx] === '--command')) {
            return checkCommand(w[idx + 1] ?? '', wrapped());
        }
        if (cmd === 'xargs') xargsFed = true;
        w = w.slice(idx);
    }

    const cmd = basename(w[0]);
    const args = w.slice(1);
    // `printf '%s\n' --output=FILE | xargs git log` and
    // `printf '%s\n' +n -c CMD | xargs bash -n` reach git and bash with
    // options this hook never sees, under the git log and bash -n allow rules.
    if (xargsFed && (cmd === 'git' || cmd === 'node' || cmd === 'nodejs' || SHELLS.has(cmd))) {
        return block(
            `Blocked: \`xargs ${cmd}\`; xargs adds arguments read at run time, so this hook cannot check the ` +
                `${cmd} command line the allow rules pre-approve. Write the ${cmd} command out in full instead.`
        );
    }
    const envPath = inlineEnv.PATH ?? state.exportedPath;
    // Nested analysis (`bash -c '...'`, `eval`) sees this segment's PATH, but
    // anything it exports stays inside it, as in a real subshell.
    const nested = (extra = {}) => Object.assign(Object.create(state), { exportedPath: envPath }, extra);

    if (cmd === 'export' || ((cmd === 'declare' || cmd === 'typeset') && args.some((a) => /^-[a-zA-Z]*x/.test(a)))) {
        for (const a of args) {
            if (a.startsWith('GH_REPO=')) state.exportedGhRepo = a.slice(8);
            if (a.startsWith('PATH=')) state.exportedPath = a.slice(5);
            // `export NAME` without a value exports an earlier assignment: value unknown (null).
            const eq = a.indexOf('=');
            const name = eq === -1 ? a : a.slice(0, eq);
            if (/^(GIT_CONFIG_|GIT_SSH)/i.test(name) || WATCHED_ENV.test(name)) {
                (state.exportedEnv ??= {})[name] = eq === -1 ? null : a.slice(eq + 1);
            }
        }
        return null;
    }
    if (cmd === 'gh') {
        const envRepo = inlineEnv.GH_REPO ?? state.exportedGhRepo ?? null;
        return checkGh(args, envRepo);
    }
    if (cmd === 'git') return checkGit(args, inlineEnv, state.exportedEnv ?? {});
    if (cmd === 'node' || cmd === 'nodejs') return checkNode(cmd, args, { ...(state.exportedEnv ?? {}), ...inlineEnv });
    if (mayNameScript(w[0])) return checkUpdaterRun(envPath, state, `Running ${w[0]}`);
    if (cmd === 'source' || cmd === '.') {
        return args.some(mayNameScript) ? checkUpdaterRun(envPath, state, `Sourcing ${args.find(mayNameScript)}`) : null;
    }
    // bats sources each file it is given to find its tests, so the file's
    // top-level code runs: `bats openaudible-autoupdate.sh` runs the updater
    // under the pre-approved `bats` rule. Same for --setup-suite-file and a
    // formatter given by path.
    if (cmd === 'bats') {
        const target = batsUpdaterArg(args);
        return target === undefined ? null : checkUpdaterRun(envPath, state, `\`bats ${target}\``);
    }
    if (SHELLS.has(cmd)) {
        // `bash -n` is pre-approved in .claude/settings.json because -n parses a
        // script without running it, but a later `+n` or `+o noexec` turns -n off
        // again: `bash -n +n -c 'cmd'` runs cmd with no prompt. Refuse any word
        // beginning with + in a -n invocation, and any word bash could rewrite
        // into one first (`{+,+}n`, `?n` beside a file named +n, `$X`).
        if (args.some((a) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(a))) {
            const bad = args.find((a) => a.startsWith('+') || /[{}*?[$`]/.test(a));
            if (bad !== undefined) {
                return block(
                    `Blocked: \`${cmd} -n ... ${bad}\`; -n only parses a script, and +n or +o noexec turns that off ` +
                        'so the command would run under the syntax-check allow rule. Check syntax with `bash -n FILE` only; ' +
                        'run a script as itself so the permission rules see it.'
                );
            }
        }
        // fish takes code from -c/--command and -C/--init-command (each may repeat,
        // with the value attached or in the next word); every one of them runs.
        // Other shells run the first non-option word after -c
        // (`sh -c -- 'cmd'`, `sh -c -x 'cmd'`).
        let scripts;
        if (cmd === 'fish') scripts = fishScripts(args);
        else {
            const c = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
            const script = c === -1 ? undefined : args.slice(c + 1).find((a) => !a.startsWith('-'));
            scripts = script === undefined ? [] : [script];
        }
        for (const script of scripts) {
            // `bash -c "$(cat openaudible-autoupdate.sh)"`: the whole script text is the updater.
            if (/^\$\([\s\S]*\)$|^`[\s\S]*`$/.test(script.trim()) && extractSubstitutions(script).some(readsUpdater)) {
                return checkUpdaterRun(envPath, state, `\`${cmd} -c\` reading ${SCRIPT}.sh`);
            }
            const r = checkCommand(script, nested());
            if (r) return r;
        }
        if (scripts.length) return null;
        // `bash -n file` only parses the file; any other shell invocation runs it.
        const syntaxOnly = args.some((a) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(a));
        const target = args.find(mayNameScript);
        if (!syntaxOnly && target !== undefined) return checkUpdaterRun(envPath, state, `\`${cmd} ${target}\``);
        // No script operand: the shell reads its program from stdin
        // (`cat openaudible-autoupdate.sh | bash`, `bash -s < openaudible-autoupdate.sh`).
        if (!syntaxOnly && !args.some((a) => !a.startsWith('-'))) {
            // `bash <<< "$(cat openaudible-autoupdate.sh)"`: the here-string expands to the updater.
            const hereReads = hereString !== undefined && extractSubstitutions(hereString).some(readsUpdater);
            let pipeReads = false;
            const feeders = [];
            for (let p = pipedFrom; p; p = p.pipedFrom) {
                feeders.push(p);
                if (segmentReadsUpdater(p)) pipeReads = true;
            }
            const reads = hereReads || (stdinFrom !== undefined && mayNameScript(stdinFrom)) || pipeReads;
            if (reads) return checkUpdaterRun(envPath, state, `\`${cmd}\` reading ${SCRIPT}.sh on stdin`);
            // A heredoc or here-string fed to a shell is a script it runs.
            // The same holds for text piped in (`cat <<'EOF' | bash`).
            // A literal `echo`/`printf` payload piped in is a script too.
            const literal = (f) => {
                const name = basename(f[0] ?? '');
                if (name !== 'echo' && name !== 'printf') return undefined;
                const rest = f.slice(1).filter((a) => !a.startsWith('-'));
                if (name === 'printf') rest.shift(); // the format string
                return rest.join(' ');
            };
            for (const text of [heredocBody, hereString, ...feeders.flatMap((f) => [f.heredocBody, f.hereString, literal(f)])]) {
                if (text === undefined) continue;
                const r = checkCommand(text, nested());
                if (r) return r;
            }
        }
        return null;
    }
    if (cmd === 'eval') return checkCommand(args.join(' '), nested());
    if (DNF.has(cmd)) return checkDnf(cmd, args);
    if (cmd === 'rpm') return checkRpm(args);
    if (cmd === 'rpm-ostree' || cmd === 'bootc' || cmd === 'pkcon') return checkImageTool(cmd, args);
    if (cmd === 'systemctl') return checkSystemctl(args);
    if (cmd === 'find') return checkFindExec(args, nested());
    if (cmd === 'systemd-run' || cmd === 'flatpak-spawn') {
        // They run a command outside this shell's PATH and cwd: look through to it,
        // always as a real (non-stubbed) run.
        const at = args.findIndex((a) => isScriptName(a) || LOOKTHROUGH.has(basename(a)));
        if (at !== -1) {
            const real = Object.assign(Object.create(state), { noStubs: true, exportedPath: undefined });
            const r = checkSegment(args.slice(at), real);
            if (r) return r;
        }
        const target = args.find((a) => a.includes(SCRIPT));
        return target === undefined ? null : block(`Blocked: \`${cmd} ${target}\` would run openaudible-autoupdate.sh outside any stub or container.`);
    }
    if (CONTAINER_ENTER.has(cmd)) return checkContainerEnter(cmd, args, state);
    if (CONTAINER_ENGINES.has(cmd)) {
        // `docker container exec ...` / `podman container run ...` are the long
        // forms of `exec` / `run`; judge them the same way.
        const words = args.filter((a) => !a.startsWith('-'));
        const sub = words[0] === 'container' ? words[1] : words[0];
        // `exec`/`attach` reach long-lived containers, including the distrobox
        // container (distrobox containers are podman containers).
        if (sub === 'exec' || sub === 'attach') {
            return block(`Blocked: \`${cmd} ${sub}\` enters an existing container, possibly the real distrobox one; use \`${cmd} run\` with a throwaway container.`);
        }
        // A container run that mentions the updater is exempt only when it is
        // the e2e harness (a path containing tests/e2e).
        const named = args.find((a) => a.includes(SCRIPT));
        if (named !== undefined && !args.some((a) => /(^|\/)tests\/e2e(\/|$)/.test(a))) {
            return block(`Blocked: \`${cmd}\` with ${named} is not the tests/e2e harness; container runs of the updater are only allowed via tests/e2e.`);
        }
        return null;
    }
    return checkUnlistedProgram(w, inlineEnv, state);
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

export function main(check = checkCommand, budgetMs = BUDGET_MS) {
    // Claude Code blocks only on exit 2; any other failure (an uncaught
    // exception exits 1) lets the command run. So nothing may escape this function.
    try {
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

        startBudget(budgetMs);
        const result = check(command);
        if (result) {
            process.stderr.write(`guard-bash: ${result.reason}\n`);
            process.exit(2);
        }
    } catch (err) {
        if (err instanceof OverBudget) {
            process.stderr.write(`guard-bash: ${err.message}\n${GUIDANCE}\n`);
            process.exit(2);
        }
        process.stderr.write(`guard-bash: internal error (${err?.message ?? err}); blocking (fail closed).\n`);
        process.exit(2);
    }
    process.exit(0);
}

/** True when this file is the program being run (also through a symlink); never fails open. */
function isMain() {
    const arg = process.argv[1];
    if (!arg) return false;
    const self = fileURLToPath(import.meta.url);
    if (resolve(arg) === self) return true;
    try {
        return realpathSync(arg) === self;
    } catch {
        // Cannot tell: assume we are the hook if the file is named like it.
        return basename(arg) === 'guard-bash.mjs';
    }
}

if (isMain()) main();
