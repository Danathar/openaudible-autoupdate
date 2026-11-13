// The `env` block in .claude/settings.json sets git's safe.bareRepository to
// `explicit` for every command an agent runs. Without it, a bare repository
// committed as ordinary files in a checked-out branch is picked up by the
// pre-approved history commands (`git show`, `git log -p`) once the agent's
// working directory is inside it, and its config can name a program for git to
// run (diff.*.textconv, with `info/attributes` choosing which files it applies
// to) with no permission prompt. The guard hook cannot see that config, so git
// itself has to refuse the repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SETTINGS = fileURLToPath(new URL('../../.claude/settings.json', import.meta.url));
const settingsEnv = JSON.parse(readFileSync(SETTINGS, 'utf8')).env ?? {};

// A clean git environment: no user or system config, no inherited GIT_* overrides.
function baseEnv(home) {
    return { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
}

function git(cwd, env, ...args) {
    return spawnSync('git', args, { cwd, env, encoding: 'utf8' });
}

const IDENT = ['-c', 'user.name=t', '-c', 'user.email=t@t'];

// Builds a clone whose tree carries a committed bare repository `evil/` that has
// one commit (refs/ kept by a placeholder file) and a diff.x.textconv program (applied to every file by
// info/attributes) that writes `marker`. Returns the clone's path.
function plantedClone(dir, marker) {
    const env = baseEnv(dir);
    const seed = join(dir, 'seed');
    const src = join(dir, 'src');
    const evil = join(src, 'evil');
    assert.equal(git(dir, env, 'init', '-q', seed).status, 0);
    writeFileSync(join(seed, 'f.txt'), 'hello\n');
    assert.equal(git(seed, env, 'add', 'f.txt').status, 0);
    assert.equal(git(seed, env, ...IDENT, 'commit', '-qm', 'seed').status, 0);
    assert.equal(git(dir, env, 'init', '-q', src).status, 0);
    assert.equal(git(dir, env, 'clone', '-q', '--bare', seed, evil).status, 0);
    mkdirSync(join(evil, 'info'), { recursive: true });
    writeFileSync(join(evil, 'info', 'attributes'), '* diff=x\n');
    // git does not track empty directories, and a directory without refs/ is
    // not a repository, so keep a file in refs/ for the clone to carry it.
    writeFileSync(join(evil, 'refs', '.keep'), '');
    assert.equal(git(evil, env, 'config', 'diff.x.textconv', `touch '${marker}'; cat`).status, 0);
    assert.equal(git(src, env, 'add', 'evil').status, 0);
    assert.equal(git(src, env, ...IDENT, 'commit', '-qm', 'x').status, 0);
    assert.equal(git(dir, env, 'clone', '-q', src, 'victim').status, 0);
    return join(dir, 'victim');
}

test('settings.json sets safe.bareRepository=explicit through GIT_CONFIG_* for agent commands', () => {
    assert.deepEqual(settingsEnv, {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'safe.bareRepository',
        GIT_CONFIG_VALUE_0: 'explicit',
    });
});

test('a committed bare repository cannot make pre-approved git show or git log run a program', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'bare-repo-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const marker = join(dir, 'ran');
    const victim = plantedClone(dir, marker);
    const agentEnv = { ...baseEnv(dir), ...settingsEnv };
    const commands = [
        ['show'],
        ['log', '-p', '-1'],
    ];

    // The planted program does run without the setting, so the check below is real.
    for (const args of commands) {
        git(join(victim, 'evil'), baseEnv(dir), ...args);
        assert.ok(existsSync(marker), `precondition: without safe.bareRepository git ${args.join(' ')} runs the planted textconv`);
        rmSync(marker);
    }

    for (const args of commands) {
        for (const [cwd, argv] of [
            [victim, ['-C', 'evil', ...args]],
            [join(victim, 'evil'), args],
        ]) {
            const r = git(cwd, agentEnv, ...argv);
            assert.notEqual(r.status, 0, `git ${argv.join(' ')} should refuse the bare repository`);
            assert.match(r.stderr, /safe\.bareRepository/);
            assert.ok(!existsSync(marker), `git ${argv.join(' ')} ran the planted program`);
        }
    }

    // The checkout's own repository (.git/, not bare) still works with the setting.
    assert.equal(git(victim, agentEnv, 'status', '--short').status, 0);
    assert.equal(git(victim, agentEnv, 'log', '-1', '--format=%s').stdout.trim(), 'x');
});
