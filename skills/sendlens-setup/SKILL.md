---
name: "sendlens-setup"
description: "Run SendLens first-run setup and doctor checks for env, runtime, local state, host bundles, and demo mode."
disable-model-invocation: true
---

# SendLens Setup

Use this skill when the user installs SendLens for the first time, wants to verify a host bundle, hits a missing-key/runtime/cache issue, or wants to run the synthetic demo workspace without production Instantly credentials.

## Phase 1: Diagnose

Call the SendLens MCP tool `setup_doctor`.

Display the relevant status, failures, warnings, and next steps from the JSON response. The MCP tool is the source of truth for setup checks; do not replace it with Bash, manual shell probing, local file inspection, or DuckDB inspection.

When describing freshness, use the exact `cache_freshness.label` and timestamp from `setup_doctor`. Do not replace a seconds/minutes-old refresh with vague phrasing such as "earlier today."

The doctor checks:

- Instantly API key presence, unless `SENDLENS_DEMO_MODE=1` is enabled.
- whether existing local cache reads are available without live refresh credentials.
- compiled MCP, refresh, and demo runtimes.
- DuckDB path and state directory writability.
- refresh status readability.
- stale session-start lock state.
- installed/source host bundle context.

The doctor never prints secrets and never refreshes or mutates campaign data.

## Phase 2: Fix

If the output has failures, guide the user through the exact next step shown by the tool:

- missing API key and no local cache: call the SendLens MCP tool `seed_demo_workspace` immediately, unless the user explicitly says they only want real Instantly data. Treat this as the default quick-start path; do not make the user set `SENDLENS_DEMO_MODE=1` first.
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

## Output Contract

Return:

- setup status: `ready`, `ready_with_warnings`, or `blocked`.
- blocking failures, if any.
- warnings, if any.
- next command to run.
- cache freshness, using `cache_freshness.label` when present.
- docs links for the relevant failure.
- whether demo mode is enabled.

Do not use Bash, local DuckDB inspection, `jq`, or repo-file fallbacks for SendLens analysis after setup succeeds. Analysis must go through SendLens MCP tools.
