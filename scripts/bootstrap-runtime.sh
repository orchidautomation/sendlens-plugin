#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="${PLUGIN_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
LOCK_DIR="${PLUGIN_ROOT}/.runtime-bootstrap.lock"
RUNTIME_DEPS=(
  "@duckdb/node-api@1.5.1-r.1"
  "@modelcontextprotocol/sdk@1.26.0"
  "node-sql-parser@5.4.0"
  "zod@4.3.6"
)

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

runtime_ready() {
  (
    cd "${PLUGIN_ROOT}"
    node -e "require('@duckdb/node-api'); require('@modelcontextprotocol/sdk/server/mcp.js')" >/dev/null 2>&1
  )
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
  while ! mkdir "${LOCK_DIR}" 2>/dev/null; do
    sleep 0.2
  done
  trap 'rm -rf "${LOCK_DIR}"' EXIT

  if runtime_ready; then
    return 0
  fi

  echo "[sendlens] Installing platform-native runtime dependencies..." >&2
  cd "${PLUGIN_ROOT}"
  npm install --no-save --no-audit --no-fund "${RUNTIME_DEPS[@]}" >/dev/null

  if ! runtime_ready; then
    echo "[sendlens] Runtime dependencies finished installing, but DuckDB still failed to load." >&2
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

  if [[ -z "${SENDLENS_INSTANTLY_API_KEY:-}" ]]; then
    echo "[sendlens] No Instantly API key is available during install; skipping first refresh." >&2
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
