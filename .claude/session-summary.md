# Session summary

The handoff between working sessions. Read it at the start of a session, after
[AGENTS.md](../AGENTS.md) and [CLAUDE.md](../CLAUDE.md); rewrite it at the end.
It carries only what is true right now and would otherwise have to be
rediscovered. Standing rules belong in AGENTS.md, mistakes worth never
repeating in [memory/](memory/README.md), recurring patterns in
[../docs/reflections/](../docs/reflections/README.md).

**Host rule.** Never run `openaudible-autoupdate.sh`, `sudo` or a package
install on the host: the script ends in `sudo dnf install -y`. Use stubs on
`PATH` from `tests/` or `podman run`/`docker run`. `guard-bash.mjs` blocks the
rest. GitHub writes pass `--repo Danathar/openaudible-autoupdate`.

## How to use it

Start of session:

1. Read "Current state" and the latest session entry below.
2. Verify anything you are about to rely on. Branch names, PR numbers and SHAs
   drift: check with `git log origin/main`,
   `gh pr list --repo Danathar/openaudible-autoupdate` and
   `gh issue list --repo Danathar/openaudible-autoupdate`.

End of session. This file is one tracked singleton, so concurrent PRs that all
rewrite it will conflict or overwrite each other. Rule: only the session that
lands work on `main` (the one that merges, or a dedicated handoff PR opened
after the merge) rewrites it, starting from the current `origin/main` copy. A
session that opens a PR to be merged later puts its notes in the PR body and
leaves this file alone. Steps for the session that updates it:

1. Update "Current state" so it matches what is on `main` now.
2. Replace the "Last session" entry. Overwrite it; do not append a history. What
   is worth keeping long term goes to AGENTS.md, `memory/` or `docs/reflections/`.
3. Rewrite "Open threads" and "Next steps": remove what is finished, and keep
   each remaining item to one line with its issue or PR number.
4. Record only things you observed. Mark guesses as `[INFERENCE]`.

Entry format:

```markdown
## Last session: <YYYY-MM-DD> - <one-line focus>

**Done:** what landed, with PR/issue numbers
**In flight:** open PRs, unmerged branches, half-finished work
**Blocked on:** decisions or merges needed before the next step
**Watch:** observed but not acted on
```

---

## Current state (as of 2026-10-09)

This is the first version of the file, written by the ACMM rollout PR for the
agent-learning issues (#16, #21-#24, #32, #33, #38). It describes `main` at
`d769ba1`, before any rollout PR has merged.

- **What the repo is:** one Bash script, `openaudible-autoupdate.sh` (74 lines),
  two systemd user units in `systemd/`, `README.md`, `LICENSE` (GNU GPL v3) and
  `.gitignore`. It checks OpenAudible's manifest
  (`https://openaudible.org/downloads/swt_version.json`) against the installed
  `OpenAudible` rpm, downloads the rpm, compares its sha256 and runs
  `sudo dnf install -y`.
- **History:** four commits, `6caac1b` (script, units, README, LICENSE) to
  `d769ba1` (README note callout). The script has not changed since `6caac1b`.
- **Known defects on `main`:** `log()` returns 1 when `systemd-cat` is missing
  and kills the run under `set -e` (see
  [memory/log-and-list-under-set-e.md](memory/log-and-list-under-set-e.md));
  fixed in PR #54, not merged when this was written. The version check is
  equality, not "newer" ([memory/version-check-is-equality.md](memory/version-check-is-equality.md)).
- **ACMM rollout:** the fifty `[ACMM ...]` issues are being worked as seven
  slices, one PR each against `main`: #51 (agent directions), #52 (autonomy
  docs), #53 (metrics and quality), #54 (tests, CI, coverage gate), #55
  (governance), #56 (automation), plus the PR that adds this file. All were
  open when this was written. Until they merge, `main` has no tests, no CI, no
  `.claude/` and no `AGENTS.md`.
- **Agent tooling (this PR):** `.claude/settings.json` registers
  `.claude/hooks/guard-bash.mjs` on every Bash call; `agent-tooling.yml` runs
  `node --test` over `scripts/tests/` and `.claude/hooks/tests/`.
- **Branch protection / merge strategy:** no ruleset existed when this was
  written (`gh api repos/Danathar/openaudible-autoupdate/rulesets` returned
  none). Hive's merge strategy for this repo is `hive-serialized`, as set by the
  owner and read back from Hive's API by the rollout lead.
- **Not verified from this repository:** whether the owner's timer is enabled
  on their machine, and which container (if any) holds their OpenAudible rpm.

## Last session: 2026-10-09 - ACMM learning artifacts (#16, #21-#24, #32, #33, #38)

**Done:** nothing merged yet; the PR adds the guard hook and its tests, the
permission settings, five memory entries, this file, and the first reflection.
**In flight:** PRs #51-#56 and the PR for this slice; none merged.
**Blocked on:** the owner's review and merge of those PRs.
**Watch:** the hook's stubs-on-`PATH` exemption needs a committed directory
`tests/<dir>` holding executable `sudo`, `dnf` and `rpm`. The foundation PR
(#54) does not have one: its bats helpers build stubs in `$BATS_TEST_TMPDIR`
at run time and its e2e test runs in `podman run`, both of which the hook
allows. So the exemption only matters for a hand-run
`PATH=tests/<dir>:$PATH ./openaudible-autoupdate.sh`, which no file in #54
sets up.

## Open threads

- `guard-bash.mjs` is a guard against careless commands, not a sandbox (threat
  model at the top of the file). `podman run`/`docker run` are allowed without
  inspecting their arguments, so a run that mounts the host's root or is
  `--privileged` is not caught.

## Next steps

1. Owner reviews and merges #51-#56 and the learning PR; then a handoff PR
   rewrites this file from `origin/main`.
2. Decide whether the hook's committed-stubs-directory exemption is still
   wanted (see "Watch"); if not, remove `stubsDirOk` and its tests.
