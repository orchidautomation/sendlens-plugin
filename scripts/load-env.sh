#!/usr/bin/env bash

load_env_file() {
  local file_path="$1"
  if [[ -f "${file_path}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${file_path}"
    set +a
  fi
}

is_unresolved_sendlens_path() {
  local value="${1:-}"
  [[ "${value}" == *"+ name +"* || "${value}" == *'${'* || "${value}" == *"{{"* || "${value}" == *"}}"* ]]
}

PLUGIN_ROOT="${PLUGIN_ROOT:-$(pwd)}"
ENV_ROOT="${SENDLENS_CONTEXT_ROOT:-${PWD}}"
CLIENTS_DIR="${SENDLENS_CLIENTS_DIR:-.env.clients}"

load_env_file "${ENV_ROOT}/.env"
load_env_file "${ENV_ROOT}/.env.local"
if [[ -n "${SENDLENS_CLIENT:-}" ]]; then
  load_env_file "${ENV_ROOT}/${CLIENTS_DIR}/${SENDLENS_CLIENT}.env"
  load_env_file "${ENV_ROOT}/${CLIENTS_DIR}/${SENDLENS_CLIENT}.local.env"
fi

if is_unresolved_sendlens_path "${SENDLENS_DB_PATH:-}"; then
  echo "[sendlens] Ignoring unresolved SENDLENS_DB_PATH value and using the default local cache path." >&2
  unset SENDLENS_DB_PATH
fi

if is_unresolved_sendlens_path "${SENDLENS_STATE_DIR:-}"; then
  echo "[sendlens] Ignoring unresolved SENDLENS_STATE_DIR value and using the DuckDB directory for state." >&2
  unset SENDLENS_STATE_DIR
fi
