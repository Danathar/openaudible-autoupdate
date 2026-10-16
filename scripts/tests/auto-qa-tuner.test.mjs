import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { propose, renderReport, jsonLineDiff, linesPct, loadSummaries } from '../auto-qa-tuner.mjs';

const rules = { raise_floor_when_headroom_exceeds: 5, buffer_below_measured: 3 };
const AREA = 'openaudible-autoupdate.sh';
const thresholds = () => ({
    areas: {
        [AREA]: {
            summary: 'coverage/bats/coverage.json',
            measured: { lines: 91 },
            floor: { lines: 88 },
        },
    },
});
// kcov writes percent_covered as a string.
const kcov = (pct) => ({ percent_covered: String(pct) });

test('linesPct reads kcov percent_covered and rejects anything else', () => {
    assert.equal(linesPct(kcov('96.40')), 96.4);
    assert.equal(linesPct(null), null);
    assert.equal(linesPct({}), null);
    assert.equal(linesPct({ percent_covered: 'n/a' }), null);
});

test('no raise when headroom does not exceed the margin (exactly at margin)', () => {
    const r = propose(thresholds(), rules, { [AREA]: kcov(93) });
    assert.equal(r.changes.length, 0);
    assert.deepEqual(r.proposed, thresholds());
});

test('raises to floor(measured - buffer) when headroom exceeds the margin', () => {
    const r = propose(thresholds(), rules, { [AREA]: kcov(96.4) });
    assert.deepEqual(r.changes, [
        { area: AREA, metric: 'lines', pct: 96.4, from: 88, to: 93, headroom: 8.4 },
    ]);
    assert.equal(r.proposed.areas[AREA].floor.lines, 93);
    assert.equal(r.proposed.areas[AREA].measured.lines, 96.4);
});

test('never lowers a floor when coverage drops', () => {
    const r = propose(thresholds(), rules, { [AREA]: kcov(40) });
    assert.equal(r.changes.length, 0);
    assert.equal(r.proposed.areas[AREA].floor.lines, 88);
});

test('a missing summary leaves the area untouched and is reported', () => {
    const r = propose(thresholds(), rules, { [AREA]: null });
    assert.equal(r.changes.length, 0);
    assert.match(r.skipped[0], /openaudible-autoupdate\.sh: no coverage summary/);
});

test('the proposed floor is never above measured minus the buffer', () => {
    const r = propose(thresholds(), rules, { [AREA]: kcov(99.9) });
    for (const c of r.changes) assert.ok(c.to <= c.pct - rules.buffer_below_measured);
});

test('report and diff show the change', () => {
    const r = propose(thresholds(), rules, { [AREA]: kcov(96.4) });
    assert.match(renderReport(r, rules), /\| openaudible-autoupdate\.sh \| lines \| 96\.4% \| 88% \| 93% \|/);
    const d = jsonLineDiff(thresholds(), r.proposed);
    assert.match(d, /^-\s+"lines": 88$/m);
    assert.match(d, /^\+\s+"lines": 93$/m);
    assert.match(renderReport({ changes: [], skipped: [] }, rules), /No floor raise warranted/);
});

test('CLI end to end: writes report and issue body, never touches the threshold file', () => {
    const root = mkdtempSync(join(tmpdir(), 'oaa-tuner-'));
    mkdirSync(join(root, '.github'));
    mkdirSync(join(root, 'coverage/bats'), { recursive: true });
    const tj = join(root, '.coverage-thresholds.json');
    writeFileSync(tj, JSON.stringify(thresholds(), null, 4));
    writeFileSync(join(root, '.github/auto-qa-tuning.json'), JSON.stringify({ coverage: rules }));
    writeFileSync(join(root, 'coverage/bats/coverage.json'), JSON.stringify(kcov('97.5')));
    assert.deepEqual(loadSummaries(thresholds(), root)[AREA], kcov('97.5'));
    const before = readFileSync(tj, 'utf8');
    const out = join(root, 'out');
    const outputFile = join(root, 'gh-output');
    const run = spawnSync(
        process.execPath,
        [new URL('../auto-qa-tuner.mjs', import.meta.url).pathname, '--root', root, '--out-dir', out],
        { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: outputFile } }
    );
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(outputFile, 'utf8'), 'raise=true\n');
    assert.match(readFileSync(join(out, 'issue-body.md'), 'utf8'), /```diff[\s\S]*\+\s+"lines": 94/);
    assert.equal(readFileSync(tj, 'utf8'), before);
});

test('never lowers a floor even when the buffer is larger than the margin', () => {
    // headroom 8.4 > 5 would raise, but floor(96.4 - 10) = 86 is below the floor of 88.
    const wide = { raise_floor_when_headroom_exceeds: 5, buffer_below_measured: 10 };
    const r = propose(thresholds(), wide, { [AREA]: kcov(96.4) });
    assert.deepEqual(r.changes, []);
    assert.deepEqual(r.proposed, thresholds());
});

test('an area without a summary does not stop the areas after it', () => {
    const t = thresholds();
    t.areas = { 'first.sh': { ...t.areas[AREA] }, [AREA]: t.areas[AREA] };
    const r = propose(t, rules, { 'first.sh': null, [AREA]: kcov(96.4) });
    assert.deepEqual(r.skipped, ['first.sh: no coverage summary, left unchanged']);
    assert.deepEqual(r.changes.map((c) => c.area), [AREA]);
    assert.match(renderReport(r, rules), /\n\nSkipped - first\.sh: no coverage summary, left unchanged\n$/);
});

test('linesPct rejects a percent_covered with trailing text', () => {
    assert.equal(linesPct({ percent_covered: '97 lines' }), null);
});

test('loadSummaries gives null for a summary file that does not exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'oaa-tuner-'));
    assert.deepEqual(loadSummaries(thresholds(), root), { [AREA]: null });
});

test('report states the rule with the configured numbers', () => {
    const text = renderReport({ changes: [], skipped: [] }, { raise_floor_when_headroom_exceeds: 7, buffer_below_measured: 2 });
    assert.match(text, /^## Auto-QA coverage tuning\n/);
    assert.match(text, /exceeds 7 points, to floor\(measured - 2\)\. Floors are never lowered automatically\./);
});

test('CLI the way auto-qa.yml runs it, nothing to raise: raise=false, empty issue body', () => {
    // .github/workflows/auto-qa.yml runs `node scripts/auto-qa-tuner.mjs --out-dir auto-qa-out`
    // from the checkout root, and opens the tracking issue only when raise == 'true'.
    const root = mkdtempSync(join(tmpdir(), 'oaa-tuner-'));
    mkdirSync(join(root, '.github'));
    mkdirSync(join(root, 'coverage/bats'), { recursive: true });
    writeFileSync(join(root, '.coverage-thresholds.json'), JSON.stringify(thresholds(), null, 4));
    writeFileSync(join(root, '.github/auto-qa-tuning.json'), JSON.stringify({ coverage: rules }));
    writeFileSync(join(root, 'coverage/bats/coverage.json'), JSON.stringify(kcov('92')));
    const outputFile = join(root, 'gh-output');
    const run = spawnSync(
        process.execPath,
        [new URL('../auto-qa-tuner.mjs', import.meta.url).pathname, '--out-dir', 'auto-qa-out'],
        { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: outputFile } }
    );
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(outputFile, 'utf8'), 'raise=false\n');
    const report = readFileSync(join(root, 'auto-qa-out/report.md'), 'utf8');
    assert.match(report, /No floor raise warranted/);
    assert.equal(run.stdout, report);
    assert.equal(readFileSync(join(root, 'auto-qa-out/issue-body.md'), 'utf8'), '');
});

test('CLI without GITHUB_OUTPUT writes no step output and still succeeds', () => {
    const root = mkdtempSync(join(tmpdir(), 'oaa-tuner-'));
    mkdirSync(join(root, '.github'));
    writeFileSync(join(root, '.coverage-thresholds.json'), JSON.stringify(thresholds(), null, 4));
    writeFileSync(join(root, '.github/auto-qa-tuning.json'), JSON.stringify({ coverage: rules }));
    const env = { ...process.env };
    delete env.GITHUB_OUTPUT;
    const run = spawnSync(
        process.execPath,
        [new URL('../auto-qa-tuner.mjs', import.meta.url).pathname, '--root', root, '--out-dir', join(root, 'out')],
        { encoding: 'utf8', env }
    );
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Skipped - openaudible-autoupdate\.sh: no coverage summary/);
});
