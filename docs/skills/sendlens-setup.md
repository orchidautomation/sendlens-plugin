# `sendlens-setup`

Runs first-run setup, no-MCP host recovery, doctor checks, provider/client configuration, local-state verification, and synthetic demo seeding.

Related: [catalog](../CATALOG.md), [install guide](../INSTALL.md), [trust and privacy](../TRUST_AND_PRIVACY.md), [troubleshooting](../TROUBLESHOOTING.md), and [synthetic examples](../examples/SYNTHETIC_OUTPUTS.md).

## Use When

- The user is installing SendLens for the first time.
- MCP tools or bundled specialists are missing.
- Provider mode, API keys, runtime dependencies, client/cache isolation, refresh status, or session-start locks need diagnosis.
- The user wants a public-safe synthetic proof workspace instead of production credentials.

## Primary Surfaces

- Skill source: `skills/sendlens-setup/SKILL.md`
- Self-contained bundled recovery reference: `skills/sendlens-setup/references/recovery-and-clients.md`
- Command: `/sendlens-setup`
- MCP tool: `setup_doctor`
- Source-developer fallback only: `scripts/sendlens-doctor.sh`
- Official public installer: [https://sendlens.app/install.sh](https://sendlens.app/install.sh)
- Durable release installer: [latest GitHub Release asset](https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install.sh)

## Ordered Flow

1. Call `setup_doctor` when the SendLens MCP is mounted. Its sanitized JSON is authoritative for provider, runtime, cache, and workspace readiness.
2. If MCP is absent and `pluxx` is callable, use the host-native Pluxx install/verify path, reload or restart the host, and rerun the doctor.
3. If MCP and Pluxx are both absent, run the official installer for the active host. This path requires `curl`, `bash`, `mktemp`, `node`, and network access, but no global Pluxx CLI.
4. If a prerequisite is unavailable, return `blocked: missing installer prerequisite: <exact prerequisite>` plus the official and durable installer links. Never recommend manually scattering agent, skill, command, or MCP files.
5. Reload or restart the host, invoke `/sendlens-setup` again, and rerun `setup_doctor`.
6. If no usable selected-provider credentials and no readable cache are present, call `seed_demo_workspace` unless the user wants real data only.
7. After setup succeeds, use SendLens MCP tools for analysis instead of shell, repo-file, cache-file, or DuckDB inspection.

Host reload actions are `/reload-plugins` for Claude Code, **Developer: Reload Window** or restart for Cursor, restart for Codex, and restart/reload for OpenCode.

## Provider, Client, and Cache Contract

- Instantly-only uses `SENDLENS_INSTANTLY_API_KEY`; Smartlead-only uses `SENDLENS_SMARTLEAD_API_KEY`.
- Both keys infer `SENDLENS_PROVIDER=all`, and live `all` refresh requires `SENDLENS_CLIENT` so both providers share one named local workspace.
- Multiple clients must use distinct `SENDLENS_DB_PATH` and `SENDLENS_STATE_DIR` values. Cache identity protections must block one client or provider-key identity from reading another's cache.
- All provider operations remain read-only.
- Smart Delivery is a separate support-gated Smartlead service. Authorized refreshes can ingest exact placement and diagnostics; absent access records `unsupported` without breaking core Smartlead ingest, and missing or empty rows never prove healthy placement.

## Output Shape

- Setup status: `ready`, `ready_with_warnings`, or `blocked`.
- Blocking failures and warnings.
- Exact next command, reload/restart action, and doctor rerun result.
- Exact missing installer prerequisite and durable installer link when blocked.
- Cache freshness and selected client/cache-isolation state.
- Source provider mode: `instantly`, `smartlead`, or `all`.
- Whether demo seeding is available and whether current evidence is synthetic.

## Privacy Boundaries

Never print or request secrets in chat. Suppress Smartlead query-string credentials from URLs, logs, traces, setup output, errors, fixtures, and tests. Do not expose raw customer data or private message bodies. Demo evidence must remain labeled synthetic, and production credentials keep the default path on the real workspace unless the user explicitly requests demo mode.
