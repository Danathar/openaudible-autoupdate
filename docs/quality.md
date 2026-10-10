# Quality dashboard

Which quality signals this repository has, where to look at each, and the last
baseline that was actually read. There is no hosted dashboard: the signals are
GitHub Actions runs and committed files, and this page is the index. Actions
for this repository are at
<https://github.com/Danathar/openaudible-autoupdate/actions>. Every `gh`
command below names the repository so it works from any clone.

**Last reviewed:** 2026-10-10, at `main` = `f1c6c55`.

The signals are split by state, because this repository gained them in
separate pull requests: the first table is what is on `main` (plus this PR's
own PR-metrics files), the second is what exists only in an open PR and so
does not run on `main` yet.

## Signals on `main` (f1c6c55)

| signal | where it lives | what it tells you | blocks merge |
|---|---|---|---|
| CI jobs | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml): `Lint (shellcheck)`, `Unit tests (<matrix entry>)`, `E2E (fedora container)` | shellcheck (pinned release), the bats unit tests in `tests/unit/` with stubbed commands (never a real `dnf`), and the container end-to-end test in `tests/e2e/` | these job names are what the main ruleset requires, see [branch-protection.md](branch-protection.md) (arrives in #58) |
| coverage gate | [`.github/workflows/coverage-gate.yml`](../.github/workflows/coverage-gate.yml) (job `Coverage gate`), floor in [`.coverage-thresholds.json`](../.coverage-thresholds.json), checker `scripts/coverage-gate.mjs` | line coverage of `openaudible-autoupdate.sh` under the bats tests (kcov) has not dropped below the floor | per the ruleset in #58 |
| PR metrics | [`.github/workflows/pr-metrics.yml`](../.github/workflows/pr-metrics.yml), definitions in [metrics.md](metrics.md), readings in [metrics/](metrics/README.md) (this PR, #53) | acceptance rate and time to merge, by author class | no, report only |

## Signals that exist only in an open PR

These are **planned, not on `main`**: the files are not in this tree, and
their workflows only run once the PR merges. Links to them are deliberately
not given, since they would not resolve.

| signal | open PR | what it will tell you |
|---|---|---|
| policy check (`policy-check.yml`, `scripts/check-policies.mjs`, `policies/`) | #55 | agent-facing policy files are well formed and consistent |
| agent tooling tests (`agent-tooling.yml`) | #57 | `node --test` over `scripts/tests/` and `.claude/hooks/tests/` |
| agent audit (`agent-audit.yml`) | #56 | weekly check that merged agent PRs have a linked issue, the signature line, an acceptable merger and base `main` |
| nightly compliance (`nightly-compliance.yml`) | #56 | scheduled re-check, including an `upstream-contract` job that reads the live OpenAudible manifest |
| Codex review | n/a | `chatgpt-codex-connector[bot]` may comment on a PR with `P0`-`P3` findings ([review-rubric.md](review-rubric.md)); advisory, and not guaranteed to be available |

[`docs/review-rubric.md`](review-rubric.md) is the reader's side of the same
picture. The property that matters most for this script, the
[checksum-before-install invariant](review-rubric.md#2-the-checksum-before-install-invariant),
is guarded by the tests of the mismatch path and by review, not by a metric.

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
| `ci.yml` runs available | 8: `pull_request` 5 success, 1 failure, 1 without a conclusion (still running); `push` 1 success | `gh run list --repo Danathar/openaudible-autoupdate --workflow ci.yml --limit 30 --json conclusion,event --jq 'group_by(.event+" "+.conclusion)[] \| "\(.[0].event) \(.[0].conclusion): \(length)"'` |
| latest `ci.yml` run on `main` | success, push of `f1c6c55` (PR #54) | `gh run list --repo Danathar/openaudible-autoupdate --workflow ci.yml --branch main --limit 5` |
| coverage floor | 95% lines; 100% (45/45 lines) was measured when the floor was set | [`.coverage-thresholds.json`](../.coverage-thresholds.json) |
| pull requests | 8 (#51 to #58): #54 merged, the other seven open; so one decided PR | `gh pr list --repo Danathar/openaudible-autoupdate --state all` |
| first PR-metrics reading | taken at `d769ba1`, when the only PR was #51 (open): every rate `n/a` | [metrics/2026-10-10.md](metrics/2026-10-10.md) |

These are readings, not guarantees: the run counts change with every push.
Replace them with a fresh reading and its date when you update this page.

## Known weak spots

- **The script ends in a privileged install.** Tests use stubbed commands; the
  real `sudo dnf install` path and a real OpenAudible manifest are only ever
  exercised by the owner on their own machine or in a throwaway container.
  Until the nightly compliance PR (#56) merges, nothing automated watches the
  live manifest format (`https://openaudible.org/downloads/swt_version.json`)
  for changes.
- **Line coverage of a Bash script is approximate.** kcov counts executed
  lines, not whether the error paths are asserted; review the tests for the
  mismatch, failed-download and failed-install paths directly (rubric
  section 6).
- **Acceptance rate needs an independent decider.** Until Hive-authored PRs
  are decided by someone other than their author, the rate says little about
  quality; see [metrics.md](metrics.md#how-to-read-the-numbers).
- **Green CI on a stale branch.** Required checks run on the PR branch; check
  that it is current with `main` before trusting a green run.
