#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"
export SENDLENS_TRACE_REFRESH=1

if [[ -x "${ROOT_DIR}/scripts/check-env.sh" ]]; then
  "${ROOT_DIR}/scripts/check-env.sh" >/dev/null
fi

now_ms() {
  python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
}

build_started="$(now_ms)"
npm run --silent build:plugin
build_ended="$(now_ms)"

echo "[sendlens] Build complete in $((build_ended - build_started))ms."
echo "[sendlens] Trace log: ${HOME}/.sendlens/refresh-trace.log"

refresh_started="$(now_ms)"
node ./build/plugin/benchmark-refresh-cli.js
refresh_ended="$(now_ms)"

echo "[sendlens] End-to-end benchmark completed in $((refresh_ended - build_started))ms."
echo "[sendlens] Refresh runner wall time was $((refresh_ended - refresh_started))ms."
