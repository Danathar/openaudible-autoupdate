#!/usr/bin/env bash
# Checks OpenAudible's public version manifest against the installed RPM and
# upgrades in place if a newer release is available.
#
# Intended to run inside whatever environment OpenAudible's rpm is actually
# installed in (a plain Fedora/RHEL host, a distrobox/toolbox container,
# etc.) — this script itself has no distrobox-specific logic; see the
# systemd/ unit files for the container-aware wrapper.
set -euo pipefail

: "${VERSION_URL:=https://openaudible.org/downloads/swt_version.json}"
: "${PKG_NAME:=OpenAudible}"
: "${PLATFORM_KEY:=linux_x86_64_rpm}"
LOG_TAG="openaudible-autoupdate"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

log() {
  echo "[$LOG_TAG] $*"
  if command -v systemd-cat >/dev/null 2>&1; then
    echo "$*" | systemd-cat -t "$LOG_TAG"
  fi
}

for dep in curl jq rpm sudo dnf sha256sum awk; do
  command -v "$dep" >/dev/null 2>&1 || { log "Missing required dependency: $dep"; exit 1; }
done

if ! installed_version=$(rpm -q --qf '%{VERSION}' "$PKG_NAME" 2>/dev/null); then
  log "$PKG_NAME is not installed via rpm; nothing to do."
  exit 0
fi

manifest="$WORKDIR/version.json"
if ! curl -fsSL "$VERSION_URL" -o "$manifest"; then
  log "Failed to fetch version manifest from $VERSION_URL"
  exit 1
fi

# Every value below goes into a file path, a URL or a root install, so the
# manifest is checked as a whole before any of it is used. Each check fails
# closed: a value that is missing, not a string or the wrong shape stops the
# run before anything is downloaded.
if ! jq -e 'type == "object"' "$manifest" >/dev/null 2>&1; then
  log "Invalid version manifest from $VERSION_URL (not a JSON object)."
  exit 1
fi

# Non-string values (null, numbers, objects) read as empty, never as "null".
platform_field() {
  jq -r --arg k "$PLATFORM_KEY" --arg f "$1" '.platforms[$k]? | .[$f]? | strings' "$manifest"
}
latest_version=$(jq -r '.version | strings' "$manifest")
download_dir=$(jq -r '.download_dir | strings' "$manifest")
file_name=$(platform_field file)
expected_sha256=$(platform_field sha256)

if [ -z "$file_name" ]; then
  log "Platform key '$PLATFORM_KEY' not found in version manifest."
  exit 1
fi
if ! [[ "$latest_version" =~ ^[0-9A-Za-z._+~]+$ ]]; then
  log "Invalid version manifest: version '$latest_version' is missing or malformed."
  exit 1
fi
if ! [[ "$file_name" =~ ^[A-Za-z0-9][A-Za-z0-9._+~-]*\.rpm$ ]]; then
  log "Invalid version manifest: file '$file_name' is not a plain .rpm file name."
  exit 1
fi
if ! [[ "$expected_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  log "Invalid version manifest: sha256 '$expected_sha256' is not 64 lowercase hex characters."
  exit 1
fi
if ! [[ "$download_dir" =~ ^https://[^/[:space:]]+/[^[:space:]]*$ ]]; then
  log "Invalid version manifest: download_dir '$download_dir' is not an https:// URL."
  exit 1
fi

if [ "$latest_version" = "$installed_version" ]; then
  log "$PKG_NAME is up to date (installed: $installed_version)."
  exit 0
fi

log "Update available: $installed_version -> $latest_version. Downloading $file_name..."

rpm_path="$WORKDIR/$file_name"
if ! curl -fsSL --proto =https --proto-redir =https "${download_dir}${file_name}" -o "$rpm_path"; then
  log "Download failed for ${download_dir}${file_name}"
  exit 1
fi

actual_sha256=$(sha256sum "$rpm_path" | awk '{print $1}')
if [ "$actual_sha256" != "$expected_sha256" ]; then
  log "Checksum mismatch! expected=$expected_sha256 actual=$actual_sha256. Aborting."
  exit 1
fi

log "Checksum verified."

# The checksum only proves the file matches the manifest; the rpm header must
# also say it is $PKG_NAME at the advertised version before it is installed.
rpm_identity=$(rpm -qp --qf '%{NAME} %{VERSION}' "$rpm_path" 2>/dev/null || true)
if [ "$rpm_identity" != "$PKG_NAME $latest_version" ]; then
  log "Package identity mismatch! expected='$PKG_NAME $latest_version' actual='$rpm_identity'. Aborting."
  exit 1
fi

log "Installing $file_name..."
if ! sudo dnf install -y "$rpm_path"; then
  log "dnf install failed."
  exit 1
fi

# dnf can exit 0 without changing anything (for example when it declines a
# downgrade), so only report an upgrade that rpm confirms.
now_installed=$(rpm -q --qf '%{VERSION}' "$PKG_NAME" 2>/dev/null || true)
if [ "$now_installed" != "$latest_version" ]; then
  log "dnf exited 0 but $PKG_NAME is at '$now_installed', not $latest_version. Install did not take effect."
  exit 1
fi

log "$PKG_NAME upgraded: $installed_version -> $latest_version."
if command -v notify-send >/dev/null 2>&1; then
  notify-send "$PKG_NAME updated" "Now on version $latest_version"
fi
