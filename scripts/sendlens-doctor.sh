#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="${PLUGIN_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
SENDLENS_CONTEXT_ROOT="${SENDLENS_CONTEXT_ROOT:-${PWD}}"
export PLUGIN_ROOT
export SENDLENS_CONTEXT_ROOT

# shellcheck disable=SC1091
source "${PLUGIN_ROOT}/scripts/load-env.sh" || true

DB_PATH="${SENDLENS_DB_PATH:-${HOME}/.sendlens/workspace-cache.duckdb}"
STATE_DIR="${SENDLENS_STATE_DIR:-$(dirname "${DB_PATH}")}"
SHADOW_DB_PATH="${STATE_DIR}/.$(basename "${DB_PATH}").refreshing"
ISSUES=0
WARNINGS=0

ok() { echo "  PASS  $1"; }
warn() { echo "  WARN  $1"; WARNINGS=$((WARNINGS + 1)); }
fail() { echo "  FAIL  $1"; ISSUES=$((ISSUES + 1)); }
detail() { echo "        $1"; }
section() { echo ""; echo "$1"; }

is_demo_mode() {
  local raw
  raw="$(printf '%s' "${SENDLENS_DEMO_MODE:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "${raw}" == "1" || "${raw}" == "true" || "${raw}" == "yes" ]]
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
elif [[ -f "${DB_PATH}" ]]; then
  warn "Instantly API key is missing; refresh is disabled"
  detail "Existing local DuckDB cache can still be used for read-only analysis"
  detail "Set SENDLENS_INSTANTLY_API_KEY before running refresh_data"
else
  fail "Instantly API key is missing"
  detail "Run /sendlens-setup in your AI host to initialize a zero-key synthetic demo workspace"
  detail "Set SENDLENS_INSTANTLY_API_KEY in host config, .env, or .env.clients/<client>.env when you want real workspace analysis"
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
if [[ -f "${DB_PATH}" ]]; then
  ok "Existing DuckDB cache found"
  if command -v stat >/dev/null 2>&1; then
    detail "$(du -h "${DB_PATH}" 2>/dev/null | awk '{print $1}') at ${DB_PATH}"
  fi
else
  warn "No DuckDB cache found yet"
  detail "Run /sendlens-setup in your AI host for zero-key demo data, or refresh_data when a real API key is configured"
fi
check_writable_dir "${STATE_DIR}" "State directory"

STATUS_PATH="${STATE_DIR}/refresh-status.json"
if [[ -f "${STATUS_PATH}" ]]; then
  ok "Refresh status file exists"
  detail "${STATUS_PATH}"
  if command -v node >/dev/null 2>&1; then
    STATUS_SUMMARY="$(node -e "const fs=require('fs'); const p=process.argv[1]; try { const s=JSON.parse(fs.readFileSync(p,'utf8')); console.log([s.status, s.source, s.lastSuccessAt || s.endedAt || 'no-success-yet'].filter(Boolean).join(' | ')); } catch (e) { process.exit(2); }" "${STATUS_PATH}" 2>/dev/null || true)"
    if [[ -n "${STATUS_SUMMARY}" ]]; then
      detail "${STATUS_SUMMARY}"
      STATUS_FIELDS="$(node -e "const fs=require('fs'); const p=process.argv[1]; try { const s=JSON.parse(fs.readFileSync(p,'utf8')); console.log([s.status || '', s.pid || '', s.dbPath || ''].join('\t')); } catch (e) { process.exit(2); }" "${STATUS_PATH}" 2>/dev/null || true)"
      IFS=$'\t' read -r STATUS_VALUE STATUS_PID STATUS_DB_PATH <<< "${STATUS_FIELDS}"
      if [[ "${STATUS_VALUE}" == "running" && -n "${STATUS_PID}" ]]; then
        if kill -0 "${STATUS_PID}" 2>/dev/null; then
          detail "Refresh pid ${STATUS_PID} is active"
        else
          warn "Refresh status says running, but pid ${STATUS_PID} is not active"
          detail "A new refresh_data or npm run refresh:plugin will replace this stale status."
        fi
      fi
      if [[ -n "${STATUS_DB_PATH:-}" && "${STATUS_DB_PATH}" != "${DB_PATH}" ]]; then
        warn "Refresh status dbPath differs from active DuckDB path"
        detail "status dbPath: ${STATUS_DB_PATH}"
        detail "active dbPath: ${DB_PATH}"
      fi
    else
      warn "Refresh status file is not valid JSON"
    fi
  fi
else
  warn "No refresh status file found yet"
  detail "Run /sendlens-setup in your AI host for zero-key demo data, or refresh_data when a real API key is configured"
fi

if [[ -f "${SHADOW_DB_PATH}" ]]; then
  warn "Interrupted refresh temp database exists"
  detail "${SHADOW_DB_PATH}"
  detail "A future refresh will remove and rebuild this temp file; the live DuckDB cache above is not replaced until refresh succeeds."
else
  ok "No interrupted refresh temp database"
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
    detail "Run /sendlens-setup in your AI host, or run npm run demo:seed from source"
    detail "Then ask your host: Use SendLens workspace health on the demo workspace"
  elif [[ -f "${DB_PATH}" ]]; then
    detail "Existing cache is present. In the host, start with workspace_snapshot; use refresh_data only when you explicitly need a fresh pull."
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
