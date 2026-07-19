#!/usr/bin/env bash
set -euo pipefail

DATA_ROOT="${SENDLENS_DATA_DIR:-/data}"

fail() {
  echo "[sendlens] $1" >&2
  exit 1
}

[[ "${DATA_ROOT}" = /* ]] || fail "SENDLENS_DATA_DIR must be an absolute persistent mount path."

export SENDLENS_TRANSPORT="http"
export SENDLENS_CONTEXT_ROOT="${SENDLENS_CONTEXT_ROOT:-${DATA_ROOT}/context}"
export SENDLENS_CLIENTS_DIR="${SENDLENS_CLIENTS_DIR:-${DATA_ROOT}/clients}"
export SENDLENS_STATE_DIR="${SENDLENS_STATE_DIR:-${DATA_ROOT}/state}"
export SENDLENS_DB_PATH="${SENDLENS_DB_PATH:-${DATA_ROOT}/workspace-cache.duckdb}"
export SENDLENS_HTTP_HOST="${SENDLENS_HTTP_HOST:-0.0.0.0}"
export SENDLENS_HTTP_PORT="${SENDLENS_HTTP_PORT:-3000}"

require_absolute_path() {
  local name="$1"
  local value="$2"
  [[ "${value}" = /* ]] || fail "${name} must be an absolute persistent path."
}

require_under_data_root() {
  local name="$1"
  local value="$2"
  local normalized_root
  local normalized_value
  normalized_root="$(realpath -m "${DATA_ROOT}")"
  normalized_value="$(realpath -m "${value}")"
  case "${normalized_value}" in
    "${normalized_root}"|"${normalized_root}"/*) ;;
    *) fail "${name} must resolve under SENDLENS_DATA_DIR (${normalized_root})." ;;
  esac
}

ensure_writable_dir() {
  local name="$1"
  local directory="$2"
  local probe_path
  mkdir -p "${directory}" || fail "${name} at ${directory} could not be created by the SendLens container user."
  probe_path="${directory}/.sendlens-write-probe"
  if ! : > "${probe_path}" 2>/dev/null; then
    fail "${name} at ${directory} is not writable by the SendLens container user."
  fi
  rm -f "${probe_path}"
}

require_absolute_path "SENDLENS_DB_PATH" "${SENDLENS_DB_PATH}"
require_absolute_path "SENDLENS_STATE_DIR" "${SENDLENS_STATE_DIR}"
require_absolute_path "SENDLENS_CLIENTS_DIR" "${SENDLENS_CLIENTS_DIR}"
require_absolute_path "SENDLENS_CONTEXT_ROOT" "${SENDLENS_CONTEXT_ROOT}"
require_under_data_root "SENDLENS_DB_PATH" "${SENDLENS_DB_PATH}"
require_under_data_root "SENDLENS_STATE_DIR" "${SENDLENS_STATE_DIR}"
require_under_data_root "SENDLENS_CLIENTS_DIR" "${SENDLENS_CLIENTS_DIR}"
require_under_data_root "SENDLENS_CONTEXT_ROOT" "${SENDLENS_CONTEXT_ROOT}"

ensure_writable_dir "SENDLENS_DATA_DIR" "${DATA_ROOT}"
ensure_writable_dir "SENDLENS_DB_PATH parent" "$(dirname "${SENDLENS_DB_PATH}")"
ensure_writable_dir "SENDLENS_STATE_DIR" "${SENDLENS_STATE_DIR}"
ensure_writable_dir "SENDLENS_CLIENTS_DIR" "${SENDLENS_CLIENTS_DIR}"
ensure_writable_dir "SENDLENS_CONTEXT_ROOT" "${SENDLENS_CONTEXT_ROOT}"

[[ -n "${SENDLENS_HTTP_BEARER_TOKEN:-}" ]] || fail "SENDLENS_HTTP_BEARER_TOKEN is required for the HTTP container."
[[ -n "${SENDLENS_HTTP_ALLOWED_HOSTS:-}" ]] || fail "SENDLENS_HTTP_ALLOWED_HOSTS is required for the HTTP container. Set it to the exact Host header your platform forwards."

exec node /app/build/plugin/server.js
