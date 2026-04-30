#!/usr/bin/env bash
set -euo pipefail

API_KEY="${SENDLENS_INSTANTLY_API_KEY:-}"
DB_PATH="${SENDLENS_DB_PATH:-${HOME}/.sendlens/workspace-cache.duckdb}"
PLUGIN_ROOT="${PLUGIN_ROOT:-$(pwd)}"
ENV_ROOT="${SENDLENS_CONTEXT_ROOT:-${PWD}}"
BUILD_ENTRY="${PLUGIN_ROOT}/build/plugin/server.js"
CLIENTS_DIR="${SENDLENS_CLIENTS_DIR:-.env.clients}"

load_env_file() {
  local file_path="$1"
  if [[ -f "${file_path}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${file_path}"
    set +a
  fi
}

load_env_file "${ENV_ROOT}/.env"
load_env_file "${ENV_ROOT}/.env.local"
if [[ -n "${SENDLENS_CLIENT:-}" ]]; then
  load_env_file "${ENV_ROOT}/${CLIENTS_DIR}/${SENDLENS_CLIENT}.env"
  load_env_file "${ENV_ROOT}/${CLIENTS_DIR}/${SENDLENS_CLIENT}.local.env"
fi

API_KEY="${SENDLENS_INSTANTLY_API_KEY:-}"
DB_PATH="${SENDLENS_DB_PATH:-${HOME}/.sendlens/workspace-cache.duckdb}"

if [[ -z "${API_KEY}" ]]; then
  echo "[sendlens] Missing SendLens Instantly API key. Set SENDLENS_INSTANTLY_API_KEY through .env / .env.clients/<client>.env." >&2
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

if [[ ! -f "${BUILD_ENTRY}" ]]; then
  echo "[sendlens] Compiled MCP runtime not found at ${BUILD_ENTRY}." >&2
  exit 1
fi

if [[ -n "${SENDLENS_CLIENT:-}" ]]; then
  echo "[sendlens] Runtime checks passed for client '${SENDLENS_CLIENT}'. Local DuckDB path: ${DB_PATH}" >&2
else
  echo "[sendlens] Runtime checks passed. Local DuckDB path: ${DB_PATH}" >&2
fi
