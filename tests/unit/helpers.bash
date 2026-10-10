# Shared helpers for the unit tests. Sourced from each .bats file.
#
# The script under test is never run against the real system: every external
# command it calls is either a stub in $STUBS or a symlink to a harmless real
# tool in $REALBIN, and the script is run with PATH set to only those two
# directories. rpm, curl, sudo, dnf, notify-send and systemd-cat are always
# stubs, so nothing here can touch the host's packages or network.

SCRIPT="${BATS_TEST_DIRNAME}/../../openaudible-autoupdate.sh"

setup_sandbox() {
  SANDBOX="$BATS_TEST_TMPDIR/sandbox"
  STUBS="$SANDBOX/stubs"
  REALBIN="$SANDBOX/realbin"
  SERVER="$SANDBOX/server"  # files the curl stub can "download"; keyed by basename
  SCRIPT_TMP="$SANDBOX/tmp" # TMPDIR for the script, so cleanup can be asserted
  CALLS="$SANDBOX/calls.log"
  mkdir -p "$STUBS" "$REALBIN" "$SERVER" "$SCRIPT_TMP"
  : >"$CALLS"

  # Real tools the script needs besides the stubbed ones (plus bash, cat, cp
  # and basename, which the stub scripts themselves use).
  local tool path
  for tool in jq sha256sum awk mktemp rm bash cat cp basename; do
    path=$(command -v "$tool") || {
      echo "test host lacks $tool" >&2
      return 1
    }
    ln -s "$path" "$REALBIN/$tool"
  done

  install_stubs
  stub_all_tools

  export STUB_CALLS="$CALLS" STUB_SERVER="$SERVER" STUB_STATE="$SANDBOX" TMPDIR="$SCRIPT_TMP"
  export STUB_RPM_VERSION="1.0.0" STUB_DNF_EXIT=0
  unset VERSION_URL PKG_NAME PLATFORM_KEY
}

# Stubs record every invocation as one line in $STUB_CALLS.
install_stubs() {
  cat >"$SANDBOX/stub-rpm" <<'S'
#!/usr/bin/env bash
echo "rpm $*" >>"$STUB_CALLS"
# Expected form: rpm -q --qf '%{VERSION}' <pkg>
pkg="${*: -1}"
if [ "${STUB_RPM_PKG:-OpenAudible}" != "$pkg" ] || [ -z "$STUB_RPM_VERSION" ]; then
  echo "package $pkg is not installed"
  exit 1
fi
printf '%s' "$STUB_RPM_VERSION"
S
  cat >"$SANDBOX/stub-curl" <<'S'
#!/usr/bin/env bash
# Serves files from $STUB_SERVER by URL basename; unknown URLs fail like curl -f.
out="" url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
echo "curl $url" >>"$STUB_CALLS"
src="$STUB_SERVER/$(basename "$url")"
[ -f "$src" ] || exit 22
cp "$src" "$out"
S
  cat >"$SANDBOX/stub-sudo" <<'S'
#!/usr/bin/env bash
echo "sudo $*" >>"$STUB_CALLS"
exec "$@"
S
  cat >"$SANDBOX/stub-dnf" <<'S'
#!/usr/bin/env bash
echo "dnf $*" >>"$STUB_CALLS"
# Record that the rpm handed to dnf exists and what it contains at call time.
rpm_arg="${*: -1}"
if [ -f "$rpm_arg" ]; then
  echo "dnf-rpm-present $(basename "$rpm_arg") $(cat "$rpm_arg")" >>"$STUB_CALLS"
  echo "$rpm_arg" >"$STUB_STATE/dnf-rpm-path"
fi
exit "${STUB_DNF_EXIT:-0}"
S
  cat >"$SANDBOX/stub-notify-send" <<'S'
#!/usr/bin/env bash
echo "notify-send $*" >>"$STUB_CALLS"
S
  cat >"$SANDBOX/stub-systemd-cat" <<'S'
#!/usr/bin/env bash
echo "systemd-cat $* :: $(cat)" >>"$STUB_CALLS"
S
  chmod +x "$SANDBOX"/stub-*
}

stub_on() { cp "$SANDBOX/stub-$1" "$STUBS/$1"; }
stub_off() { rm -f "$STUBS/$1"; }
stub_all_tools() {
  local t
  for t in rpm curl sudo dnf notify-send systemd-cat; do stub_on "$t"; done
}

# publish_release <version> [file] [platform_key] [content]
# Writes version.json plus the rpm into the fake server and sets RPM_NAME.
publish_release() {
  local version="$1" file="${2:-OpenAudible-$1.x86_64.rpm}"
  local key="${3:-linux_x86_64_rpm}" content="${4:-rpm-payload-$1}"
  # shellcheck disable=SC2034 # read by the .bats files
  RPM_NAME="$file"
  printf '%s' "$content" >"$SERVER/$file"
  local sum
  sum=$(sha256sum "$SERVER/$file" | awk '{print $1}')
  jq -n --arg v "$version" --arg f "$file" --arg k "$key" --arg s "$sum" \
    '{version: $v, download_dir: "http://stub.test/dl/",
      platforms: {($k): {file: $f, sha256: $s}}}' >"$SERVER/swt_version.json"
  export VERSION_URL="http://stub.test/swt_version.json"
}

run_script() {
  run env "PATH=$STUBS:$REALBIN" "$BASH" "$SCRIPT"
}

calls() { cat "$CALLS"; }
