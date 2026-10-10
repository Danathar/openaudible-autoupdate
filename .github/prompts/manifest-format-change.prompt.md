---
description: Adapt openaudible-autoupdate.sh to a change in OpenAudible's swt_version.json
---

OpenAudible's manifest (`VERSION_URL`, default
`https://openaudible.org/downloads/swt_version.json`) appears to have changed
shape. Fix `openaudible-autoupdate.sh` safely.

1. Fetch the current manifest with `curl -fsSL` (read-only) and save it under
   `/var/tmp/`. Compare with the fields the script reads: `.version`,
   `.download_dir`, `.platforms[$PLATFORM_KEY].file`,
   `.platforms[$PLATFORM_KEY].sha256`.
2. Identify exactly what changed (renamed key, new nesting, missing sha256,
   `download_dir` without a trailing slash, etc.).
3. Update the `jq` expressions. The script concatenates
   `${download_dir}${file_name}`; keep that correct. If `sha256` is missing or
   `null`, the script must fail, never install unverified. Note the existing
   code treats a missing `file` as an error but compares `sha256` directly, so
   check what an empty/`null` expected hash does.
4. Add a bats test in `tests/unit/openaudible-autoupdate.bats` with a fixture of the new shape (stubbed `curl`).
5. Run `git ls-files -z '*.sh' '*.bash' '*.bats' | xargs -0 shellcheck` and `bats tests/unit`.
6. Do not run the script for real (it runs `sudo dnf install`).

Any `gh` command passes `--repo Danathar/openaudible-autoupdate`.

Report the old vs. new manifest shape and the checks you ran.
