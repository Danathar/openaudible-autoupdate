# openaudible-autoupdate

> [!NOTE]
> This was created with some AI. It's pretty easy to read the code, but you should know this.

OpenAudible ships standalone installers (`.rpm`, `.deb`, `.sh`, `.AppImage`, ...)
with no package repository behind them, so `dnf`/`apt`/etc. never see new
releases. This is a small script + systemd timer that checks OpenAudible's
own version manifest and upgrades the installed rpm automatically.

## How it works

`openaudible-autoupdate.sh`:

1. Reads the installed version with `rpm -q OpenAudible`.
2. Fetches `https://openaudible.org/downloads/swt_version.json`, which lists
   the current release version and, per platform, a download URL and
   `sha256` checksum.
3. If the manifest's version is newer than what's installed, downloads the
   rpm, verifies its checksum, and runs `sudo dnf install -y` on it.
4. Logs to stdout/`systemd-cat` and sends a desktop notification (if
   `notify-send` is available) on a successful upgrade.

If OpenAudible isn't installed via rpm, or is already current, the script
exits cleanly and does nothing.

## Requirements

- OpenAudible already installed from the official `.rpm` (see
  [openaudible.org/download](https://openaudible.org/download)) — this repo
  only keeps an existing rpm install up to date, it does not install
  OpenAudible itself
- `bash`
- `curl`, `jq`, `rpm`, `dnf`, `sha256sum`
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
podman run --rm -v "$PWD:/src:ro,Z" registry.fedoraproject.org/fedora:latest bash -c '
  dnf install -y -q kcov bats jq gawk git nodejs &&
  cp -r /src /work && cd /work &&
  kcov --include-pattern=openaudible-autoupdate.sh coverage bats tests/unit &&
  node scripts/coverage-gate.mjs'
```

CI (`.github/workflows/ci.yml`) runs lint, the unit tests on Ubuntu and in a
Fedora container, and the end-to-end test; `.github/workflows/coverage-gate.yml`
enforces the coverage floor.

## License

GPL-3.0-only, see [LICENSE](LICENSE).
