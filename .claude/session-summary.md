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

Written by the ACMM rollout PR for the agent-learning issues (#16, #21-#24,
#32, #33, #38), on top of `main` at `1305b17` (foundation #54, governance #55
and automation #56 merged). Re-verify with `git log origin/main`.

- **What the repo is:** one Bash script, `openaudible-autoupdate.sh` (78
  lines), two systemd user units in `systemd/`, `README.md`, `LICENSE` (GNU GPL
  v3), tests under `tests/unit` (bats) and `tests/e2e` (container), and the
  agent tooling. The script checks OpenAudible's manifest
  (`https://openaudible.org/downloads/swt_version.json`) against the installed
  `OpenAudible` rpm, downloads the rpm, compares its sha256 and runs
  `sudo dnf install -y`.
- **Script history:** `6caac1b` (first version), `a8758f5` (`log()` and
  `notify-send` no longer fail under `set -e`; added by #54) and `56c0b3f`
  (shellcheck fixes, `awk` dependency check).
- **Known behaviour to remember:** the version check is equality, not "newer"
  ([memory/version-check-is-equality.md](memory/version-check-is-equality.md)).
  The `log()` bug is fixed; its entry is kept as history
  ([memory/log-and-list-under-set-e.md](memory/log-and-list-under-set-e.md)).
- **Checks and merging:** ruleset `protect main` (id 24826574) is active and
  requires six checks: `Lint (shellcheck)`, `Unit tests (ubuntu bash)`,
  `Unit tests (fedora container)`, `E2E (fedora container)`, `Coverage gate`
  and `policy-check`; the branch must be up to date with `main`. Hive's merge
  strategy for this repo is `hive-serialized`.
- **Agent tooling (this PR):** `.claude/settings.json` registers
  `.claude/hooks/guard-bash.mjs` on every Bash call; `agent-tooling.yml` runs
  `node --test` over `scripts/tests/` and `.claude/hooks/tests/`.
- **Not verified from this repository:** whether the owner's timer is enabled
  on their machine, and which container (if any) holds their OpenAudible rpm.

## Last session: 2026-10-09 - ACMM learning artifacts (#16, #21-#24, #32, #33, #38)

**Done:** the learning PR adds the guard hook and its tests, the permission
settings, five memory entries, this file and the first reflection; not merged
when this was written.
**In flight:** the PR that adds these files, and whatever else is open (check
`gh pr list --repo Danathar/openaudible-autoupdate`).
**Blocked on:** the owner's review and merge.
**Watch:** the hook's stubs-on-`PATH` exemption needs a committed directory
`tests/<dir>` holding executable `sudo`, `dnf` and `rpm`, named by an absolute
or `$CLAUDE_PROJECT_DIR`-anchored `PATH` entry. Nothing in `main` provides one:
the bats helpers build stubs in `$BATS_TEST_TMPDIR` at run time and the e2e
test runs through `tests/e2e/run.sh` in a container. So the exemption is
unused today; remove `stubsDirOk` and its tests if nobody wants it.

## Open threads

- `guard-bash.mjs` is a guard against careless commands, not a sandbox (threat
  model at the top of the file). For `podman`/`docker run` it checks only that
  a run naming the updater also names a `tests/e2e` path, and refuses
  `exec`/`attach`; `--privileged` or a host-root bind mount is not checked, and
  any argument that merely contains `tests/e2e` satisfies the exemption.

## Next steps

1. Owner reviews and merges the learning PR; then a handoff PR rewrites this
   file from `origin/main`.
2. Decide whether to keep the stubs-directory exemption (see "Watch").
