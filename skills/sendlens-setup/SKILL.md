---
name: "sendlens-setup"
description: "Use when the user wants to install, configure, diagnose, or repair SendLens, including provider access, runtime/cache readiness, host bundles, refresh failures, or synthetic demo setup. For outbound analysis and recommendations, use sendlens-analyst."
---

# SendLens Setup

Use this skill when the user installs SendLens for the first time, wants to verify a host bundle, hits a missing-key/runtime/cache issue, or wants to run the synthetic demo workspace without production provider credentials.

## Phase 1: Diagnose

Call the SendLens MCP tool `setup_doctor`.

Display the relevant status, failures, warnings, and next steps from the JSON response. The MCP tool is the source of truth for provider, runtime, cache, and workspace setup checks; do not replace those checks with Bash, manual shell probing, local file inspection, or DuckDB inspection.

Custom-agent discovery is a host installation concern outside the MCP doctor. Repair it with the host-native Pluxx path:

- Claude Code: SendLens agents are native plugin components under `agents/`. Rerun the current Pluxx-backed installer, run `pluxx verify-install --target claude-code`, then run `/reload-plugins`. Confirm the specialists appear in `/agents`.
- Cursor: SendLens agents are native plugin components under `agents/`. Rerun the installer, run `pluxx verify-install --target cursor`, then use **Developer: Reload Window** or restart Cursor.
- Codex: Pluxx registers bundled agent TOML under the active Codex home. Rerun the installer, run `pluxx verify-install --target codex`, and restart Codex. Do not ask the user to copy agent files by hand.
- OpenCode: the generated plugin injects SendLens agent definitions through its `config` hook. Rerun the installer, run `pluxx verify-install --target opencode`, restart OpenCode, and invoke a specialist with `@campaign-strategist` or another bundled agent name.

When describing freshness, use the exact `cache_freshness.label` and timestamp from `setup_doctor`. Do not replace a seconds/minutes-old refresh with vague phrasing such as "earlier today."

The doctor checks:

- provider mode and required API key presence, unless `SENDLENS_DEMO_MODE=1` is enabled.
- Smartlead query-string API key redaction for `SENDLENS_PROVIDER=smartlead` or `SENDLENS_PROVIDER=all`.
- whether existing local cache reads are available without live refresh credentials.
- compiled MCP, refresh, and demo runtimes.
- DuckDB path and state directory writability.
- refresh status readability.
- stale session-start lock state.
- installed/source host bundle context.

The doctor never prints secrets and never refreshes or mutates campaign data.

## Phase 2: Fix

If the output has failures, guide the user through the exact next step shown by the tool:

- missing API key and no local cache: call the SendLens MCP tool `seed_demo_workspace` immediately, unless the user explicitly says they only want real provider data. Treat this as the default quick-start path; do not make the user set `SENDLENS_DEMO_MODE=1` first.
- missing API key with an existing local cache: explain that read-only cached analysis is available, and that `seed_demo_workspace` can be used for a synthetic proof workspace if desired.
- rejected or unreachable production API key: follow the doctor next step to fix or retry the key, and offer `seed_demo_workspace` as the demo-safe fallback while credentials are being corrected.
- missing env for real workspace refresh: point to `docs/INSTALL.md` and `docs/TROUBLESHOOTING.md`; do not ask the user to paste secrets into chat.
- missing build output: run `npm run build:plugin`.
- missing runtime dependencies: run `npm install` from source, or `bash scripts/bootstrap-runtime.sh` in an installed bundle.
- non-writable DuckDB or state path: ask the user to choose a writable `SENDLENS_DB_PATH` or `SENDLENS_STATE_DIR`.
- missing host bundles from source: run `npm run build:hosts`.

If `seed_demo_workspace` is called:

Display the seed result, say that the local synthetic workspace is ready, and tell the user to ask for `workspace-health` on the demo workspace. Keep every answer clearly labeled as synthetic demo evidence.

If production credentials are configured, do not suggest demo seeding by default. Recommend `workspace_snapshot` or `refresh_data` for real workspace analysis. Mention demo only if the user explicitly asks for synthetic, dummy, sample, or proof data.

Provider setup modes are `instantly`, `smartlead`, and `all`. Smartlead V1 is read-only, and Smartlead inbox placement is unsupported unless a later checked read endpoint exists. Preserve those limitations in setup guidance.

## Output Contract

Return:

- setup status: `ready`, `ready_with_warnings`, or `blocked`.
- blocking failures, if any.
- warnings, if any.
- next command to run.
- cache freshness, using `cache_freshness.label` when present.
- docs links for the relevant failure.
- whether demo mode is enabled.
- host-native registration repair guidance when Claude Code, Cursor, Codex, or OpenCode cannot discover a SendLens specialist.

Do not use Bash, local DuckDB inspection, `jq`, or repo-file fallbacks for SendLens analysis after setup succeeds. Analysis must go through SendLens MCP tools.
