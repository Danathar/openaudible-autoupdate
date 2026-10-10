#!/usr/bin/env bash
# Host-side launcher for the end-to-end test. Runs tests/e2e/in-container.sh
# inside a throwaway Fedora container (podman, or docker if podman is absent)
# with this repository mounted read-only. Nothing on the host is installed,
# upgraded or modified: `sudo dnf install` in the script under test happens
# inside the container.
#
# Usage: tests/e2e/run.sh
# Override the image with E2E_IMAGE, the engine with CONTAINER_ENGINE.
set -euo pipefail

: "${E2E_IMAGE:=registry.fedoraproject.org/fedora:latest}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

engine="${CONTAINER_ENGINE:-}"
if [ -z "$engine" ]; then
  for candidate in podman docker; do
    if command -v "$candidate" >/dev/null 2>&1; then
      engine="$candidate"
      break
    fi
  done
fi
if [ -z "$engine" ]; then
  echo "run.sh: neither podman nor docker found" >&2
  exit 2
fi

# label=disable lets the container read the mount on SELinux hosts without
# relabelling the repository (:z/:Z would change its file labels recursively).
exec "$engine" run --rm \
  --security-opt label=disable \
  -v "$repo_root:/src:ro" \
  "$E2E_IMAGE" \
  bash /src/tests/e2e/in-container.sh
