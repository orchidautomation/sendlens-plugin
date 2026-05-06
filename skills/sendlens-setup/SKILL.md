---
name: "sendlens-setup"
description: "Run SendLens first-run setup and doctor checks for env, runtime, local state, host bundles, and demo mode."
disable-model-invocation: true
---

# SendLens Setup

Use this skill when the user installs SendLens for the first time, wants to verify a host bundle, hits a missing-key/runtime/cache issue, or wants to run the synthetic demo workspace without production Instantly credentials.

## Phase 1: Diagnose

Run the bundled doctor script from the plugin root:

```bash
bash scripts/sendlens-doctor.sh
```

Display the full output. The script is the source of truth for setup checks; do not replace it with manual shell probing.

The doctor checks:

- Instantly API key presence, unless `SENDLENS_DEMO_MODE=1` is enabled.
- Node and npm availability.
- native runtime dependency loading.
- compiled MCP, refresh, and demo runtimes.
- DuckDB path and state directory writability.
- refresh status readability.
- stale session-start lock state.
- generated host bundle presence.

The doctor never prints secrets.

## Phase 2: Fix

If the output has failures, guide the user through the exact next step shown by the script:

- missing env: point to `docs/INSTALL.md` and `docs/TROUBLESHOOTING.md`; do not ask the user to paste secrets into chat.
- missing build output: run `npm run build:plugin`.
- missing runtime dependencies: run `npm install` from source, or `bash scripts/bootstrap-runtime.sh` in an installed bundle.
- non-writable DuckDB or state path: ask the user to choose a writable `SENDLENS_DB_PATH` or `SENDLENS_STATE_DIR`.
- missing host bundles from source: run `npm run build:hosts`.

If the user wants a proof path without production credentials:

```bash
SENDLENS_DEMO_MODE=1 npm run demo:seed
```

Then tell the user to ask for `workspace-health` on the demo workspace. Keep every answer clearly labeled as synthetic demo evidence.

## Output Contract

Return:

- setup status: `ready`, `ready_with_warnings`, or `blocked`.
- blocking failures, if any.
- warnings, if any.
- next command to run.
- docs links for the relevant failure.
- whether demo mode is enabled.

Do not use Bash, local DuckDB inspection, `jq`, or repo-file fallbacks for SendLens analysis after setup succeeds. Analysis must go through SendLens MCP tools.
