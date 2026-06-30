#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="${PLUGIN_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
export PLUGIN_ROOT
export SENDLENS_CONTEXT_ROOT="${SENDLENS_CONTEXT_ROOT:-${PWD}}"

# shellcheck disable=SC1091
source "${PLUGIN_ROOT}/scripts/load-env.sh"

SOURCE_PROVIDER="$(printf '%s' "${SENDLENS_PROVIDER:-instantly}" | tr '[:upper:]' '[:lower:]')"

is_demo_mode() {
  local raw
  raw="$(printf '%s' "${SENDLENS_DEMO_MODE:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "${raw}" == "1" || "${raw}" == "true" || "${raw}" == "yes" ]]
}

source_provider_includes() {
  local mode="$1"
  local provider="$2"
  [[ "${mode}" == "all" || "${mode}" == "${provider}" ]]
}

if [[ "${SOURCE_PROVIDER}" != "instantly" && "${SOURCE_PROVIDER}" != "smartlead" && "${SOURCE_PROVIDER}" != "all" ]]; then
  echo "[sendlens] Invalid SENDLENS_PROVIDER value '${SENDLENS_PROVIDER}'. Set SENDLENS_PROVIDER to instantly, smartlead, or all." >&2
  exit 1
fi

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

if [[ ! -f "${PLUGIN_ROOT}/build/plugin/server.js" ]]; then
  echo "[sendlens] Compiled MCP runtime not found at ${PLUGIN_ROOT}/build/plugin/server.js." >&2
  exit 1
fi

exec node "${PLUGIN_ROOT}/build/plugin/server.js"
