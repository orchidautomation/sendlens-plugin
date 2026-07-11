#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="${PLUGIN_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
export PLUGIN_ROOT
export SENDLENS_CONTEXT_ROOT="${SENDLENS_CONTEXT_ROOT:-${PLUXX_MCP_WORKSPACE_ROOT:-${PLUXX_HOOK_WORKSPACE_ROOT:-${PWD}}}}"

# shellcheck disable=SC1091
source "${PLUGIN_ROOT}/scripts/load-env.sh"

SOURCE_PROVIDER="$(source_provider_mode)"

is_demo_mode() {
  local raw
  raw="$(printf '%s' "${SENDLENS_DEMO_MODE:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "${raw}" == "1" || "${raw}" == "true" || "${raw}" == "yes" ]]
}

validate_source_provider "${SOURCE_PROVIDER}" || exit 1

if [[ -z "${SENDLENS_INSTANTLY_API_KEY:-}" ]] && ! is_demo_mode && source_provider_includes "${SOURCE_PROVIDER}" "instantly"; then
  echo "[sendlens] SENDLENS_INSTANTLY_API_KEY is not set for SENDLENS_PROVIDER=${SOURCE_PROVIDER}. Starting MCP in read-only local-cache mode; refresh_data will require the key." >&2
  echo "[sendlens] Run /sendlens-setup in your AI host to initialize a zero-key synthetic demo workspace." >&2
fi

if [[ -z "${SENDLENS_SMARTLEAD_API_KEY:-}" ]] && ! is_demo_mode && source_provider_includes "${SOURCE_PROVIDER}" "smartlead"; then
  echo "[sendlens] SENDLENS_SMARTLEAD_API_KEY is not set for SENDLENS_PROVIDER=${SOURCE_PROVIDER}. Smartlead setup checks require it, and setup output suppresses the value." >&2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[sendlens] Node.js is required to run the local MCP runtime." >&2
  exit 1
fi

if ! bash "${PLUGIN_ROOT}/scripts/bootstrap-runtime.sh"; then
  echo "[sendlens] Missing or incompatible runtime dependencies. SendLens could not bootstrap its local runtime." >&2
  exit 1
fi
export SENDLENS_RUNTIME_BOOTSTRAPPED=1

# Host SessionStart hooks remain the preferred per-session trigger. Some
# Codex/Claude host versions do not execute plugin hooks consistently, so MCP
# process startup is an idempotent fallback. session-start.sh owns the shared
# lock and returns immediately when another hook/process already started it.
if ! bash "${PLUGIN_ROOT}/scripts/session-start.sh"; then
  echo "[sendlens] Automatic startup refresh could not be launched; continuing with the last good local cache." >&2
fi

if [[ ! -f "${PLUGIN_ROOT}/build/plugin/server.js" ]]; then
  echo "[sendlens] Compiled MCP runtime not found at ${PLUGIN_ROOT}/build/plugin/server.js." >&2
  exit 1
fi

exec node "${PLUGIN_ROOT}/build/plugin/server.js"
