import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, renderTable } from '../coverage-gate.mjs';

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
