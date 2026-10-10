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

## Current state (as of 2026-10-10)

`main` at `a5f831d9` has all eight ACMM pull requests (#51-#58); every issue
from #1 to #50 is closed. Re-verify with `git log origin/main`.

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
- **Agent tooling:** `.claude/settings.json` registers
  `.claude/hooks/guard-bash.mjs` on every Bash call; `agent-tooling.yml` runs
  `node --test` over `scripts/tests/` and `.claude/hooks/tests/`. Agent
  directions live in `AGENTS.md` (authoritative), `CLAUDE.md`, Copilot, Cursor,
  `.github/prompts/` and `.claude/skills/`.
- **Secrets:** `claude.yml` and `ai-fix.yml` skip their agent step until one of
  `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` is set. Their pushes use the
  workflow token, which does not start other workflows; re-run checks by hand.
- **Not verified from this repository:** whether the owner's timer is enabled
  on their machine, and which container (if any) holds their OpenAudible rpm.

## Last session: 2026-10-10 - ACMM tickets #1-#50

**Done:** PRs #51-#58 merged (order and merge commits in
[../docs/agent-tasks/2026-10-10.md](../docs/agent-tasks/2026-10-10.md));
ruleset 24826574 applied with six required checks; private vulnerability
reporting enabled.
**In flight:** nothing.
**Blocked on:** nothing.
**Watch:** the hook's stubs-on-`PATH` exemption is used by the
`test-against-fake-manifest` skill (`tests/.fake-host/`, gitignored); nothing
else relies on it.

## Open threads

- `guard-bash.mjs` is a guard against careless commands, not a sandbox (threat
  model at the top of the file). For `podman`/`docker run` it checks only that
  a run naming the updater also names a `tests/e2e` path, and refuses
  `exec`/`attach`; `--privileged` or a host-root bind mount is not checked, and
  any argument that merely contains `tests/e2e` satisfies the exemption.
- Script findings recorded but not fixed (see
  [../docs/security/SECURITY-AI.md](../docs/security/SECURITY-AI.md)): the
  manifest's `file` value is used in a path unvalidated (`../` escapes the temp
  dir); `download_dir` is not limited to https or a host; the version check is
  `!=`, so an older manifest version downgrades; a missing `.version` reads as
  `null` and is treated as an update; invalid manifest JSON exits without a log
  line.

## Next steps

1. Owner decides whether to fix the script findings above (each is a small,
   testable change to `openaudible-autoupdate.sh`).
