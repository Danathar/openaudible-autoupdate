#!/usr/bin/env node
// Proposes coverage floor raises. Never lowers a floor, never writes the
// repository's threshold file: output goes to --out-dir for the workflow to
// publish as a step summary and a tracking issue.
//
// Reads .coverage-thresholds.json (areas -> { summary, measured, floor }, the
// file scripts/coverage-gate.mjs enforces) and the kcov `coverage.json` each
// area's `summary` points at (`percent_covered` is the line coverage of the
// shell script). kcov reports line coverage only for Bash, so `lines` is the
// only metric. Rules: .github/auto-qa-tuning.json, "coverage" block.
//
// Usage: node scripts/auto-qa-tuner.mjs [--root <dir>] [--out-dir <dir>]
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Line coverage percentage from a kcov coverage.json, or null when absent. */
export function linesPct(summary) {
    const n = Number(summary?.percent_covered);
    return summary && summary.percent_covered !== undefined && Number.isFinite(n) ? n : null;
}

export function loadSummaries(thresholds, root) {
    const out = {};
    for (const [area, cfg] of Object.entries(thresholds.areas)) {
        const p = resolve(root, cfg.summary);
        out[area] = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
    }
    return out;
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {object} thresholds current .coverage-thresholds.json
 * @param {object} rules .github/auto-qa-tuning.json "coverage" block
 * @param {Record<string, object|null>} summaries area -> kcov coverage.json (null = missing)
 * @returns {{changes: object[], proposed: object, skipped: string[]}}
 */
export function propose(thresholds, rules, summaries) {
    const margin = rules.raise_floor_when_headroom_exceeds;
    const buffer = rules.buffer_below_measured;
    const proposed = structuredClone(thresholds);
    const changes = [];
    const skipped = [];
    for (const [area, cfg] of Object.entries(thresholds.areas)) {
        const pct = linesPct(summaries[area]);
        if (pct === null) {
            skipped.push(`${area}: no coverage summary, left unchanged`);
            continue;
        }
        const floor = cfg.floor.lines;
        const headroom = round2(pct - floor);
        const target = Math.floor(pct - buffer);
        if (headroom > margin && target > floor) {
            changes.push({ area, metric: 'lines', pct, from: floor, to: target, headroom });
            proposed.areas[area].floor.lines = target;
            proposed.areas[area].measured.lines = pct;
        }
    }
    return { changes, proposed, skipped };
}

export function renderReport({ changes, skipped }, rules) {
    const out = ['## Auto-QA coverage tuning', ''];
    out.push(
        `Rule: raise a floor when measured minus floor exceeds ${rules.raise_floor_when_headroom_exceeds} points, to floor(measured - ${rules.buffer_below_measured}). Floors are never lowered automatically.`,
        ''
    );
    if (changes.length === 0) {
        out.push('No floor raise warranted.');
    } else {
        out.push(
            '| area | metric | measured | floor now | proposed floor |',
            '| --- | --- | ---: | ---: | ---: |'
        );
        for (const c of changes) {
            out.push(`| ${c.area} | ${c.metric} | ${c.pct}% | ${c.from}% | ${c.to}% |`);
        }
    }
    for (const s of skipped) out.push('', `Skipped - ${s}`);
    return out.join('\n') + '\n';
}

/** Line diff of two JSON documents with identical shape (same key order). */
export function jsonLineDiff(before, after) {
    const a = JSON.stringify(before, null, 4).split('\n');
    const b = JSON.stringify(after, null, 4).split('\n');
    const out = [];
    a.forEach((line, i) => {
        if (line !== b[i]) out.push(`-${line}`, `+${b[i]}`);
    });
    return out.join('\n');
}

function main(argv) {
    const arg = (name, dflt) => {
        const i = argv.indexOf(name);
        return i >= 0 ? argv[i + 1] : dflt;
    };
    const root = resolve(arg('--root', process.cwd()));
    const outDir = resolve(arg('--out-dir', 'auto-qa-out'));
    const thresholds = JSON.parse(readFileSync(resolve(root, '.coverage-thresholds.json'), 'utf8'));
    const rules = JSON.parse(readFileSync(resolve(root, '.github/auto-qa-tuning.json'), 'utf8')).coverage;
    const result = propose(thresholds, rules, loadSummaries(thresholds, root));
    const report = renderReport(result, rules);
    mkdirSync(outDir, { recursive: true });
    let issueBody = '';
    if (result.changes.length) {
        issueBody =
            report +
            '\nProposed change to `.coverage-thresholds.json` (apply by hand in a pull request):\n\n```diff\n' +
            jsonLineDiff(thresholds, result.proposed) +
            '\n```\n';
    }
    writeFileSync(resolve(outDir, 'report.md'), report);
    writeFileSync(resolve(outDir, 'issue-body.md'), issueBody);
    process.stdout.write(report);
    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `raise=${result.changes.length > 0}\n`);
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main(process.argv.slice(2));
}
