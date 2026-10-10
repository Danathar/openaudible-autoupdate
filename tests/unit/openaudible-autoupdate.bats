#!/usr/bin/env bats

load helpers

setup() { setup_sandbox; }

assert_tmp_clean() {
  [ -z "$(ls -A "$SCRIPT_TMP")" ]
}

# --- dependency check -------------------------------------------------------

@test "missing stubbed dependency exits 1 and names it (each of curl, rpm, sudo, dnf)" {
  local dep
  for dep in curl rpm sudo dnf; do
    stub_all_tools
    stub_off "$dep"
    run_script
    [ "$status" -eq 1 ]
    [[ "$output" == *"Missing required dependency: $dep"* ]]
  done
}

@test "missing jq exits 1 and names it" {
  rm "$REALBIN/jq"
  run_script
  [ "$status" -eq 1 ]
  [[ "$output" == *"Missing required dependency: jq"* ]]
}

@test "missing sha256sum exits 1 and names it" {
  rm "$REALBIN/sha256sum"
  run_script
  [ "$status" -eq 1 ]
  [[ "$output" == *"Missing required dependency: sha256sum"* ]]
}

@test "missing awk exits 1 and names it before any network access" {
  rm "$REALBIN/awk"
  run_script
  [ "$status" -eq 1 ]
  [[ "$output" == *"Missing required dependency: awk"* ]]
  [[ "$(calls)" != *"curl "* ]]
}

@test "missing dependency is reported to the journal when systemd-cat exists" {
  stub_off dnf
  run_script
  [ "$status" -eq 1 ]
  [[ "$(calls)" == *"systemd-cat -t openaudible-autoupdate :: Missing required dependency: dnf"* ]]
}

@test "missing dependency still exits 1 with the message when systemd-cat is absent" {
  stub_off dnf
  stub_off systemd-cat
  run_script
  [ "$status" -eq 1 ]
  [[ "$output" == *"Missing required dependency: dnf"* ]]
}

# --- not installed ----------------------------------------------------------

@test "package not installed via rpm exits 0 without touching the network" {
  export STUB_RPM_VERSION=""
  run_script
  [ "$status" -eq 0 ]
  [[ "$output" == *"OpenAudible is not installed via rpm; nothing to do."* ]]
  [[ "$(calls)" != *"curl "* ]]
}

# --- manifest fetch / parsing ----------------------------------------------

@test "manifest fetch failure exits 1 and reports the URL" {
  export VERSION_URL="http://stub.test/does-not-exist.json"
  run_script
  [ "$status" -eq 1 ]
  [[ "$output" == *"Failed to fetch version manifest from http://stub.test/does-not-exist.json"* ]]
  [[ "$(calls)" != *"dnf "* ]]
}

@test "unknown PLATFORM_KEY exits 1 and names the key" {
  publish_release 2.0.0
  export PLATFORM_KEY="linux_arm64_rpm"
  run_script
  [ "$status" -eq 1 ]
  [[ "$output" == *"Platform key 'linux_arm64_rpm' not found in version manifest."* ]]
  [[ "$(calls)" != *"dnf "* ]]
}

@test "manifest that is not JSON exits 1 before any download" {
  publish_release 2.0.0
  printf '<html><body>maintenance</body></html>\n' >"$SERVER/swt_version.json"
  run_script
  [ "$status" -eq 1 ]
  [[ "$output" == *"Invalid version manifest from http://stub.test/swt_version.json (not a JSON object)."* ]]
  [[ "$(calls)" != *"/dl/"* ]]
  [[ "$(calls)" != *"dnf "* ]]
  assert_tmp_clean
}

@test "manifest that is JSON but not an object exits 1 before any download" {
  publish_release 2.0.0
  printf '[]\n' >"$SERVER/swt_version.json"
  run_script
  [ "$status" -eq 1 ]
  [[ "$output" == *"Invalid version manifest from"* ]]
  [[ "$(calls)" != *"/dl/"* ]]
}

@test "empty file name for the platform exits 1 and names the key" {
  publish_release 2.0.0
  set_manifest_field '.platforms.linux_x86_64_rpm.file = ""'
  run_script
  [ "$status" -eq 1 ]
  [[ "$output" == *"Platform key 'linux_x86_64_rpm' not found in version manifest."* ]]
  [[ "$(calls)" != *"/dl/"* ]]
  [[ "$(calls)" != *"dnf "* ]]
}

# assert_rejected_before_download MESSAGE: the run failed on manifest
# validation, so nothing was downloaded, verified or installed. Only curl
# calls are checked for /dl/: the logged message may echo a bad download_dir.
assert_rejected_before_download() {
  [ "$status" -eq 1 ]
  [[ "$output" == *"$1"* ]]
  [[ "$output" != *"Checksum verified."* ]]
  if calls | grep -q '^curl .*/dl/'; then return 1; fi
  [[ "$(calls)" == *"curl "*"swt_version.json"* ]]
  [[ "$(calls)" != *"sudo "* ]]
  [[ "$(calls)" != *"dnf "* ]]
  assert_tmp_clean
}

@test "manifest without a sha256 for the platform refuses to install" {
  # A missing checksum must never be read as "nothing to check".
  publish_release 2.0.0
  set_manifest_field 'del(.platforms.linux_x86_64_rpm.sha256)'
  run_script
  assert_rejected_before_download "Invalid version manifest: sha256 '' is not 64 lowercase hex characters."
}

@test "manifest with an empty sha256 for the platform refuses to install" {
  publish_release 2.0.0
  set_manifest_field '.platforms.linux_x86_64_rpm.sha256 = ""'
  run_script
  assert_rejected_before_download "Invalid version manifest: sha256 '' is not"
}

@test "manifest with a null sha256 for the platform refuses to install" {
  publish_release 2.0.0
  set_manifest_field '.platforms.linux_x86_64_rpm.sha256 = null'
  run_script
  assert_rejected_before_download "Invalid version manifest: sha256 '' is not"
}

@test "manifest with a malformed sha256 refuses to install (short, uppercase, non-hex, number)" {
  local bad
  for bad in '"abc123"' '"ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789"' \
    '"zz00000000000000000000000000000000000000000000000000000000000000"' '12345'; do
    publish_release 2.0.0
    : >"$CALLS"
    set_manifest_field ".platforms.linux_x86_64_rpm.sha256 = $bad"
    run_script
    assert_rejected_before_download "Invalid version manifest: sha256"
  done
}

@test "manifest without a version refuses to download (missing, null, empty, number)" {
  local filter
  for filter in 'del(.version)' '.version = null' '.version = ""' '.version = 2'; do
    publish_release 2.0.0
    : >"$CALLS"
    set_manifest_field "$filter"
    run_script
    assert_rejected_before_download "Invalid version manifest: version '' is missing or malformed."
  done
}

@test "manifest version with characters outside an rpm version refuses to download" {
  publish_release 2.0.0
  set_manifest_field '.version = "2.0.0/../x"'
  run_script
  assert_rejected_before_download "Invalid version manifest: version '2.0.0/../x' is missing or malformed."
}

@test "manifest file that is not a plain .rpm name refuses to download" {
  local bad
  for bad in '../x.rpm' 'sub/x.rpm' '.hidden.rpm' 'OpenAudible-2.0.0.sh' 'x.rpm.sh' 'x .rpm'; do
    publish_release 2.0.0
    : >"$CALLS"
    set_manifest_field ".platforms.linux_x86_64_rpm.file = \"$bad\""
    run_script
    assert_rejected_before_download "Invalid version manifest: file '$bad' is not a plain .rpm file name."
  done
}

@test "manifest download_dir that is not https refuses to download" {
  local bad
  for bad in 'http://stub.test/dl/' 'ftp://stub.test/dl/' 'file:///etc/' 'https://' 'stub.test/dl/' 'HTTPS://stub.test/dl/'; do
    publish_release 2.0.0
    : >"$CALLS"
    set_manifest_field ".download_dir = \"$bad\""
    run_script
    assert_rejected_before_download "Invalid version manifest: download_dir '$bad' is not an https:// URL."
  done
}

@test "manifest without download_dir refuses to download" {
  publish_release 2.0.0
  set_manifest_field 'del(.download_dir)'
  run_script
  assert_rejected_before_download "Invalid version manifest: download_dir '' is not an https:// URL."
}

# --- up to date -------------------------------------------------------------

@test "up to date exits 0 with no download or install" {
  publish_release 1.0.0
  run_script
  [ "$status" -eq 0 ]
  [[ "$output" == *"OpenAudible is up to date (installed: 1.0.0)."* ]]
  [[ "$(calls)" != *"dnf "* ]]
  [[ "$(calls)" != *"/dl/"* ]]
}

@test "up to date still exits 0 when systemd-cat is absent" {
  stub_off systemd-cat
  publish_release 1.0.0
  run_script
  [ "$status" -eq 0 ]
  [[ "$output" == *"up to date"* ]]
}

@test "up to date writes the message to the journal when systemd-cat exists" {
  publish_release 1.0.0
  run_script
  [ "$status" -eq 0 ]
  [[ "$(calls)" == *"systemd-cat -t openaudible-autoupdate :: OpenAudible is up to date (installed: 1.0.0)."* ]]
}

# --- update path ------------------------------------------------------------

@test "update installs the downloaded rpm via sudo dnf install -y" {
  publish_release 2.0.0
  run_script
  [ "$status" -eq 0 ]
  [[ "$output" == *"Update available: 1.0.0 -> 2.0.0. Downloading OpenAudible-2.0.0.x86_64.rpm..."* ]]
  [[ "$output" == *"Checksum verified."* ]]
  [[ "$output" == *"OpenAudible upgraded: 1.0.0 -> 2.0.0."* ]]
  [[ "$(calls)" == *"curl https://stub.test/dl/OpenAudible-2.0.0.x86_64.rpm"* ]]
  run grep -E '^sudo dnf install -y .*/OpenAudible-2\.0\.0\.x86_64\.rpm$' "$CALLS"
  [ "$status" -eq 0 ]
  # The file dnf received existed and held the downloaded bytes.
  [[ "$(calls)" == *"dnf-rpm-present OpenAudible-2.0.0.x86_64.rpm rpm-payload-2.0.0"* ]]
}

@test "rpm download is restricted to https, including redirects" {
  publish_release 2.0.0
  run_script
  [ "$status" -eq 0 ]
  [[ "$(calls)" == *"curl-protos --proto =https --proto-redir =https https://stub.test/dl/OpenAudible-2.0.0.x86_64.rpm"* ]]
}

@test "rpm header is checked after the checksum and before sudo dnf" {
  publish_release 2.0.0
  run_script
  [ "$status" -eq 0 ]
  local qp install
  qp=$(grep -n '^rpm -qp --qf %{NAME} %{VERSION} .*/OpenAudible-2\.0\.0\.x86_64\.rpm$' "$CALLS" | cut -d: -f1)
  install=$(grep -n '^sudo dnf install -y ' "$CALLS" | cut -d: -f1)
  [ -n "$qp" ] && [ -n "$install" ]
  [ "$qp" -lt "$install" ]
}

@test "update sends a desktop notification when notify-send exists" {
  publish_release 2.0.0
  run_script
  [ "$status" -eq 0 ]
  [[ "$(calls)" == *"notify-send OpenAudible updated Now on version 2.0.0"* ]]
}

@test "update succeeds with exit 0 when notify-send is absent" {
  stub_off notify-send
  publish_release 2.0.0
  run_script
  [ "$status" -eq 0 ]
  [[ "$output" == *"OpenAudible upgraded: 1.0.0 -> 2.0.0."* ]]
}

@test "update succeeds with exit 0 when both notify-send and systemd-cat are absent" {
  stub_off notify-send
  stub_off systemd-cat
  publish_release 2.0.0
  run_script
  [ "$status" -eq 0 ]
  [[ "$(calls)" == *"dnf install -y "* ]]
}

@test "a differing manifest version is treated as an update even if older" {
  # The script compares for equality only; this documents that behaviour.
  export STUB_RPM_VERSION="3.0.0"
  publish_release 2.0.0
  run_script
  [ "$status" -eq 0 ]
  [[ "$(calls)" == *"dnf install -y "* ]]
}

# --- failures during update -------------------------------------------------

@test "download failure exits 1 and never calls dnf" {
  publish_release 2.0.0
  rm "$SERVER/$RPM_NAME"
  run_script
  [ "$status" -eq 1 ]
  [[ "$output" == *"Download failed for https://stub.test/dl/OpenAudible-2.0.0.x86_64.rpm"* ]]
  [[ "$(calls)" != *"dnf "* ]]
}

@test "checksum mismatch exits 1 and never calls dnf or sudo" {
  publish_release 2.0.0
  printf 'tampered' >"$SERVER/$RPM_NAME"
  run_script
  [ "$status" -eq 1 ]
  [[ "$output" == *"Checksum mismatch! expected="* ]]
  [[ "$output" == *"Aborting."* ]]
  [[ "$(calls)" != *"dnf "* ]]
  [[ "$(calls)" != *"sudo "* ]]
}

# assert_not_installed_after_verify MESSAGE: the checksum passed, but the run
# stopped before sudo/dnf with MESSAGE.
assert_not_installed_after_verify() {
  [ "$status" -eq 1 ]
  [[ "$output" == *"Checksum verified."* ]]
  [[ "$output" == *"$1"* ]]
  [[ "$output" != *"upgraded"* ]]
  [[ "$(calls)" != *"sudo "* ]]
  [[ "$(calls)" != *"dnf "* ]]
  [[ "$(calls)" != *"notify-send"* ]]
  assert_tmp_clean
}

@test "rpm whose package name is not PKG_NAME is not installed" {
  publish_release 2.0.0
  printf 'SomethingElse 2.0.0' >"$SERVER/$RPM_NAME.header"
  run_script
  assert_not_installed_after_verify "Package identity mismatch! expected='OpenAudible 2.0.0' actual='SomethingElse 2.0.0'. Aborting."
}

@test "rpm whose version differs from the manifest version is not installed" {
  publish_release 2.0.0
  printf 'OpenAudible 1.9.9' >"$SERVER/$RPM_NAME.header"
  run_script
  assert_not_installed_after_verify "Package identity mismatch! expected='OpenAudible 2.0.0' actual='OpenAudible 1.9.9'. Aborting."
}

@test "download that rpm cannot read as a package is not installed" {
  publish_release 2.0.0
  rm "$SERVER/$RPM_NAME.header"
  run_script
  assert_not_installed_after_verify "Package identity mismatch! expected='OpenAudible 2.0.0' actual=''. Aborting."
}

@test "dnf exiting 0 without changing the installed version exits 1 and does not notify" {
  export STUB_DNF_NOOP=1
  publish_release 2.0.0
  run_script
  [ "$status" -eq 1 ]
  [[ "$(calls)" == *"sudo dnf install -y "* ]]
  [[ "$output" == *"dnf exited 0 but OpenAudible is at '1.0.0', not 2.0.0. Install did not take effect."* ]]
  [[ "$output" != *"upgraded"* ]]
  [[ "$(calls)" != *"notify-send"* ]]
  assert_tmp_clean
}

@test "dnf failure exits 1, reports it and does not notify" {
  export STUB_DNF_EXIT=1
  publish_release 2.0.0
  run_script
  [ "$status" -eq 1 ]
  [[ "$output" == *"dnf install failed."* ]]
  [[ "$output" != *"upgraded"* ]]
  [[ "$(calls)" != *"notify-send"* ]]
}

# --- environment overrides --------------------------------------------------

@test "VERSION_URL override is the URL fetched" {
  publish_release 1.0.0
  export VERSION_URL="http://mirror.test/custom/swt_version.json"
  run_script
  [ "$status" -eq 0 ]
  [[ "$(calls)" == *"curl http://mirror.test/custom/swt_version.json"* ]]
}

@test "default VERSION_URL points at openaudible.org" {
  unset VERSION_URL
  run_script
  # The stub server has no such file, so the fetch fails; the URL is what matters.
  [ "$status" -eq 1 ]
  [[ "$output" == *"Failed to fetch version manifest from https://openaudible.org/downloads/swt_version.json"* ]]
}

@test "PKG_NAME override is queried via rpm and used in messages" {
  export STUB_RPM_PKG="OtherApp"
  export PKG_NAME="OtherApp"
  publish_release 1.0.0
  run_script
  [ "$status" -eq 0 ]
  [[ "$(calls)" == *"rpm -q --qf %{VERSION} OtherApp"* ]]
  [[ "$output" == *"OtherApp is up to date (installed: 1.0.0)."* ]]
}

@test "default PKG_NAME is OpenAudible" {
  publish_release 1.0.0
  run_script
  [[ "$(calls)" == *"rpm -q --qf %{VERSION} OpenAudible"* ]]
}

@test "PLATFORM_KEY override selects that platform's file" {
  publish_release 2.0.0 "OpenAudible-2.0.0.aarch64.rpm" "linux_aarch64_rpm"
  export PLATFORM_KEY="linux_aarch64_rpm"
  run_script
  [ "$status" -eq 0 ]
  [[ "$(calls)" == *"dnf install -y "*"/OpenAudible-2.0.0.aarch64.rpm"* ]]
}

@test "default PLATFORM_KEY is linux_x86_64_rpm" {
  publish_release 2.0.0 "OpenAudible-2.0.0.other.rpm" "other_key"
  run_script
  [ "$status" -eq 1 ]
  [[ "$output" == *"Platform key 'linux_x86_64_rpm' not found"* ]]
}

# --- temp dir cleanup -------------------------------------------------------

@test "temp dir is removed after a successful update" {
  publish_release 2.0.0
  run_script
  [ "$status" -eq 0 ]
  assert_tmp_clean
  # and the rpm path dnf saw no longer exists
  [ ! -e "$(cat "$SANDBOX/dnf-rpm-path")" ]
}

@test "temp dir is removed when up to date" {
  publish_release 1.0.0
  run_script
  assert_tmp_clean
}

@test "temp dir is removed after a checksum mismatch" {
  publish_release 2.0.0
  printf 'tampered' >"$SERVER/$RPM_NAME"
  run_script
  [ "$status" -eq 1 ]
  assert_tmp_clean
}

@test "temp dir is removed after a manifest fetch failure" {
  export VERSION_URL="http://stub.test/nope.json"
  run_script
  [ "$status" -eq 1 ]
  assert_tmp_clean
}

@test "temp dir is removed when exiting for a missing dependency" {
  stub_off dnf
  run_script
  [ "$status" -eq 1 ]
  assert_tmp_clean
}
