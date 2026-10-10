# Quality dashboard

Which quality signals this repository has, where to look at each, and the last
baseline that was actually read. There is no hosted dashboard: the signals are
GitHub Actions runs and committed files, and this page is the index. Actions
for this repository are at
<https://github.com/Danathar/openaudible-autoupdate/actions>. Every `gh`
command below names the repository so it works from any clone.

**Last reviewed:** 2026-10-10, at `main` = `d769ba1`.

## Signals

| signal | where it lives | what it tells you | blocks merge |
|---|---|---|---|
| CI jobs | the jobs in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | shellcheck and the bats unit tests of `openaudible-autoupdate.sh` (stubbed commands, never a real `dnf`), and the container end-to-end tests under `tests/e2e/` | yes: these job names are the required checks, see [branch-protection.md](branch-protection.md) |
| coverage gate | [`coverage-gate.yml`](../.github/workflows/coverage-gate.yml), floor in [`.coverage-thresholds.json`](../.coverage-thresholds.json) | coverage of the script has not dropped below the recorded floor | per that workflow |
| nightly compliance | [`nightly-compliance.yml`](../.github/workflows/nightly-compliance.yml) | scheduled re-check of the repository against its own rules | no, notification |
| policy check | [`policy-check.yml`](../.github/workflows/policy-check.yml), `scripts/check-policies.mjs`, `policies/` | agent-facing policy files are well formed and consistent | per that workflow |
| agent tooling tests | [`agent-tooling.yml`](../.github/workflows/agent-tooling.yml) | `node --test` over `scripts/tests/` and `.claude/hooks/tests/` (this includes the PR-metrics tests) | per that workflow |
| PR metrics | [`pr-metrics.yml`](../.github/workflows/pr-metrics.yml), definitions in [metrics.md](metrics.md), readings in [metrics/](metrics/README.md) | acceptance rate and time to merge, by author class | no, report only |
| agent audit | [`agent-audit.yml`](../.github/workflows/agent-audit.yml) | which agent actions ran and what they touched (audit trail) | no, report only |
| Codex review | `chatgpt-codex-connector[bot]` comments on a PR | automated findings, `P0`-`P3` ([review-rubric.md](review-rubric.md)) | no, advisory |

These files arrive through their own pull requests, so a link above that does
not resolve yet means that PR has not merged. The signal that is *not*
automated is the one that matters most for this script: the review rubric's
[checksum-before-install invariant](review-rubric.md#2-the-checksum-before-install-invariant)
is checked by a reader and by the tests of the mismatch path, not by a metric.

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

The coverage floor and the latest measured value are in the output of the
coverage gate's run and in `.coverage-thresholds.json`; this page does not
copy them, so they cannot drift here.

## Baseline (read 2026-10-10)

| | value | source |
|---|---|---|
| workflow runs on GitHub | none: `gh run list` and `gh workflow list` both printed nothing | `gh run list --repo Danathar/openaudible-autoupdate --limit 5` and `gh workflow list --repo Danathar/openaudible-autoupdate`, 2026-10-10 |
| pull requests | 1 total (#51, open, by the owner); none merged or closed | [metrics/2026-10-10.md](metrics/2026-10-10.md) |
| PR acceptance, time to merge | `n/a`: no decided PR yet | same snapshot |
| test counts, coverage percentage | not recorded: there were no tests or CI on `main` at the time of reading | `git ls-tree` of `d769ba1` lists only the script, two systemd units, README, LICENSE and `.gitignore` |

The baseline is a statement about `main` at `d769ba1`. As the test and CI pull
requests merge, replace the rows above with real runs (date, command, result)
and move the old reading into the dated snapshot history rather than editing
it into a different story.

## Known weak spots

- **The script ends in a privileged install.** Tests use stubbed commands; the
  real `sudo dnf install` path and a real OpenAudible manifest are only ever
  exercised by the owner on their own machine or in a throwaway container.
  Nothing automated watches the live manifest format
  (`https://openaudible.org/downloads/swt_version.json`) for changes.
- **Coverage of a Bash script is approximate.** Whatever tool the coverage gate
  uses measures executed lines, not whether the error paths are asserted;
  review the tests for the mismatch, failed-download and failed-install paths
  directly (rubric section 6).
- **Acceptance rate is not a quality signal while one person is the author and
  the reviewer.** See [metrics.md](metrics.md#how-to-read-the-numbers).
- **Green CI on a stale branch.** Required checks run on the PR branch; check
  that it is current with `main` before trusting a green run.
