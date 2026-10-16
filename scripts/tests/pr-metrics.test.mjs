import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    classifyAuthor,
    computeMetrics,
    formatDuration,
    formatRate,
    median,
    outcomeOf,
    percentile,
    renderMarkdown,
    summarize,
} from '../pr-metrics.mjs';

const NOW = '2026-10-09T12:00:00Z';
const nowMs = Date.parse(NOW);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const iso = (ms) => new Date(ms).toISOString();
const human = { login: 'Danathar', is_bot: false };
const hive = { login: 'app/danathar-atomic-hive', is_bot: true };

function merged(number, author, createdAgoMs, openForMs) {
    const created = nowMs - createdAgoMs;
    return {
        number,
        author,
        state: 'MERGED',
        createdAt: iso(created),
        mergedAt: iso(created + openForMs),
        closedAt: iso(created + openForMs),
    };
}

test('no PRs gives zeros and null rates, not NaN', () => {
    const m = computeMetrics([], { now: NOW });
    const all = m.windows.all.overall;
    assert.equal(all.merged, 0);
    assert.equal(all.acceptanceRate, null);
    assert.equal(all.timeToMergeHours.median, null);
    assert.equal(all.timeToMergeHours.p90, null);
    assert.match(renderMarkdown(m), /n\/a/);
});

test('open-only PRs are counted open and leave the rate undefined', () => {
    const prs = [
        { number: 1, author: human, state: 'OPEN', createdAt: iso(nowMs - DAY), mergedAt: null, closedAt: null },
    ];
    const s = computeMetrics(prs, { now: NOW }).windows.all.overall;
    assert.equal(s.open, 1);
    assert.equal(s.merged + s.closedUnmerged, 0);
    assert.equal(s.acceptanceRate, null);
});

test('closed-unmerged PRs lower acceptance and have no merge time', () => {
    const prs = [
        merged(1, human, 3 * DAY, 2 * HOUR),
        {
            number: 2,
            author: human,
            state: 'CLOSED',
            createdAt: iso(nowMs - 3 * DAY),
            mergedAt: null,
            closedAt: iso(nowMs - 2 * DAY),
        },
    ];
    const s = computeMetrics(prs, { now: NOW }).windows.all.overall;
    assert.equal(s.merged, 1);
    assert.equal(s.closedUnmerged, 1);
    assert.equal(s.acceptanceRate, 0.5);
    assert.equal(s.timeToMergeHours.samples, 1);
    assert.equal(s.timeToMergeHours.median, 2);
    assert.equal(outcomeOf(prs[1]), 'closed');
});

test('author classification: owner, Hive app, other bots, other humans', () => {
    assert.equal(classifyAuthor({ login: 'Danathar', is_bot: false }), 'owner');
    assert.equal(classifyAuthor({ login: 'danathar' }), 'owner');
    assert.equal(classifyAuthor(hive), 'hive');
    assert.equal(classifyAuthor({ login: 'danathar-atomic-hive[bot]', is_bot: true }), 'hive');
    assert.equal(classifyAuthor({ login: 'app/dependabot', is_bot: true }), 'other-bot');
    assert.equal(classifyAuthor({ login: 'dependabot[bot]' }), 'other-bot');
    assert.equal(classifyAuthor({ login: 'someone', is_bot: false }), 'other-human');
    assert.equal(classifyAuthor(null), 'other-human');
    // A lookalike account is not Hive.
    assert.equal(classifyAuthor({ login: 'danathar-atomic-hive-fake', is_bot: false }), 'other-human');
});

test('per-class summaries split the same PRs without double counting', () => {
    const prs = [
        merged(1, human, 5 * DAY, HOUR),
        merged(2, hive, 5 * DAY, 3 * HOUR),
        merged(3, { login: 'app/dependabot', is_bot: true }, 5 * DAY, HOUR),
    ];
    const w = computeMetrics(prs, { now: NOW }).windows.all;
    assert.equal(w.overall.merged, 3);
    assert.equal(w.byAuthorClass.owner.merged, 1);
    assert.equal(w.byAuthorClass.hive.merged, 1);
    assert.equal(w.byAuthorClass['other-bot'].merged, 1);
    assert.equal(w.byAuthorClass['other-human'].merged, 0);
    assert.equal(w.byAuthorClass.hive.timeToMergeHours.median, 3);
});

test('window edge: merged exactly 30 days ago is in, one second earlier is out', () => {
    const edge = nowMs - 30 * DAY;
    const on = { ...merged(1, human, 31 * DAY, 0), mergedAt: iso(edge), closedAt: iso(edge) };
    const before = { ...merged(2, human, 31 * DAY, 0), mergedAt: iso(edge - 1000), closedAt: iso(edge - 1000) };
    const m = computeMetrics([on, before], { now: NOW });
    assert.equal(m.windows.all.overall.merged, 2);
    assert.equal(m.windows.last30d.overall.merged, 1);
});

test('window is by merge date, not creation date', () => {
    // Opened 40 days ago, merged yesterday: counts in the 30-day window.
    const pr = merged(1, human, 40 * DAY, 39 * DAY);
    const m = computeMetrics([pr], { now: NOW });
    assert.equal(m.windows.last30d.overall.merged, 1);
    assert.equal(m.windows.last30d.overall.timeToMergeHours.median, 39 * 24);
});

test('PRs decided after "now" are ignored (reproducible with a fixed --now)', () => {
    const pr = merged(1, human, 2 * DAY, 3 * DAY); // merged 1 day in the future
    assert.equal(computeMetrics([pr], { now: NOW }).windows.all.overall.merged, 0);
});

test('custom window length', () => {
    const pr = merged(1, human, 10 * DAY, HOUR);
    const m = computeMetrics([pr], { now: NOW, windowDays: 7 });
    assert.equal(m.windows.last7d.overall.merged, 0);
    assert.equal(m.windows.all.overall.merged, 1);
});

test('median and nearest-rank p90', () => {
    assert.equal(median([]), null);
    assert.equal(median([5]), 5);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
    assert.equal(percentile(ten, 90), 9);
    assert.equal(percentile([7], 90), 7);
    assert.equal(percentile([], 90), null);
    const s = summarize(
        ten.map((h, i) => merged(i + 1, human, 20 * DAY, h * HOUR)),
        { nowMs },
    );
    assert.equal(s.timeToMergeHours.median, 5.5);
    assert.equal(s.timeToMergeHours.p90, 9);
});

test('formatDuration picks minutes, hours or days', () => {
    assert.equal(formatDuration(null), 'n/a');
    assert.equal(formatDuration(0.5), '30 min');
    assert.equal(formatDuration(5.25), '5.3 h');
    assert.equal(formatDuration(72), '3 d');
});

test('non-array input is rejected', () => {
    assert.throws(() => computeMetrics({}, { now: NOW }), TypeError);
    assert.throws(() => computeMetrics([], { now: 'not a date' }), TypeError);
});

test('CLI reads stdin and honours --format json', () => {
    const script = fileURLToPath(new URL('../pr-metrics.mjs', import.meta.url));
    const input = JSON.stringify([merged(1, human, 2 * DAY, HOUR)]);
    const out = execFileSync(process.execPath, [script, '--now', NOW, '--format', 'json'], { input, encoding: 'utf8' });
    const parsed = JSON.parse(out);
    assert.equal(parsed.totalPrs, 1);
    assert.equal(parsed.windows.all.overall.merged, 1);
});

test('CLI exits non-zero on bad input', () => {
    const script = fileURLToPath(new URL('../pr-metrics.mjs', import.meta.url));
    assert.throws(
        () => execFileSync(process.execPath, [script], { input: '{"not":"an array"}', stdio: 'pipe' }),
        (err) => err.status === 1 && /must be a JSON array/.test(String(err.stderr)),
    );
});

test('formatRate shows the rounded rate and merged/decided', () => {
    assert.equal(formatRate({ acceptanceRate: null, merged: 0, closedUnmerged: 0 }), 'n/a');
    assert.equal(formatRate({ acceptanceRate: 2 / 3, merged: 2, closedUnmerged: 1 }), '66.7% (2/3)');
    assert.equal(formatRate({ acceptanceRate: 1, merged: 4, closedUnmerged: 0 }), '100% (4/4)');
});

test('formatDuration boundaries: 1 hour is hours, 48 hours is days', () => {
    assert.equal(formatDuration(1), '1 h');
    assert.equal(formatDuration(47.9), '47.9 h');
    assert.equal(formatDuration(48), '2 d');
});

test('a bot flag alone makes an account a bot', () => {
    assert.equal(classifyAuthor({ login: 'renovate', is_bot: true }), 'other-bot');
    assert.equal(classifyAuthor({ login: 'Danathar', is_bot: true }), 'other-bot');
});

test('--owner changes who counts as the owner', () => {
    const prs = [merged(1, { login: 'someone', is_bot: false }, 2 * DAY, HOUR), merged(2, human, 2 * DAY, HOUR)];
    const w = computeMetrics(prs, { now: NOW, owner: 'SomeOne' }).windows.all.byAuthorClass;
    assert.equal(w.owner.merged, 1);
    assert.equal(w['other-human'].merged, 1);
    assert.equal(classifyAuthor({ login: 'someone' }, 'someone'), 'owner');
    assert.equal(classifyAuthor(human, 'someone'), 'other-human');
});

test('open PRs: created after now are left out, undated or unparseable ones are counted', () => {
    const open = (number, createdAt) => ({ number, author: human, state: 'OPEN', createdAt, mergedAt: null, closedAt: null });
    const s = summarize(
        [open(1, iso(nowMs - DAY)), open(2, iso(nowMs + DAY)), open(3, null), open(4, 'not a date')],
        { nowMs },
    );
    assert.equal(s.open, 3);
});

test('outcome: CLOSED state or a closedAt each mean closed when there is no mergedAt', () => {
    assert.equal(outcomeOf({ state: 'CLOSED', mergedAt: null, closedAt: null }), 'closed');
    assert.equal(outcomeOf({ state: 'OPEN', mergedAt: null, closedAt: iso(nowMs) }), 'closed');
    assert.equal(outcomeOf({ state: 'OPEN', mergedAt: null, closedAt: null }), 'open');
    assert.equal(outcomeOf({ state: 'MERGED', mergedAt: iso(nowMs), closedAt: iso(nowMs) }), 'merged');
});

test('a decided PR with no decision date is not counted in any window', () => {
    const pr = { number: 1, author: human, state: 'CLOSED', createdAt: iso(nowMs - DAY), mergedAt: null, closedAt: null };
    const s = computeMetrics([pr], { now: NOW }).windows.all.overall;
    assert.equal(s.closedUnmerged, 0);
    assert.equal(s.acceptanceRate, null);
});

test('merged PRs without a usable creation date count as merged but give no merge time', () => {
    const noCreated = { ...merged(1, human, 2 * DAY, HOUR), createdAt: null };
    const badCreated = { ...merged(2, human, 2 * DAY, HOUR), createdAt: 'not a date' };
    const mergedBeforeCreated = { ...merged(3, human, 2 * DAY, HOUR), mergedAt: iso(nowMs - 3 * DAY) };
    const s = summarize([noCreated, badCreated, mergedBeforeCreated], { nowMs });
    assert.equal(s.merged, 3);
    assert.equal(s.timeToMergeHours.samples, 0);
    assert.equal(s.timeToMergeHours.median, null);
});

test('now may be a Date; window start and labels come from it', () => {
    const now = new Date(nowMs + 123);
    const m = computeMetrics([], { now });
    assert.equal(m.generatedAt, now.toISOString());
    assert.equal(m.windows.all.since, null);
    assert.equal(m.windows.last30d.since, iso(nowMs + 123 - 30 * DAY));
    assert.equal(m.windows.last30d.label, 'last 30 days');
});

test('markdown lists every window and author class with its numbers', () => {
    const prs = [
        merged(1, human, 3 * DAY, 2 * HOUR),
        merged(2, hive, 3 * DAY, 30 * 60_000),
        { number: 3, author: hive, state: 'CLOSED', createdAt: iso(nowMs - 3 * DAY), mergedAt: null, closedAt: iso(nowMs - DAY) },
        merged(4, hive, 50 * DAY, 4 * DAY),
    ];
    const md = renderMarkdown(computeMetrics(prs, { now: NOW, windowDays: 7 }));
    assert.match(md, /^Generated 2026-10-09T12:00:00\.000Z from 4 PRs\. /m);
    assert.match(md, /^## All time$/m);
    assert.match(md, /^## Last 7 days$/m);
    assert.match(md, /^\| all \| 3 \| 1 \| 0 \| 75% \(3\/4\) \| 2 h \| 4 d \|$/m);
    assert.match(md, /^\| Hive app \| 2 \| 1 \| 0 \| 66\.7% \(2\/3\) \| 2 d \| 4 d \|$/m);
    assert.match(md, /^\| Hive app \| 1 \| 1 \| 0 \| 50% \(1\/2\) \| 30 min \| 30 min \|$/m);
    assert.match(md, /^\| owner \| 1 \| 0 \| 0 \| 100% \(1\/1\) \| 2 h \| 2 h \|$/m);
    assert.match(md, /^\| other bots \| 0 \| 0 \| 0 \| n\/a \| n\/a \| n\/a \|$/m);
    assert.match(md, /^\| other humans \| 0 \| 0 \| 0 \| n\/a \| n\/a \| n\/a \|$/m);
});

test('CLI with the weekly run\'s arguments: --input, --window-days, --json-out', () => {
    // .github/workflows/pr-metrics.yml runs
    //   node scripts/pr-metrics.mjs --input prs.json --window-days "$WINDOW_DAYS" --json-out pr-metrics.json
    const script = fileURLToPath(new URL('../pr-metrics.mjs', import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), 'oaa-prm-'));
    const input = join(dir, 'prs.json');
    const jsonOut = join(dir, 'pr-metrics.json');
    const prs = [merged(1, human, 10 * DAY, HOUR), merged(2, hive, 2 * DAY, HOUR)];
    writeFileSync(input, JSON.stringify(prs));
    const md = execFileSync(
        process.execPath,
        [script, '--input', input, '--window-days', '7', '--json-out', jsonOut, '--now', NOW],
        { input: '', encoding: 'utf8' },
    );
    assert.match(md, /^## Last 7 days$/m);
    assert.match(md, /from 2 PRs\./);
    const json = JSON.parse(readFileSync(jsonOut, 'utf8'));
    assert.deepEqual(json, computeMetrics(prs, { now: NOW, windowDays: 7 }));
    assert.equal(json.windows.last7d.overall.merged, 1);
    assert.equal(json.windows.all.overall.merged, 2);
});

test('CLI --owner and --format markdown', () => {
    const script = fileURLToPath(new URL('../pr-metrics.mjs', import.meta.url));
    const input = JSON.stringify([merged(1, { login: 'someone', is_bot: false }, 2 * DAY, HOUR)]);
    const out = execFileSync(process.execPath, [script, '--now', NOW, '--owner', 'someone', '--format', 'json'], { input, encoding: 'utf8' });
    assert.equal(JSON.parse(out).windows.all.byAuthorClass.owner.merged, 1);
    const md = execFileSync(process.execPath, [script, '--now', NOW, '--format', 'markdown'], { input, encoding: 'utf8' });
    assert.match(md, /^# PR metrics$/m);
});

test('CLI rejects bad arguments with exit 1 and a message', () => {
    const script = fileURLToPath(new URL('../pr-metrics.mjs', import.meta.url));
    const cases = [
        [['--bogus'], /unknown argument: --bogus/],
        [['--format', 'xml'], /--format must be markdown or json/],
        [['--window-days', '0'], /--window-days must be a positive number/],
        [['--window-days', 'abc'], /--window-days must be a positive number/],
        [['--input'], /--input needs a value/],
    ];
    for (const [args, message] of cases) {
        assert.throws(
            () => execFileSync(process.execPath, [script, ...args], { input: '[]', stdio: 'pipe' }),
            (err) => err.status === 1 && message.test(String(err.stderr)),
            args.join(' '),
        );
    }
});
