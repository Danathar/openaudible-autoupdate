---
name: run-checks
description: Run the project's static analysis and tests (shellcheck, bats, optionally e2e) before committing or opening a PR in openaudible-autoupdate.
---

# run-checks

From the repo root (use absolute paths or `git -C`, not `cd`):

```bash
shellcheck openaudible-autoupdate.sh
bats tests/
```

If the change touches download, checksum, or `dnf install`, also run the
container tests in `tests/e2e/` (see the entry point in that directory).

Report the exact commands and observed results. These are the same checks as
the jobs in `.github/workflows/ci.yml`. If `shellcheck` or `bats` is missing,
say so; do not substitute running the real script (it executes `sudo dnf
install`).
