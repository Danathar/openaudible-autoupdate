// docs/ai-ops-runbook.md is what the owner reads to find and switch off a
// workflow: a table with every workflow file, the `name:` that `gh workflow
// disable` takes, when it runs and which of its jobs show up on a pull
// request, a sentence naming the workflows whose jobs the ruleset requires,
// and a section on scheduled runs and the users' systemd timer. Nothing read
// any of it, so a new workflow, a renamed job or a moved schedule left the page
// wrong with every check green. These tests read each claim back from the
// workflow files, .github/rulesets/main.json and the timer unit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const RUNBOOK = 'docs/ai-ops-runbook.md';
const WORKFLOWS = '.github/workflows';
const RULESET = '.github/rulesets/main.json';
const TIMER = 'systemd/openaudible-autoupdate.timer';
const TABLE_HEADING = '## What each workflow does, and how to turn it off';
const SCHEDULE_HEADING = '## A scheduled run did not fire';

const codeSpans = (text) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const unquote = (s) => s.trim().replace(/^(['"])(.*)\1$/, '$2');

function section(page, heading) {
    const lines = read(page).split('\n');
    const start = lines.indexOf(heading);
    assert.notEqual(start, -1, `${page} has no ${JSON.stringify(heading)} heading`);
    const end = lines.findIndex((l, i) => i > start && /^#{1,3} /.test(l));
    return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

// The lines of a top-level YAML block (`on:`, `jobs:`), up to the next
// top-level key.
function topBlock(text, key) {
    const lines = text.split('\n');
    const start = lines.indexOf(`${key}:`);
    assert.notEqual(start, -1, `no block-form top-level "${key}:"`);
    const end = lines.findIndex((l, i) => i > start && /^\S/.test(l));
    return lines.slice(start + 1, end === -1 ? undefined : end);
}

// Children of a block that sit at the given indent, each with its own lines.
function children(lines, indent) {
    const head = new RegExp(`^ {${indent}}([A-Za-z0-9_-]+):`);
    const out = [];
    for (const line of lines) {
        const m = line.match(head);
        if (m) out.push({ key: m[1], first: line, lines: [] });
        else if (out.length && (line.startsWith(' '.repeat(indent + 1)) || line.trim() === '')) out.at(-1).lines.push(line);
    }
    return out;
}

// A job's check names: its `name:` (a matrix `${{ matrix.name }}` expanded
// from the include list), or its id when it has none.
function jobNames(job) {
    const nameLine = job.lines.find((l) => /^ {4}name:/.test(l));
    if (!nameLine) return { named: false, names: [job.key] };
    const name = unquote(nameLine.replace(/^ {4}name:/, ''));
    if (!name.includes('${{ matrix.name }}')) return { named: true, names: [name] };
    const stepsAt = job.lines.findIndex((l) => /^ {4}steps:/.test(l));
    const values = job.lines.slice(0, stepsAt === -1 ? undefined : stepsAt)
        .map((l) => l.match(/^\s+- name:\s*(.+)$/)).filter(Boolean).map((m) => unquote(m[1]));
    assert.ok(values.length > 0, `job ${job.key} uses matrix.name but has no include names`);
    return { named: true, names: values.map((v) => name.replace('${{ matrix.name }}', v)) };
}

function workflow(file) {
    const text = read(path.join(WORKFLOWS, file));
    const name = text.match(/^name:\s*(.+)$/m);
    assert.ok(name, `${file} has no top-level name:`);
    const on = children(topBlock(text, 'on'), 2);
    const triggers = Object.fromEntries(on.map((t) => [t.key, [t.first, ...t.lines].join('\n')]));
    const crons = [...(triggers.schedule ?? '').matchAll(/cron:\s*'([^']+)'/g)].map((m) => m[1]);
    const jobs = children(topBlock(text, 'jobs'), 2).map(jobNames);
    return { file, text, name: unquote(name[1]), triggers, crons, jobs };
}

const workflowFiles = fs.readdirSync(path.join(repoRoot, WORKFLOWS)).filter((f) => /\.ya?ml$/.test(f)).sort();
const workflows = Object.fromEntries(workflowFiles.map((f) => [f, workflow(f)]));
const allJobNames = (wf) => wf.jobs.flatMap((j) => j.names);

// `| \`file\` | \`name\` | what it does |` rows, keyed by file.
function tableRows() {
    const rows = section(RUNBOOK, TABLE_HEADING).split('\n').filter((l) => /^\| `/.test(l));
    assert.ok(rows.length > 0, `no workflow table under ${RUNBOOK} ${JSON.stringify(TABLE_HEADING)}`);
    return Object.fromEntries(rows.map((row) => {
        const cells = row.split('|').slice(1, -1).map((c) => c.trim());
        assert.equal(cells.length, 3, `expected 3 cells in ${row}`);
        return [unquote(cells[0].replace(/`/g, '')), { row, name: cells[1].replace(/^`|`$/g, ''), what: cells[2] }];
    }));
}
const rows = tableRows();

// A cron the table can say in words. Teach this function a new shape rather
// than loosening the comparison.
function cronWords(cron) {
    const m = cron.match(/^(\d+) (\d+) \* \* (\*|1)$/);
    assert.ok(m, `cron '${cron}' has no wording in this test yet`);
    const time = `${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')} UTC`;
    return m[3] === '*' ? `${time} daily` : `Mondays ${time}`;
}

test(`${RUNBOOK} lists every workflow file and no other`, () => {
    assert.ok(workflowFiles.length > 0);
    assert.deepEqual(Object.keys(rows).sort(), workflowFiles);
});

test('each row gives the name: that gh workflow disable takes', () => {
    for (const [file, { name }] of Object.entries(rows)) {
        assert.equal(name, workflows[file]?.name, `${file} row`);
    }
});

test('each row gives the schedule the workflow has, and only that', () => {
    for (const [file, { what }] of Object.entries(rows)) {
        const said = [...what.matchAll(/(Mondays )?(\d\d:\d\d UTC)( daily)?/g)].map((m) => m[0]).sort();
        assert.deepEqual(said, workflows[file].crons.map(cronWords).sort(), `${file} row`);
    }
});

test('each row names the events that start the workflow', () => {
    for (const [file, { what }] of Object.entries(rows)) {
        const t = workflows[file].triggers;
        const msg = `${file} row: ${what}`;
        assert.equal(/\bmanual\b/.test(what), 'workflow_dispatch' in t, `manual vs workflow_dispatch, ${msg}`);
        assert.equal(/pull request/.test(what), 'pull_request' in t, `pull request vs pull_request, ${msg}`);
        assert.equal(/PR review comment/.test(what), 'pull_request_review_comment' in t, `PR review comment, ${msg}`);
        // "on a push to `main`" describes the run auto-issues watches, not a trigger.
        assert.equal(/(?<!on a )push(es)? to `main`/.test(what), /^ {2}push:/.test(t.push ?? ''), `push to main, ${msg}`);
        if ('push' in t) assert.match(t.push, /branches:\s*\[\s*main\s*\]/, `${file} push trigger`);
        assert.equal(/` comment\b/.test(what), 'issue_comment' in t, `comment vs issue_comment, ${msg}`);

        const watched = what.match(/when `([^`]+)` completes/)?.[1];
        const runOf = t.workflow_run?.match(/workflows:\s*\[([^\]]+)\]/)?.[1].split(',').map(unquote);
        assert.deepEqual(watched ? [watched] : undefined, runOf, `workflow_run, ${msg}`);
        if (watched) assert.ok(Object.values(workflows).some((w) => w.name === watched), `no workflow named ${watched}`);

        const label = what.match(/on label `([^`]+)`/)?.[1];
        const labeled = ['issues', 'pull_request'].some((k) => /types:\s*\[[^\]]*\blabeled\b/.test(t[k] ?? ''));
        assert.equal(Boolean(label), labeled, `label trigger, ${msg}`);
        if (label) assert.ok(workflows[file].text.includes(`'${label}'`), `${file} never compares against label ${label}`);
    }
});

test('each row of a pull request workflow names every job that has a name:', () => {
    for (const [file, { row }] of Object.entries(rows)) {
        const wf = workflows[file];
        if (!('pull_request' in wf.triggers)) continue;
        const spans = new Set(codeSpans(row));
        for (const job of wf.jobs.filter((j) => j.named)) {
            for (const name of job.names) assert.ok(spans.has(name), `${file} row does not name job \`${name}\``);
        }
    }
});

test('every job or required check a row names is a job of that workflow', () => {
    for (const [file, { what }] of Object.entries(rows)) {
        const lists = [...what.matchAll(/\b(?:jobs?|required check) ((?:`[^`]+`(?:, | and )?)+)/g)];
        const have = new Set(allJobNames(workflows[file]));
        for (const span of lists.flatMap((m) => codeSpans(m[1]))) {
            assert.ok(have.has(span), `${file} row names job \`${span}\`, which ${file} does not have`);
        }
    }
});

test('the workflows the runbook says not to disable alone are the ones with required checks', () => {
    const required = [...read(RULESET).matchAll(/"context":\s*"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(required.length > 0, `no required check contexts in ${RULESET}`);
    const owners = new Set(required.map((ctx) => {
        // A required check has to report on pull requests; the nightly run
        // repeats some of the same job names on a schedule.
        const wf = Object.values(workflows).filter((w) => 'pull_request' in w.triggers && allJobNames(w).includes(ctx));
        assert.equal(wf.length, 1, `required check ${ctx} is a job of ${wf.length} pull request workflows`);
        return wf[0].name;
    }));
    const flat = section(RUNBOOK, TABLE_HEADING).replace(/\s*\n\s*/g, ' ');
    const sentence = flat.match(/Disable ((?:`[^`]+`(?:, | or )?)+) only if you also relax the ruleset/);
    assert.ok(sentence, 'no "Disable ... only if you also relax the ruleset" sentence');
    assert.deepEqual(codeSpans(sentence[1]).sort(), [...owners].sort());
});

test(`"${SCHEDULE_HEADING}" names a workflow that has a schedule`, () => {
    const files = codeSpans(section(RUNBOOK, SCHEDULE_HEADING)).filter((s) => /^[\w-]+\.yml$/.test(s) && s !== '<file>.yml');
    assert.ok(files.length > 0);
    for (const f of files) assert.ok(workflows[f]?.crons.length > 0, `${f} has no schedule:`);
});

test(`"${SCHEDULE_HEADING}" states the timer's ${TIMER} settings`, () => {
    const text = section(RUNBOOK, SCHEDULE_HEADING).replace(/\s*\n\s*/g, ' ');
    const timer = read(TIMER).split('\n').map((l) => l.trim());
    const spans = new Set(codeSpans(text));
    assert.ok(spans.has(TIMER), `section does not name ${TIMER}`);
    assert.ok(spans.has(path.basename(TIMER)));
    for (const key of ['OnCalendar', 'Persistent']) {
        const line = timer.find((l) => l.startsWith(`${key}=`));
        assert.ok(line, `${TIMER} has no ${key}=`);
        assert.ok(spans.has(line), `section does not say \`${line}\``);
    }
    for (const span of spans) {
        if (/^[A-Z]\w+=/.test(span)) assert.ok(timer.includes(span), `\`${span}\` is not a line of ${TIMER}`);
    }
    const delay = text.match(/(\d+) minute random delay/);
    assert.ok(delay, 'section does not give the random delay');
    assert.ok(timer.includes(`RandomizedDelaySec=${delay[1]}m`), `${TIMER} delay is not ${delay[1]} minutes`);
});
