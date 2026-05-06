#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="${PLUGIN_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
SENDLENS_CONTEXT_ROOT="${SENDLENS_CONTEXT_ROOT:-${PWD}}"
export PLUGIN_ROOT
export SENDLENS_CONTEXT_ROOT

# shellcheck disable=SC1091
source "${PLUGIN_ROOT}/scripts/load-env.sh" 2>/dev/null || true

DB_PATH="${SENDLENS_DB_PATH:-${HOME}/.sendlens/workspace-cache.duckdb}"
STATE_DIR="${SENDLENS_STATE_DIR:-$(dirname "${DB_PATH}")}"
DEMO_MODE="${SENDLENS_DEMO_MODE:-}"
ISSUES=0
WARNINGS=0

ok() { echo "  PASS  $1"; }
warn() { echo "  WARN  $1"; WARNINGS=$((WARNINGS + 1)); }
fail() { echo "  FAIL  $1"; ISSUES=$((ISSUES + 1)); }
detail() { echo "        $1"; }
section() { echo ""; echo "$1"; }

is_demo_mode() {
  [[ "${DEMO_MODE}" == "1" || "${DEMO_MODE}" == "true" || "${DEMO_MODE}" == "yes" ]]
}

check_writable_dir() {
  local dir="$1"
  local label="$2"
  if mkdir -p "${dir}" 2>/dev/null; then
    local probe="${dir}/.sendlens-doctor-write-probe"
    if : > "${probe}" 2>/dev/null; then
      rm -f "${probe}" 2>/dev/null || true
      ok "${label} is writable"
      detail "${dir}"
      return 0
    fi
  fi
  fail "${label} is not writable"
  detail "${dir}"
  return 1
}

echo ""
echo "SendLens doctor"
echo "Context root: ${SENDLENS_CONTEXT_ROOT}"
echo "Plugin root:  ${PLUGIN_ROOT}"

section "Environment"
if is_demo_mode; then
  ok "Demo mode enabled; production Instantly API key is optional"
elif [[ -n "${SENDLENS_INSTANTLY_API_KEY:-}" ]]; then
  ok "Instantly API key is configured"
  detail "Secret value suppressed"
else
  fail "Instantly API key is missing"
  detail "Set SENDLENS_INSTANTLY_API_KEY in host config, .env, or .env.clients/<client>.env"
  detail "Or set SENDLENS_DEMO_MODE=1 for synthetic demo data"
fi

if [[ -n "${SENDLENS_CLIENT:-}" ]]; then
  ok "Client profile selected: ${SENDLENS_CLIENT}"
  detail "Client env directory: ${SENDLENS_CLIENTS_DIR:-.env.clients}"
else
  warn "No SENDLENS_CLIENT selected"
  detail "This is fine for a single workspace or demo mode"
fi

section "Runtime"
if command -v node >/dev/null 2>&1; then
  ok "Node.js available: $(node --version)"
else
  fail "Node.js is missing"
  detail "Install Node.js 22+ or use a host bundle that includes runtime prerequisites"
fi

if command -v npm >/dev/null 2>&1; then
  ok "npm available: $(npm --version)"
else
  warn "npm is missing"
  detail "npm is only required when native runtime dependencies need bootstrap"
fi

if (cd "${PLUGIN_ROOT}" && node -e "require('@duckdb/node-api'); require('@modelcontextprotocol/sdk/server/mcp.js')" >/dev/null 2>&1); then
  ok "Runtime dependencies load"
else
  fail "Runtime dependencies do not load"
  detail "Run: npm install"
  detail "Installed bundles can also run scripts/bootstrap-runtime.sh"
fi

if [[ -f "${PLUGIN_ROOT}/build/plugin/server.js" ]]; then
  ok "Compiled MCP runtime exists"
else
  fail "Compiled MCP runtime missing"
  detail "Run: npm run build:plugin"
fi

if [[ -f "${PLUGIN_ROOT}/build/plugin/refresh-cli.js" ]]; then
  ok "Compiled refresh runtime exists"
else
  fail "Compiled refresh runtime missing"
  detail "Run: npm run build:plugin"
fi

if [[ -f "${PLUGIN_ROOT}/build/plugin/demo-workspace.js" ]]; then
  ok "Compiled demo workspace runtime exists"
else
  warn "Compiled demo workspace runtime missing"
  detail "Run: npm run build:plugin before demo:seed"
fi

section "Local State"
check_writable_dir "$(dirname "${DB_PATH}")" "DuckDB directory"
detail "DuckDB path: ${DB_PATH}"
check_writable_dir "${STATE_DIR}" "State directory"

STATUS_PATH="${STATE_DIR}/refresh-status.json"
if [[ -f "${STATUS_PATH}" ]]; then
  ok "Refresh status file exists"
  detail "${STATUS_PATH}"
  if command -v node >/dev/null 2>&1; then
    STATUS_SUMMARY="$(node -e "const fs=require('fs'); const p=process.argv[1]; try { const s=JSON.parse(fs.readFileSync(p,'utf8')); console.log([s.status, s.source, s.lastSuccessAt || s.endedAt || 'no-success-yet'].filter(Boolean).join(' | ')); } catch (e) { process.exit(2); }" "${STATUS_PATH}" 2>/dev/null || true)"
    if [[ -n "${STATUS_SUMMARY}" ]]; then
      detail "${STATUS_SUMMARY}"
    else
      warn "Refresh status file is not valid JSON"
    fi
  fi
else
  warn "No refresh status file found yet"
  detail "Run refresh_data from the MCP tool, npm run refresh:plugin, or npm run demo:seed"
fi

if [[ -d "${STATE_DIR}/session-start-refresh.lock" ]]; then
  if [[ -f "${STATE_DIR}/session-start-refresh.lock/pid" ]]; then
    LOCK_PID="$(cat "${STATE_DIR}/session-start-refresh.lock/pid" 2>/dev/null || true)"
    if [[ -n "${LOCK_PID}" ]] && kill -0 "${LOCK_PID}" 2>/dev/null; then
      warn "Session-start refresh is currently running"
      detail "pid ${LOCK_PID}"
    else
      warn "Stale session-start lock exists"
      detail "${STATE_DIR}/session-start-refresh.lock"
    fi
  else
    warn "Session-start lock exists without a pid"
    detail "${STATE_DIR}/session-start-refresh.lock"
  fi
else
  ok "No active session-start lock"
fi

section "Host Bundles"
for target in claude-code cursor codex opencode; do
  if [[ -d "${PLUGIN_ROOT}/dist/${target}" ]]; then
    ok "${target} bundle exists"
  else
    warn "${target} bundle missing"
    detail "Run: npm run build:hosts"
  fi
done

section "Next Steps"
if [[ "${ISSUES}" -eq 0 ]]; then
  ok "SendLens setup can run"
  if is_demo_mode; then
    detail "Run: npm run demo:seed"
    detail "Then ask your host: Use SendLens workspace health on the demo workspace"
  else
    detail "Run: npm run refresh:plugin or use refresh_data from the MCP tool"
  fi
else
  fail "SendLens setup has blocking issues"
  detail "Install guide: docs/INSTALL.md"
  detail "Troubleshooting: docs/TROUBLESHOOTING.md"
fi

echo ""
echo "Summary: ${ISSUES} fail(s), ${WARNINGS} warning(s)"
if [[ "${ISSUES}" -eq 0 ]]; then
  exit 0
fi
exit 1
