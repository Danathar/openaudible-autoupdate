# CLAUDE.md

@AGENTS.md

## Claude Code notes

- `AGENTS.md` is the source of truth; keep this file short.
- Skills in `.claude/skills/`: `run-checks` (shellcheck + `bats tests/unit`),
  `test-against-fake-manifest` (exercise the script with stubbed commands),
  `handle-manifest-change` (adapt to an OpenAudible manifest change).
- Never run `openaudible-autoupdate.sh` directly: it ends in
  `sudo dnf install -y`. Use the stubbed bats tests or `bash tests/e2e/run.sh`.
- Use `git -C <dir>`/absolute paths rather than `cd` in scripts, and
  `/var/tmp/` rather than `/tmp` for scratch files.
- Any `gh` command: pass `--repo Danathar/openaudible-autoupdate`.
- Read `.claude/session-summary.md` at the start of a session. Follow its
  end-of-session rule: only the session landing work on `main` rewrites it;
  otherwise put handoff notes in the PR body.
