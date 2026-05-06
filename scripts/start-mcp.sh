#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="${PLUGIN_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
export PLUGIN_ROOT
export SENDLENS_CONTEXT_ROOT="${SENDLENS_CONTEXT_ROOT:-${PWD}}"

# shellcheck disable=SC1091
source "${PLUGIN_ROOT}/scripts/load-env.sh"

if [[ -z "${SENDLENS_INSTANTLY_API_KEY:-}" && "${SENDLENS_DEMO_MODE:-}" != "1" && "${SENDLENS_DEMO_MODE:-}" != "true" ]]; then
  echo "[sendlens] Missing SendLens Instantly API key. Set SENDLENS_INSTANTLY_API_KEY through install config or .env." >&2
  echo "[sendlens] For synthetic demo data without production credentials, set SENDLENS_DEMO_MODE=1 and run npm run demo:seed." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[sendlens] Node.js is required to run the local MCP runtime." >&2
  exit 1
fi

if ! bash "${PLUGIN_ROOT}/scripts/bootstrap-runtime.sh"; then
  echo "[sendlens] Missing or incompatible runtime dependencies. SendLens could not bootstrap its local runtime." >&2
  exit 1
fi

if [[ ! -f "${PLUGIN_ROOT}/build/plugin/server.js" ]]; then
  echo "[sendlens] Compiled MCP runtime not found at ${PLUGIN_ROOT}/build/plugin/server.js." >&2
  exit 1
fi

exec node "${PLUGIN_ROOT}/build/plugin/server.js"
