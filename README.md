# openaudible-autoupdate

[![CI](https://github.com/Danathar/openaudible-autoupdate/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Danathar/openaudible-autoupdate/actions/workflows/ci.yml)
[![Coverage gate](https://github.com/Danathar/openaudible-autoupdate/actions/workflows/coverage-gate.yml/badge.svg?branch=main)](https://github.com/Danathar/openaudible-autoupdate/actions/workflows/coverage-gate.yml)
[![Nightly compliance](https://github.com/Danathar/openaudible-autoupdate/actions/workflows/nightly-compliance.yml/badge.svg?branch=main)](https://github.com/Danathar/openaudible-autoupdate/actions/workflows/nightly-compliance.yml)
[![Ask DeepWiki](https://img.shields.io/badge/Ask-DeepWiki-1f6feb)](https://deepwiki.com/Danathar/openaudible-autoupdate)
[![Maintenance assisted by Hivecommons Hive](https://img.shields.io/badge/maintenance%20assisted%20by-Hivecommons%20Hive-1f6feb)](https://github.com/hivecommons/hive)
[![ACMM L6 Fully Autonomous](https://img.shields.io/badge/ACMM-L6%20Fully%20Autonomous-2da44e)](#maintained-with-hive-acmm-l6)
[![AI assisted](https://img.shields.io/badge/AI-assisted-d29922)](#about-this-project)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)

> [!NOTE]
> This was created with some AI. It's pretty easy to read the code, but you should know this.

OpenAudible ships standalone installers (`.rpm`, `.deb`, `.sh`, `.AppImage`, ...)
with no package repository behind them, so `dnf`/`apt`/etc. never see new
releases. This is a small script + systemd timer that checks OpenAudible's
own version manifest and upgrades the installed rpm automatically.

## How it works

`openaudible-autoupdate.sh`:

1. Reads the installed version with `rpm -q OpenAudible`.
2. Fetches `https://openaudible.org/downloads/swt_version.json` over https
   only (redirects included), which lists
   the current release version and, per platform, a download URL and
   `sha256` checksum.
3. Checks the manifest before using it: it must be a JSON object, the version
   must look like an rpm version, the file must be a plain `.rpm` name, the
   `sha256` must be 64 hex characters and `download_dir` must be an
   `https://` URL. Anything else stops the run with a log line.
4. If the manifest's version differs from what's installed (a plain
   comparison, not "newer"), downloads the rpm over https only, verifies its
   checksum, checks that the rpm header names the expected package and
   version, and runs `sudo dnf install -y` on it.
5. Confirms with `rpm -q` that the new version is really installed, then logs
   to stdout/`systemd-cat` and sends a desktop notification (if `notify-send`
   is available). If dnf exits 0 without installing it, the run fails instead.

If OpenAudible isn't installed via rpm, or is already current, the script
exits cleanly and does nothing.

## Requirements

- OpenAudible already installed from the official `.rpm` (see
  [openaudible.org/download](https://openaudible.org/download)) — this repo
  only keeps an existing rpm install up to date, it does not install
  OpenAudible itself
- `bash`
- `curl`, `jq`, `rpm`, `dnf`, `sha256sum`, `awk`
- passwordless (or otherwise non-interactive) `sudo` for `dnf install`,
  since the timer runs unattended

## Install

This installs the update-checker (script + systemd timer) described above,
assuming OpenAudible's rpm is already installed.

```bash
mkdir -p ~/bin
cp openaudible-autoupdate.sh ~/bin/
chmod +x ~/bin/openaudible-autoupdate.sh

mkdir -p ~/.config/systemd/user
cp systemd/openaudible-autoupdate.service systemd/openaudible-autoupdate.timer ~/.config/systemd/user/

systemctl --user daemon-reload
systemctl --user enable --now openaudible-autoupdate.timer
```

### Running inside a container (distrobox/toolbox)

> [!NOTE]
> This support exists because the author runs a bootc-based, partially
> immutable distro ([Aurora](https://getaurora.dev/)), where apps like
> OpenAudible that expect a mutable `/usr` and traditional rpm/dnf install
> don't go on the host itself — they go in a
> [distrobox](https://distrobox.it/)/toolbox container instead.

If OpenAudible is installed inside a distrobox/toolbox rather than directly
on the host, the systemd user timer still runs on the **host** (containers
generally don't run systemd), so point `ExecStart` at the container instead
of the script directly. Edit
`~/.config/systemd/user/openaudible-autoupdate.service`:

```ini
ExecStart=/usr/bin/distrobox enter <container-name> -- %h/bin/openaudible-autoupdate.sh
```

(assuming your home directory is shared into the container, which is the
distrobox default). Then `systemctl --user daemon-reload` and restart the
timer.

Rather than editing the tracked unit file directly, consider a local
[systemd drop-in](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html#Unit%20File%20Load%20Path)
instead, so host-specific details (container name, etc.) stay out of the
repo:

```bash
mkdir -p ~/.config/systemd/user/openaudible-autoupdate.service.d
cat > ~/.config/systemd/user/openaudible-autoupdate.service.d/override.conf <<'EOF'
[Service]
ExecStart=
ExecStart=/usr/bin/distrobox enter <container-name> -- %h/bin/openaudible-autoupdate.sh
EOF
systemctl --user daemon-reload
```

## Configuration

The script honors these environment variables if you need to point it at a
different manifest/package/platform:

| Variable | Default | Purpose |
|---|---|---|
| `VERSION_URL` | `https://openaudible.org/downloads/swt_version.json` | Version manifest URL |
| `PKG_NAME` | `OpenAudible` | rpm package name to check/upgrade |
| `PLATFORM_KEY` | `linux_x86_64_rpm` | Key under `.platforms` in the manifest to use |

Set them in the systemd service via `Environment=`, or export them before
running the script manually.

## Usage

```bash
# Run a check on demand
systemctl --user start openaudible-autoupdate.service

# View update history
journalctl --user -u openaudible-autoupdate.service

# Disable
systemctl --user disable --now openaudible-autoupdate.timer
```

## Testing

Never run `openaudible-autoupdate.sh` itself to "try it out" on a development
machine: a real run ends in `sudo dnf install -y`. The tests below stub or
containerise everything that touches the system.

```bash
# Unit tests (needs bats and jq). rpm, curl, sudo, dnf, notify-send and
# systemd-cat are replaced by stubs on a private PATH; nothing real is called.
bats tests/unit

# Lint (config in .shellcheckrc)
git ls-files -z '*.sh' '*.bash' '*.bats' | xargs -0 shellcheck

# End-to-end (needs podman or docker): builds two dummy OpenAudible rpms in a
# throwaway Fedora container, serves a manifest locally and runs the real
# script with a real `dnf install` inside that container only.
tests/e2e/run.sh

# Coverage (line coverage of the script under the unit tests, via kcov, which
# is packaged for Fedora). Floor is in .coverage-thresholds.json.
podman run --rm --security-opt label=disable -v "$PWD:/src:ro" registry.fedoraproject.org/fedora:latest bash -c '
  dnf install -y -q kcov bats jq gawk git nodejs &&
  cp -r /src /work && cd /work &&
  kcov --include-pattern=openaudible-autoupdate.sh coverage bats tests/unit &&
  node scripts/coverage-gate.mjs'
```

CI (`.github/workflows/ci.yml`) runs lint, the unit tests on Ubuntu and in a
Fedora container, and the end-to-end test; `.github/workflows/coverage-gate.yml`
enforces the coverage floor.

## Maintained with Hive (ACMM L6)

Maintenance is assisted by [Hivecommons Hive](https://github.com/hivecommons/hive), which runs a fleet of AI agents against this repo at ACMM level 6 (Fully Autonomous). The repository is maintained by [@Danathar](https://github.com/Danathar).

**What L6 permits here:** agents file issues and open pull requests, and agent pull requests merge once their required checks pass unless they carry `hold`. Changes to workflows, policies, the install path and similar Tier 1 and Tier 2 paths need the owner to read and merge them; docs and tests need only passing CI. Main is protected by a ruleset. The reviewer agent comments with file and line references but never approves, merges or closes anything.

See [`docs/branch-protection.md`](docs/branch-protection.md) for the required checks, [`docs/risk-tiers.md`](docs/risk-tiers.md) for which changes need a human, [`docs/multi-agent.md`](docs/multi-agent.md) for how agents share the repo and [`docs/agent-boundaries.md`](docs/agent-boundaries.md) for what an agent may change without the owner.

Learn more: [Hive](https://github.com/hivecommons/hive) · [Hive Hub](https://hive.kubestellar.io) · [ACMM levels](https://github.com/hivecommons/hive#acmm-levels) · [full ACMM policy matrix](https://github.com/hivecommons/hive/blob/v4/src/docs/acmm-policy-matrix.md)

## About this project

> [!NOTE]
> This project was developed with AI assistance and should be treated cautiously. It is not affiliated with or endorsed by OpenAudible. It comes as-is. The timer upgrades an installed rpm with `dnf` as root, so read `openaudible-autoupdate.sh` and the systemd units before you install them.

## License

GPL-3.0-only, see [LICENSE](LICENSE).
