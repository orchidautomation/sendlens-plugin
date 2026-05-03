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

runtime_ready() {
  (
    cd "${PLUGIN_ROOT}"
    node -e "require('@duckdb/node-api'); require('@modelcontextprotocol/sdk/server/mcp.js')" >/dev/null 2>&1
  )
}

if runtime_ready; then
  exit 0
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
  exit 0
fi

echo "[sendlens] Installing platform-native runtime dependencies..." >&2
cd "${PLUGIN_ROOT}"
npm install --no-save --no-audit --no-fund "${RUNTIME_DEPS[@]}" >/dev/null

if ! runtime_ready; then
  echo "[sendlens] Runtime dependencies finished installing, but DuckDB still failed to load." >&2
  exit 1
fi

echo "[sendlens] Runtime dependencies are ready." >&2
