// docs/quality.md is the index of this repository's quality signals: a table
// of the workflows that check a change, and a section naming the checks the
// ruleset requires. Nothing read either, and the page went on calling
// agent-tooling.yml "planned, not on main" (with no row in the signals table)
// long after it merged and became a required check. These tests hold both
// sections to .github/workflows/ and .github/rulesets/main.json, so a new
// workflow or a new required check has to be written into the page in the
// same change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const PAGE = 'docs/quality.md';
const WORKFLOWS = '.github/workflows';
const SIGNALS_HEADING = '## Signals on `main`';
const REQUIRED_HEADING = '## Required checks';
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

const codeSpans = (text) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const unquote = (s) => s.trim().replace(/^(['"])(.*)\1$/, '$2');

function section(heading) {
    const lines = read(PAGE).split('\n');
    const start = lines.indexOf(heading);
    assert.notEqual(start, -1, `${PAGE} has no ${JSON.stringify(heading)} heading`);
    const end = lines.findIndex((l, i) => i > start && /^#{1,3} /.test(l));
    return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

// The check names a workflow's jobs report: each job's `name:` (a
// `${{ matrix.name }}` expanded over the matrix include list), or its id.
function checkNames(file) {
    const lines = read(path.join(WORKFLOWS, file)).split('\n');
    const start = lines.indexOf('jobs:');
    assert.notEqual(start, -1, `${file} has no jobs:`);
    const jobs = [];
    for (const line of lines.slice(start + 1)) {
        if (/^\S/.test(line)) break;
        const id = line.match(/^ {2}([\w-]+):\s*$/);
        if (id) jobs.push({ id: id[1], lines: [] });
        else if (jobs.length) jobs.at(-1).lines.push(line);
    }
    return jobs.flatMap((job) => {
        const nameLine = job.lines.find((l) => /^ {4}name:/.test(l));
        if (!nameLine) return [job.id];
        const name = unquote(nameLine.replace(/^ {4}name:/, ''));
        if (!name.includes('${{ matrix.name }}')) return [name];
        const stepsAt = job.lines.findIndex((l) => /^ {4}steps:/.test(l));
        const values = job.lines.slice(0, stepsAt === -1 ? undefined : stepsAt)
            .map((l) => l.match(/^\s+- name:\s*(.+)$/)).filter(Boolean).map((m) => unquote(m[1]));
        assert.ok(values.length > 0, `${file} job ${job.id} uses matrix.name but has no include names`);
        return values.map((v) => name.replace('${{ matrix.name }}', v));
    });
}

const workflowFiles = fs.readdirSync(path.join(repoRoot, WORKFLOWS)).filter((f) => /\.ya?ml$/.test(f)).sort();

function requiredChecks() {
    const ruleset = JSON.parse(read('.github/rulesets/main.json'));
    const rule = ruleset.rules.find((r) => r.type === 'required_status_checks');
    assert.ok(rule, '.github/rulesets/main.json has no required_status_checks rule');
    return rule.parameters.required_status_checks.map((c) => c.context).sort();
}

// Whether a workflow runs on pull requests: only those runs can satisfy a
// required check. nightly-compliance.yml reuses the CI job names on a schedule.
function runsOnPullRequests(file) {
    const lines = read(path.join(WORKFLOWS, file)).split('\n');
    const start = lines.indexOf('on:');
    assert.notEqual(start, -1, `${file} has no block-form on:`);
    const end = lines.findIndex((l, i) => i > start && /^\S/.test(l) && !l.startsWith('#'));
    return lines.slice(start + 1, end === -1 ? undefined : end).some((l) => /^ {2}pull_request:/.test(l));
}

// The pull-request workflow files that report at least one required check.
function requiredWorkflows() {
    const required = new Set(requiredChecks());
    return workflowFiles.filter((f) => runsOnPullRequests(f) && checkNames(f).some((n) => required.has(n)));
}

// Rows of the signals table, with the workflow file each one links first.
function signalRows() {
    const rows = section(SIGNALS_HEADING).split('\n').filter((l) => l.startsWith('|'));
    assert.ok(rows.length > 2, `no table under ${SIGNALS_HEADING}`);
    return rows.slice(2).map((row) => {
        const cells = row.split('|').slice(1, -1).map((c) => c.trim());
        assert.equal(cells.length, 4, `expected 4 cells in ${row}`);
        const [signal, where, , blocks] = cells;
        const workflow = /\]\(\.\.\/\.github\/workflows\/([\w.-]+\.yml)\)/.exec(where)?.[1] ?? null;
        return { signal, workflow, blocks };
    });
}

test(`${REQUIRED_HEADING} names exactly the ruleset's required checks, and how many`, () => {
    const text = section(REQUIRED_HEADING).replace(/\s*\n\s*/g, ' ');
    const m = /requires (\w+) status checks: (.*?)\. They come from/.exec(text);
    assert.ok(m, `no "requires <n> status checks: ..." sentence under ${REQUIRED_HEADING}`);
    const named = codeSpans(m[2]);
    assert.deepEqual([...named].sort(), requiredChecks());
    assert.equal(NUMBER_WORDS.indexOf(m[1]), named.length, `the page says ${m[1]}, it names ${named.length}`);
});

test(`${REQUIRED_HEADING} names the workflows the required checks come from`, () => {
    const text = section(REQUIRED_HEADING).replace(/\s*\n\s*/g, ' ');
    const m = /They come from (.*?)\. /.exec(text);
    assert.ok(m, `no "They come from ..." sentence under ${REQUIRED_HEADING}`);
    const named = codeSpans(m[1]).filter((s) => /\.ya?ml$/.test(s)).sort();
    assert.deepEqual(named, requiredWorkflows());
});

test(`${SIGNALS_HEADING} names every workflow file`, () => {
    const text = section(SIGNALS_HEADING);
    const missing = workflowFiles.filter((f) => !text.includes(`\`${f}\``) && !text.includes(`${WORKFLOWS}/${f}`));
    assert.deepEqual(missing, []);
});

test('the signals rows that block merge are the workflows with required checks', () => {
    const rows = signalRows();
    const blocking = rows.filter((r) => /^yes\b/.test(r.blocks));
    for (const r of blocking) assert.ok(r.workflow, `${r.signal}: blocks merge but links no workflow`);
    assert.deepEqual(blocking.map((r) => r.workflow).sort(), requiredWorkflows());
});

test('the page says nothing on main is still only planned', () => {
    assert.doesNotMatch(read(PAGE), /not on `main`|only in an open PR/);
});

test('a scheduled workflow that reuses the CI job names supplies no required check', () => {
    const required = new Set(requiredChecks());
    assert.ok(checkNames('nightly-compliance.yml').some((n) => required.has(n)));
    assert.equal(runsOnPullRequests('nightly-compliance.yml'), false);
    assert.equal(runsOnPullRequests('ci.yml'), true);
});

test('the workflow reader expands the unit-test matrix', () => {
    assert.deepEqual(checkNames('ci.yml').sort(), [
        'E2E (fedora container)',
        'Lint (shellcheck)',
        'Unit tests (fedora container)',
        'Unit tests (ubuntu bash)',
    ]);
});
