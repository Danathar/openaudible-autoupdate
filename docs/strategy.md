# Strategy

This page says why `Danathar/openaudible-autoupdate` exists, what it
deliberately does not do, which goals are measured and where, and what the
measurements said on the date below. Rules for agents are in
[`AGENTS.md`](../AGENTS.md); how agents share the repository is in
[`multi-agent.md`](multi-agent.md).

Every `gh` command here passes `--repo Danathar/openaudible-autoupdate`.

## Why this repository exists

From [`README.md`](../README.md):

- **A gap in how OpenAudible ships.** OpenAudible distributes standalone
  installers (`.rpm`, `.deb`, `.sh`, `.AppImage`) with no package repository
  behind them, so `dnf` never sees a new release.
- **One small tool.** `openaudible-autoupdate.sh` reads the installed version with
  `rpm -q`, fetches OpenAudible's own manifest
  (`https://openaudible.org/downloads/swt_version.json`), and, when the version
  differs, downloads the rpm named under `.platforms.linux_x86_64_rpm`, checks its
  `sha256`, and runs `sudo dnf install -y` on it. Two systemd user units in
  `systemd/` run it daily.
- **It only updates.** It does not install OpenAudible, and exits cleanly if the
  rpm is not installed.
- **Container-aware by documentation, not by code.** The author runs
  [Aurora](https://getaurora.dev/), a bootc-based distro, where OpenAudible lives
  in a distrobox; the README shows how to point the service at the container.
  The script itself has no distrobox logic.
- **GPL-3.0-only** ([`LICENSE`](../LICENSE)), and the README says it was written
  with AI help.
- **Agents help maintain it.** The owner uses AI agents (Hive agents, the Codex
  connector, local Claude Code or omp sessions) to build and review changes. The
  ACMM issues (`[ACMM L0]` to `[ACMM L6]`) are the scaffolding that makes that
  safe and auditable. Because the script runs unattended with `sudo`, safe
  matters more here than fast.

## What it will not do

- Run the updater for real in tests, CI or an agent session: tests use stubbed
  commands or a throwaway container.
- Install a package it has not checksum-verified, or skip the `sha256` check to
  make a test pass.
- Grow into a package manager: no other distributions' formats, no repository
  hosting. It keeps an existing rpm install current.
- Let an agent merge its own pull request, or widen its own permissions. A
  merge is a human's, or the Hive serialized lane's after the required checks
  pass ([`multi-agent.md`](multi-agent.md)).

## Measurable goals

Each goal names the place it is measured. Most of those places are added by
the ACMM pull requests in [`agent-tasks/2026-10-10.md`](agent-tasks/2026-10-10.md)
and did not exist at the baseline read below (`d769ba1`); once they merge, each
file's own header is the source of truth. Run the command for today's answer.

| goal | measured by | where |
|---|---|---|
| Reach and hold the target ACMM level | the ACMM evaluator's result for this repo; open criteria are the `[ACMM L<n>]` issues | `gh issue list --repo Danathar/openaudible-autoupdate --state open --limit 100` (titles start with `[ACMM`) |
| `main` stays green | the jobs in `.github/workflows/ci.yml` (`Lint (shellcheck)`, `Unit tests (ubuntu bash)`, `Unit tests (fedora container)`, `E2E (fedora container)`) on pushes to `main` | `gh run list --repo Danathar/openaudible-autoupdate --workflow ci.yml --branch main --limit 10 --json createdAt,conclusion` |
| Tests do not lose coverage | the line-coverage floor for `openaudible-autoupdate.sh` in `.coverage-thresholds.json` (95% when written, measured 100% on 45 lines), enforced by `.github/workflows/coverage-gate.yml` (job `Coverage gate`); a floor guards against regression, it is not a target to climb | `gh run list --repo Danathar/openaudible-autoupdate --workflow coverage-gate.yml --branch main --limit 10 --json createdAt,conclusion` |
| The script still matches OpenAudible's manifest | the `Upstream manifest contract` job in `.github/workflows/nightly-compliance.yml`, which fetches the live manifest and checks that the fields the script reads are still there; the same workflow repeats the unit, shellcheck and e2e jobs nightly | `gh run list --repo Danathar/openaudible-autoupdate --workflow nightly-compliance.yml --limit 7` |
| Change flow is visible | PR counts, review findings, CI outcomes, read by `scripts/pr-metrics.mjs` | [`metrics.md`](metrics.md), dated snapshots in [`metrics/`](metrics/) |
| Agent work is traceable | every agent PR has `Closes #N`, a signature line and a merger that is a human or the Hive serialized lane | [`agent-tasks/`](agent-tasks/README.md), the `agent-audit.yml` run summary |

The fields the script depends on are `.version`, `.download_dir` and
`.platforms[$PLATFORM_KEY].file` and `.sha256`
(`openaudible-autoupdate.sh:40-43`). The contract check exists because
OpenAudible controls that file, not this repository.

None of these is a velocity target. Throughput and coverage percentage are not
goals; optimising them would mean rushing review or padding tests.

## Status on 2026-10-09

Read on 2026-10-09 at `origin/main` = `d769ba1` (the repository's fourth
commit). Left as it was read; the next reading is a new dated section or file,
not an edit.

| measure | reading | how it was read |
|---|---|---|
| Repository | public, not a fork, default branch `main`, 4 commits | `gh api repos/Danathar/openaudible-autoupdate --jq '.fork,.default_branch'` printed `false` and `main`; `git log --oneline` |
| CI on `main` | at that baseline, no workflow files exist at `d769ba1`, and no runs | `gh run list --repo Danathar/openaudible-autoupdate` returned nothing |
| Branch protection | no rulesets: `gh api repos/Danathar/openaudible-autoupdate/rulesets` printed `[]`. The ruleset is issue #42, a settings change recorded in [`branch-protection.md`](branch-protection.md) | `gh api repos/Danathar/openaudible-autoupdate/rulesets` |
| Coverage floor | none yet: `.coverage-thresholds.json` does not exist at `d769ba1` | file absent |
| Tests | none at `d769ba1`; the repository has `LICENSE`, `README.md`, the script and the two units | `git ls-tree -r --name-only HEAD` |
| Open pull requests | 0 | `gh pr list --repo Danathar/openaudible-autoupdate --state all` printed `[]` |
| ACMM | 50 open `[ACMM L<n>]` issues (#1 to #50), one per missing criterion; the evaluator's current level was not read for this page: see the Hive dashboard card | `gh issue list --repo Danathar/openaudible-autoupdate --state open --limit 100` |
| OpenAudible manifest | version `5.0.1`; `linux_x86_64_rpm` present with a `file` and a 64-hex `sha256`; top-level `.version` and `.download_dir` present | `curl -s https://openaudible.org/downloads/swt_version.json \| jq` |

## Keeping this page honest

Do not put a number here that a later commit can make false without dating it.
The status table is a dated reading; everything above it is commands and
reasons. When you change a command, run it and check it prints what the text
says.
