# Troubleshooting SendLens

Use this when SendLens installs but the MCP tools do not appear, the local cache is empty, refreshes look stuck, or analysis returns less data than expected.

## Quick Checks

1. Run the bundled doctor:

   ```bash
   npm run doctor
   ```

   Or, inside a host, run:

   ```text
   /sendlens-setup
   ```

2. Confirm Node.js is available:

   ```bash
   node --version
   ```

3. Confirm your Instantly API key is present without printing it:

   ```bash
   test -n "$SENDLENS_INSTANTLY_API_KEY" && echo "set" || echo "missing"
   ```

4. Confirm the plugin builds locally:

   ```bash
   npm run build:plugin
   npm run test:plugin
   ```

5. Reload the host after install:

   - Claude Code: run `/reload-plugins`
   - Cursor: reload the window
   - Codex: refresh plugins or restart
   - OpenCode: restart or reload

## MCP Tools Do Not Appear

If the SendLens tools are missing after install:

- reload or restart the host
- confirm you installed the bundle for the host you are using
- run `pluxx validate` from this repo during local development
- run `pluxx install --target <host> --trust` again during local development
- check whether an older `sendlens-local` plugin is still installed and disable it

Expected core tools:

- `workspace_snapshot`
- `refresh_status`
- `refresh_data`
- `load_campaign_data`
- `fetch_reply_text`
- `analysis_starters`
- `list_tables`
- `list_columns`
- `search_catalog`
- `analyze_data`

## Missing API Key

SendLens needs `SENDLENS_INSTANTLY_API_KEY`.

For local development, create `.env`:

```bash
SENDLENS_INSTANTLY_API_KEY=your_key
```

For client-specific local overlays, use:

```bash
SENDLENS_CLIENT=acme
.env.clients/acme.env
.env.clients/acme.local.env
```

SendLens reads env files in this order:

1. `.env`
2. `.env.local`
3. `.env.clients/<client>.env`
4. `.env.clients/<client>.local.env`

For synthetic demo proof without production credentials:

```bash
SENDLENS_DEMO_MODE=1 npm run demo:seed
```

Demo mode is only for public-safe fixture data and should always be described as synthetic.

## Refresh Is Still Running

Every new session starts a background refresh. If you ask for data immediately, some tools may wait briefly before answering.

Check status with:

```text
refresh_status
```

Local refresh files:

- status: `~/.sendlens/refresh-status.json`
- log: `~/.sendlens/session-start-refresh.log`
- cache: `~/.sendlens/workspace-cache.duckdb`

If a tool says the DuckDB cache is temporarily locked, wait for `refresh_status` to move out of `running`, then retry. This usually means the startup refresh is finishing or another manual refresh is active.

## Empty Or Sparse Data

If `workspace_snapshot` returns no active campaigns or very little evidence:

- confirm the Instantly workspace has active sending campaigns
- run `refresh_data` once manually
- check `refresh_status` for the latest failure or success message
- confirm the API key belongs to the Instantly workspace you expect
- remember that non-reply lead evidence is sampled, while campaign and account metrics are exact

For deep analysis, load one campaign first:

```text
load_campaign_data(campaign_id="...")
```

## Missing Inbox Placement Data

SendLens ingests Instantly inbox placement tests and per-email inbox placement analytics when those API surfaces are available to the API key.

If inbox placement tables are empty:

- confirm the Instantly workspace has inbox placement tests
- confirm the API key has access to inbox placement endpoints
- run `refresh_data` once manually after creating or running a test
- check `refresh_status` and the session-start log for `refresh.inbox_placement` entries

Empty inbox placement tables mean no local inbox placement evidence was available. They do not prove senders are landing in primary inbox.

## Rendered Copy Limits

SendLens reconstructs outbound copy locally from campaign templates plus stored lead variables. Treat this as analysis evidence and personalization QA, not as a guaranteed byte-for-byte copy of the delivered email.

Current local rendering supports basic `{{ key }}` replacements using stable lead fields and `custom_payload`. It may differ from Instantly-rendered output when a campaign uses provider-specific fallback syntax, pipes, conditional logic, or transformations.

## Data Looks Stale

Run:

```text
refresh_status
```

Then run:

```text
refresh_data
```

If you use client-specific env files, confirm `SENDLENS_CLIENT` is set to the client you intended before starting the host.

## Reset Local Cache

If you need a clean local cache during development:

```bash
rm -f ~/.sendlens/workspace-cache.duckdb
rm -f ~/.sendlens/refresh-status.json
rm -f ~/.sendlens/session-start-refresh.log
```

Then restart the host or run:

```bash
npm run refresh:plugin
```

## Useful Development Commands

```bash
npm run build:plugin
npm run test:plugin
npm run validate:plugin
npm run lint:plugin
npm run build:hosts
```

`pluxx lint` may report host-surface warnings for Codex/OpenCode translation behavior. Warnings are not failures; errors need to be fixed before release.
