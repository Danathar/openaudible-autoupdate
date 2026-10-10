---
name: run-checks
description: Run the project's static analysis and tests (shellcheck, bats, optionally e2e) before committing or opening a PR in openaudible-autoupdate.
---

# run-checks

From the repo root (use absolute paths or `git -C`, not `cd`):

```bash
git ls-files -z '*.sh' '*.bash' '*.bats' | xargs -0 shellcheck
bats tests/unit
```

If the change touches download, checksum, or `dnf install`, also run the
container tests: `bash tests/e2e/run.sh` (needs podman or docker). After editing
agent docs/policies/workflows also run `node scripts/check-policies.mjs`.
Any `gh` command: pass `--repo Danathar/openaudible-autoupdate`.

Report the exact commands and observed results. These are the same checks as
the jobs in `.github/workflows/ci.yml`. If `shellcheck` or `bats` is missing,
say so; do not substitute running the real script (it executes `sudo dnf
install`).
