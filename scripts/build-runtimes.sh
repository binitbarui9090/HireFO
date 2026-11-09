#!/usr/bin/env bash
# Builds the sandbox runtime images used by the execution worker.
# Idempotent: re-run after changing anything under runtimes/.
set -euo pipefail

TAG="${RUNTIME_IMAGE_TAG:-1}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! docker info >/dev/null 2>&1; then
  cat >&2 <<'MSG'
Docker daemon is not reachable.

Start it and re-run `npm run runtimes:build`:
  Docker Desktop : open the app
  colima         : colima start
  Linux          : sudo systemctl start docker

Without Docker you can still run the project with
EXECUTION_RUNNER=LOCAL_SUBPROCESS in .env, but submitted code then runs as a
child process on this host with no container isolation. Development only —
see docs/SECURITY.md.
MSG
  exit 1
fi

build() {
  local name="$1" dir="$2"
  echo "==> building hirefo-runtime-${name}:${TAG}"
  docker build \
    --tag "hirefo-runtime-${name}:${TAG}" \
    --file "${ROOT}/runtimes/${dir}/Dockerfile" \
    "${ROOT}/runtimes/${dir}"
}

build node node
build python python

echo
echo "Runtime images:"
docker images --filter 'reference=hirefo-runtime-*' \
  --format '  {{.Repository}}:{{.Tag}}  {{.Size}}'
