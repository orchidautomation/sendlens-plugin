# Trust And Privacy

SendLens is designed as a local-first analysis plugin for Instantly. It reads workspace data with a user-provided Instantly API key, stores analysis state locally in DuckDB, and exposes bounded analysis results to the user's AI host through MCP tools.

This page is intentionally precise. It describes the OSS plugin's data handling model without claiming that the user's AI host, model provider, shell, package manager, or Instantly account has the same privacy behavior.

## Short Version

- SendLens provides read-oriented tools. The shipped MCP surface does not include tools that modify Instantly campaigns, accounts, leads, or emails.
- The core cache is local DuckDB, defaulting to `~/.sendlens/workspace-cache.duckdb`.
- SendLens does not require an Orchid-hosted cloud warehouse for the core workflow.
- Tool results are returned to the user's AI host. The host/model provider may process that context according to its own settings and policies.
- Exact reply body text is not fetched during the normal startup refresh. It is fetched only when `fetch_reply_text` is used for one campaign.

## Instantly Access

SendLens uses `SENDLENS_INSTANTLY_API_KEY` for Instantly API access. The key should be scoped and managed in Instantly according to the workspace owner's policy.

The shipped tools are analysis and refresh tools:

- `refresh_data`
- `workspace_snapshot`
- `load_campaign_data`
- `fetch_reply_text`
- `analysis_starters`
- `list_tables`
- `list_columns`
- `search_catalog`
- `analyze_data`
- `refresh_status`

These tools read from Instantly or from the local cache. They do not expose mutation actions such as editing campaigns, changing senders, updating lead states, sending messages, or deleting Instantly records.

## Local Storage

Default local state:

| Path | Purpose |
| --- | --- |
| `~/.sendlens/workspace-cache.duckdb` | Local DuckDB cache with campaign, account, tag, inbox-placement, sampled lead, reconstructed outbound, and fetched reply surfaces |
| `~/.sendlens/refresh-status.json` | Last refresh status, timestamps, source, and error context |
| `~/.sendlens/session-start-refresh.log` | Local session-start refresh log |

Optional overrides:

| Env var | Effect |
| --- | --- |
| `SENDLENS_DB_PATH` | Moves the DuckDB cache to a custom absolute path |
| `SENDLENS_STATE_DIR` | Moves local refresh state/log paths |
| `SENDLENS_CLIENT` | Selects client-specific env overlays |
| `SENDLENS_CLIENTS_DIR` | Changes the directory used for client env overlays |
| `SENDLENS_DEMO_MODE` | Enables synthetic demo-mode setup paths when supported by the installed bundle |

## What Gets Stored Locally

The local DuckDB cache can contain:

- exact campaign metadata and aggregate analytics from Instantly
- exact step, variant, account, tag, and inbox-placement surfaces when available from Instantly
- semantic rollups such as `campaign_overview`, `sender_deliverability_health`, and `inbox_placement_test_overview`
- full replied lead records where they can be resolved from campaign lead feeds
- bounded non-reply lead samples
- campaign-specific lead `custom_payload` JSON and the `lead_payload_kv` view derived from it
- campaign templates from `campaign_variants`
- locally reconstructed outbound copy built from templates plus stored lead variables
- fetched inbound reply email rows and body text only after `fetch_reply_text` runs
- refresh metadata and sampling coverage metadata

Sampled and reconstructed surfaces are analysis evidence, not a complete warehouse export.

## What Does Not Leave The Machine By SendLens Itself

SendLens does not need to upload the DuckDB cache to an Orchid service for the core workflow. The default MCP runtime reads local files and Instantly API responses, writes local cache files, and returns bounded JSON payloads to the local host process.

Important boundary: when an AI host calls a SendLens MCP tool, the returned data becomes context for that host. Depending on the host, that context may be sent to a configured model provider. That transfer is controlled by the host and provider, not by the SendLens repository.

## What Can Leave The Machine

Data can leave the machine through these expected paths:

- Instantly API requests made with the configured API key.
- MCP tool results sent into the user's AI host session.
- Model-provider requests made by the user's AI host after it receives tool results.
- Package-manager and installer network requests during install or development.
- Any separate integrations the user invokes outside the core SendLens plugin.

## Env Handling

Local development env files are loaded in this order:

1. `.env`
2. `.env.local`
3. `.env.clients/<client>.env`
4. `.env.clients/<client>.local.env`

`SENDLENS_CLIENT=<client>` selects the client overlay. `SENDLENS_CLIENTS_DIR=<path>` changes the client env directory.

Keep env files out of public commits. Do not put API keys, customer names, domains, or private account notes into OSS issues, docs, examples, screenshots, or operator memory.

## Synthetic Demo Mode

When demo mode is enabled by setup tooling, production Instantly credentials are optional for the demo path and outputs must stay clearly labeled as synthetic. Demo data is useful for install proof and examples, not for customer or workspace conclusions.

## Cleanup

To remove default local SendLens state:

```bash
rm -f ~/.sendlens/workspace-cache.duckdb
rm -f ~/.sendlens/refresh-status.json
rm -f ~/.sendlens/session-start-refresh.log
```

If custom paths were used, remove the files pointed to by `SENDLENS_DB_PATH` and `SENDLENS_STATE_DIR`.

To remove local credentials, delete the relevant `.env`, `.env.local`, `.env.clients/<client>.env`, or `.env.clients/<client>.local.env` entries. If access should be revoked rather than only removed locally, rotate or revoke the key in Instantly.

## Evidence Boundaries

Public docs and example outputs should use the same evidence language as the product:

- Exact: campaign, account, step, variant, tag, and inbox-placement API surfaces when present locally.
- Sampled: non-reply lead evidence and sampled payload variables.
- Hybrid: semantic views that combine exact aggregates with sampled evidence.
- Reconstructed: outbound copy rendered locally from templates and stored variables.
- Fetched: exact inbound reply body text only after `fetch_reply_text` writes it into local DuckDB.

When evidence is missing, say what is missing. For example, empty inbox-placement tables mean no local inbox-placement evidence was available; they do not prove sender health is clean.
