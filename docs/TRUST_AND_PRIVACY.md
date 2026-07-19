# Trust And Privacy

SendLens is designed as a local-first analysis plugin for outbound provider data. It reads workspace data with user-provided provider API keys, stores analysis state locally in DuckDB, and exposes bounded analysis results to the user's AI host through MCP tools.

This page is intentionally precise. It describes the OSS plugin's data handling model without claiming that the user's AI host, model provider, shell, package manager, or Instantly account has the same privacy behavior.

## Short Version

- SendLens provides read-oriented tools. The shipped MCP surface does not include tools that modify provider campaigns, accounts, leads, emails, webhooks, or settings.
- The core cache is local DuckDB, defaulting to `~/.sendlens/workspace-cache.duckdb`.
- SendLens does not require an Orchid-hosted cloud warehouse for the core workflow.
- Tool results are returned to the user's AI host. The host/model provider may process that context according to its own settings and policies.
- Stdio is the default transport. Opt-in Streamable HTTP returns tool results to any remote MCP client that holds the deployment credential and passes the configured Host/Origin policy.
- Exact reply body text is not fetched during the normal startup refresh. It is fetched only when `prepare_campaign_analysis` or `fetch_reply_text` is used for one campaign.

## Provider Access

SendLens uses `SENDLENS_INSTANTLY_API_KEY` for Instantly API access. The key should be scoped and managed in Instantly according to the workspace owner's policy.

Smartlead access uses `SENDLENS_SMARTLEAD_API_KEY`; when that is the only configured provider key, SendLens infers Smartlead mode. `SENDLENS_PROVIDER=smartlead` or `SENDLENS_PROVIDER=all` remains available as an explicit override. Smartlead uses query-string API keys, so SendLens suppresses the value in URLs, traces, logs, setup output, errors, fixtures, and tests.

Smartlead V1 support is read-only. SendLens can refresh supported campaign, account, lead, analytics, bounded message-history, and support-gated Smart Delivery evidence, but it does not expose Smartlead campaign, lead, account, email, webhook, test, folder, or provider-setting mutation paths. Smart Delivery email-content and raw reply-header endpoints are intentionally not ingested.

The shipped tools are analysis and refresh tools:

- `refresh_data`
- `workspace_snapshot`
- `load_campaign_data`
- `prepare_campaign_analysis`
- `fetch_reply_text`
- `analysis_starters`
- `list_tables`
- `list_columns`
- `search_catalog`
- `analyze_data`
- `refresh_status`

These tools read from configured providers or from the local cache. They do not expose mutation actions such as editing campaigns, changing senders, updating lead states, sending messages, managing webhooks, or deleting provider records.

`analyze_data` failures are intentionally sanitized. Guard, parser, binder, runtime, workspace-isolation, and local-cache execution failures return a stable error shape with a bounded code and safe retry hint; they do not echo the submitted SQL, workspace-injected SQL, literals, row previews, provider/customer identifiers, email addresses, reply text, or engine detail.

`analyze_data` diagnostics are additive and bounded. They may report elapsed handler time, a small status enum, cache timestamp/generation, row/truncation counts, and referenced public SendLens surfaces parsed from `sendlens.<table>` names. They do not store route history or return SQL, private literals, raw row content, customer identifiers, email addresses, reply text, or non-public table names.

The single-tenant container image uses the same read-only MCP surface and privacy contract. One container owns one configured workspace and one persistent `/data` directory; provider credentials and HTTP bearer credentials are injected only at runtime. See [Single-Tenant Container Deployment](./CONTAINER_DEPLOYMENT.md).

## Local Storage

Default local state:

| Path | Purpose |
| --- | --- |
| `~/.sendlens/workspace-cache.duckdb` | Local DuckDB cache with campaign, account, tag, inbox-placement, sampled lead, reconstructed outbound, and fetched reply surfaces |
| `~/.sendlens/refresh-status.json` | Last refresh status, timestamps, source, and error context |
| `~/.sendlens/session-start-refresh.log` | Local session-start refresh log |

The DuckDB cache also stores cache-owner metadata such as schema version, active workspace id, selected client, context root, DB path, and a SHA-256 API-key fingerprint. SendLens uses this fingerprint to prevent a newly configured key from silently reading a previous client's cache. The raw API key is never stored.

Optional overrides:

| Env var | Effect |
| --- | --- |
| `SENDLENS_DB_PATH` | Moves the DuckDB cache to a custom absolute path |
| `SENDLENS_STATE_DIR` | Moves local refresh state/log paths |
| `SENDLENS_CLIENT` | Selects client-specific env overlays |
| `SENDLENS_CLIENTS_DIR` | Changes the directory used for client env overlays |
| `SENDLENS_DEMO_MODE` | Enables synthetic demo-mode setup paths when supported by the installed bundle |
| `SENDLENS_PROVIDER` | Optionally overrides the inferred source provider mode with `instantly`, `smartlead`, or `all` |
| `SENDLENS_SMARTLEAD_API_KEY` | Dedicated Smartlead setup credential; suppress from URLs, traces, logs, setup output, errors, fixtures, and tests |
| `SENDLENS_TRANSPORT` | Selects default `stdio` or opt-in `http` transport |
| `SENDLENS_HTTP_BEARER_TOKEN` | Required deployment credential for HTTP mode; never returned or logged |
| `SENDLENS_HTTP_ALLOWED_HOSTS` | Exact hostname allowlist for HTTP DNS-rebinding protection |
| `SENDLENS_HTTP_ALLOWED_ORIGINS` | Exact optional browser-origin allowlist; empty by default |

## What Gets Stored Locally

The local DuckDB cache can contain:

- exact campaign metadata and aggregate analytics from Instantly
- exact or provider-native campaign, account, lead, analytics, and bounded message-history evidence from Smartlead where supported
- exact step, variant, account, tag, and inbox-placement surfaces when available from Instantly
- semantic rollups such as `campaign_overview`, `sender_deliverability_health`, and `inbox_placement_test_overview`
- reply-signal lead records found during bounded campaign lead scans or explicit reply-email lead backfills
- bounded non-reply lead samples
- campaign-specific lead `custom_payload` JSON and the `lead_payload_kv` view derived from it
- campaign templates from `campaign_variants`
- locally reconstructed outbound copy built from templates plus stored lead variables
- fetched inbound reply email rows and body text only after `prepare_campaign_analysis` or `fetch_reply_text` runs
- refresh metadata and sampling coverage metadata

Sampled and reconstructed surfaces are analysis evidence, not a complete warehouse export.

## Transport Boundary

The default `SENDLENS_TRANSPORT=stdio` path communicates with a local AI host process over stdin/stdout and preserves the existing local-first boundary.

Opt-in `SENDLENS_TRANSPORT=http` exposes the same read-only MCP tools through authenticated Streamable HTTP. In that mode:

- the DuckDB cache and provider configuration belong to the machine/container running the SendLens process;
- one process serves one configured workspace, not separate users or tenants;
- every MCP `POST`, `GET`, and `DELETE` requires a deployment-scoped bearer credential; browser preflight is limited by Host/Origin policy;
- exact Host and optional Origin allowlists constrain the network boundary;
- public deployments require HTTPS termination outside SendLens;
- connection state is in memory and is lost on restart; and
- tool results leave the server for the authenticated MCP client and may then enter that client's AI/model context.

The unauthenticated `/health` route exposes only a static status, plugin version, and transport name. It does not read provider data or reveal credential, workspace, cache, or connection state. See [Streamable HTTP transport](./HTTP_TRANSPORT.md) for the complete operator contract.

## What Does Not Leave The Runtime By SendLens Itself

SendLens does not need to upload the DuckDB cache to an Orchid service for the core workflow. The stdio runtime returns bounded JSON payloads to the local host process; an explicitly enabled HTTP runtime returns them to its authenticated remote MCP client.

Important boundary: when an AI host calls a SendLens MCP tool, the returned data becomes context for that host. Depending on the host, that context may be sent to a configured model provider. That transfer is controlled by the host and provider, not by the SendLens repository.

## What Can Leave The Machine

Data can leave the machine through these expected paths:

- Provider API requests made with the configured API key.
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

When demo mode is enabled by setup tooling, production provider credentials are optional for the demo path and outputs must stay clearly labeled as synthetic. Demo data is useful for install proof and examples, not for customer or workspace conclusions. The demo includes provider-qualified Instantly and Smartlead fixture rows plus synthetic Smart Delivery evidence; all values are public-safe placeholders.

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

- Exact: campaign, account, step, variant, tag, reply, and provider capability API surfaces when present locally.
- Sampled: non-reply lead evidence and sampled payload variables.
- Hybrid: semantic views that combine exact aggregates with sampled evidence.
- Reconstructed: outbound copy rendered locally from templates and stored variables.
- Fetched: exact inbound reply body text only after `prepare_campaign_analysis` or `fetch_reply_text` writes it into local DuckDB.

When evidence is missing, say what is missing. For example, empty inbox-placement tables mean no local inbox-placement evidence was available; they do not prove sender health is clean.

For Smartlead, empty Smart Delivery rows can mean no tests or support-gated access. Read `provider_capabilities`; absence never proves placement is healthy.
