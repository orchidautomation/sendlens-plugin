#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="${PLUGIN_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
LOCK_DIR="${PLUGIN_ROOT}/.runtime-bootstrap.lock"
LOCK_OWNER_FILE="${LOCK_DIR}/owner.env"
BOOTSTRAP_LOCK_TIMEOUT_SECONDS="${SENDLENS_RUNTIME_BOOTSTRAP_LOCK_TIMEOUT_SECONDS:-60}"
BOOTSTRAP_LOCK_STALE_SECONDS="${SENDLENS_RUNTIME_BOOTSTRAP_LOCK_STALE_SECONDS:-60}"

is_truthy() {
  local raw
  raw="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "${raw}" == "1" || "${raw}" == "true" || "${raw}" == "yes" || "${raw}" == "y" ]]
}

is_disabled() {
  local raw
  raw="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "${raw}" == "1" || "${raw}" == "true" || "${raw}" == "yes" || "${raw}" == "y" ]]
}

is_demo_mode() {
  is_truthy "${SENDLENS_DEMO_MODE:-}"
}

has_non_whitespace() {
  [[ -n "${1//[[:space:]]/}" ]]
}

require_positive_seconds() {
  local name="$1"
  local value="$2"
  if ! [[ "${value}" =~ ^[1-9][0-9]*$ ]]; then
    echo "[sendlens] ${name} must be a positive integer number of seconds." >&2
    exit 1
  fi
}

runtime_ready() {
  (
    cd "${PLUGIN_ROOT}"
    node "${PLUGIN_ROOT}/scripts/runtime-dependencies.cjs" verify "${PLUGIN_ROOT}" >/dev/null 2>&1
  )
}

runtime_dependency_specs() {
  node "${PLUGIN_ROOT}/scripts/runtime-dependencies.cjs" specs
}

write_lock_owner() {
  {
    printf 'pid=%s\n' "$$"
    printf 'started_at=%s\n' "$(date +%s)"
    printf 'timeout_seconds=%s\n' "${BOOTSTRAP_LOCK_TIMEOUT_SECONDS}"
    printf 'stale_seconds=%s\n' "${BOOTSTRAP_LOCK_STALE_SECONDS}"
  } >"${LOCK_OWNER_FILE}"
}

lock_pid() {
  local pid=""
  if [[ -f "${LOCK_OWNER_FILE}" ]]; then
    pid="$(sed -n 's/^pid=//p' "${LOCK_OWNER_FILE}" 2>/dev/null | head -n 1)"
  elif [[ -f "${LOCK_DIR}/pid" ]]; then
    pid="$(cat "${LOCK_DIR}/pid" 2>/dev/null || true)"
  fi
  printf '%s' "${pid}"
}

lock_started_at() {
  local started=""
  if [[ -f "${LOCK_OWNER_FILE}" ]]; then
    started="$(sed -n 's/^started_at=//p' "${LOCK_OWNER_FILE}" 2>/dev/null | head -n 1)"
  fi
  if [[ -z "${started}" ]]; then
    started="$(stat -f %m "${LOCK_DIR}" 2>/dev/null || stat -c %Y "${LOCK_DIR}" 2>/dev/null || printf '0')"
  fi
  printf '%s' "${started}"
}

lock_is_live() {
  local pid
  pid="$(lock_pid)"
  [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null
}

lock_age_seconds() {
  local started now
  started="$(lock_started_at)"
  now="$(date +%s)"
  if [[ "${started}" =~ ^[0-9]+$ ]]; then
    printf '%s' "$((now - started))"
  else
    printf '0'
  fi
}

try_acquire_runtime_lock() {
  if mkdir "${LOCK_DIR}" 2>/dev/null; then
    write_lock_owner
    return 0
  fi
  return 1
}

recover_stale_runtime_lock() {
  local recovery_lock="${LOCK_DIR}.recovery"
  local stale_lock="${LOCK_DIR}.stale.$$.$RANDOM"
  if ! mkdir "${recovery_lock}" 2>/dev/null; then
    return 0
  fi

  (
    trap 'rm -rf "${recovery_lock}" 2>/dev/null || true' EXIT
    [[ -d "${LOCK_DIR}" ]] || exit 0
    lock_is_live && exit 0
    (( $(lock_age_seconds) >= BOOTSTRAP_LOCK_STALE_SECONDS )) || exit 0
    if mv "${LOCK_DIR}" "${stale_lock}" 2>/dev/null; then
      echo "[sendlens] Recovering stale runtime bootstrap lock older than ${BOOTSTRAP_LOCK_STALE_SECONDS}s." >&2
      rm -rf "${stale_lock}" 2>/dev/null || true
    fi
  )
}

release_runtime_lock() {
  if [[ "$(lock_pid)" == "$$" ]]; then
    rm -rf "${LOCK_DIR}" 2>/dev/null || true
  fi
}

acquire_runtime_lock() {
  local deadline now age
  require_positive_seconds "SENDLENS_RUNTIME_BOOTSTRAP_LOCK_TIMEOUT_SECONDS" "${BOOTSTRAP_LOCK_TIMEOUT_SECONDS}"
  require_positive_seconds "SENDLENS_RUNTIME_BOOTSTRAP_LOCK_STALE_SECONDS" "${BOOTSTRAP_LOCK_STALE_SECONDS}"
  deadline="$(($(date +%s) + BOOTSTRAP_LOCK_TIMEOUT_SECONDS))"

  while ! try_acquire_runtime_lock; do
    age="$(lock_age_seconds)"
    if ! lock_is_live && (( age >= BOOTSTRAP_LOCK_STALE_SECONDS )); then
      recover_stale_runtime_lock
      continue
    fi

    now="$(date +%s)"
    if (( now >= deadline )); then
      echo "[sendlens] Runtime bootstrap lock was not released within ${BOOTSTRAP_LOCK_TIMEOUT_SECONDS}s." >&2
      echo "[sendlens] Another install may still be running. If no SendLens install is active, remove .runtime-bootstrap.lock in the installed plugin and retry." >&2
      exit 1
    fi
    sleep 0.2
  done
}

ensure_runtime_ready() {
  if runtime_ready; then
    return 0
  fi

  if ! command -v npm >/dev/null 2>&1; then
    echo "[sendlens] npm is required to install platform-native runtime dependencies for this plugin." >&2
    exit 1
  fi

  mkdir -p "${PLUGIN_ROOT}"
  acquire_runtime_lock
  trap release_runtime_lock EXIT

  if runtime_ready; then
    return 0
  fi

  echo "[sendlens] Installing platform-native runtime dependencies..." >&2
  cd "${PLUGIN_ROOT}"
  runtime_specs="$(runtime_dependency_specs)" || {
    echo "[sendlens] Could not read SendLens runtime dependency metadata." >&2
    exit 1
  }
  runtime_deps=()
  while IFS= read -r runtime_dep; do
    [[ -n "${runtime_dep}" ]] || continue
    runtime_deps+=("${runtime_dep}")
  done <<<"${runtime_specs}"
  if (( ${#runtime_deps[@]} == 0 )); then
    echo "[sendlens] SendLens runtime dependency metadata did not list any packages." >&2
    exit 1
  fi
  npm install --omit=dev --no-save --no-audit --no-fund "${runtime_deps[@]}" >/dev/null

  if ! runtime_ready; then
    node "${PLUGIN_ROOT}/scripts/runtime-dependencies.cjs" verify "${PLUGIN_ROOT}" >&2 || true
    echo "[sendlens] Runtime dependencies finished installing, but the runtime still failed to load." >&2
    exit 1
  fi

  echo "[sendlens] Runtime dependencies are ready." >&2
}

run_installer_first_refresh() {
  if [[ -z "${PLUXX_INSTALL_DIR:-}" ]]; then
    return 0
  fi

  if is_disabled "${SENDLENS_SKIP_INSTALL_REFRESH:-}"; then
    echo "[sendlens] Skipping installer first refresh because SENDLENS_SKIP_INSTALL_REFRESH is set." >&2
    return 0
  fi

  export SENDLENS_CONTEXT_ROOT="${SENDLENS_CONTEXT_ROOT:-${PLUGIN_ROOT}}"
  export SENDLENS_DB_PATH="${SENDLENS_DB_PATH:-${HOME}/.sendlens/workspace-cache.duckdb}"
  export SENDLENS_STATE_DIR="${SENDLENS_STATE_DIR:-$(dirname "${SENDLENS_DB_PATH}")}"

  if is_demo_mode; then
    if [[ ! -f "${PLUGIN_ROOT}/build/plugin/demo-workspace.js" ]]; then
      echo "[sendlens] Demo runtime is not bundled; skipping installer demo seed." >&2
      return 0
    fi
    echo "[sendlens] Seeding demo workspace during install..." >&2
    if (cd "${PLUGIN_ROOT}" && node "${PLUGIN_ROOT}/build/plugin/demo-workspace.js" >/dev/null); then
      echo "[sendlens] Demo workspace is ready. Local DuckDB path: ${SENDLENS_DB_PATH}" >&2
    else
      echo "[sendlens] Demo seed did not complete. The plugin is still installed; run /sendlens-setup after restarting your host." >&2
    fi
    return 0
  fi

  local provider_mode
  provider_mode="$(printf '%s' "${SENDLENS_PROVIDER:-}" | tr '[:upper:]' '[:lower:]')"
  provider_mode="$(printf '%s' "${provider_mode}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  if [[ -z "${provider_mode}" ]]; then
    if has_non_whitespace "${SENDLENS_INSTANTLY_API_KEY:-}" \
      && has_non_whitespace "${SENDLENS_SMARTLEAD_API_KEY:-}"; then
      provider_mode="all"
    elif has_non_whitespace "${SENDLENS_SMARTLEAD_API_KEY:-}"; then
      provider_mode="smartlead"
    else
      provider_mode="instantly"
    fi
  fi
  local provider_ready="false"
  case "${provider_mode}" in
    instantly) has_non_whitespace "${SENDLENS_INSTANTLY_API_KEY:-}" && provider_ready="true" ;;
    smartlead) has_non_whitespace "${SENDLENS_SMARTLEAD_API_KEY:-}" && provider_ready="true" ;;
    all)
      if has_non_whitespace "${SENDLENS_INSTANTLY_API_KEY:-}" \
        && has_non_whitespace "${SENDLENS_SMARTLEAD_API_KEY:-}"; then
        has_non_whitespace "${SENDLENS_CLIENT:-}" && provider_ready="true"
      elif has_non_whitespace "${SENDLENS_INSTANTLY_API_KEY:-}" \
        || has_non_whitespace "${SENDLENS_SMARTLEAD_API_KEY:-}"; then
        provider_ready="true"
      fi
      ;;
  esac

  if [[ "${provider_ready}" != "true" ]]; then
    echo "[sendlens] No configured key is available for SENDLENS_PROVIDER=${provider_mode} during install; skipping first refresh." >&2
    echo "[sendlens] The plugin is still installed. Restart your host and run /sendlens-setup." >&2
    return 0
  fi

  if [[ ! -f "${PLUGIN_ROOT}/build/plugin/refresh-cli.js" ]]; then
    echo "[sendlens] Refresh runtime is not bundled; skipping installer first refresh." >&2
    return 0
  fi

  mkdir -p "${SENDLENS_STATE_DIR}" 2>/dev/null || true
  echo "[sendlens] Running first workspace refresh during install..." >&2
  if (cd "${PLUGIN_ROOT}" && node "${PLUGIN_ROOT}/build/plugin/refresh-cli.js"); then
    echo "[sendlens] First refresh completed. Local DuckDB path: ${SENDLENS_DB_PATH}" >&2
  else
    echo "[sendlens] First refresh did not complete. The plugin is still installed; restart your host and run /sendlens-setup." >&2
  fi
}

ensure_runtime_ready
run_installer_first_refresh
