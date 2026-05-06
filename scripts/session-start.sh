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

# shellcheck disable=SC1091
source "${PLUGIN_ROOT}/scripts/load-env.sh"

DB_PATH="${SENDLENS_DB_PATH:-${HOME}/.sendlens/workspace-cache.duckdb}"
STATE_DIR="${SENDLENS_STATE_DIR:-$(dirname "${DB_PATH}")}"
LOCK_DIR="${STATE_DIR}/session-start-refresh.lock"
LOG_PATH="${STATE_DIR}/session-start-refresh.log"
SHADOW_DB_PATH="${STATE_DIR}/.$(basename "${DB_PATH}").refreshing"
export SENDLENS_DB_PATH="${DB_PATH}"
export SENDLENS_STATE_DIR="${STATE_DIR}"

is_demo_mode() {
  local raw
  raw="$(printf '%s' "${SENDLENS_DEMO_MODE:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "${raw}" == "1" || "${raw}" == "true" || "${raw}" == "yes" ]]
}

refresh_lock_is_active() {
  if [[ ! -f "${LOCK_DIR}/pid" ]]; then
    return 1
  fi
  local existing_pid
  existing_pid="$(cat "${LOCK_DIR}/pid" 2>/dev/null || true)"
  [[ -n "${existing_pid}" ]] && kill -0 "${existing_pid}" 2>/dev/null
}

cleanup_stale_refresh_state() {
  if refresh_lock_is_active; then
    return 0
  fi
  rm -rf "${LOCK_DIR}" 2>/dev/null || true
  rm -f "${SHADOW_DB_PATH}" "${SHADOW_DB_PATH}.wal" 2>/dev/null || true
}

write_missing_key_status() {
  mkdir -p "${STATE_DIR}" 2>/dev/null || return 0
  if command -v node >/dev/null 2>&1; then
    node -e '
      const fs = require("fs");
      const path = require("path");
      const statusPath = process.argv[1];
      const dbPath = process.argv[2];
      let current = {};
      try {
        current = JSON.parse(fs.readFileSync(statusPath, "utf8"));
      } catch {}
      const next = {
        ...current,
        status: "idle",
        source: "session_start",
        pid: process.pid,
        endedAt: new Date().toISOString(),
        message: "Session-start refresh skipped because SENDLENS_INSTANTLY_API_KEY is not set. Existing local DuckDB cache remains usable; configure the key before running refresh_data.",
        dbPath,
      };
      fs.mkdirSync(path.dirname(statusPath), { recursive: true });
      fs.writeFileSync(statusPath, JSON.stringify(next, null, 2));
    ' "${STATE_DIR}/refresh-status.json" "${DB_PATH}" 2>/dev/null || true
  fi
}

cleanup_stale_refresh_state

if [[ -z "${SENDLENS_INSTANTLY_API_KEY:-}" ]] && ! is_demo_mode; then
  write_missing_key_status
  echo "[sendlens] SENDLENS_INSTANTLY_API_KEY is not set; skipping session-start refresh. Existing local DuckDB cache remains available." >&2
  echo "[sendlens] Configure the key before running refresh_data, or set SENDLENS_DEMO_MODE=1 for synthetic demo data." >&2
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[sendlens] Node.js is required to run the local MCP runtime." >&2
  exit 1
fi

if ! bash "${PLUGIN_ROOT}/scripts/bootstrap-runtime.sh"; then
  echo "[sendlens] Missing or incompatible runtime dependencies. SendLens could not bootstrap its local runtime." >&2
  exit 1
fi

if [[ ! -f "${PLUGIN_ROOT}/build/plugin/refresh-cli.js" ]]; then
  echo "[sendlens] Compiled refresh runtime not found at ${PLUGIN_ROOT}/build/plugin/refresh-cli.js." >&2
  exit 1
fi

if is_demo_mode; then
  if [[ ! -f "${PLUGIN_ROOT}/build/plugin/demo-workspace.js" ]]; then
    echo "[sendlens] Compiled demo workspace runtime not found at ${PLUGIN_ROOT}/build/plugin/demo-workspace.js." >&2
    exit 1
  fi
  cd "${PLUGIN_ROOT}"
  node "${PLUGIN_ROOT}/build/plugin/demo-workspace.js" >/dev/null
  echo "[sendlens] Demo mode loaded synthetic workspace. Local DuckDB path: ${DB_PATH}" >&2
  exit 0
fi

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
  source "${PLUGIN_ROOT}/scripts/load-env.sh"
  if ! bash "${PLUGIN_ROOT}/scripts/bootstrap-runtime.sh"; then
    echo "[sendlens] Background session-start refresh failed during runtime bootstrap." >>"${LOG_PATH}" 2>&1
    exit 1
  fi
  if ! node "${PLUGIN_ROOT}/build/plugin/refresh-cli.js" >>"${LOG_PATH}" 2>&1; then
    echo "[sendlens] Background session-start refresh failed. The plugin remains available; run refresh_data() if you need an immediate retry." >>"${LOG_PATH}" 2>&1
  fi
' bash "${LOCK_DIR}" "${LOG_PATH}" "${PLUGIN_ROOT}" "${SENDLENS_CONTEXT_ROOT}" "${SENDLENS_DB_PATH}" "${SENDLENS_STATE_DIR}" >/dev/null 2>&1 &

if [[ -n "${SENDLENS_CLIENT:-}" ]]; then
  echo "[sendlens] Background refresh started for client '${SENDLENS_CLIENT}'. Local DuckDB path: ${DB_PATH}" >&2
else
  echo "[sendlens] Background refresh started. Local DuckDB path: ${DB_PATH}" >&2
fi
