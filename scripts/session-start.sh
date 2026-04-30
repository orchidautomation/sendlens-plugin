#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="${PLUGIN_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
SENDLENS_CONTEXT_ROOT="${SENDLENS_CONTEXT_ROOT:-${PWD}}"
DB_PATH="${SENDLENS_DB_PATH:-${HOME}/.sendlens/workspace-cache.duckdb}"
STATE_DIR="${SENDLENS_STATE_DIR:-$(dirname "${DB_PATH}")}"
LOCK_DIR="${STATE_DIR}/session-start-refresh.lock"
LOG_PATH="${STATE_DIR}/session-start-refresh.log"
export SENDLENS_CONTEXT_ROOT
export SENDLENS_DB_PATH="${DB_PATH}"
export SENDLENS_STATE_DIR="${STATE_DIR}"

# Source the env/bootstrap checks into this shell so the detached child inherits
# the loaded SENDLENS_* variables.
# shellcheck disable=SC1091
source "${PLUGIN_ROOT}/scripts/check-env.sh"

cd "${PLUGIN_ROOT}"
if ! mkdir -p "${STATE_DIR}" 2>/dev/null; then
  STATE_DIR="${PLUGIN_ROOT}/.sendlens-state"
  LOCK_DIR="${STATE_DIR}/session-start-refresh.lock"
  LOG_PATH="${STATE_DIR}/session-start-refresh.log"
  mkdir -p "${STATE_DIR}"
fi
if [[ -f "${LOCK_DIR}/pid" ]]; then
  EXISTING_PID="$(cat "${LOCK_DIR}/pid" 2>/dev/null || true)"
  if [[ -n "${EXISTING_PID}" ]] && kill -0 "${EXISTING_PID}" 2>/dev/null; then
    if [[ -n "${SENDLENS_CLIENT:-}" ]]; then
      echo "[sendlens] Background refresh is already running for client '${SENDLENS_CLIENT}'. Local DuckDB path: ${DB_PATH}" >&2
    else
      echo "[sendlens] Background refresh is already running. Local DuckDB path: ${DB_PATH}" >&2
    fi
    exit 0
  fi
  rm -rf "${LOCK_DIR}"
fi

if ! mkdir -p "${LOCK_DIR}" 2>/dev/null; then
  STATE_DIR="${PLUGIN_ROOT}/.sendlens-state"
  LOCK_DIR="${STATE_DIR}/session-start-refresh.lock"
  LOG_PATH="${STATE_DIR}/session-start-refresh.log"
  mkdir -p "${LOCK_DIR}"
fi
nohup bash -lc '
  LOCK_DIR="$1"
  LOG_PATH="$2"
  PLUGIN_ROOT="$3"
  export SENDLENS_CONTEXT_ROOT="$4"
  export SENDLENS_DB_PATH="$5"
  export SENDLENS_STATE_DIR="$6"
  exec >>"${LOG_PATH}" 2>&1
  echo "$BASHPID" > "${LOCK_DIR}/pid"
  trap '"'"'rm -rf "${LOCK_DIR}"'"'"' EXIT
  # shellcheck disable=SC1091
  source "${PLUGIN_ROOT}/scripts/check-env.sh"
  if ! node "${PLUGIN_ROOT}/build/plugin/refresh-cli.js" >>"${LOG_PATH}" 2>&1; then
    echo "[sendlens] Background session-start refresh failed. The plugin remains available; run refresh_data() if you need an immediate retry." >>"${LOG_PATH}" 2>&1
  fi
' bash "${LOCK_DIR}" "${LOG_PATH}" "${PLUGIN_ROOT}" "${SENDLENS_CONTEXT_ROOT}" "${SENDLENS_DB_PATH}" "${SENDLENS_STATE_DIR}" >/dev/null 2>&1 &

if [[ -n "${SENDLENS_CLIENT:-}" ]]; then
  echo "[sendlens] Background refresh started for client '${SENDLENS_CLIENT}'. Local DuckDB path: ${DB_PATH}" >&2
else
  echo "[sendlens] Background refresh started. Local DuckDB path: ${DB_PATH}" >&2
fi
