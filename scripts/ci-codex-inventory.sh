#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -eq 0 || ! -d "${RUNNER_TEMP:-}" ]]; then
  printf 'Codex CI inventory fixture requires a command and RUNNER_TEMP\n' >&2
  exit 64
fi

# CI has no Codex installation. Model only its empty native plugin inventory;
# the doctor still checks the Codex bundle and launches its MCP server.
fixture_root="$(mktemp -d "$RUNNER_TEMP/sendlens-codex-inventory.XXXXXX")"
trap 'rm -rf "$fixture_root"' EXIT
cat > "$fixture_root/codex" <<'EOF'
#!/usr/bin/env bash
if [[ "$#" -eq 3 && "$1" == "plugin" && "$2" == "list" && "$3" == "--json" ]]; then
  printf 'called\n' >> "$PLUXX_CODEX_INVENTORY_MARKER"
  printf '{"installed":[]}\n'
  exit 0
fi
printf 'codex stub: unhandled argv (%s args):' "$#" >&2
printf ' %q' "$@" >&2
printf '\n' >&2
exit 64
EOF
chmod +x "$fixture_root/codex"

PLUXX_CODEX_INVENTORY_MARKER="$fixture_root/inventory-called" \
  PATH="$fixture_root:$PATH" "$@"
if [[ ! -s "$fixture_root/inventory-called" ]]; then
  printf 'Codex inventory probe was not exercised\n' >&2
  exit 1
fi
