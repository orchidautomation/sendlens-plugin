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

PLUGIN_ROOT="${PLUGIN_ROOT:-$(pwd)}"
ENV_ROOT="${SENDLENS_CONTEXT_ROOT:-${PWD}}"
CLIENTS_DIR="${SENDLENS_CLIENTS_DIR:-.env.clients}"

load_env_file "${ENV_ROOT}/.env"
load_env_file "${ENV_ROOT}/.env.local"
if [[ -n "${SENDLENS_CLIENT:-}" ]]; then
  load_env_file "${ENV_ROOT}/${CLIENTS_DIR}/${SENDLENS_CLIENT}.env"
  load_env_file "${ENV_ROOT}/${CLIENTS_DIR}/${SENDLENS_CLIENT}.local.env"
fi
