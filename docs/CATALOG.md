# SendLens Component Catalog

SendLens is a local-first analysis plugin for Instantly workspaces. The public surface is built from skills, host commands, specialist agents, MCP tools, local scripts, and generated host bundles.

See also: [trust and privacy](./TRUST_AND_PRIVACY.md), [skill docs](./skills/README.md), [synthetic example outputs](./examples/SYNTHETIC_OUTPUTS.md), and [operator memory](./operator-memory/README.md).

## Workflow Map

| Workflow | Skills | Commands | Agents | MCP tools | Scripts and generated surfaces |
| --- | --- | --- | --- | --- | --- |
| Setup and refresh | [sendlens-setup](./skills/sendlens-setup.md), [workspace-health](./skills/workspace-health.md) | `/sendlens-setup`, `/workspace-health` | `workspace-triager` | `refresh_status`, `refresh_data`, `workspace_snapshot` | `sendlens-doctor.sh`, `start-mcp.sh`, `session-start.sh`, `load-env.sh`, `check-env.sh`; generated Claude Code, Cursor, Codex, and OpenCode bundles |
| Workspace triage | [workspace-health](./skills/workspace-health.md), [campaign-performance](./skills/campaign-performance.md), [account-manager-brief](./skills/account-manager-brief.md) | `/workspace-health`, `/campaign-performance`, `/account-manager-brief` | `workspace-triager`, `campaign-analyst`, `synthesis-reviewer` | `workspace_snapshot`, `analysis_starters`, `analyze_data`, `search_catalog` | `benchmark-fast-refresh.sh`; host session-start refresh hook |
| One-campaign diagnosis | [campaign-performance](./skills/campaign-performance.md), [campaign-launch-qa](./skills/campaign-launch-qa.md), [experiment-planner](./skills/experiment-planner.md) | `/campaign-performance`, `/campaign-launch-qa`, `/experiment-planner` | `campaign-analyst`, `synthesis-reviewer` | `load_campaign_data`, `analysis_starters`, `analyze_data`, `list_columns` | runtime build from `npm run build:plugin`; host bundles from `npm run build:hosts` |
| Copy and personalization | [copy-analysis](./skills/copy-analysis.md), [cold-email-best-practices](./skills/cold-email-best-practices.md) | `/copy-analysis`, `/cold-email-best-practices` | `copy-auditor`, `synthesis-reviewer` | `load_campaign_data`, `analysis_starters`, `analyze_data`, `list_columns` | sampled/reconstructed outbound surfaces in the local cache |
| ICP and segmentation | [icp-signals](./skills/icp-signals.md) | `/icp-signals` | `icp-auditor`, `synthesis-reviewer` | `load_campaign_data`, `analysis_starters`, `analyze_data`, `search_catalog` | `lead_payload_kv` view for campaign-scoped payload analysis |
| Reply outcomes | [reply-patterns](./skills/reply-patterns.md) | `/reply-patterns` | `reply-auditor`, `synthesis-reviewer` | `fetch_reply_text`, `load_campaign_data`, `analysis_starters`, `analyze_data` | on-demand reply hydration into local DuckDB |

## Skills

Runtime skill files live in `skills/<skill>/SKILL.md`. Public skill docs live under [docs/skills](./skills/README.md).

| Skill | Use it for | Evidence posture |
| --- | --- | --- |
| [sendlens-setup](./skills/sendlens-setup.md) | First-run setup, doctor checks, host bundle verification, and demo-mode guidance | Operational checks only; suppresses secrets and labels demo evidence synthetic |
| [workspace-health](./skills/workspace-health.md) | Broad health checks, reply-rate diagnosis, account quality, and next actions | Exact aggregate metrics first; sampled lead evidence only when called out |
| [campaign-performance](./skills/campaign-performance.md) | Campaign comparisons, step/variant ranking, runway, and prioritization | Exact campaign/account/step metrics when available; explicit metric basis for sequence ranking |
| [copy-analysis](./skills/copy-analysis.md) | Subject/body critique, template structure, personalization QA, and rewrite guidance | Intended templates plus locally reconstructed outbound samples; not exact delivered email text |
| [icp-signals](./skills/icp-signals.md) | Campaign-scoped segment hypotheses and payload-variable patterns | Exact campaign baselines plus sampled lead/payload evidence |
| [reply-patterns](./skills/reply-patterns.md) | Positive, negative, neutral, and fetched reply-body pattern analysis | Instantly reply outcomes by default; exact reply body text only after `fetch_reply_text` |
| [cold-email-best-practices](./skills/cold-email-best-practices.md) | Policy and benchmark lens for campaign recommendations | Operator rules; not a substitute for workspace evidence |
| [campaign-launch-qa](./skills/campaign-launch-qa.md) | Launch, scale, resume, clone, and handoff readiness | Checklist over sender inventory, lead supply, templates, tracking, schedule, and health |
| [experiment-planner](./skills/experiment-planner.md) | Next test selection, hypothesis, metrics, guardrails, and stop conditions | Requires evidence basis: exact, sampled, fetched, reconstructed, or operator judgment |
| [account-manager-brief](./skills/account-manager-brief.md) | Client-safe updates, daily action queues, and risk summaries | Separates internal action priority from client-facing wording |

## Commands

Commands are host entry points in `commands/*.md`. Most route to a specialist agent and activate the matching skill.

| Command | Argument hint | Default agent | Notes |
| --- | --- | --- | --- |
| `/sendlens-setup` | none | `sendlens-setup` | Runs first-run setup and doctor checks before analysis |
| `/workspace-health` | `[campaign-name-or-instantly-tag]` | `workspace-triager` | First stop for broad workspace diagnosis |
| `/campaign-performance` | `[campaign-name] [instantly-tag]` | `campaign-analyst` | Ranks campaigns, steps, variants, runway, and sequence fatigue |
| `/copy-analysis` | `[campaign-name] [instantly-tag]` | `copy-auditor` | Scopes to one campaign before copy and personalization analysis |
| `/icp-signals` | `[campaign-name] [instantly-tag]` | `icp-auditor` | Uses campaign payload keys instead of assuming global enrichment columns |
| `/reply-patterns` | `[campaign-name] [instantly-tag]` | `reply-auditor` | Separates human reply outcomes before theme synthesis |
| `/cold-email-best-practices` | none | host default | Applies policy rules such as reply-rate focus, tracking caution, and bounce thresholds |
| `/campaign-launch-qa` | `[campaign-name]` | `campaign-analyst` | Returns blockers first, then warnings, ready checks, and next actions |
| `/experiment-planner` | `[campaign-name-or-instantly-tag]` | `campaign-analyst` | Produces hypothesis, change, metric, guardrail, and stop condition |
| `/account-manager-brief` | `[campaign-name-or-instantly-tag]` | `workspace-triager` | Produces client-safe update plus internal action queue |

## Agents

Agents are read-only specialist prompts in `agents/*.md`. They deny file edits and shell access, and they use only SendLens MCP tools.

| Agent | Role | Primary tools |
| --- | --- | --- |
| `workspace-triager` | Rank workspace health and choose the next campaign to inspect | `workspace_snapshot`, `analysis_starters`, `analyze_data`, `refresh_status` |
| `campaign-analyst` | Analyze one hydrated campaign and identify winners, failures, and tests | `load_campaign_data`, `analysis_starters`, `analyze_data`, `list_columns`, `search_catalog` |
| `copy-auditor` | Inspect templates, reconstructed copy, and personalization quality | `load_campaign_data`, `analysis_starters`, `analyze_data`, `list_columns` |
| `icp-auditor` | Inspect campaign lead evidence and payload fields for segment signals | `load_campaign_data`, `analysis_starters`, `analyze_data`, `list_columns`, `search_catalog` |
| `reply-auditor` | Separate positive, negative, and neutral reply cohorts | `load_campaign_data`, `analysis_starters`, `analyze_data`, `list_columns` |
| `synthesis-reviewer` | Remove unsupported claims and tighten next actions | `analysis_starters`, `analyze_data` |

## MCP Tools

MCP tools are registered by the local `sendlens` stdio server. Responses are JSON in MCP text content for host compatibility. The detailed response contract is in the existing [MCP response contract](./MCP_RESPONSE_CONTRACT.md).

| Tool | Purpose | When to use |
| --- | --- | --- |
| `refresh_status` | Read local refresh lifecycle state | Stale data, startup refresh, or cache-readiness questions |
| `refresh_data` | Refresh local cache from Instantly | Explicit fresh pull, client/workspace change, or stale/failed status |
| `workspace_snapshot` | First high-level read of a workspace, tag, or campaign-name scope | Broad triage and campaign selection |
| `load_campaign_data` | Hydrate one campaign for copy, ICP, reply, or next-test analysis | After selecting a campaign |
| `fetch_reply_text` | Fetch exact inbound reply body text for one campaign into local DuckDB | Only when actual reply wording is needed |
| `analysis_starters` | Return curated SQL recipes and exactness notes | Before custom analysis for common questions |
| `list_tables` | List public SendLens tables/views and descriptions | Schema orientation |
| `list_columns` | List columns and DuckDB types for one table/view | Before custom SQL |
| `search_catalog` | Search public schema names by concept | When the right table or column is unclear |
| `analyze_data` | Run guarded read-only DuckDB `SELECT`/`WITH` analysis | Focused questions after schema and filters are clear |

## Public Data Surfaces

The local schema exposes exact aggregate tables and semantic analysis views. Common surfaces:

| Surface | Classification | Use |
| --- | --- | --- |
| `campaigns`, `campaign_analytics`, `campaign_daily_metrics`, `step_analytics`, `campaign_variants` | Exact Instantly-derived campaign surfaces | Campaign, step, variant, template, and daily performance analysis |
| `accounts`, `account_daily_metrics`, `campaign_accounts` | Exact or resolved sender/account surfaces | Account health, sender coverage, and capacity checks |
| `custom_tags`, `custom_tag_mappings`, `campaign_tags`, `account_tags` | Exact tag surfaces | Campaign and sender scoping |
| `inbox_placement_tests`, `inbox_placement_analytics` | Exact when available from Instantly | Inbox placement and authentication evidence |
| `inbox_placement_test_overview`, `sender_deliverability_health` | Semantic rollups over inbox placement data | Deliverability diagnosis with availability caveats |
| `campaign_overview` | Semantic campaign rollup | Default campaign ranking and health view |
| `lead_evidence`, `lead_payload_kv` | Sampled lead and campaign-payload evidence | ICP and lead-variable hypotheses |
| `reply_context`, `reply_emails` | Reply outcome context and fetched exact reply rows | Reply cohort analysis and exact reply-body analysis when hydrated |
| `rendered_outbound_context` | Locally reconstructed outbound context | Personalization QA and copy analysis, not byte-for-byte delivered email |

## Scripts

Scripts live in `scripts/` and support local runtime setup, startup refresh, development checks, benchmarks, and tests.

| Script | Purpose |
| --- | --- |
| `load-env.sh` | Load `.env`, `.env.local`, and optional client overlays |
| `sendlens-doctor.sh` | Run first-run diagnostics for env, runtime dependencies, local state, refresh status, locks, and generated host bundles without printing secrets |
| `start-mcp.sh` | Start the compiled SendLens MCP server |
| `session-start.sh` | Run the background session-start refresh hook |
| `check-env.sh` | Verify API key, Node.js, build entry, and local cache path |
| `bootstrap-runtime.sh` | Install or repair runtime dependencies needed for local execution |
| `benchmark-fast-refresh.sh` | Benchmark startup refresh behavior |
| `test-*.mjs` | Validate SQL guardrails, cache locking, sampling, template rendering, local runtime behavior, and reply hydration contracts |

## Generated Host Surfaces

The plugin is authored once and generated into host-native bundles with Pluxx.

| Target | Generated surface |
| --- | --- |
| Claude Code | Skills, commands, agents, instructions, MCP server config, session-start hook |
| Cursor | Skills, commands, agents, instructions, MCP server config, session-start hook |
| Codex | Skills, commands, agents, instructions, MCP server config, session-start hook |
| OpenCode | Skills, commands, agents, instructions, MCP server config, session-start hook |

The generated bundles preserve the same operating model: read-only Instantly access, local DuckDB cache, bounded MCP outputs, and one-campaign-at-a-time deep analysis.
