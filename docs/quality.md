# Quality dashboard

Which quality signals this repository has, where to look at each, and the last
baseline that was actually read. There is no hosted dashboard: the signals are
GitHub Actions runs and committed files, and this page is the index. Actions
for this repository are at
<https://github.com/Danathar/openaudible-autoupdate/actions>. Every `gh`
command below names the repository so it works from any clone.

**Last reviewed:** 2026-10-10, at `main` = `1305b17`.

The signals are split by state, because this repository gained them in
separate pull requests: the first table is what is on `main` (plus this PR's
own PR-metrics files), the second is what exists only in an open PR and does
not run on `main` yet.

## Signals on `main` (1305b17)

| signal | where it lives | what it tells you | blocks merge |
|---|---|---|---|
| CI jobs | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml): `Lint (shellcheck)`, `Unit tests (<matrix entry>)`, `E2E (fedora container)` | shellcheck (pinned release), the bats unit tests in `tests/unit/` with stubbed commands (never a real `dnf`), and the container end-to-end test in `tests/e2e/` | yes, all three: see "Required checks" below |
| coverage gate | [`.github/workflows/coverage-gate.yml`](../.github/workflows/coverage-gate.yml) (job `Coverage gate`), floor in [`.coverage-thresholds.json`](../.coverage-thresholds.json), checker `scripts/coverage-gate.mjs` | line coverage of `openaudible-autoupdate.sh` under the bats tests (kcov) has not dropped below the floor | yes: see "Required checks" below |
| policy check | [`.github/workflows/policy-check.yml`](../.github/workflows/policy-check.yml) (job `policy-check`), `scripts/check-policies.mjs`, [`policies/`](../policies/README.md) | the repository still satisfies its machine-checkable policies (install safety, repo target, workflow permissions); `node scripts/check-policies.mjs` runs it locally | yes: see "Required checks" below |
| nightly compliance | [`.github/workflows/nightly-compliance.yml`](../.github/workflows/nightly-compliance.yml) | every night against `main`: bats tests, shellcheck, the container e2e test, and an `upstream-contract` job that reads the live OpenAudible manifest and checks the fields the script uses are still there; a scheduled failure opens or updates one tracking issue | no, notification |
| auto-QA | [`.github/workflows/auto-qa.yml`](../.github/workflows/auto-qa.yml), rules in [`.github/auto-qa-tuning.json`](../.github/auto-qa-tuning.json) | weekly: measures coverage and, when the floor can be raised, opens or updates one issue with the proposed diff; never pushes and never lowers the floor | no, report only |
| agent audit | [`.github/workflows/agent-audit.yml`](../.github/workflows/agent-audit.yml), `scripts/ai-audit-report.mjs` | weekly: each merged agent PR has a linked issue, the signature line, an acceptable merger and base `main`; a violation fails the run | no, scheduled |
| auto issues | [`.github/workflows/auto-issues.yml`](../.github/workflows/auto-issues.yml) | opens an issue for a red `main` | no, notification |
| PR metrics | [`.github/workflows/pr-metrics.yml`](../.github/workflows/pr-metrics.yml), definitions in [metrics.md](metrics.md), readings in [metrics/](metrics/README.md) (this PR, #53) | acceptance rate and time to merge, by author class | no, report only |
| mutation check on changed lines | `scripts/mutation-check.mjs`, [`stryker.config.mjs`](../stryker.config.mjs), [`.mutation-survivors.json`](../.mutation-survivors.json); see [below](#mutation-check-on-changed-lines) | a changed line of the guard hook, its shared reader or a `scripts/*.mjs` script can be broken without any test failing | no, advisory |

## Required checks

The ruleset on `main` requires seven status checks: `Lint (shellcheck)`,
`Unit tests (ubuntu bash)`, `Unit tests (fedora container)`,
`E2E (fedora container)`, `Coverage gate`, `policy-check` and `agent-tooling`.
They come from `ci.yml` (the first four), `coverage-gate.yml`,
`policy-check.yml` and `agent-tooling.yml`. The first six were read on
2026-10-10 with `gh api repos/Danathar/openaudible-autoupdate/rulesets/24826574`,
which printed those six contexts; #58 records the ruleset as
`.github/rulesets/main.json`. The strict
setting means a PR must also be up to date with `main`. PR metrics is not
required.

## Signals that exist only in an open PR

These are **planned, not on `main`**: the files are not in this tree, and
their workflows only run once the PR merges. Links to them are deliberately
not given, since they would not resolve.

| signal | open PR | what it will tell you |
|---|---|---|
| agent tooling tests (`agent-tooling.yml`) | #57 | `node --test` over `scripts/tests/` and `.claude/hooks/tests/` |

Also on `main` but not quality signals: `labeler.yml`, `ai-fix.yml` and
`claude.yml` (agent automation). Codex review (`chatgpt-codex-connector[bot]`)
may comment on a PR with `P0`-`P3` findings ([review-rubric.md](review-rubric.md));
it is advisory and not guaranteed to be available.

[`docs/review-rubric.md`](review-rubric.md) is the reader's side of the same
picture. The property that matters most for this script, the
[checksum-before-install invariant](review-rubric.md#2-the-checksum-before-install-invariant),
is guarded by the tests of the mismatch path and by review, not by a metric.

## Mutation check on changed lines

Guard-hook changes here kept merging with every test green while some of their changed lines could be
broken without any test noticing; each time a later hand mutation audit found them and a test-only pull
request pinned them (#110, #113, #119, #123, #132). The reader is also copied byte-identical from other
repositories, so an unpinned line here is unpinned everywhere. `scripts/mutation-check.mjs` does that audit
for the lines a pull request changes (#155).

- **What it mutates:** only the added and changed lines (`git diff -U0 <base>...HEAD`) of
  `.claude/hooks/*.mjs` and `scripts/*.mjs`. Tests are never mutated.
- **Which tests it runs:** [StrykerJS](https://stryker-mutator.io/) `@stryker-mutator/core` 10.0.0 with its
  built-in `command` test runner, so the tests stay plain `node --test` files. Hook files run against
  `node --test .claude/hooks/tests/guard-bash.test.mjs .claude/hooks/tests/gate-refusal-corpus.test.mjs`; a
  script `scripts/<name>.mjs` runs against `scripts/tests/<name>.test.mjs`, and a changed script without one
  is reported. `.claude/hooks/tests/shell-reader.test.mjs` is never in a command: it pins the reader's
  sha256, so it fails for every mutant and would count each one as killed.
- **No dependency:** Stryker is installed with `npm install --prefix <dir> --no-save --ignore-scripts
  @stryker-mutator/core@10.0.0`, outside the checkout; the repository has no `package.json`.
  `scripts/mutation-check.mjs` is dependency-free and `stryker.config.mjs` holds the Stryker settings.
- **Result:** exit 0 means no new survivor, 1 a new survivor (each listed with a ready-to-fill ledger entry,
  and in the step summary under GitHub Actions), 2 the check could not run. A full guard test run is about
  30 s and runs once per mutant.
- **In CI:** the advisory `Mutation check on changed lines (advisory)` job in
  [`agent-tooling.yml`](../.github/workflows/agent-tooling.yml) runs it on each pull request (#155). It is
  `continue-on-error`, pull requests only, and never a required check.
- **What to do with a survivor:** add a test that fails on it. If it is equivalent (behaves the same) or
  harmless over-refusal (the guard refuses more, never less), add the printed entry to
  `.mutation-survivors.json` with a real reason. Entries match on file, mutator, original and replacement
  text, not on line numbers, so they survive edits elsewhere in the file. A survivor that lets the guard
  allow a command it should refuse is never accepted.
- **By hand:** install Stryker as above into a temporary directory, then
  `node scripts/mutation-check.mjs --base origin/main --stryker <dir>/node_modules/.bin/stryker`.
  `--dry-run` prints the Stryker runs without starting them; `--report <file>` checks existing Stryker JSON
  reports against the ledger.

## Where to look

```bash
# latest runs of the main gate
gh run list --repo Danathar/openaudible-autoupdate --workflow ci.yml --limit 10
# one run, with failing steps
gh run view <run-id> --repo Danathar/openaudible-autoupdate --log-failed
# PR metrics, current
gh pr list --repo Danathar/openaudible-autoupdate --state all --limit 500 \
  --json number,author,state,createdAt,mergedAt,closedAt,labels,title \
  | node scripts/pr-metrics.mjs
```

The coverage floor and the measurement it was set from are in
`.coverage-thresholds.json`; the current value is in the output of the latest
`Coverage gate` run. This page does not copy those numbers, so they cannot
drift here.

## Baseline (read 2026-10-10)

| | value | source |
|---|---|---|
| `ci.yml` runs on `main` | 3, all `push`, all success (`f1c6c55`, `63d17bf`, `1305b17`) | `gh run list --repo Danathar/openaudible-autoupdate --workflow ci.yml --branch main --limit 30 --json conclusion,event,headSha` |
| coverage floor | `floor.lines` 95; `measured.lines` 100 (45/45 lines) when the file was introduced | [`.coverage-thresholds.json`](../.coverage-thresholds.json) |
| pull requests | 8 (#51 to #58): #54, #55 and #56 merged, the other five open; so three decided PRs, all merged | `gh pr list --repo Danathar/openaudible-autoupdate --state all --json number,state` |
| first PR-metrics reading | taken at `d769ba1`, before any of the signals above existed on `main`: one open PR (#51), every rate `n/a` | [metrics/2026-10-10.md](metrics/2026-10-10.md) |

These are readings, not guarantees: the run counts change with every push.
Replace them with a fresh reading and its date when you update this page.

## Known weak spots

- **The script ends in a privileged install.** Tests use stubbed commands; the
  real `sudo dnf install` path and a real OpenAudible manifest are only ever
  exercised by the owner on their own machine or in a throwaway container.
  Only the nightly `upstream-contract` job watches the live manifest format
  (`https://openaudible.org/downloads/swt_version.json`) for changes; a rename
  shows up there the next night, not on a pull request.
- **Line coverage of a Bash script is approximate.** kcov counts executed
  lines, not whether the error paths are asserted; review the tests for the
  mismatch, failed-download and failed-install paths directly (rubric
  section 6).
- **Acceptance rate needs an independent decider.** Until Hive-authored PRs
  are decided by someone other than their author, the rate says little about
  quality; see [metrics.md](metrics.md#how-to-read-the-numbers).
- **Green CI on a stale branch.** Required checks run on the PR branch; check
  that it is current with `main` before trusting a green run.
