// AGENTS.md and README.md each copy the updater's environment variables with
// their defaults, and the commands it needs, out of openaudible-autoupdate.sh.
// docs/ai-ops-runbook.md tells whoever changes a default to change the README
// table in the same pull request, but nothing checked that either copy still
// matched the script. These tests read the defaults from the script's
// `: "${NAME:=default}"` lines and the commands from its start-up loop and its
// `command -v` guards, and hold each copy to them both ways.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const UPDATER = 'openaudible-autoupdate.sh';
const AGENTS = 'AGENTS.md';
const README = 'README.md';
const script = read(UPDATER);

const codeSpans = (text) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

function section(page, heading) {
    const lines = read(page).split('\n');
    const start = lines.indexOf(heading);
    assert.notEqual(start, -1, `${page} has no ${JSON.stringify(heading)} heading`);
    const end = lines.findIndex((l, i) => i > start && /^#{1,3} /.test(l));
    return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

// Each overridable variable and its default, from the script's top-level
// `: "${NAME:=default}"` lines.
function scriptDefaults() {
    const found = [...script.matchAll(/^: "\$\{([A-Z_]+):=([^}]*)\}"$/gm)].map((m) => [m[1], m[2]]);
    assert.ok(found.length > 0, `no : "\${NAME:=default}" lines in ${UPDATER}`);
    return Object.fromEntries(found);
}

// Each `| \`NAME\` | \`default\` | ... |` row of the section's table.
function tableDefaults(page, heading) {
    const rows = section(page, heading).split('\n').filter((l) => /^\| `/.test(l));
    assert.ok(rows.length > 0, `no variable table under ${page} ${JSON.stringify(heading)}`);
    return Object.fromEntries(rows.map((row) => {
        const cells = row.split('|').slice(1, -1).map((c) => c.trim());
        return [cells[0].replace(/^`|`$/g, ''), cells[1].replace(/^`|`$/g, '')];
    }));
}

// The commands the start-up loop requires, in the order it checks them.
function requiredCommands() {
    const loop = script.match(/^for dep in ([^;]+); do$/m);
    assert.ok(loop, `no "for dep in ...; do" start-up loop in ${UPDATER}`);
    return loop[1].trim().split(/\s+/);
}

// Commands the script uses only when present: every `command -v NAME` guard
// other than the start-up loop's.
function optionalCommands() {
    const names = [...script.matchAll(/command -v ([^\s"$]+) >\/dev\/null/g)].map((m) => m[1]);
    return [...new Set(names)].sort();
}

test(`${UPDATER} has the defaults and commands these tests read`, () => {
    assert.deepEqual(Object.keys(scriptDefaults()).sort(), ['PKG_NAME', 'PLATFORM_KEY', 'VERSION_URL']);
    assert.ok(requiredCommands().includes('curl'));
    assert.deepEqual(optionalCommands(), ['notify-send', 'systemd-cat']);
});

test(`${AGENTS} "Configuration (environment variables)" table matches the script's defaults`, () => {
    assert.deepEqual(tableDefaults(AGENTS, '## Configuration (environment variables)'), scriptDefaults());
});

test(`${README} "Configuration" table matches the script's defaults`, () => {
    assert.deepEqual(tableDefaults(README, '## Configuration'), scriptDefaults());
});

test(`${AGENTS} names the start-up loop's required commands and the optional ones`, () => {
    const flat = section(AGENTS, '## Configuration (environment variables)').replace(/\s*\n\s*/g, ' ');
    const required = flat.match(/Required commands \([^)]*\): `([^`]+)`/);
    assert.ok(required, 'no "Required commands (...): `...`" sentence in the section');
    assert.deepEqual(required[1].split(/\s+/), requiredCommands());
    const optional = flat.match(/Optional: ([^.]+)\./);
    assert.ok(optional, 'no "Optional: ..." sentence in the section');
    assert.deepEqual(codeSpans(optional[1]).sort(), optionalCommands());
});

test(`${README} "Requirements" names every required command and no other`, () => {
    // `bash` runs the script; the loop does not check for it.
    const spans = codeSpans(section(README, '## Requirements'));
    const commands = new Set(spans.filter((s) => /^[a-z0-9-]+$/.test(s) && s !== 'bash'));
    assert.deepEqual([...commands].sort(), [...requiredCommands()].sort());
});
