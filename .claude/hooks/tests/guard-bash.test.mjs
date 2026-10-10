// Tests for .claude/hooks/guard-bash.mjs. Each case spawns the hook exactly
// as Claude Code does: JSON on stdin, decision from the exit code (0 allow,
// 2 block) and stderr.
//
// The "stubs on PATH" exemption looks at the disk, so the cases run against a
// throwaway project directory (CLAUDE_PROJECT_DIR) built under the OS temp dir:
//   tests/stubs/{sudo,dnf,rpm}   executable stubs      -> valid stubs dir
//   tests/partial/sudo           only one stub         -> invalid
//   tests/empty/                 no stubs              -> invalid
//   other/stubs/{sudo,dnf,rpm}   stubs outside tests/  -> invalid
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../guard-bash.mjs', import.meta.url));

const PROJECT = mkdtempSync(join(tmpdir(), 'oaa-guard-'));
const stub = (dir, name) => {
    mkdirSync(join(PROJECT, dir), { recursive: true });
    writeFileSync(join(PROJECT, dir, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
};
for (const name of ['sudo', 'dnf', 'rpm']) {
    stub('tests/stubs', name);
    stub('other/stubs', name);
}
stub('tests/partial', 'sudo');
mkdirSync(join(PROJECT, 'tests/empty'), { recursive: true });
after(() => rmSync(PROJECT, { recursive: true, force: true }));

function run(command, toolName = 'Bash') {
    const input = JSON.stringify({ tool_name: toolName, tool_input: { command } });
    return spawnSync(process.execPath, [HOOK], {
        input,
        encoding: 'utf8',
        cwd: PROJECT,
        env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT },
    });
}

const allowed = [
    'gh pr view 3',
    'gh pr list --state open',
    'gh issue view 21 --json title',
    'gh pr checks 5',
    'gh run view 123 --log-failed',
    'gh api repos/someone/other/issues',
    'gh api -X GET repos/someone/other/pulls -f state=open',
    'gh api -X POST repos/Danathar/openaudible-autoupdate/issues -f title=x',
    'gh api repos/Danathar/openaudible-autoupdate/issues/1/comments -f body=hi',
    'gh pr create --repo Danathar/openaudible-autoupdate --base main --head b',
    'gh pr create -R Danathar/openaudible-autoupdate --base main --head b --title t',
    'gh pr --repo Danathar/openaudible-autoupdate create --base=main --head=b --title t',
    'gh pr create --repo=danathar/openaudible-autoupdate -B main -H b --title t',
    'GH_REPO=Danathar/openaudible-autoupdate gh issue create --title t --body b',
    'GH_REPO=Danathar/openaudible-autoupdate gh pr create --base main --head b',
    'git remote add upstream https://github.com/someone/other.git',
    'git remote remove upstream',
    'export GH_REPO=Danathar/openaudible-autoupdate; gh issue comment 4 --body ok',
    'cd x && gh pr create --repo Danathar/openaudible-autoupdate --base main --head b',
    'gh repo set-default Danathar/openaudible-autoupdate',
    'gh repo set-default --view',
    'gh pr comment 4 --repo Danathar/openaudible-autoupdate --body "forked from someone/other, kept in sync"',
    'echo "do not run gh pr create against someone/other"',
    'gh pr view 3 --json title --jq ".title" # someone/other',
    "gh pr view 3 --jq 'someone/other'",
    'gh issue list --search "someone/other"',
    'git remote set-url origin https://github.com/Danathar/openaudible-autoupdate',
    'gh api graphql -f query=\'query($o:String!){ repository(owner:$o,name:"tududi"){ id } }\' -f o=Danathar',
    'gh discussion list --repo someone/other',
    'gh auth status',
    'git config rename-section foo bar',
    'git config set --value zzz user.name x',
    'git config --global push.autoSetupRemote true',
    'git config push.default current',
    'git config get remote.origin.url',
    'git config list',
    'git config -f .git/config user.name x',
    'git -c push.default=current push origin main',
    'gh pr create --repo Danathar/openaudible-autoupdate --base main --head b --body "-Bump deps" --title "-Hx"',
    'git config --get remote.origin.url',
    'git config remote.origin.url',
    'git config user.name x',
    'env FOO=1 git status',
    'env -u FOO git status',
    'gh alias list',
    'gh search issues foo',
    'git -c user.name=x commit -m msg',
    "env -S 'gh pr view 3'",
    'git remote add -t main upstream https://github.com/someone/other.git',
    'gh pr create --repo Danathar/openaudible-autoupdate --base develop --base main --head b',
    'gh codespace list',
    'git push origin HEAD',
    'git push -u origin acmm/claude-guard',
    'git -C ../wt push origin main',
    'git fetch upstream',
    'git remote set-url --push upstream DISABLE',
    'git status && git diff --stat',
    'shellcheck openaudible-autoupdate.sh',
    'cat <<EOF\ngh pr create\nEOF',
    'git commit -m "$(cat <<\'EOF\'\nuse gh pr create --repo Danathar/openaudible-autoupdate\nEOF\n)"',
    // --- Updater only with verified stubs, or inside a throwaway container ---
    'PATH=tests/stubs:$PATH ./openaudible-autoupdate.sh',
    'PATH="$PWD/tests/stubs:$PATH" bash openaudible-autoupdate.sh',
    'PATH=${CLAUDE_PROJECT_DIR}/tests/stubs:$PATH ./openaudible-autoupdate.sh',
    'env PATH=tests/stubs:$PATH bash ./openaudible-autoupdate.sh',
    'export PATH=tests/stubs:$PATH; ./openaudible-autoupdate.sh',
    "bash -c 'PATH=tests/stubs:$PATH ./openaudible-autoupdate.sh'",
    'PATH=tests/stubs:$PATH timeout 30 ./openaudible-autoupdate.sh',
    'rpm -q -i OpenAudible',
    'podman run --rm -v "$PWD":/src:Z fedora:latest bash /src/tests/e2e/run.sh',
    // Reading the script is not running it.
    'shellcheck openaudible-autoupdate.sh',
    'bash -n openaudible-autoupdate.sh',
    'bats tests/',
    'cat openaudible-autoupdate.sh',
    'git diff -- openaudible-autoupdate.sh',
    'grep -n "dnf install" openaudible-autoupdate.sh',
    'chmod +x openaudible-autoupdate.sh',
    'echo "never run sudo dnf install or ./openaudible-autoupdate.sh here"',
    'git commit -m "fix: log() under set -e in openaudible-autoupdate.sh"',
    // Read-only queries and unrelated systemd/container commands.
    'dnf list installed',
    'dnf info OpenAudible',
    'dnf --quiet search audible',
    'dnf repoquery --installed',
    'dnf history list',
    'rpm -q OpenAudible',
    'rpm -qi OpenAudible',
    'rpm -qa | grep -i audible',
    'rpm -V OpenAudible',
    'rpm -K x.rpm',
    "rpm --eval '%{?fedora}'",
    'systemctl --user status openaudible-autoupdate.timer',
    'systemctl --user list-timers',
    'systemctl --user disable openaudible-autoupdate.timer',
    'systemctl --user daemon-reload',
    'systemctl --user start some-other.service',
    'systemd-analyze verify systemd/openaudible-autoupdate.service',
    'distrobox list',
    'toolbox list',
    'podman ps',
    'gh pr view https://github.com/someone/other/pull/9',
    'gh pr create --repo Danathar/openaudible-autoupdate --base main --head acmm/claude-learning --title t --body "never run sudo"',
];

const blocked = [
    ['gh pr create', 'no --repo'],
    ['gh pr create --title t --body b', 'no --repo'],
    ['gh pr create -R someone/other', 'someone/other'],
    ['gh pr create --repo someone/other --base main', 'someone/other'],
    ['gh -R someone/other pr create', 'someone/other'],
    ['gh --repo someone/other issue create --title t', 'someone/other'],
    ['gh pr create --repo https://github.com/someone/other', 'someone/other'],
    ['GH_REPO=someone/other gh issue create --title t', 'someone/other'],
    ['gh issue create --title t', 'no --repo'],
    ['gh issue comment 3 --body hi', 'no --repo'],
    ['gh issue close 3', 'no --repo'],
    ['gh pr merge 9 --squash', 'no --repo'],
    ['gh release create v1', 'no --repo'],
    ['gh workflow run ci.yml', 'no --repo'],
    ['gh label create bug', 'no --repo'],
    ['gh repo fork someone/other', 'explicit'],
    ['gh repo sync someone/other', 'explicit'],
    ['gh repo set-default someone/other', 'set-default'],
    ['gh api -X POST repos/someone/other/issues -f title=x', 'repos/Danathar/openaudible-autoupdate'],
    ['gh api repos/someone/other/issues -f title=x', 'repos/Danathar/openaudible-autoupdate'],
    ['gh api --method=DELETE repos/someone/other/issues/1', 'repos/Danathar/openaudible-autoupdate'],
    ['gh api -X PATCH /user -f name=x', 'repos/Danathar/openaudible-autoupdate'],
    ['gh api graphql -f query=\'mutation { addStar(input:{starrableId:"x"}) { clientMutationId } }\'', 'mutation'],
    ['git push upstream main', 'origin'],
    ['git push', 'explicit remote'],
    ['git push https://github.com/someone/other.git main', 'origin'],
    ['git push --force origin main', 'force'],
    ['git push -f origin main', 'force'],
    ['git push origin +main', 'force'],
    ['git push origin main --force-with-lease', 'force'],
    ['git push --mirror origin', 'mirror'],
    ['git remote set-url --push upstream https://github.com/someone/other.git', 'set-url'],
    ['git remote set-url origin https://github.com/someone/other.git', 'origin'],
    ['git remote set-url origin https://github.com/someone-else/tududi.git', 'origin'],
    ['gh discussion create --repo someone/other --title t', 'someone/other'],
    ['gh discussion comment 3 --body x', 'no --repo'],
    ["sh -c -- 'gh pr create'", 'no --repo'],
    ["bash -c -- 'git push upstream main'", 'origin'],
    ['gh api graphql --input payload.json', 'graphql'],
    ['gh api graphql -F query=@payload.graphql', 'graphql'],
    ['gh api graphql -f query="$Q"', 'graphql'],
    ['gh codespace create -R someone/other', 'someone/other'],
    ['gh somenewgroup create --repo someone/else', 'allowlist'],
    ['gh somenewgroup sync someone/other', 'allowlist'],
    ['gh issue create -R Danathar/openaudible-autoupdate -R someone/other --title x', 'someone/other'],
    ['gh issue create --repo Danathar/openaudible-autoupdate --repo=someone/other', 'someone/other'],
    ['git remote remove origin && git remote add origin https://github.com/someone/other.git', 'origin'],
    ['git remote rm origin', 'origin'],
    ['git remote rename upstream origin', 'origin'],
    ['git remote rename origin old', 'origin'],
    ['git remote add origin https://github.com/someone/other.git', 'origin'],
    ['gh pr create --repo Danathar/openaudible-autoupdate --title t', '--base main'],
    ['gh pr create --repo Danathar/openaudible-autoupdate --base develop --head b', '--base main'],
    ['gh pr create --repo Danathar/openaudible-autoupdate --base main', '--head'],
    ['gh issue create -R someone/other -R Danathar/openaudible-autoupdate --title t', 'someone/other'],
    // Duplicate flags: gh and git honour the last one.
    ['gh pr create --repo Danathar/openaudible-autoupdate --base main --base develop --head b', '--base main'],
    ['gh pr create --repo Danathar/openaudible-autoupdate --base main --head b --head ""', '--head'],
    // Option values must not be mistaken for remote names.
    ['git remote add -t main origin https://github.com/someone/other.git', 'origin'],
    ['git remote add -m main origin https://github.com/someone/other.git', 'origin'],
    // git config / env overrides that redirect pushes.
    ['git -c remote.origin.url=https://github.com/someone/other push origin main', 'redirect'],
    ['git -c url.https://github.com/chrisvel/.insteadOf=https://github.com/Danathar/ push origin main', 'redirect'],
    ['git -c remote.origin.pushurl=x push origin main', 'redirect'],
    ['git -c core.sshCommand=evil push origin main', 'redirect'],
    ['git --config-env=remote.origin.url=URL push origin main', 'redirect'],
    ['GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.url GIT_CONFIG_VALUE_0=x git push origin main', 'redirect'],
    // env -S command strings.
    ["env -S 'gh pr create --title t'", 'no --repo'],
    ["env --split-string='git push upstream main'", 'origin'],
    ["env -Sgh\\ issue\\ create", 'no --repo'],
    // Unknown gh groups and aliases fail closed.
    ['gh alias set pc "pr create --repo someone/other"', 'allowlist'],
    ['gh extension install foo/bar', 'allowlist'],
    ['env -S "FOO=1" gh issue create --title t', 'no --repo'],
    ['env -S "GH_PROMPT_DISABLED=1" gh pr create --repo someone/other --base main --head x', 'someone/other'],
    ['env FOO=1 gh issue create --repo someone/other --title -Sx', 'someone/other'],
    ['env sudo -S git push upstream main', 'privilege'],
    ['gh pr create --repo Danathar/openaudible-autoupdate --base main --head b -Bdevelop', '--base main'],
    ['gh pr create --repo Danathar/openaudible-autoupdate --base main --head b -H', '--head'],
    ['git config remote.origin.url https://github.com/someone/other.git && git push origin main', 'could redirect'],
    ['git config --global url.https://github.com/chrisvel/.insteadOf https://github.com/Danathar/', 'could redirect'],
    ['git config --unset remote.origin.pushurl', 'could redirect'],
    ['git config --edit', 'could redirect'],
    ['export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.url; git push origin main', 'redirect'],
    ['git config set remote.origin.url https://github.com/someone/other.git', 'could redirect'],
    ['git config unset remote.origin.pushurl', 'could redirect'],
    ['git config replace-all url.x.insteadOf y', 'could redirect'],
    ['git config remove-section remote.origin', 'could redirect'],
    ['git config edit', 'could redirect'],
    ['git config -f .git/config remote.origin.url https://github.com/someone/other.git', 'could redirect'],
    ['git config --file=x --type bool remote.origin.url v', 'could redirect'],
    ['gh pr create --repo Danathar/openaudible-autoupdate --base main --head b --title t -Bdevelop', '--base main'],
    ['declare -x GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.url; git push origin main', 'redirect'],
    ['git config set --value zzz remote.origin.url https://github.com/someone/other.git', 'could redirect'],
    ['git config --url=x --value zzz remote.origin.url v', 'could redirect'],
    ['git config set --url https://example.com remote.origin.pushurl v', 'could redirect'],
    ['git config rename-section foo remote.origin', 'rename-section'],
    ['git config --rename-section foo remote.origin', 'rename-section'],
    ['git config rename-section remote.origin foo', 'could redirect'],
    // Compound commands, subshells, wrappers.
    ['git status && gh pr create --title t', 'no --repo'],
    ['git status; gh issue create --title t', 'no --repo'],
    ['true | gh pr comment 1 --body x', 'no --repo'],
    ['(cd x && gh pr create)', 'no --repo'],
    ['echo $(gh issue create --title t)', 'no --repo'],
    ['echo `gh issue create --title t`', 'no --repo'],
    ['echo "$(gh issue create --title t)"', 'no --repo'],
    [`echo "$(printf ')'; gh pr create)"`, 'no --repo'],
    ['echo $(echo "(" ; gh issue create --title t)', 'no --repo'],
    ['bash -c "gh pr create --title t"', 'no --repo'],
    ['sh -lc \'git push upstream main\'', 'origin'],
    ['eval "gh pr create"', 'no --repo'],
    ['env FOO=1 gh pr create', 'no --repo'],
    ['FOO=1 gh pr create', 'no --repo'],
    ['xargs -n1 gh pr close', 'no --repo'],
    ['gh pr create \\\n  --title t', 'no --repo'],
    ['git push origin main && git push upstream main', 'origin'],
    // --- Running the real updater (openaudible-autoupdate.sh) ---
    ['./openaudible-autoupdate.sh', 'would execute'],
    ['openaudible-autoupdate.sh', 'would execute'],
    ['bash openaudible-autoupdate.sh', 'would execute'],
    ['bash -x ./openaudible-autoupdate.sh', 'would execute'],
    ['sh ~/bin/openaudible-autoupdate.sh', 'would execute'],
    ['/var/home/dbaggett/bin/openaudible-autoupdate.sh', 'would execute'],
    ['~/bin/openaudible-autoupdate', 'would execute'],
    ['source ./openaudible-autoupdate.sh', 'would execute'],
    ['. ./openaudible-autoupdate.sh', 'would execute'],
    ['env FOO=1 ./openaudible-autoupdate.sh', 'would execute'],
    ['VERSION_URL=http://localhost:1/x.json ./openaudible-autoupdate.sh', 'would execute'],
    ['timeout 10 ./openaudible-autoupdate.sh', 'would execute'],
    ['nohup bash ./openaudible-autoupdate.sh', 'would execute'],
    ['echo x | xargs ./openaudible-autoupdate.sh', 'would execute'],
    ['cd . && ./openaudible-autoupdate.sh', 'would execute'],
    ['bash -c "cd x && ./openaudible-autoupdate.sh"', 'would execute'],
    ['eval ./openaudible-autoupdate.sh', 'would execute'],
    ['echo $(./openaudible-autoupdate.sh)', 'would execute'],
    ['systemd-run --user ./openaudible-autoupdate.sh', 'systemd-run'],
    // A PATH that is not a verified stubs dir does not exempt it.
    ['PATH=tests/empty:$PATH ./openaudible-autoupdate.sh', 'would execute'],
    ['PATH=tests/partial:$PATH ./openaudible-autoupdate.sh', 'would execute'],
    ['PATH=tests/missing:$PATH ./openaudible-autoupdate.sh', 'would execute'],
    ['PATH=other/stubs:$PATH ./openaudible-autoupdate.sh', 'would execute'],
    ['PATH=tests/../other/stubs:$PATH ./openaudible-autoupdate.sh', 'would execute'],
    ['PATH=/usr/bin:$PATH ./openaudible-autoupdate.sh', 'would execute'],
    ['PATH=$HOME/tests/stubs:$PATH ./openaudible-autoupdate.sh', 'would execute'],
    ['PATH=$PATH:tests/stubs ./openaudible-autoupdate.sh', 'would execute'],
    ['PATH=tests ./openaudible-autoupdate.sh', 'would execute'],
    ['export PATH=other/stubs:$PATH; ./openaudible-autoupdate.sh', 'would execute'],
    ['env PATH=tests/empty:$PATH bash openaudible-autoupdate.sh', 'would execute'],
    // distrobox/toolbox are refused outright: they enter the real container.
    ['distrobox enter dev -- ./openaudible-autoupdate.sh', 'real long-lived container'],
    ['PATH=tests/stubs:$PATH distrobox enter dev -- ./openaudible-autoupdate.sh', 'real long-lived container'],
    ['distrobox enter dev -- bash -c "./openaudible-autoupdate.sh"', 'real long-lived container'],
    ['distrobox enter dev -- ls -la', 'real long-lived container'],
    ['distrobox enter dev', 'real long-lived container'],
    ['distrobox-enter -n dev -- ./openaudible-autoupdate.sh', 'real long-lived container'],
    ['toolbox run ./openaudible-autoupdate.sh', 'real long-lived container'],
    ['toolbox run -c dev -- ./openaudible-autoupdate.sh', 'real long-lived container'],
    ['toolbox enter', 'real long-lived container'],
    ['distrobox-host-exec ./openaudible-autoupdate.sh', 'would execute'],
    ['distrobox-host-exec sudo dnf install -y x', 'privilege'],
    // Container runs of the updater are only for the tests/e2e harness.
    ['podman run --rm -v "$PWD":/src:ro,Z fedora:latest /src/openaudible-autoupdate.sh', 'tests/e2e'],
    ['docker run --rm img bash -c "./openaudible-autoupdate.sh"', 'tests/e2e'],
    ['podman run --rm -v "$HOME/bin":/b fedora /b/openaudible-autoupdate.sh', 'tests/e2e'],
    // rpm: a query flag elsewhere must not hide a mutating flag.
    ['rpm -q -U x.rpm', 'rpm'],
    ['rpm -qa -e OpenAudible', 'rpm'],
    ['rpm -V -F x.rpm', 'rpm'],
    ['rpm -K -U x.rpm', 'rpm'],
    ['rpm -i -q x.rpm --nodeps -U', 'rpm'],
    ['rpm --query --install x.rpm', 'rpm'],
    ['rpm -i x.rpm -v', 'rpm'],
    ['podman exec dev ./openaudible-autoupdate.sh', 'exec'],
    ['docker exec -it c bash', 'exec'],
    // --- sudo and package managers ---
    ['sudo dnf install -y x', 'privilege'],
    ['sudo -n true', 'privilege'],
    ['echo x | sudo tee /etc/foo', 'privilege'],
    ['xargs sudo rm', 'privilege'],
    ['bash -c "sudo ls"', 'privilege'],
    ['env FOO=1 sudo ls', 'privilege'],
    ['timeout 5 sudo ls', 'privilege'],
    ['doas ls', 'privilege'],
    ['pkexec ls', 'privilege'],
    ['dnf install -y x', 'changes packages'],
    ['dnf -y install x', 'changes packages'],
    ['dnf upgrade', 'changes packages'],
    ['dnf update', 'changes packages'],
    ['dnf remove x', 'changes packages'],
    ['dnf swap a b', 'changes packages'],
    ['dnf localinstall x.rpm', 'changes packages'],
    ['dnf history undo 3', 'changes packages'],
    ['dnf --setopt=x=y install x', 'changes packages'],
    ['dnf -c /etc/dnf/dnf.conf install x', 'changes packages'],
    ['dnf5 install x', 'changes packages'],
    ['yum install x', 'changes packages'],
    ['timeout 5 dnf install x', 'changes packages'],
    ['rpm -i x.rpm', 'rpm'],
    ['rpm -U x.rpm', 'rpm'],
    ['rpm -Uvh x.rpm', 'rpm'],
    ['rpm -ivh --nodeps x.rpm', 'rpm'],
    ['rpm -F x.rpm', 'rpm'],
    ['rpm -e OpenAudible', 'rpm'],
    ['rpm --install x.rpm', 'rpm'],
    ['rpm --upgrade x.rpm', 'rpm'],
    ['rpm --erase OpenAudible', 'rpm'],
    ['rpm --import key.asc', 'rpm'],
    ['rpm --rebuilddb', 'rpm'],
    // --- scheduling the updater ---
    ['systemctl --user enable openaudible-autoupdate.timer', 'systemctl'],
    ['systemctl --user enable --now openaudible-autoupdate.timer', 'systemctl'],
    ['systemctl --user reenable openaudible-autoupdate.timer', 'systemctl'],
    ['systemctl --user start openaudible-autoupdate.service', 'systemctl'],
    ['systemctl --user restart openaudible-autoupdate.service', 'systemctl'],
    ['systemctl enable openaudible-autoupdate.timer', 'systemctl'],
    ['systemctl --user link systemd/openaudible-autoupdate.service', 'systemctl'],
    ['systemctl --user edit openaudible-autoupdate.service', 'systemctl'],
    ['systemctl --user start openaudible-autoupdate.timer && echo ok', 'systemctl'],
    // --- gh: other repositories, URLs ---
    ['gh pr merge https://github.com/someone/other/pull/9 --repo Danathar/openaudible-autoupdate', 'another repository'],
    ['gh issue close https://github.com/someone/other/issues/9 -R Danathar/openaudible-autoupdate', 'another repository'],
    ['gh issue comment 3 --body hi --repo Danathar/tududi', 'Danathar/tududi'],
    ['GH_REPO=Danathar/tududi gh issue create --title t', 'Danathar/tududi'],
    ['gh api -X POST repos/Danathar/tududi/issues -f title=x', 'repos/Danathar/openaudible-autoupdate'],
];

for (const command of allowed) {
    test(`allows: ${command.replace(/\n/g, '\\n')}`, () => {
        const r = run(command);
        assert.equal(r.status, 0, `expected allow, got ${r.status}: ${r.stderr}`);
    });
}

for (const [command, fragment] of blocked) {
    test(`blocks: ${command.replace(/\n/g, '\\n')}`, () => {
        const r = run(command);
        assert.equal(r.status, 2, `expected block, got ${r.status}`);
        assert.match(r.stderr, /guard-bash: /);
        assert.ok(
            r.stderr.toLowerCase().includes(fragment.toLowerCase()),
            `stderr should mention "${fragment}": ${r.stderr}`
        );
        assert.match(r.stderr, /Danathar\/openaudible-autoupdate/);
    });
}

test('ignores non-Bash tools', () => {
    assert.equal(run('gh pr create', 'Edit').status, 0);
});

test('empty command is allowed', () => {
    assert.equal(run('').status, 0);
});

test('malformed hook input fails closed', () => {
    const r = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /fail/i);
});
