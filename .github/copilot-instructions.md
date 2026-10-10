# Copilot instructions

Full rules: [AGENTS.md](../AGENTS.md). Essentials:

- This repo is one Bash script (`openaudible-autoupdate.sh`) that upgrades an
  installed OpenAudible **rpm** from OpenAudible's manifest
  (`VERSION_URL`, `PKG_NAME`, `PLATFORM_KEY`), plus two systemd user units in
  `systemd/`.
- Never run the script for real: it ends in `sudo dnf install -y`. Test with
  stubbed commands (`bats tests/unit`) or the container tests in `tests/e2e/run.sh`.
- The sha256 check between download and install must never be removed,
  skipped, or made non-fatal. Do not add `--nogpgcheck` or `curl -k`.
- Keep `set -euo pipefail`; new code must pass `git ls-files -z '*.sh' '*.bash' '*.bats' | xargs -0 shellcheck`.
- Add/update a bats test for each behaviour change; keep README accurate.
- Conventional Commits. Any `gh` command needs `--repo Danathar/openaudible-autoupdate`.
- Licence is GPL-3.0-only.
