# Recovery and Client Isolation

Use this reference only when SendLens MCP/agent registration is missing or when provider, client, or cache identity needs repair.

## Recovery Ladder

### 1. Doctor is callable

Return to `setup_doctor`. Its sanitized JSON is authoritative for provider, runtime, cache, and workspace readiness. Do not add shell or local-file diagnosis.

### 2. MCP is absent and Pluxx is callable

Resolve the active target as `claude-code`, `cursor`, `codex`, or `opencode`, then run:

```bash
pluxx verify-install --target <host>
```

If the user is in a SendLens source checkout and verification reports an absent or stale bundle, repair it with:

```bash
pluxx install --target <host> --trust
pluxx verify-install --target <host>
```

Outside a source checkout, rerun the official release installer for the active host instead of asking the user to clone the repo or copy files manually. Pluxx owns host registration; never scatter agent, skill, command, or MCP files across host directories.

### 3. MCP and Pluxx are both absent

Use the public release installer. It requires, in this order, `curl`, `bash`, `mktemp`, `node`, and network access to `sendlens.app` and GitHub. It does not require a global Pluxx CLI.

Set the active host and run the fail-closed download. The installer executes only after a bounded download succeeds, and the temporary file is removed on both success and failure.

```bash
install_target="codex" # claude-code, cursor, codex, or opencode
(
  set -e
  installer_file="$(mktemp)"
  trap 'rm -f "$installer_file"' EXIT
  curl -fsSL --connect-timeout 10 --max-time 120 --retry 3 --retry-all-errors --retry-delay 1 \
    https://sendlens.app/install.sh --output "$installer_file"
  bash "$installer_file" "--$install_target" -y
)
```

Use `--agents -y` only when the user explicitly wants every supported host.

If any prerequisite is missing, do not improvise a manual install. Stop and name the exact failure, for example:

```text
blocked: missing installer prerequisite: curl
blocked: missing installer prerequisite: bash
blocked: missing installer prerequisite: mktemp
blocked: missing installer prerequisite: node
blocked: missing installer prerequisite: network access to sendlens.app and github.com
```

Official entry point: [https://sendlens.app/install.sh](https://sendlens.app/install.sh)

Durable release asset: [https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install.sh](https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install.sh)

Do not recommend manually downloading and distributing the raw host bundle, agent files, skills, commands, or MCP configuration as a recovery shortcut.

## Reload and Recheck

After any repair:

- Claude Code: run `/reload-plugins`, then confirm SendLens tools and agents are present.
- Cursor: use **Developer: Reload Window** or restart Cursor.
- Codex: restart Codex.
- OpenCode: restart or reload OpenCode.

Invoke `sendlens-setup` again and rerun `setup_doctor`. If the tools remain absent after one reinstall and host reload, return `blocked`, name the host and failed mount, and link the [public troubleshooting guide](https://github.com/orchidautomation/sendlens-plugin/blob/main/docs/TROUBLESHOOTING.md). Do not fall back to repo files or DuckDB for analysis.

## Provider and Client Modes

- `SENDLENS_INSTANTLY_API_KEY` alone infers `instantly`.
- `SENDLENS_SMARTLEAD_API_KEY` alone infers `smartlead`.
- Both keys infer `all`; live `all` refresh requires `SENDLENS_CLIENT` so both providers join one named local workspace.
- Use `SENDLENS_PROVIDER` only for an explicit `instantly`, `smartlead`, or `all` override.

SendLens loads `.env`, `.env.local`, `.env.clients/<client>.env`, then `.env.clients/<client>.local.env` from the launch context. Do not ask the user to paste keys into chat or print them while checking configuration.

For multiple clients, isolate both cache and refresh state:

```bash
SENDLENS_CLIENT=synthetic-acme
SENDLENS_DB_PATH=$HOME/.sendlens/synthetic-acme.duckdb
SENDLENS_STATE_DIR=$HOME/.sendlens/synthetic-acme-state
```

Give every client distinct `SENDLENS_DB_PATH` and `SENDLENS_STATE_DIR` values. Cache-owner metadata binds the cache to its selected client, workspace, path, schema, and provider-key fingerprint. On a client or key mismatch, preserve the old cache, block cross-identity reads, and require a successful refresh for the selected identity or a new per-client cache path. Never disable or work around this protection.

Provider operations remain read-only. Smartlead query-string credentials must never appear in URLs, logs, traces, errors, fixtures, or output. Smart Delivery is a separate support-gated read service: authorized access may yield exact placement and diagnostics; absent access records `unsupported` without breaking core Smartlead ingest, and missing or empty rows never prove healthy placement.
