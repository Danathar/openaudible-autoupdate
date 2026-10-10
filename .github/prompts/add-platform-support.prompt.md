---
description: Plan and implement support for another package type or architecture (e.g. deb)
---

The script currently handles one thing: an installed rpm (`rpm -q`), the
manifest key `PLATFORM_KEY` (default `linux_x86_64_rpm`), and `sudo dnf
install -y`. The manifest also lists other platforms.

Task: add support for `${input:target}` (for example a `.deb` using `dpkg-query`
and `apt-get install`, or an aarch64 key).

1. Read the manifest's `.platforms` keys and confirm the target key exists and
   has `file` and `sha256`.
2. Propose a design first. Constraints: checksum verification stays between
   download and install and stays fatal; the dependency check loop at the top
   must list the new tools; no `--nogpgcheck`-style bypass; keep rpm behaviour
   and the three env vars backward compatible; no distrobox logic in the script.
3. Implement, then add bats tests with stubbed `dpkg-query`/`apt-get` (or the
   relevant tools) covering up-to-date, update, checksum mismatch, and not
   installed. Add an e2e case in `tests/e2e/` (see `run.sh`/`in-container.sh`) using a container of the target
   distro.
4. Update README (Requirements, Configuration) and AGENTS.md.
5. Run `git ls-files -z '*.sh' '*.bash' '*.bats' | xargs -0 shellcheck`, `bats tests/unit`, and `tests/e2e/run.sh`. Never run the script
   unstubbed on the host. Any `gh` command passes
   `--repo Danathar/openaudible-autoupdate`.
