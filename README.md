# SendLens

Privacy-first Instantly analysis that runs on the user's machine.

SendLens is the missing reasoning layer on top of Instantly.

It gives Claude Code, Cursor, Codex, and OpenCode agentic access to your campaign, lead, template, and analytics data so you can see:

- what is actually landing with prospects
- which campaigns and sequences are producing positive replies
- which lead variables and segments correlate with good outcomes
- what to change next to improve performance

It is designed to be fast, local, and safe by default:

- read-only against Instantly
- local DuckDB cache
- campaign-scoped analysis by default
- raw `custom_payload` preserved per lead
- fast startup refresh on every new session

## Repo Layout

This repo is the canonical open-source home for SendLens.

- `plugin/` contains the MCP runtime, local DuckDB cache logic, and host-native plugin behavior
- `site/` contains the public landing page, waitlist flow, and install-command funnel

`json-render-lab` is legacy/internal history and is no longer the canonical home for SendLens.

## Why SendLens Exists

No other tool gives you agentic reasoning over your Instantly data in a way that is fast, private, and actually useful day to day.

Instantly has the signal, but it does not give you a clean local reasoning layer for questions like:

- what copy is really working
- what kinds of leads are replying positively
- what segments are getting ignored or bouncing
- what should we test next to get more positive replies

SendLens gives you:

- a normalized local warehouse
- exact campaign and step analytics
- reconstructed rendered copy from templates plus lead variables
- campaign-specific payload analysis without hardcoding every enrichment field
- host-native workflows across Claude Code, Cursor, Codex, and OpenCode

The unlock is simple: you can finally reason across all of your Instantly data with an agent and get usable answers about what is landing, who is responding, and how to improve.

## What It Enables

SendLens is optimized for questions like:

- "What campaigns are performing best and worst right now?"
- "What is common among positive responders in this campaign?"
- "Which variables are showing up in winning leads for this sequence?"
- "Show me the reconstructed step copy that a replied lead saw."
- "Compare two campaigns without conflating their payload schema."

In practice, that means:

- faster diagnosis of underperforming campaigns
- clearer visibility into what messaging lands with real prospects
- better segmentation decisions from the data already living in Instantly
- a much tighter feedback loop between sending, learning, and improving

It is intentionally not overfit to any single client. Stable Instantly fields are first-class columns; arbitrary campaign-specific variables stay in raw `custom_payload` and are analyzed after scoping to one campaign.

## Download And Install

Latest release:

- [Latest release page](https://github.com/orchidautomation/sendlens-plugin/releases/latest)

Copy-paste installers:

Claude Code

```bash
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-claude-code.sh | bash
```

Cursor

```bash
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-cursor.sh | bash
```

Codex

```bash
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-codex.sh | bash
```

OpenCode

```bash
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-opencode.sh | bash
```

All supported hosts

```bash
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-all.sh | bash
```

Direct bundle downloads:

- [Claude Code bundle](https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/sendlens-claude-code-latest.tar.gz)
- [Cursor bundle](https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/sendlens-cursor-latest.tar.gz)
- [Codex bundle](https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/sendlens-codex-latest.tar.gz)
- [OpenCode bundle](https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/sendlens-opencode-latest.tar.gz)

More detail:

- [Install guide](./docs/INSTALL.md)
- [Troubleshooting guide](./docs/TROUBLESHOOTING.md)
- [Release guide](./docs/RELEASING.md)

## How It Works

```text
Instantly API
   |
   v
session-start refresh
   |
   v
local DuckDB cache
   |
   +-- exact layer
   |    campaigns
   |    campaign_analytics
   |    step_analytics
   |    campaign_variants
   |    accounts
   |    account_daily_metrics
   |    custom_tags
   |    custom_tag_mappings
   |
   +-- evidence layer
        sampled_leads
        sampled_outbound_emails
        sampling_runs
```

The refresh path is optimized around speed and useful coverage:

- exact campaign and step analytics are always pulled
- templates are always pulled
- full reply-signal leads are kept
- bounded non-reply samples are kept
- copy is reconstructed locally from templates plus lead variables

## Local-First Privacy Model

SendLens is intentionally privacy-first.

- It reads from Instantly using a user-provided API key.
- It stores analysis state locally in DuckDB.
- It does not require a shared cloud warehouse for the core workflow.
- It keeps campaign-specific variables in per-lead `custom_payload` instead of flattening private enrichment into a universal schema.

Default local state:

- DuckDB: `~/.sendlens/workspace-cache.duckdb`
- refresh status: `~/.sendlens/refresh-status.json`
- session-start logs: `~/.sendlens/session-start-refresh.log`

## Core Analysis Surfaces

Main MCP tools:

- `workspace_snapshot`
- `analysis_starters`
- `analyze_data`
- `refresh_status`
- `refresh_data`
- `load_campaign_data`

Preferred warehouse surfaces:

- `campaign_overview`
- `lead_evidence`
- `reply_context`
- `rendered_outbound_context`
- `campaign_tags`
- `account_tags`

Key design rule:

- workspace-level ranking is fine
- deeper analysis should usually scope to one campaign at a time

## Campaign Payload Model

SendLens treats Instantly data in two layers:

- stable Instantly-native lead fields become first-class columns
- campaign-specific variables stay inside raw `custom_payload`

That means Campaign A and Campaign B can use completely different variables without schema conflict. Analysis should:

1. pick a campaign
2. inspect which payload keys exist in that campaign
3. group or compare within that campaign

This keeps the warehouse portable across many customers instead of overfitting to today's campaigns.

## Specialist Analysis Flow

The plugin also ships specialist reviewers so the host can split campaign analysis cleanly when needed:

- `workspace-triager`
- `campaign-analyst`
- `copy-auditor`
- `icp-auditor`
- `reply-auditor`
- `synthesis-reviewer`

The intended flow is:

1. triage the workspace
2. choose a campaign
3. hydrate that campaign's evidence
4. run specialist analysis
5. synthesize the result

## Developer Quickstart

```bash
git clone https://github.com/orchidautomation/sendlens-plugin.git
cd sendlens-plugin
npm install
cp .env.example .env
```

Set at least:

```bash
SENDLENS_INSTANTLY_API_KEY=your_key
```

Then:

```bash
npm run test:plugin
pluxx validate
pluxx build --target claude-code cursor codex opencode
pluxx install --target claude-code cursor codex opencode --trust
```

Landing page:

```bash
npm run site:install
npm run site:dev
```

Useful commands:

```bash
npm run build:plugin
npm run refresh:plugin
npm run benchmark:fast-sync
npm run ci:plugin
pluxx verify-install --target claude-code cursor codex opencode
```

## Client-Scoped Env Support

Env loading order already supports named client overlays:

1. `.env`
2. `.env.local`
3. `.env.clients/<client>.env`
4. `.env.clients/<client>.local.env`

Example:

Use `SENDLENS_CLIENT` when you want to load a client-specific env overlay.

This is the beginning of multi-client support. See [SEND-134](https://linear.app/orchid-automation/issue/SEND-134/design-multi-client-sendlens-architecture-with-named-workspaces-per) for the next architecture step around named clients, per-client DBs, and MCP-native client switching.

## Documentation

- [Install guide](./docs/INSTALL.md)
- [Troubleshooting guide](./docs/TROUBLESHOOTING.md)
- [Release guide](./docs/RELEASING.md)
- [Brand assets](./assets/README.md)
