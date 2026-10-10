---
name: handle-manifest-change
description: Diagnose and fix openaudible-autoupdate.sh when OpenAudible's swt_version.json changes shape or a platform key disappears.
---

# handle-manifest-change

Symptoms: "Platform key '...' not found in version manifest", jq errors, a
`null` version/URL, or checksum mismatches after an upstream release.

1. `curl -fsSL https://openaudible.org/downloads/swt_version.json -o /var/tmp/oaa-manifest.json` (read-only fetch) and inspect with `jq`.
2. Compare to the fields the script reads: `.version`, `.download_dir`,
   `.platforms[$PLATFORM_KEY].file`, `.platforms[$PLATFORM_KEY].sha256`.
3. Fix the `jq` expressions in `openaudible-autoupdate.sh`. Never "fix" a
   mismatch by dropping or loosening the sha256 comparison.
4. Add a bats test in `tests/` with the new fixture; run
   `shellcheck openaudible-autoupdate.sh` and `bats tests/`.
5. Update README (Configuration) if the key name default changes.

See also `.github/prompts/manifest-format-change.prompt.md`. Never run the
script unstubbed.
