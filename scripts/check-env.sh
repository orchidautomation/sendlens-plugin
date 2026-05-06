#!/usr/bin/env bash
set -euo pipefail

API_KEY="${SENDLENS_INSTANTLY_API_KEY:-}"
DB_PATH="${SENDLENS_DB_PATH:-${HOME}/.sendlens/workspace-cache.duckdb}"
PLUGIN_ROOT="${PLUGIN_ROOT:-$(pwd)}"
BUILD_ENTRY="${PLUGIN_ROOT}/build/plugin/server.js"

# shellcheck disable=SC1091
source "${PLUGIN_ROOT}/scripts/load-env.sh"

API_KEY="${SENDLENS_INSTANTLY_API_KEY:-}"
DB_PATH="${SENDLENS_DB_PATH:-${HOME}/.sendlens/workspace-cache.duckdb}"

is_demo_mode() {
  local raw
  raw="$(printf '%s' "${SENDLENS_DEMO_MODE:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "${raw}" == "1" || "${raw}" == "true" || "${raw}" == "yes" ]]
}

if [[ -z "${API_KEY}" ]] && ! is_demo_mode; then
  echo "[sendlens] SENDLENS_INSTANTLY_API_KEY is not set. Runtime can start in read-only local-cache mode; refresh_data will require the key." >&2
  echo "[sendlens] Run /sendlens-setup in your AI host to initialize a zero-key synthetic demo workspace." >&2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[sendlens] Node.js is required to run the local MCP runtime." >&2
  exit 1
fi

if ! bash "${PLUGIN_ROOT}/scripts/bootstrap-runtime.sh"; then
  echo "[sendlens] Missing or incompatible runtime dependencies. SendLens could not bootstrap its local runtime." >&2
  exit 1
fi

if [[ ! -f "${BUILD_ENTRY}" ]]; then
  echo "[sendlens] Compiled MCP runtime not found at ${BUILD_ENTRY}." >&2
  exit 1
fi

if is_demo_mode; then
  echo "[sendlens] Runtime checks passed in demo mode. Local DuckDB path: ${DB_PATH}" >&2
elif [[ -z "${API_KEY}" ]]; then
  echo "[sendlens] Runtime checks passed without an Instantly API key. Local DuckDB path: ${DB_PATH}" >&2
elif [[ -n "${SENDLENS_CLIENT:-}" ]]; then
  echo "[sendlens] Runtime checks passed for client '${SENDLENS_CLIENT}'. Local DuckDB path: ${DB_PATH}" >&2
else
  echo "[sendlens] Runtime checks passed. Local DuckDB path: ${DB_PATH}" >&2
fi
