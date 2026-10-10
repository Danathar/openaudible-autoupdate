# Change risk tiers

How to classify a change to this repository, and what each tier requires before
it merges. Reviewers and agents use it. [Agent boundaries](agent-boundaries.md)
maps the tiers to what an agent may change without the owner.

The tier is set by **what the change can break**, not by diff size. This
repository is one Bash script that runs `sudo dnf install` unattended on a
package it downloaded, so a one-line change to the checksum comparison is
Tier 1 and a 300-line change to the README is Tier 4.

This file is the source. [`risk-config.json`](../risk-config.json) restates the
table below as data, and `node scripts/check-policies.mjs` fails when the two
disagree. To change a tier, edit both in the same pull request.

## Tier table

Tier 1 is the most dangerous. `**` matches any depth, `*` matches within one
directory level.

| Tier | Name | Covers | Required commands | Review |
| ---- | ---- | ------ | ----------------- | ------ |
| 1 | critical | `.github/workflows/**`, `.github/CODEOWNERS`, `.github/rulesets/**`, `.claude/settings.json`, `.claude/hooks/**`, `policies/**`, `scripts/check-policies.mjs`, `risk-config.json`, `LICENSE`, `AGENTS.md` | `shellcheck openaudible-autoupdate.sh`, `bats tests/unit`, `tests/e2e/run.sh`, `node scripts/check-policies.mjs`, `node --test scripts/tests/*.test.mjs` | `owner` |
| 2 | high | `openaudible-autoupdate.sh`, `systemd/**`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.cursor/rules/**`, `.github/prompts/**`, `.claude/skills/**`, `.claude/memory/**` | `shellcheck openaudible-autoupdate.sh`, `bats tests/unit`, `node scripts/check-policies.mjs` | `owner` |
| 3 | medium | `tests/**`, `scripts/**`, `.shellcheckrc`, `.coverage-thresholds.json` | `bats tests/unit`, `node --test scripts/tests/*.test.mjs` | `ci` |
| 4 | low | `docs/**`, `*.md`, `.editorconfig`, `.gitignore` | none | `ci` |

Review values: `owner` means the repository owner (Danathar) reads the diff and
merges it, and a green CI run alone is not enough. `ci` means the required CI
checks must pass: the four jobs in `.github/workflows/ci.yml` (`Lint (shellcheck)`, `Unit tests (ubuntu bash)`, `Unit tests (fedora container)`, `E2E (fedora container)`), `Coverage gate` and `policy-check`, and an agent may
open and, under the Hive merge strategy, queue the pull request.

## The install path is Tier 1

A path glob cannot see inside a file, so `openaudible-autoupdate.sh` matches
Tier 2. The part of it that decides what gets installed as root is Tier 1 and
the table does not say so: **raise any change to the install path to Tier 1.**
The install path is:

- the manifest fields read with `jq` (`version`, `download_dir`,
  `platforms[...].file`, `platforms[...].sha256`), because they decide what is
  downloaded and from where;
- how the download path is built from `file_name` and where it is written;
- the `sha256sum` comparison between the downloaded file and the manifest value
  and the `exit 1` on mismatch;
- the `sudo dnf install -y` line and anything placed between the checksum check
  and it;
- the dependency check for `sudo`, `dnf` and `sha256sum`.

`policies/install-safety.json` checks the minimum of this mechanically (the
comparison exists, it exits on mismatch, it comes before the install command,
and no gpgcheck-disabling option appears). Everything else about the install
path is the reviewer's judgment, so a Tier 1 change to it states in the PR what
was checked. See [AI security policy](security/SECURITY-AI.md), section "The
install path".

The rest of the script (logging, notifications, the "not installed" early
exit) and `systemd/**` (what runs the script and when) are Tier 2. Path
matching is whole-file, so this split is a reviewer rule, not something the
checker or CODEOWNERS can see. The owner is asked to review every change to
the script regardless (CODEOWNERS requests the review; the ruleset does not
make it a blocking requirement).

## How to apply it

1. List every path the change touches.
2. Take the **highest-risk** (lowest-numbered) tier any path matches. A path
   that matches several rows, such as `AGENTS.md` (Tier 1) and `*.md` (Tier 4), takes the lowest number.
3. A path no row lists is Tier 3.
4. Raise the tier, never lower it, when the change is riskier than its path
   says: the install path rule above; a "docs" change that edits the example
   `systemd` unit or a command users copy and run; a test change that stubs out
   the checksum comparison.
5. Run every command in the tier's Required column. `shellcheck` in CI also covers `tests/`; locally run it on the files you changed. A pull request that spans
   tiers meets the requirements of its highest tier. `tests/e2e/run.sh` needs a
   container runtime; if you have none, say so in the PR and rely on the
   `E2E (fedora container)` job.

`node scripts/check-policies.mjs --classify <path> ...` prints the tier the
path table assigns to each path. It does not apply the install-path rule.

## Why these paths

- **`.github/workflows/**`, `.github/rulesets/**`, `.github/CODEOWNERS`.** What
  runs with repository tokens, what blocks a merge, and who must approve. A
  workflow that gets write scope or an interpolated issue title is a way into
  the repository.
- **`.claude/settings.json`, `.claude/hooks/**`.** The agent permission table and
  Bash guard (added by the Claude-learning change set, not by this one): they
  are meant to stop an agent from running the updater for real or pushing to
  the wrong repository.
- **`policies/**`, `scripts/check-policies.mjs`, `risk-config.json`, `AGENTS.md`.**
  The rules that bound agents and the checker that enforces them. They are
  changed by the owner, never by the agent they constrain.
- **`LICENSE`.** GPL-3.0-only text; changing it changes what users may do with
  the script.
- **`openaudible-autoupdate.sh`, `systemd/**`.** The code that runs as the user
  on a timer and calls `sudo dnf install`. See the install path above.
- **Agent direction files** (`CLAUDE.md`, `.github/copilot-instructions.md`,
  `.cursor/rules/**`, `.github/prompts/**`, `.claude/skills/**`,
  `.claude/memory/**`). They tell
  agents what to do; a loosened one loosens the agent.
- **`docs/**` (Tier 4), including `docs/security/**`, `docs/agent-boundaries.md`
  and this file.** Documentation is Tier 4 by path. These three describe the
  boundary, so CODEOWNERS still requests the owner's review on them and a
  change that loosens a rule they state is raised to the tier of the rule
  (step 4 above). Edit them together with the policy files they describe.
- **`tests/**`, `scripts/**`.** They can hide a regression but do not ship to the
  host. `scripts/check-policies.mjs` is the exception and is Tier 1.

## Pull request notes by tier

- Tier 1 and Tier 2: state in the PR body which of the required commands ran
  and what they printed, and what could not be run (for example `tests/e2e/run.sh` without a container runtime).
- Tier 1 changes to a workflow: say what was verified and what could not be (a
  cron schedule cannot be proven before it fires).
- Tier 1 changes to the install path: say how checksum verification, the
  `sudo dnf install` argument list and the handling of manifest fields were
  affected, even when the answer is "unchanged". Never run the updater for real
  to check; use the stubbed tests.

See also [`.github/CODEOWNERS`](../.github/CODEOWNERS) and, once it lands,
the review rubric in `docs/review-rubric.md`.
