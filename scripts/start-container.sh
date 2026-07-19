#!/usr/bin/env bash
set -euo pipefail

DATA_ROOT="${SENDLENS_DATA_DIR:-/data}"

fail() {
  echo "[sendlens] $1" >&2
  exit 1
}

is_enabled() {
  local raw
  raw="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "${raw}" == "1" || "${raw}" == "true" || "${raw}" == "yes" ]]
}

[[ "${DATA_ROOT}" = /* ]] || fail "SENDLENS_DATA_DIR must be an absolute persistent mount path."

mkdir -p "${DATA_ROOT}" "${DATA_ROOT}/state" "${DATA_ROOT}/clients"
probe_path="${DATA_ROOT}/.sendlens-write-probe"
if ! : > "${probe_path}" 2>/dev/null; then
  fail "Persistent storage at ${DATA_ROOT} is not writable by the SendLens container user."
fi
rm -f "${probe_path}"

export SENDLENS_TRANSPORT="http"
export SENDLENS_CONTEXT_ROOT="${SENDLENS_CONTEXT_ROOT:-${DATA_ROOT}/context}"
export SENDLENS_CLIENTS_DIR="${SENDLENS_CLIENTS_DIR:-${DATA_ROOT}/clients}"
export SENDLENS_STATE_DIR="${SENDLENS_STATE_DIR:-${DATA_ROOT}/state}"
export SENDLENS_DB_PATH="${SENDLENS_DB_PATH:-${DATA_ROOT}/workspace-cache.duckdb}"
export SENDLENS_HTTP_HOST="${SENDLENS_HTTP_HOST:-0.0.0.0}"
export SENDLENS_HTTP_PORT="${SENDLENS_HTTP_PORT:-3000}"

[[ -n "${SENDLENS_HTTP_BEARER_TOKEN:-}" ]] || fail "SENDLENS_HTTP_BEARER_TOKEN is required for the HTTP container."
[[ -n "${SENDLENS_HTTP_ALLOWED_HOSTS:-}" ]] || fail "SENDLENS_HTTP_ALLOWED_HOSTS is required for the HTTP container. Set it to the exact Host header your platform forwards."

if ! is_enabled "${SENDLENS_DEMO_MODE:-}"; then
  if [[ ! -f "${SENDLENS_DB_PATH}" && -z "${SENDLENS_INSTANTLY_API_KEY:-}" && -z "${SENDLENS_SMARTLEAD_API_KEY:-}" ]]; then
    fail "Set a provider API key, enable SENDLENS_DEMO_MODE=1 for synthetic proof data, or mount an existing SendLens DuckDB cache at SENDLENS_DB_PATH."
  fi
fi

exec node /app/build/plugin/server.js
