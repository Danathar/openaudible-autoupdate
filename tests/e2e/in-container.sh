#!/usr/bin/env bash
# End-to-end test: runs the real openaudible-autoupdate.sh against a real rpm
# database and a real `dnf install`, with only the network faked.
#
# MUST run inside a throwaway Fedora container (tests/e2e/run.sh does that, and
# CI runs it as the `e2e` job's container). It installs and upgrades packages as
# root, so it refuses to run unless it is told it is inside a container.
#
# Flow: build two dummy rpms named OpenAudible (1.0.0 and 2.0.0), install the
# old one, serve a manifest + the rpms over HTTPS from python's http.server on
# 127.0.0.1 (self-signed certificate added to the container's trust store, as
# the script only downloads rpms over https), point VERSION_URL at it and run
# the script.
set -euo pipefail

if [ ! -f /run/.containerenv ] && [ ! -f /.dockerenv ] && [ "${E2E_ALLOW_NON_CONTAINER:-}" != "1" ]; then
  echo "in-container.sh: refusing to run outside a container (it runs dnf install as root)." >&2
  exit 2
fi

SRC="${SRC:-/src}"
SCRIPT="$SRC/openaudible-autoupdate.sh"
WORK="$(mktemp -d)"
PORT="${E2E_PORT:-8765}"
SERVER_PID=""
failures=0

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

step() { printf '\n== %s\n' "$*"; }
pass() { printf 'PASS: %s\n' "$*"; }
fail() {
  printf 'FAIL: %s\n' "$*" >&2
  failures=$((failures + 1))
}

assert_installed_version() {
  local want="$1" got
  got=$(rpm -q --qf '%{VERSION}' OpenAudible 2>/dev/null || true)
  if [ "$got" = "$want" ]; then pass "$2 (installed OpenAudible is $got)"; else fail "$2 (wanted $want, got '${got}')"; fi
}

step "Installing test dependencies"
# sudo: the script calls it. rpm-build builds the dummy rpms. python3 serves
# them; openssl makes the server's certificate.
dnf install -y -q rpm-build python3 sudo jq curl openssl ca-certificates >/dev/null

step "Building dummy OpenAudible rpms"
cat >"$WORK/OpenAudible.spec" <<'SPEC'
Name:      OpenAudible
Version:   %{ver}
Release:   1
Summary:   Dummy OpenAudible package for openaudible-autoupdate end-to-end tests
License:   GPL-3.0-only
BuildArch: noarch

%description
Contains one file recording its own version. Not the real application.

%install
mkdir -p %{buildroot}/opt/openaudible-dummy
echo %{ver} > %{buildroot}/opt/openaudible-dummy/VERSION

%files
/opt/openaudible-dummy/VERSION
SPEC
for ver in 1.0.0 2.0.0; do
  rpmbuild -bb --quiet --define "_topdir $WORK/rpmbuild" --define "ver $ver" "$WORK/OpenAudible.spec"
done
OLD_RPM="$WORK/rpmbuild/RPMS/noarch/OpenAudible-1.0.0-1.noarch.rpm"
NEW_RPM="$WORK/rpmbuild/RPMS/noarch/OpenAudible-2.0.0-1.noarch.rpm"

step "Serving manifest and rpms over HTTPS on 127.0.0.1:$PORT"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=127.0.0.1" \
  -addext "subjectAltName=IP:127.0.0.1,DNS:localhost" \
  -keyout "$WORK/key.pem" -out "$WORK/cert.pem" 2>/dev/null
cp "$WORK/cert.pem" /etc/pki/ca-trust/source/anchors/openaudible-e2e.pem
update-ca-trust extract
SERVE="$WORK/serve"
mkdir -p "$SERVE/dl"
cp "$NEW_RPM" "$OLD_RPM" "$SERVE/dl/"
HTTPS_SERVER='
import functools, http.server, ssl, sys
port, root, cert, key = int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root)
srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(cert, key)
srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
srv.serve_forever()
'
python3 -c "$HTTPS_SERVER" "$PORT" "$SERVE" "$WORK/cert.pem" "$WORK/key.pem" >"$WORK/http.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 50); do
  curl -fsS "https://127.0.0.1:$PORT/" >/dev/null 2>&1 && break
  sleep 0.1
done

# write_manifest <version> <sha256> [rpm path]
write_manifest() {
  jq -n --arg v "$1" --arg f "$(basename "${3:-$NEW_RPM}")" --arg s "$2" --arg d "https://127.0.0.1:$PORT/dl/" \
    '{version: $v, download_dir: $d, platforms: {linux_x86_64_rpm: {file: $f, sha256: $s}}}' \
    >"$SERVE/swt_version.json"
}
good_sha=$(sha256sum "$NEW_RPM" | awk '{print $1}')
old_sha=$(sha256sum "$OLD_RPM" | awk '{print $1}')
export VERSION_URL="https://127.0.0.1:$PORT/swt_version.json"

run_script() {
  # Run as root, so `sudo dnf install -y` inside the script needs no password.
  # notify-send and systemd-cat are absent from the container, which also
  # exercises the "optional tools missing" paths of the script.
  set +e
  bash "$SCRIPT" >"$WORK/out.txt" 2>&1
  SCRIPT_STATUS=$?
  set -e
  sed 's/^/    | /' "$WORK/out.txt"
}

step "Case 0: package not installed -> exit 0, nothing happens"
write_manifest 2.0.0 "$good_sha"
run_script
if [ "$SCRIPT_STATUS" -eq 0 ] && grep -q "is not installed via rpm" "$WORK/out.txt" && ! rpm -q OpenAudible >/dev/null 2>&1; then
  pass "not installed: exit 0 and nothing installed"
else fail "not installed case (status $SCRIPT_STATUS)"; fi

step "Installing old version 1.0.0"
rpm -i "$OLD_RPM"
assert_installed_version 1.0.0 "precondition"

step "Case 1: checksum mismatch -> exit 1, old version stays"
write_manifest 2.0.0 "0000000000000000000000000000000000000000000000000000000000000000"
run_script
if [ "$SCRIPT_STATUS" -eq 1 ] && grep -q "Checksum mismatch" "$WORK/out.txt"; then pass "mismatch: exit 1 with message"; else fail "mismatch: status $SCRIPT_STATUS"; fi
assert_installed_version 1.0.0 "mismatch leaves the old version installed"

step "Case 1b: rpm header version differs from the manifest -> exit 1, old version stays"
write_manifest 3.0.0 "$good_sha"
run_script
if [ "$SCRIPT_STATUS" -eq 1 ] && grep -q "Package identity mismatch" "$WORK/out.txt"; then pass "identity mismatch: exit 1 with message"; else fail "identity mismatch: status $SCRIPT_STATUS"; fi
assert_installed_version 1.0.0 "identity mismatch leaves the old version installed"

step "Case 2: up to date manifest -> exit 0, no change"
write_manifest 1.0.0 "$good_sha"
run_script
if [ "$SCRIPT_STATUS" -eq 0 ] && grep -q "up to date" "$WORK/out.txt"; then pass "up to date: exit 0"; else fail "up to date: status $SCRIPT_STATUS"; fi
assert_installed_version 1.0.0 "up to date changes nothing"

step "Case 3: new release with correct checksum -> upgraded to 2.0.0"
write_manifest 2.0.0 "$good_sha"
run_script
if [ "$SCRIPT_STATUS" -eq 0 ] && grep -q "upgraded: 1.0.0 -> 2.0.0" "$WORK/out.txt"; then pass "upgrade: exit 0 with message"; else fail "upgrade: status $SCRIPT_STATUS"; fi
assert_installed_version 2.0.0 "upgrade installs the new version"
if [ "$(cat /opt/openaudible-dummy/VERSION)" = "2.0.0" ]; then pass "installed file content is from the new rpm"; else fail "installed file content"; fi

step "Case 3b: manifest lists an older version -> success is reported only if it really installed"
# The version check is equality, so 1.0.0 differs from the installed 2.0.0 and
# the script hands the older rpm to dnf. Whether dnf downgrades or declines,
# the script's exit status and message must match what is actually installed.
write_manifest 1.0.0 "$old_sha" "$OLD_RPM"
run_script
now=$(rpm -q --qf '%{VERSION}' OpenAudible 2>/dev/null || true)
echo "    (installed after run: $now)"
if [ "$SCRIPT_STATUS" -eq 0 ] && [ "$now" = "1.0.0" ] && grep -q "upgraded: 2.0.0 -> 1.0.0" "$WORK/out.txt"; then
  pass "older manifest: dnf downgraded and the script reported it"
elif [ "$SCRIPT_STATUS" -eq 1 ] && [ "$now" = "2.0.0" ] && ! grep -q "upgraded" "$WORK/out.txt"; then
  pass "older manifest: no change and the script did not claim an upgrade"
else
  fail "older manifest: status $SCRIPT_STATUS, installed '$now'"
fi

step "Case 4: manifest unreachable -> exit 1"
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
SERVER_PID=""
run_script
if [ "$SCRIPT_STATUS" -eq 1 ] && grep -q "Failed to fetch version manifest" "$WORK/out.txt"; then pass "unreachable manifest: exit 1"; else fail "unreachable manifest: status $SCRIPT_STATUS"; fi

echo
if [ "$failures" -eq 0 ]; then
  echo "E2E: all cases passed"
else
  echo "E2E: $failures failure(s)" >&2
  exit 1
fi
