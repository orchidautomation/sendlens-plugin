#!/usr/bin/env bash

load_env_file() {
  local file_path="$1"
  [[ -f "${file_path}" ]] || return 0

  local raw_line parse_status
  while IFS= read -r raw_line || [[ -n "${raw_line}" ]]; do
    if parse_sendlens_env_line "${raw_line}"; then
      export "${SENDLENS_PARSED_KEY}=${SENDLENS_PARSED_VALUE}"
    else
      parse_status=$?
      if [[ "${parse_status}" -eq 2 ]]; then
        echo "[sendlens] Ignoring unsafe or invalid SendLens dotenv entry." >&2
      fi
    fi
  done < "${file_path}"
}

is_allowed_sendlens_env_key() {
  case "${1:-}" in
    SENDLENS_CLIENT | \
    SENDLENS_CLIENTS_DIR | \
    SENDLENS_DB_PATH | \
    SENDLENS_DEMO_MODE | \
    SENDLENS_INSTANTLY_API_KEY | \
    SENDLENS_PROVIDER | \
    SENDLENS_SMARTLEAD_API_KEY | \
    SENDLENS_STATE_DIR)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_sendlens_home_path_key() {
  case "${1:-}" in
    SENDLENS_DB_PATH | SENDLENS_STATE_DIR)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_sendlens_root_locked_key() {
  case "${1:-}" in
    SENDLENS_CLIENT | SENDLENS_CLIENTS_DIR)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_sendlens_container_locked_key() {
  case "${1:-}" in
    SENDLENS_CLIENTS_DIR | SENDLENS_DB_PATH | SENDLENS_DEMO_MODE | SENDLENS_STATE_DIR)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_sendlens_container_enabled() {
  local normalized
  normalized="$(trim_sendlens_value "${SENDLENS_CONTAINER:-}")"
  normalized="$(printf '%s' "${normalized}" | tr '[:upper:]' '[:lower:]')"
  [[ "${normalized}" == "1" || "${normalized}" == "true" || "${normalized}" == "yes" ]]
}

contains_ascii_control_character() {
  local LC_ALL=C
  [[ "${1:-}" =~ [[:cntrl:]] ]]
}

capture_initial_sendlens_env_keys() {
  local key
  SENDLENS_INITIAL_ENV_KEYS="|"
  for key in \
    SENDLENS_CLIENT \
    SENDLENS_CLIENTS_DIR \
    SENDLENS_DB_PATH \
    SENDLENS_DEMO_MODE \
    SENDLENS_INSTANTLY_API_KEY \
    SENDLENS_PROVIDER \
    SENDLENS_SMARTLEAD_API_KEY \
    SENDLENS_STATE_DIR; do
    if declare -p "${key}" >/dev/null 2>&1; then
      SENDLENS_INITIAL_ENV_KEYS="${SENDLENS_INITIAL_ENV_KEYS}${key}|"
    fi
  done
}

is_initial_sendlens_env_key() {
  [[ "${SENDLENS_INITIAL_ENV_KEYS:-|}" == *"|${1:-}|"* ]]
}

should_apply_sendlens_env_key() {
  local key="${1:-}"
  local layer="${SENDLENS_ENV_LAYER:-base}"

  if is_sendlens_container_enabled && is_sendlens_container_locked_key "${key}"; then
    return 1
  fi
  if [[ "${layer}" == "client" ]]; then
    ! is_sendlens_root_locked_key "${key}"
    return
  fi
  ! is_initial_sendlens_env_key "${key}"
}

parse_sendlens_env_line() {
  local raw_line="${1%$'\r'}"
  local line key value quote_type="unquoted"

  SENDLENS_PARSED_KEY=""
  SENDLENS_PARSED_VALUE=""

  line="$(trim_sendlens_value "${raw_line}")"
  [[ -n "${line}" && "${line}" != \#* ]] || return 1

  if [[ "${line}" == export[[:space:]]* ]]; then
    line="$(trim_sendlens_value "${line#export}")"
  fi
  if [[ ! "${line}" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    [[ "${line}" == SENDLENS_* ]] && return 2
    return 1
  fi

  key="${BASH_REMATCH[1]}"
  is_allowed_sendlens_env_key "${key}" || return 1
  should_apply_sendlens_env_key "${key}" || return 1
  value="$(trim_sendlens_value "${BASH_REMATCH[2]}")"

  if [[ "${value}" == \'* ]]; then
    [[ "${value}" =~ ^\'([^\']*)\'([[:space:]]*(\#.*)?)$ ]] || return 2
    quote_type="single"
    value="${BASH_REMATCH[1]}"
  elif [[ "${value}" == \"* ]]; then
    [[ "${value}" =~ ^\"([^\"]*)\"([[:space:]]*(\#.*)?)$ ]] || return 2
    quote_type="double"
    value="${BASH_REMATCH[1]}"
  elif [[ "${value}" == *\"* || "${value}" == *\'* ]]; then
    return 2
  else
    if [[ "${value}" =~ ^(.*)[[:space:]]+\#.*$ ]]; then
      value="$(trim_sendlens_value "${BASH_REMATCH[1]}")"
    fi
  fi

  if [[ "${quote_type}" != "single" \
    && ( "${value}" == '$HOME/'* || "${value}" == '${HOME}/'* ) ]] \
    && is_sendlens_home_path_key "${key}"; then
    value="${HOME:-}/${value#*/}"
  fi
  if [[ "${value}" == *'$'* || "${value}" == *'`'* ]]; then
    return 2
  fi
  if contains_ascii_control_character "${value}"; then
    return 2
  fi

  if [[ "${value}" == *';'* \
    || "${value}" == *'|'* \
    || "${value}" == *'&'* \
    || "${value}" == *'<'* \
    || "${value}" == *'>'* \
    || "${value}" == *'\'* ]]; then
    return 2
  fi

  SENDLENS_PARSED_KEY="${key}"
  SENDLENS_PARSED_VALUE="${value}"
  return 0
}

trim_sendlens_value() {
  local value="${1:-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "${value}"
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
  normalized="$(trim_sendlens_value "${value}" | tr '[:upper:]' '[:lower:]')"
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
  local mode
  mode="$(trim_sendlens_value "${SENDLENS_PROVIDER:-}")"
  if [[ -z "${mode}" ]]; then
    if [[ -n "$(trim_sendlens_value "${SENDLENS_INSTANTLY_API_KEY:-}")" \
      && -n "$(trim_sendlens_value "${SENDLENS_SMARTLEAD_API_KEY:-}")" ]]; then
      mode="all"
    elif [[ -n "$(trim_sendlens_value "${SENDLENS_SMARTLEAD_API_KEY:-}")" ]]; then
      mode="smartlead"
    else
      mode="instantly"
    fi
  fi
  printf '%s' "${mode}" | tr '[:upper:]' '[:lower:]'
}

source_provider_includes() {
  local mode="$1"
  local provider="$2"
  [[ "${mode}" == "all" || "${mode}" == "${provider}" ]]
}

source_provider_is_valid() {
  local mode="$1"
  [[ "${mode}" == "instantly" || "${mode}" == "smartlead" || "${mode}" == "all" ]]
}

validate_source_provider() {
  local mode="${1:-$(source_provider_mode)}"
  if source_provider_is_valid "${mode}"; then
    return 0
  fi
  echo "[sendlens] Invalid SENDLENS_PROVIDER value '${SENDLENS_PROVIDER:-${mode}}'. Set SENDLENS_PROVIDER to instantly, smartlead, or all." >&2
  return 1
}

sanitize_initial_sendlens_placeholders() {
  if is_unresolved_sendlens_value "${SENDLENS_CLIENT:-}"; then
    echo "[sendlens] Ignoring unresolved SENDLENS_CLIENT placeholder." >&2
    unset SENDLENS_CLIENT
  fi
  if is_unresolved_sendlens_path "${SENDLENS_CLIENTS_DIR:-}"; then
    echo "[sendlens] Ignoring unresolved SENDLENS_CLIENTS_DIR value and using the default client profile directory." >&2
    unset SENDLENS_CLIENTS_DIR
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
}

PLUGIN_ROOT="${PLUGIN_ROOT:-$(pwd)}"
ENV_ROOT="${SENDLENS_CONTEXT_ROOT:-${PWD}}"
sanitize_initial_sendlens_placeholders
CLIENTS_DIR="${SENDLENS_CLIENTS_DIR:-.env.clients}"

capture_initial_sendlens_env_keys
SENDLENS_ENV_LAYER="base"

load_env_file "${ENV_ROOT}/.env"
load_env_file "${ENV_ROOT}/.env.local"
CLIENTS_DIR="${SENDLENS_CLIENTS_DIR:-.env.clients}"
if is_unresolved_sendlens_path "${CLIENTS_DIR}"; then
  unset SENDLENS_CLIENTS_DIR
  CLIENTS_DIR=".env.clients"
fi
if [[ "${CLIENTS_DIR}" == /* ]]; then
  CLIENTS_ROOT="${CLIENTS_DIR}"
else
  CLIENTS_ROOT="${ENV_ROOT}/${CLIENTS_DIR}"
fi

if [[ -z "${SENDLENS_CLIENT:-}" && -d "${CLIENTS_ROOT}" ]]; then
  shopt -s nullglob
  sendlens_client_files=("${CLIENTS_ROOT}"/*.env)
  shopt -u nullglob
  sendlens_client_names=()
  for sendlens_client_file in "${sendlens_client_files[@]}"; do
    [[ "${sendlens_client_file}" == *.local.env ]] && continue
    sendlens_client_names+=("$(basename "${sendlens_client_file}" .env)")
  done
  if (( ${#sendlens_client_names[@]} == 1 )); then
    export SENDLENS_CLIENT="${sendlens_client_names[0]}"
  fi
  unset sendlens_client_files sendlens_client_names sendlens_client_file
fi
if [[ -n "${SENDLENS_CLIENT:-}" ]]; then
  SENDLENS_ENV_LAYER="client"
  load_env_file "${CLIENTS_ROOT}/${SENDLENS_CLIENT}.env"
  load_env_file "${CLIENTS_ROOT}/${SENDLENS_CLIENT}.local.env"
fi

unset SENDLENS_ENV_LAYER SENDLENS_INITIAL_ENV_KEYS SENDLENS_PARSED_KEY SENDLENS_PARSED_VALUE

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
