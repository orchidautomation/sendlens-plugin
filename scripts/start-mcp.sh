#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="${PLUGIN_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
export PLUGIN_ROOT

# shellcheck disable=SC1091
source "${PLUGIN_ROOT}/scripts/check-env.sh"

exec node "${PLUGIN_ROOT}/build/plugin/server.js"
