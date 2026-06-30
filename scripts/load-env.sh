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

is_unresolved_sendlens_value() {
  local value="${1:-}"
  local normalized
  normalized="$(printf '%s' "${value}" | tr '[:upper:]' '[:lower:]')"
  [[
    "${normalized}" == *"+ name +"* ||
    "${normalized}" == *'${'* ||
    "${normalized}" == *"{{"* ||
    "${normalized}" == *"}}"* ||
    "${normalized}" == "your_key" ||
    "${normalized}" == "your-api-key" ||
    "${normalized}" == "your_api_key" ||
    "${normalized}" == "your-instantly-api-key" ||
    "${normalized}" == "your_instantly_api_key" ||
    "${normalized}" == "your-smartlead-api-key" ||
    "${normalized}" == "your_smartlead_api_key" ||
    "${normalized}" == "instantly_api_key"
  ]]
}

is_unresolved_provider_value() {
  local value="${1:-}"
  local normalized
  normalized="$(printf '%s' "${value}" | tr '[:upper:]' '[:lower:]')"
  [[
    "${normalized}" == *"+ name +"* ||
    "${normalized}" == *'${'* ||
    "${normalized}" == *"{{"* ||
    "${normalized}" == *"}}"* ||
    "${normalized}" == "your_provider" ||
    "${normalized}" == "your-provider" ||
    "${normalized}" == "provider"
  ]]
}

source_provider_mode() {
  printf '%s' "${SENDLENS_PROVIDER:-instantly}" | tr '[:upper:]' '[:lower:]'
}

source_provider_includes() {
  local mode="$1"
  local provider="$2"
  [[ "${mode}" == "all" || "${mode}" == "${provider}" ]]
}

validate_source_provider() {
  local mode="${1:-$(source_provider_mode)}"
  if [[ "${mode}" == "instantly" || "${mode}" == "smartlead" || "${mode}" == "all" ]]; then
    return 0
  fi
  echo "[sendlens] Invalid SENDLENS_PROVIDER value '${SENDLENS_PROVIDER:-${mode}}'. Set SENDLENS_PROVIDER to instantly, smartlead, or all." >&2
  return 1
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

if is_unresolved_sendlens_value "${SENDLENS_INSTANTLY_API_KEY:-}"; then
  echo "[sendlens] Ignoring unresolved SENDLENS_INSTANTLY_API_KEY placeholder." >&2
  unset SENDLENS_INSTANTLY_API_KEY
fi

if is_unresolved_sendlens_value "${SENDLENS_SMARTLEAD_API_KEY:-}"; then
  echo "[sendlens] Ignoring unresolved SENDLENS_SMARTLEAD_API_KEY placeholder." >&2
  unset SENDLENS_SMARTLEAD_API_KEY
fi

if is_unresolved_provider_value "${SENDLENS_PROVIDER:-}"; then
  echo "[sendlens] Ignoring unresolved SENDLENS_PROVIDER placeholder." >&2
  unset SENDLENS_PROVIDER
fi
