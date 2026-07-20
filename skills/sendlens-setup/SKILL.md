---
name: sendlens-setup
description: "Use when the user wants to install, configure, diagnose, or repair SendLens: provider access, runtime/cache readiness, host bundles, refresh failures, or demo setup. Simple cache age/status stays direct; outbound analysis uses sendlens-analyst."
compatibility: "Supports Claude Code, Cursor, Codex, and OpenCode. Normal diagnosis uses SendLens MCP; public no-Pluxx recovery requires curl, bash, mktemp, Node.js, and network access, but no global Pluxx CLI."
---

# SendLens Setup

Install, diagnose, or repair SendLens; verify host and local-cache readiness; and offer a synthetic proof workspace without production credentials.

## Ordered Recovery Ladder

1. If `setup_doctor` is callable, call it and use its JSON response as the source of truth. Do not replace its provider, runtime, cache, or workspace checks with Bash, local-file, or DuckDB inspection.
2. If the SendLens MCP tools are absent, read [references/recovery-and-clients.md](references/recovery-and-clients.md) and follow the host-specific Pluxx path when `pluxx` is callable.
3. If both SendLens MCP and `pluxx` are absent, use the same reference's official `https://sendlens.app/install.sh` recovery path. It requires `curl`, `bash`, `mktemp`, `node`, and network access, but not a preinstalled global Pluxx CLI. If a prerequisite is unavailable, stop with `blocked: missing installer prerequisite: <exact prerequisite>` and the durable installer link.
4. Never repair an install by manually scattering agent, skill, command, or MCP files. Reload or restart the host after repair, invoke this skill again, and rerun `setup_doctor`.

Use the recovery reference for custom-agent discovery failures too; agent registration belongs to the host installer, not the MCP doctor.

## Phase 1: Diagnose

Display the relevant status, failures, warnings, and next steps from `setup_doctor`.

When describing freshness, use the exact `cache_freshness.label` and timestamp. Do not replace a seconds/minutes-old refresh with vague phrasing such as "earlier today."

The doctor checks:

- provider mode inferred from configured API keys, or explicitly overridden, and the required API key presence unless `SENDLENS_DEMO_MODE=1` is enabled.
- Smartlead query-string API-key redaction for `SENDLENS_PROVIDER=smartlead` or `SENDLENS_PROVIDER=all`.
- whether an existing local cache is readable without live refresh credentials.
- compiled MCP, refresh, and demo runtimes.
- DuckDB path and state-directory writability.
- refresh-status readability and stale session-start lock state.
- installed or source host-bundle context.

The doctor never prints secrets and never refreshes or mutates campaign data.

## Phase 2: Fix

If the doctor reports failures, guide the user through its exact next step:

- Missing API key and no local cache: call `seed_demo_workspace` immediately unless the user explicitly wants real provider data only. Do not require `SENDLENS_DEMO_MODE=1` first.
- Missing API key with a readable local cache: explain that cached read-only analysis is available, and offer `seed_demo_workspace` only as an optional synthetic proof workspace.
- Rejected or unreachable production API key: follow the doctor next step to fix or retry the key, and offer `seed_demo_workspace` while credentials are being corrected.
- Missing env for a real refresh: use the self-contained provider/client guidance in [references/recovery-and-clients.md](references/recovery-and-clients.md); never ask the user to paste secrets into chat.
- Missing build output in a source checkout: run `npm run build:plugin`.
- Missing runtime dependencies: run `npm install` from source, or `bash scripts/bootstrap-runtime.sh` in an installed bundle.
- Non-writable DuckDB or state path: ask the user to choose a writable `SENDLENS_DB_PATH` or `SENDLENS_STATE_DIR`.
- Missing host bundles in a source checkout: run `npm run build:hosts`.

If `seed_demo_workspace` is called, display the seed result, label the workspace and every result as synthetic demo evidence, and tell the user to ask for `workspace-health` on the demo workspace.

If production credentials are configured, keep the default path on the real workspace and recommend `workspace_snapshot` or an explicitly requested `refresh_data`. Mention demo only when the user asks for synthetic, dummy, sample, or proof data.

Provider setup modes are `instantly`, `smartlead`, and `all`. Both provider keys infer `all`, which requires `SENDLENS_CLIENT` so both read-only refreshes share one named workspace. For multiple clients, use a distinct `SENDLENS_DB_PATH` and `SENDLENS_STATE_DIR` for each client; never bypass a cache-owner mismatch or let one client's key read another client's cache.

Smartlead V1 is read-only. Smart Delivery uses a separate support-gated service: ingest its exact placement and diagnostic evidence when authorized, record the capability as unsupported without breaking core Smartlead ingest when access is absent, and never treat missing or empty rows as healthy placement.

## Output Contract

Return:

- setup status: `ready`, `ready_with_warnings`, or `blocked`.
- blocking failures and warnings.
- next command to run.
- cache freshness using `cache_freshness.label` when present.
- a relevant durable docs or installer link.
- whether demo mode is enabled.
- host-native registration repair guidance when a specialist is missing.
- selected client plus cache/state isolation guidance when `all` mode or multiple clients are involved.
- recovery path used, host reload/restart action, and post-reload doctor result when MCP or agent registration was missing.
- exact missing installer prerequisite and durable installer link when recovery is blocked.

## Example Requests

- "Install and configure SendLens."
- "Run the SendLens setup doctor."
- "In a synthetic Codex setup, SendLens MCP tools and `pluxx` are both absent, while `curl`, `bash`, `mktemp`, `node`, and network access are available. Install the official Codex bundle without requiring global Pluxx, restart Codex, and rerun the doctor."

Do not use Bash, local DuckDB inspection, `jq`, or repo-file fallbacks for SendLens analysis after setup succeeds. Analysis must go through SendLens MCP tools.

## Final QA Loop

Before returning, verify that the ordered recovery ladder was followed; any blocked result names the exact missing prerequisite and durable installer link; no manual file scattering was recommended; the host reload/restart and doctor rerun are explicit; `all` mode and per-client caches are isolated; and no secret, credential value, raw customer data, or private message body is exposed. Confirm all provider actions remain read-only and Smart Delivery is described as support-gated rather than universally absent or implicitly healthy.
