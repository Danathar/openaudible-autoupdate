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
  command -v systemd-cat >/dev/null 2>&1 && echo "$*" | systemd-cat -t "$LOG_TAG"
}

for dep in curl jq rpm sudo dnf sha256sum; do
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

latest_version=$(jq -r '.version' "$manifest")
download_dir=$(jq -r '.download_dir' "$manifest")
file_name=$(jq -r --arg k "$PLATFORM_KEY" '.platforms[$k].file' "$manifest")
expected_sha256=$(jq -r --arg k "$PLATFORM_KEY" '.platforms[$k].sha256' "$manifest")

if [ "$file_name" = "null" ] || [ -z "$file_name" ]; then
  log "Platform key '$PLATFORM_KEY' not found in version manifest."
  exit 1
fi

if [ "$latest_version" = "$installed_version" ]; then
  log "$PKG_NAME is up to date (installed: $installed_version)."
  exit 0
fi

log "Update available: $installed_version -> $latest_version. Downloading $file_name..."

rpm_path="$WORKDIR/$file_name"
if ! curl -fsSL "${download_dir}${file_name}" -o "$rpm_path"; then
  log "Download failed for ${download_dir}${file_name}"
  exit 1
fi

actual_sha256=$(sha256sum "$rpm_path" | awk '{print $1}')
if [ "$actual_sha256" != "$expected_sha256" ]; then
  log "Checksum mismatch! expected=$expected_sha256 actual=$actual_sha256. Aborting."
  exit 1
fi

log "Checksum verified. Installing $file_name..."
if sudo dnf install -y "$rpm_path"; then
  log "$PKG_NAME upgraded: $installed_version -> $latest_version."
  command -v notify-send >/dev/null 2>&1 && notify-send "$PKG_NAME updated" "Now on version $latest_version"
else
  log "dnf install failed."
  exit 1
fi
