---
description: Review a pull request against openaudible-autoupdate's safety rules
---

Review PR `${input:pr}` using `gh pr view`/`gh pr diff` with
`--repo Danathar/openaudible-autoupdate`. Do not push to the contributor's
branch.

Check, citing file:line:

1. Checksum: `sha256sum` comparison still sits between download and
   `dnf install`, and a mismatch still exits non-zero.
2. No verification bypass (`--nogpgcheck`, `curl -k/--insecure`, `|| true` around
   the check, removed `set -euo pipefail`).
3. Only the manifest's file for `PLATFORM_KEY` from `download_dir` is installed.
4. Quoting and shellcheck cleanliness; env var defaults unchanged unless
   intended and documented in README and AGENTS.md.
5. Tests: a bats test covers the changed behaviour; e2e was run if the install
   path changed; CI is green on a branch that is current with `main`.
6. Docs match the script (README claims versus actual behaviour).
7. Scope: unrelated changes are disclosed in the PR body.

Output: verdict (approve / request changes), a list of findings by severity,
and the checks you ran. Comment only; do not merge.
