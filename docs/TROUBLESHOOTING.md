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

3. Confirm the expected provider API key is present without printing it:

   ```bash
   test -n "$SENDLENS_INSTANTLY_API_KEY" && echo "set" || echo "missing"
   test -n "$SENDLENS_SMARTLEAD_API_KEY" && echo "set" || echo "missing"
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

For Codex, plugin-bundled hooks have a separate opt-in. The release `install-codex.sh` prompts to enable it. If tools appear but the session-start refresh never runs, or if you installed from a raw bundle or skipped the prompt, add this to `~/.codex/config.toml` and restart Codex:

```toml
[features]
plugin_hooks = true
```

The general `hooks` feature defaults on; `codex_hooks` is deprecated and is not the plugin-bundled hook gate.

Expected core tools:

- `workspace_snapshot`
- `refresh_status`
- `refresh_data`
- `load_campaign_data`
- `prepare_campaign_analysis`
- `fetch_reply_text`
- `analysis_starters`
- `list_tables`
- `list_columns`
- `search_catalog`
- `analyze_data`

## Missing Provider API Key

SendLens defaults to `SENDLENS_PROVIDER=instantly`, so real Instantly workspace analysis needs `SENDLENS_INSTANTLY_API_KEY`.

Provider modes:

- `SENDLENS_PROVIDER=instantly`: requires `SENDLENS_INSTANTLY_API_KEY`.
- `SENDLENS_PROVIDER=smartlead`: requires `SENDLENS_SMARTLEAD_API_KEY`.
- `SENDLENS_PROVIDER=all`: requires both keys plus `SENDLENS_CLIENT` for full live refresh into one shared local workspace; setup can still report partial readiness without printing either value.

Smartlead uses query-string access; SendLens setup output, logs, traces, errors, fixtures, and tests suppress the value. Smartlead V1 support is read-only and does not expose campaign, lead, account, email, webhook, or provider-setting mutation paths.

For local development, create `.env`:

```bash
SENDLENS_INSTANTLY_API_KEY=your_key
# Optional Smartlead-only or both-provider setup:
SENDLENS_PROVIDER=smartlead
SENDLENS_SMARTLEAD_API_KEY=your_key
```

For a one-session launch, export the value or prefix the host command:

```bash
export SENDLENS_INSTANTLY_API_KEY=your_key
claude

SENDLENS_INSTANTLY_API_KEY=your_key claude
```

Running `SENDLENS_INSTANTLY_API_KEY=your_key` by itself only creates a shell variable in shells such as zsh; it does not export the key to Claude Code or other child processes.

Claude Code and other hosts pass environment values to the MCP process when the host/plugin starts. After changing the key, reload plugins or restart the host before retrying `refresh_data`.

If SendLens says a different API key is configured than the key that last refreshed the DuckDB cache, this is intentional stale-cache protection. Run `refresh_data` with the current key so SendLens can rebuild and stamp the cache. If a provider is temporarily failing, the old cache is preserved but blocked for the new key. To inspect old cached Instantly data anyway, restart the host without `SENDLENS_INSTANTLY_API_KEY`.

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

For synthetic demo proof without production credentials, run setup in your AI host:

```text
/sendlens-setup
```

If no provider API key and no local cache are configured, setup initializes the synthetic demo workspace.

From a local source checkout, you can also seed directly:

```bash
SENDLENS_DEMO_MODE=1 npm run demo:seed
```

Demo mode is only for public-safe fixture data and should always be described as synthetic. The demo contains provider-qualified Instantly and Smartlead fixture rows, an intentionally duplicated campaign name across providers, and synthetic Smart Delivery placement/diagnostic evidence.

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

SendLens ingests Instantly per-email inbox-placement evidence and Smartlead Smart Delivery test/run, aggregate sender/provider, authentication, and blacklist evidence when those API surfaces are available to the configured key.

If inbox placement tables are empty:

- confirm the provider workspace has inbox-placement tests
- confirm the API key has access to the provider's inbox-placement endpoints; Smart Delivery access is support-gated
- run `refresh_data` once manually after creating or running a test
- check `refresh_status` and the session-start log for `refresh.inbox_placement` entries

Empty inbox placement tables mean no local inbox placement evidence was available. They do not prove senders are landing in primary inbox.

For `SENDLENS_PROVIDER=smartlead`, inspect the `inbox_placement` capability. `supported` means the last full refresh read Smart Delivery successfully; `unsupported` means the valid Standard API key lacked support-gated Smart Delivery access. Campaign-scoped refreshes preserve the workspace-global delivery snapshot. Do not turn Smartlead aggregates into fake per-email rows or treat absence as healthy placement.

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

## Frequent 429s During Refresh

If `refresh_status` shows repeated 429 responses or the refresh never completes, SendLens is hitting a provider rate limit. Instantly has a workspace-wide limit of 100 req/10s and 600 req/min. Smartlead has plan-dependent limits and documented 429 behavior; SendLens uses conservative local throttling and honors retry signals where present. The plugin has two layers of mitigation:

1. A per-process sliding-window limiter proactively throttles requests before the limit is reached. `refresh_status.rateLimit.throttled_count` reports the cumulative number of times the limiter had to pause a request.
2. On 429 responses, SendLens honors the `Retry-After` header (both seconds and HTTP-date form) instead of using a fixed exponential backoff.

What to check:

- If `window_10s_count` is consistently at or near 100, your refresh is making more than 100 requests per 10 seconds. This is expected for a full workspace refresh; the limiter will spread them out automatically.
- If `throttled_count` grows rapidly, an external process (another host, a CI job, a separate script) is also calling the same Instantly workspace. Coordinate timing, or run the refreshes sequentially.
- If a 429 is *not* being retried, check `session-start-refresh.log` for the latest `http.retry` entries and the actual `Retry-After` value the server returned.

If the limiter is the cause of unexpected slowness, reduce concurrent host processes (each host process gets its own limiter — but they all count toward the workspace total).

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
