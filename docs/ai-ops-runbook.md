# AI operations runbook

For the owner. It says how to notice each automated signal in this repository,
what to check first, and what to do, and how to stop each automation.

**The safety rule comes first.** `openaudible-autoupdate.sh` runs
`sudo dnf install -y` on the rpm it downloads. Nothing in this runbook,
and no agent, runs it for real to "see what happens". Reproduce with stub
`curl`, `rpm`, `sudo` and `dnf` on `PATH`, or in a throwaway container. Every
`gh` command here passes `--repo Danathar/openaudible-autoupdate`.

| signal or need | section |
|---|---|
| Stop all agent work | [Pause and resume the repository in Hive](#pause-and-resume-the-repository-in-hive) |
| What does each workflow do, how do I turn it off | [What each workflow does](#what-each-workflow-does-and-how-to-turn-it-off) |
| Red `main` | [A red `main`](#a-red-main) |
| The nightly manifest check failed | [OpenAudible changed its manifest](#openaudible-changed-its-manifest) |
| Users report a broken OpenAudible after an update | [A bad update reached users](#a-bad-update-reached-users) |
| A token or key appeared in a commit, log or comment | [A leaked secret](#a-leaked-secret) |
| An agent is looping or doing the wrong thing | [A runaway agent](#a-runaway-agent) |
| A scheduled run never appeared | [A scheduled run did not fire](#a-scheduled-run-did-not-fire) |

## Pause and resume the repository in Hive

Hive is outside this repository. Its per-repo pause stops agent activity on
`Danathar/openaudible-autoupdate` only, and leaves the card on the dashboard, its
counts and its ACMM evaluation in place. It is a different switch from pausing
one agent (everywhere) or the whole fleet.

- **Dashboard:** on the repo's card under PROJECTS, the owner presses "pause"
  (it asks for a reason) or "resume".
- **API:** `POST /api/repos/pause` with `{"repo": "<name>", "reason": "..."}`,
  `POST /api/repos/resume` with `{"repo": "<name>"}`, and
  `GET /api/repos/pauses` to list. Pause and resume are owner-only.

Source: Hive's `src/docs/repo-pause.md`. Whether this repository is paused right
now is shown on the dashboard; this page does not record it.

What pausing does not do:

- It does not stop GitHub workflows. Those are switched off per workflow (next
  section).
- It does not stop the Codex connector's reviews or a local Claude Code or omp
  session.
- It does not undo anything an agent already pushed.

Confirm that Hive has stopped by looking for new bot activity:

```bash
gh pr list --repo Danathar/openaudible-autoupdate --state all --author app/danathar-atomic-hive --limit 5 --json number,createdAt,title
```

## What each workflow does, and how to turn it off

All live in [`.github/workflows/`](../.github/workflows/). Disable one without
deleting it (this changes repository settings; it is reversible, and `enable`
brings it back). A workflow can be named by its file name, so no `name:` needs
looking up:

```bash
gh workflow disable "<workflow name>" --repo Danathar/openaudible-autoupdate
gh workflow enable  "<workflow name>" --repo Danathar/openaudible-autoupdate
gh workflow list --repo Danathar/openaudible-autoupdate --all
```

Disabling a required check leaves pull requests waiting for a status that never
arrives. Disable `CI`, `Coverage gate` or `Policy check` only if you also relax the ruleset
([`branch-protection.md`](branch-protection.md)). To remove a workflow
permanently, delete the file in a pull request.

| file | `name:` (use it to disable) | what it does and when it runs |
|---|---|---|
| `ci.yml` | `CI` | jobs `Lint (shellcheck)`, `Unit tests (ubuntu bash)`, `Unit tests (fedora container)`, `E2E (fedora container)`; every pull request and every push to `main` |
| `coverage-gate.yml` | `Coverage gate` | measures line coverage of the script under the bats tests with kcov in a Fedora container and fails below the floor in `.coverage-thresholds.json`; pull requests and pushes to `main` |
| `nightly-compliance.yml` | `Nightly compliance` | 04:23 UTC daily and manual: repeats unit, shellcheck and e2e jobs, and runs `Upstream manifest contract` against the live OpenAudible manifest; on failure opens or updates one tracking issue and never closes it |
| `auto-qa.yml` | `Auto-QA` | Mondays 05:17 UTC and manual: measures coverage like the gate, runs `scripts/auto-qa-tuner.mjs` with `.github/auto-qa-tuning.json`, and opens or updates one issue proposing a higher floor; never commits, never lowers a floor |
| `pr-metrics.yml` | `PR metrics` | Mondays 06:17 UTC and manual: runs `scripts/pr-metrics.mjs`, writes a step summary and a `pr-metrics` artifact; read-only ([`metrics.md`](metrics.md)) |
| `agent-audit.yml` | `Agent audit trail` | Mondays 05:17 UTC and manual: `scripts/ai-audit-report.mjs --strict` checks agent PRs for a linked issue, a signature line and a human (or Hive lane) merger; a violation turns the run red, nothing is written |
| `auto-issues.yml` | `Auto issues` | when `CI` completes as failure, timed out or startup failure on a push to `main`, opens or comments on one tracking issue; never closes it |
| `ai-fix.yml` | `AI fix requested` | on label `ai-fix-requested` (issue or PR) or an `/ai-fix` comment from the owner, a member or a collaborator, asks Claude Code to verify review findings and apply those that hold; skips bots and fork PRs |
| `claude.yml` | `Claude` | an `@claude` comment (issue, PR conversation or PR review comment) from the owner, a member or a collaborator; refuses fork PRs; without `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` it writes a summary and skips |
| `labeler.yml` | `Labeler` | labels pull requests by changed paths using [`.github/labeler.yml`](../.github/labeler.yml); skipped for fork PRs |
| `policy-check.yml` | `Policy check` | runs `scripts/check-policies.mjs` over `policies/` and `risk-config.json`, then its tests; pull requests and pushes to `main` |
| `agent-tooling.yml` | `Agent tooling` | `node --test` over `scripts/tests/*.test.mjs` and `.claude/hooks/tests/*.test.mjs`; pull requests and pushes to `main` that touch `.claude/**`, `scripts/**` or the workflow itself |

These are the workflows in the pull requests listed in
[`agent-tasks/2026-10-10.md`](agent-tasks/2026-10-10.md); they exist on `main`
only once those merge. A header comment at the top of each file explains its
triggers and gating; that header, not this table, is the source of truth if they
differ. Get the exact `name:` with `grep -m1 '^name:' .github/workflows/<file>`.

The agent workflows hold a write token, so they never use `pull_request_target`
and they skip bots and outsiders before doing anything. If you doubt one,
disable it first and read it afterwards.

## A red `main`

Signal: a run of `CI` on a push to `main` fails, or `auto-issues.yml` opened
an issue for the failing workflow.

```bash
gh run list --repo Danathar/openaudible-autoupdate --workflow ci.yml --branch main --limit 5
RUN=<run id>
gh run view "$RUN" --repo Danathar/openaudible-autoupdate --json jobs \
  --jq '.jobs[] | {name, conclusion, failed: [.steps[] | select(.conclusion=="failure") | .name]}'
gh run view "$RUN" --repo Danathar/openaudible-autoupdate --log-failed
```

1. **Which job.** Read the failing step. A shellcheck failure is a change to the
   script or a test; a unit-test failure names the bats test that pinned the
   behaviour; an end-to-end failure is the container run.
2. **Was it the last commit or the environment.** Re-run once
   (`gh run rerun "$RUN" --repo Danathar/openaudible-autoupdate --failed`). A pass
   on re-run is a flake; note it in the tracking issue. A new runner image or
   package version in a container job is the usual environmental cause.
3. **Fix forward or revert.** If the cause is clear, fix in a branch and pull
   request as usual. If not, revert the offending merge in a pull request
   (`git revert -m 1 <merge sha>`). Do not push to `main` directly.
4. **Remember what `main` is.** Users copy the script from this repository. If
   the broken commit changed `openaudible-autoupdate.sh`, treat it as a possible
   [bad update](#a-bad-update-reached-users) as well as a red check.
5. **Close the tracking issue by hand** when `main` is green again;
   `auto-issues.yml` does not close one.

## OpenAudible changed its manifest

Signal: the `Upstream manifest contract` job of `Nightly compliance` fails (the tracking issue says so), or a user reports the script failing. The script
depends on `.version`, `.download_dir` and `.platforms[$PLATFORM_KEY].file` /
`.sha256` of `https://openaudible.org/downloads/swt_version.json`
(the `jq` reads after the manifest is fetched). OpenAudible, not this repository, controls
that file.

```bash
curl -fsSL https://openaudible.org/downloads/swt_version.json | jq '{version, download_dir, platforms: (.platforms | keys)}'
curl -fsSL https://openaudible.org/downloads/swt_version.json | jq '.platforms.linux_x86_64_rpm'
```

Read the result against what the script expects:

1. **A key is missing or renamed.** If `.platforms.linux_x86_64_rpm` is gone, the
   script logs `Platform key '...' not found in version manifest.` and exits 1
   (the `if [ -z "$file_name" ]` check), so it fails safely: no install happens.
   Find the new key name and either change the default of `PLATFORM_KEY`
   (the `: "${PLATFORM_KEY:=...}"` line at the top of the script) and the README configuration table in one
   pull request, or tell affected users to set `PLATFORM_KEY` in the service.
2. **`.version`, `.download_dir` or `.sha256` changed shape or went missing.**
   The script reads each field as a string only (a missing field or a
   non-string reads as empty) and checks its shape before anything is
   downloaded, so a changed field fails safely: the run logs
   `Invalid version manifest: ...` and exits 1. To accept a new shape, add a
   stubbed-manifest unit test for it first, then change the matching check in
   the script.
3. **The manifest URL moved.** `curl -fsSL --proto =https --proto-redir =https` fails and the script exits 1 with
   `Failed to fetch version manifest`. Update the default of `VERSION_URL`
   (the `: "${VERSION_URL:=...}"` line at the top of the script) and the README table; users can meanwhile
   set `VERSION_URL` in the service.
4. **Until the fix merges,** consider telling users to disable the timer (see
   [below](#a-bad-update-reached-users)) if a changed shape could make the script
   install the wrong file. A script that fails on every run is harmless; one that
   mis-reads the manifest is not.

Do not "fix" this by running the script against the real manifest on the owner's
host. Use a saved copy of the manifest as the stub's data.

## A bad update reached users

Signal: OpenAudible misbehaves right after an automatic update, or a change to
`openaudible-autoupdate.sh` or the systemd units on `main` is found to be wrong.
There are two different causes, and users act on both the same way.

**Stop further updates first.** On each affected machine:

```bash
systemctl --user disable --now openaudible-autoupdate.timer
journalctl --user -u openaudible-autoupdate.service   # what it installed and when
```

If OpenAudible lives in a distrobox or toolbox, the timer is still on the host;
the `dnf` commands below run inside the container.

**Roll OpenAudible back.** The script keeps no copy of the rpm: it downloads into
a temporary directory that is removed when it exits
(the `WORKDIR` and `trap` lines at the top of the script). Roll back from dnf's record or from the
vendor's release (the local-file `dnf install` below was tried with dummy rpms, see
the note after it; `dnf history undo` was not):

```bash
sudo dnf history list                       # find the transaction that upgraded OpenAudible
sudo dnf history undo <id>                  # reverses it, only if dnf can still fetch the old package
# or install the vendor's older rpm as a local file, so dnf still solves dependencies:
sudo dnf install ./OpenAudible_<old version>_x86_64.rpm
```

There is no package repository behind OpenAudible, so `sudo dnf downgrade
OpenAudible` works only if a configured repo happens to carry the older version.
Installing the older rpm as a local file keeps dependency solving. Tried on
2026-10-10 in a throwaway `registry.fedoraproject.org/fedora:latest` container
with two dummy rpm versions (2.0 installed, then `dnf install` of the 1.0 file):
dnf reported `Downgrading` and `Replacing`, exited 0, and `rpm -q` then showed
1.0. If your dnf behaves differently, read its message before forcing anything.

The older rpm comes from OpenAudible: the manifest's `download_dir` is
`https://github.com/openaudible/openaudible/releases/download/v<version>/`, so an
older version's file sits under its own tag if the vendor still publishes it.
Verify its `sha256` against what you trust before installing. If the vendor
shipped the bad release, nothing in this repository fixes that; roll back,
leave the timer off, and re-enable it when a good release is out.

**Fix the cause in this repository** if the script caused it:

- The script installs whenever the manifest version differs from the installed
  version (the `[ "$latest_version" = "$installed_version" ]` test), not only
  when it is higher. If the vendor republishes an older version number, it will
  install that, and Fedora's dnf does downgrade a local rpm (`E2E (fedora
  container)` case 3b printed `installed after run: 1.0.0` in CI run
  38046391883). A fix is a
  comparison change plus a test with stubbed versions.
- Revert the offending merge by pull request, say in the PR what users must do
  (copy the script again to `~/bin`, per the README), and add a test that fails
  on the bad behaviour first.
- Record the incident in the day's ledger under
  [`agent-tasks/`](agent-tasks/README.md).

## A leaked secret

Signal: a token, key or credential in a commit, a PR, an issue, a log or a
comment. The repository's secrets are the Anthropic credential used by
`claude.yml` and `ai-fix.yml`, if the owner added one, and any Hive tokens;
`ci.yml` and the scripts here need no secret.

1. **Revoke first.** Rotate or delete the credential at its issuer, before
   cleaning the repository. History cleanup does not un-leak a secret that was
   public.
2. Disable the workflow that used it (table above) until a new one is set.
3. Remove it from the visible surface: edit or delete the comment or issue body;
   for a commit, a revert does not remove it from history, so the owner decides
   about rewriting history of a branch (never of `main` without a plan).
4. Replace it with `gh secret set <NAME> --repo Danathar/openaudible-autoupdate`,
   run by the owner so the value is never in a transcript.
5. Record it in the day's ledger without the value.

## A runaway agent

Signal: a Hive agent or a workflow opening many PRs or comments, rewriting the
same files (usually `openaudible-autoupdate.sh`), or acting outside its issue.

1. **Pause the repository in Hive** (first section). Then disable `ai-fix.yml`
   and `claude.yml` if a workflow agent is involved.
2. **Stop what is queued.** Cancel running workflows:
   `gh run cancel <run id> --repo Danathar/openaudible-autoupdate`; list with
   `gh run list --repo Danathar/openaudible-autoupdate --status in_progress`.
3. **Contain the output.** Close its open pull requests
   (`gh pr close <N> --repo Danathar/openaudible-autoupdate`) and keep the
   branches for evidence. Nothing it opened should merge: the serial lane and the
   required checks are why a runaway cannot land by volume, so confirm the
   ruleset is active
   (`gh api repos/Danathar/openaudible-autoupdate/rulesets`).
4. **Check what merged.**
   `gh pr list --repo Danathar/openaudible-autoupdate --state merged --author app/danathar-atomic-hive --limit 20`,
   and the `agent-audit.yml` run summary. Revert anything wrong by pull request;
   if it touched the script, also read
   [a bad update](#a-bad-update-reached-users).
5. **Find why** before resuming: the issue text it followed, the instructions in
   [`AGENTS.md`](../AGENTS.md), the guard and permission settings in
   [`agent-boundaries.md`](agent-boundaries.md). Fix the instruction, not only
   the output.

## A scheduled run did not fire

Scheduled workflows (`nightly-compliance.yml`, and any other with a `schedule:`)
run only from the default branch, can be delayed under load, and GitHub disables
schedules in a repository with no activity for 60 days. Check with
`gh workflow list --repo Danathar/openaudible-autoupdate --all`; re-enable a
disabled one with `gh workflow enable <file>.yml --repo Danathar/openaudible-autoupdate`,
and start one by hand with
`gh workflow run <file>.yml --repo Danathar/openaudible-autoupdate`.

The users' own timer is a different thing: `openaudible-autoupdate.timer` is
`OnCalendar=daily` with `Persistent=true` and a 30 minute random delay
(`systemd/openaudible-autoupdate.timer`), so a run missed while the machine was
off happens when the user's systemd manager next starts and activates the
timer: at the next login, or at boot if lingering is enabled for that user. Check it on the machine with
`systemctl --user list-timers openaudible-autoupdate.timer`.
