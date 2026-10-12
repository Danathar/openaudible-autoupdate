import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluate, renderTable, loadSummaries } from '../coverage-gate.mjs';

const thresholds = {
    areas: {
        script: { summary: 'k.json', floor: { lines: 95 } },
    },
};
// kcov's coverage.json: top-level percent_covered is a number.
const summary = (pct) => ({ percent_covered: pct, covered_lines: 1, total_lines: 1 });

test('passes at or above the floor, including exactly at the floor', () => {
    assert.deepEqual(evaluate(thresholds, { script: summary(95) }).failures, []);
    assert.deepEqual(evaluate(thresholds, { script: summary(100) }).failures, []);
});

test('fails below the floor and names the numbers', () => {
    const r = evaluate(thresholds, { script: summary(94.99) });
    assert.equal(r.failures.length, 1);
    assert.match(r.failures[0], /script\.lines: 94\.99% is below the 95% floor/);
});

test('accepts the string form kcov uses for per-file percentages', () => {
    assert.deepEqual(evaluate(thresholds, { script: summary('96.50') }).failures, []);
});

test('a missing summary file is a failure, not a pass', () => {
    const r = evaluate(thresholds, { script: null });
    assert.match(r.failures[0], /no coverage summary at k\.json/);
});

test('a summary without percent_covered fails', () => {
    const r = evaluate(thresholds, { script: {} });
    assert.match(r.failures[0], /percent_covered not present/);
});

test('a missing floor fails', () => {
    const r = evaluate({ areas: { script: { summary: 'k.json', floor: {} } } }, { script: summary(100) });
    assert.match(r.failures[0], /no floor configured/);
});

test('table marks rows below floor', () => {
    const r = evaluate(thresholds, { script: summary(50) });
    assert.match(renderTable(r.rows), /\| script \| lines \| 50\.00% \| 95% \| BELOW FLOOR \|/);
});

// The CLI's exit status is what fails the Coverage gate check in CI, so these
// run the script as coverage-gate.yml does, against a throwaway repository root.
const repo = (pct, config = thresholds) => {
    const root = mkdtempSync(join(tmpdir(), 'oaa-gate-'));
    writeFileSync(join(root, '.coverage-thresholds.json'), JSON.stringify(config));
    if (pct !== undefined) writeFileSync(join(root, 'k.json'), JSON.stringify(summary(pct)));
    return root;
};
const gate = (args, cwd) =>
    spawnSync(process.execPath, [new URL('../coverage-gate.mjs', import.meta.url).pathname, ...args], {
        encoding: 'utf8',
        cwd,
    });

test('loadSummaries reads each summary relative to the root, null when absent', () => {
    const config = {
        areas: {
            script: { summary: 'k.json', floor: { lines: 95 } },
            other: { summary: 'missing/coverage.json', floor: { lines: 95 } },
        },
    };
    const root = repo('97.00', config);
    assert.deepEqual(loadSummaries(config, root), { script: summary('97.00'), other: null });
});

test('CLI passes, prints the table and exits 0 at the floor', () => {
    const run = gate(['--root', repo(95)]);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /\| script \| lines \| 95\.00% \| 95% \| ok \|/);
    assert.match(run.stdout, /Coverage gate passed\./);
    assert.equal(run.stderr, '');
});

test('CLI exits 1 and names the failure below the floor', () => {
    const run = gate(['--root', repo(94.99)]);
    assert.equal(run.status, 1);
    assert.match(run.stdout, /BELOW FLOOR/);
    assert.doesNotMatch(run.stdout, /Coverage gate passed/);
    assert.match(run.stderr, /Coverage gate FAILED:\n {2}- script\.lines: 94\.99% is below the 95% floor/);
});

test('CLI exits 1 when the kcov summary was never written', () => {
    const run = gate(['--root', repo(undefined)]);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /- script: no coverage summary at k\.json/);
});

test('CLI defaults --root to the working directory', () => {
    const run = gate([], repo(94));
    assert.equal(run.status, 1);
    assert.match(run.stderr, /94% is below the 95% floor/);
});

test('CLI --config names the thresholds file under the root', () => {
    const root = repo(90);
    mkdirSync(join(root, 'cfg'));
    writeFileSync(
        join(root, 'cfg/t.json'),
        JSON.stringify({ areas: { script: { summary: 'k.json', floor: { lines: 85 } } } })
    );
    const run = gate(['--root', root, '--config', 'cfg/t.json']);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /\| 90\.00% \| 85% \| ok \|/);
});

test('CLI fails, not passes, on an unreadable thresholds file', () => {
    const root = repo(100);
    writeFileSync(join(root, '.coverage-thresholds.json'), '{ not json');
    const run = gate(['--root', root]);
    assert.notEqual(run.status, 0);
    assert.doesNotMatch(run.stdout, /Coverage gate passed/);
});
