---
name: test-against-fake-manifest
description: Exercise openaudible-autoupdate.sh safely against a fabricated manifest using stub commands on PATH, never the real rpm/dnf/sudo.
---

# test-against-fake-manifest

Never run the script with real `rpm`/`dnf`/`sudo`: success ends in
`sudo dnf install -y`. The Bash guard hook (`.claude/hooks/guard-bash.mjs`)
only lets the script run when `PATH`'s **first** entry is a directory inside
this project under `tests/<dir>` holding executable `sudo`, `dnf` and `rpm`
stubs, so build the sandbox there (not in `/tmp` or `/var/tmp`). Use
`tests/.fake-host/` (gitignored) and never `:$PATH`: the second entry is a
directory with symlinks to only the real tools the script needs.

1. Create the sandbox (from the repo root; `R=$PWD`):
   ```bash
   F=$R/tests/.fake-host; mkdir -p "$F/stubs" "$F/real" "$F/server" "$F/tmp"
   for t in jq sha256sum awk mktemp rm bash cat basename; do ln -sf "$(command -v $t)" "$F/real/$t"; done
   ```
2. Stubs in `$F/stubs` (all `chmod +x`, `#!/usr/bin/env bash`):
   - `rpm`: print an old version for `rpm -q --qf '%{VERSION}' OpenAudible` (`printf 1.0.0`); `exit 1` to simulate "not installed".
   - `curl`: for `-o <file> <url>` copy `$F/server/<basename of url>` to the target, or `exit 22` if absent.
   - `sudo`: `echo "sudo $*" >> "$F/calls.log"` and exit 0, so `dnf install` is only logged. `dnf`: `exit 0`.
   `tests/unit/helpers.bash` has complete versions of all of these; reuse its logic.
3. Fixture manifest `$F/server/swt_version.json` (what the script reads):
   ```json
   {"version":"2.0.0","download_dir":"https://example.invalid/dl/",
    "platforms":{"linux_x86_64_rpm":{"file":"OpenAudible.rpm","sha256":"<sha256sum of $F/server/OpenAudible.rpm>"}}}
   ```
4. Run from the repo root with the stubs first and only the real-tools dir second. Write the PATH literally with a leading `$PWD` (the hook rejects other variables such as `$F` in the PATH value):
   ```bash
   VERSION_URL=https://example.invalid/swt_version.json TMPDIR=$PWD/tests/.fake-host/tmp \
     PATH=$PWD/tests/.fake-host/stubs:$PWD/tests/.fake-host/real bash openaudible-autoupdate.sh
   ```
   Checked against the hook: this form is allowed, while `PATH=$F/stubs:...` and `/var/tmp/...` stubs are blocked. If the hook still blocks it, fix the sandbox; never work around the hook.
5. Expected: older installed -> "Checksum verified" and `calls.log` holds `sudo dnf install -y ...`; equal version -> "up to date", no `sudo` call; wrong hash -> "Checksum mismatch", exit 1, no `sudo` call; unknown `PLATFORM_KEY` -> "not found in version manifest", exit 1.
6. Delete `tests/.fake-host` when done.

Prefer encoding a case as a bats test in `tests/unit/openaudible-autoupdate.bats`
over a one-off. Any `gh` command: pass `--repo Danathar/openaudible-autoupdate`.
