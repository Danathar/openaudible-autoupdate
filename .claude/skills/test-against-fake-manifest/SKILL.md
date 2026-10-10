---
name: test-against-fake-manifest
description: Exercise openaudible-autoupdate.sh safely against a fabricated manifest using stub commands on PATH, never the real rpm/dnf/sudo.
---

# test-against-fake-manifest

Never run the script with real `rpm`/`dnf`/`sudo`: success ends in
`sudo dnf install -y`. Use a scratch dir under `/var/tmp/oaa-fake-*`.

1. Create the stub directory and put it first on `PATH`:
   - `rpm`: `-q --qf '%{VERSION}' OpenAudible` prints an old version (e.g. `1.0.0`); exit 1 to simulate "not installed".
   - `curl`: for the manifest URL write a fixture to the `-o` target; for the download URL write a small file.
   - `sha256sum`: leave real, and put that file's real hash in the manifest to test the happy path, a wrong one to test mismatch.
   - `sudo`: a stub that records its arguments to a file and exits 0 (so `dnf install -y <path>` is only logged).
   - `dnf`: stub that exits 0.
2. Fixture manifest shape the script reads:
   ```json
   {"version":"2.0.0","download_dir":"https://example.invalid/dl/",
    "platforms":{"linux_x86_64_rpm":{"file":"OpenAudible.rpm","sha256":"<hash>"}}}
   ```
3. Run with `VERSION_URL=https://example.invalid/m.json PATH=<stubs>:$PATH bash openaudible-autoupdate.sh`.
4. Expected outcomes: older installed -> "Checksum verified" and the `sudo` stub is called with `dnf install -y`; equal version -> "up to date" and no `sudo` call; wrong hash -> "Checksum mismatch" and exit 1 with no `sudo` call; unknown `PLATFORM_KEY` -> "not found in version manifest" and exit 1.

Prefer encoding a case as a bats test in `tests/unit/openaudible-autoupdate.bats` over a one-off
(`tests/unit/helpers.bash` already provides the stubs). Any `gh` command: pass
`--repo Danathar/openaudible-autoupdate`.
