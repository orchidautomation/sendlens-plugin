# SendLens Component Catalog

SendLens is a local-first analysis plugin for outbound workspaces. Instantly remains the shipped full provider; Smartlead V1 support is read-only and provider-qualified where implemented.

See also: [trust and privacy](./TRUST_AND_PRIVACY.md), [skill docs](./skills/README.md), [synthetic example outputs](./examples/SYNTHETIC_OUTPUTS.md), and [operator memory](./operator-memory/README.md).

## Workflow Map

| Workflow | Public skill | Commands | Agents | MCP tools | Scripts and generated surfaces |
| --- | --- | --- | --- | --- | --- |
| Setup and refresh | [sendlens-setup](./skills/sendlens-setup.md) | `/sendlens-setup` | host default | `setup_doctor`, `refresh_status`, `refresh_data`, `workspace_snapshot` | `sendlens-doctor.sh`, `start-mcp.sh`, `session-start.sh`, `load-env.sh`, `check-env.sh`; generated Claude Code, Cursor, Codex, and OpenCode bundles |
| Workspace triage and campaign diagnosis | [sendlens-analyst](./skills/sendlens-analyst.md) | `/sendlens-analyst`, `/workspace-health`, `/campaign-performance` | `workspace-triager`, `campaign-analyst`, `synthesis-reviewer` | `workspace_snapshot`, `load_campaign_data`, `prepare_campaign_analysis`, `analysis_starters`, `analyze_data` | benchmark and host session-start refresh |
| Reply, ICP, and copy intelligence | [sendlens-analyst](./skills/sendlens-analyst.md) | `/reply-patterns`, `/icp-signals`, `/copy-analysis` | `reply-auditor`, `icp-auditor`, `copy-auditor` | `prepare_campaign_analysis`, `fetch_reply_text`, `load_campaign_data`, `analysis_starters`, `analyze_data` | hydrated replies, payload views, and reconstructed outbound surfaces |
| Campaign strategy | [sendlens-campaign-strategist](./skills/sendlens-campaign-strategist.md) | `/sendlens-campaign-strategist`, `/experiment-planner` | `campaign-strategist`, `synthesis-reviewer` | validated analyst evidence | audience, exclusions, offer, angle, sequence architecture, and experiment hypothesis |
| Evidence-backed copy | [sendlens-copywriter](./skills/sendlens-copywriter.md) | `/sendlens-copywriter`, `/cold-email-best-practices` | `campaign-copywriter`, `copy-auditor`, `synthesis-reviewer` | validated strategy, templates, replies, payload, and reconstructed-copy evidence | subjects, bodies, CTAs, sequence, variants, claim ledger, and rendering requirements |
| Launch, scale, and learning handoff | [sendlens-launch-operator](./skills/sendlens-launch-operator.md) | `/sendlens-launch-operator`, `/campaign-launch-qa`, `/account-manager-brief` | `launch-operator`, `campaign-analyst`, `workspace-triager` | launch, campaign, sender, and evidence recipes | blocker matrix, operating thresholds, learning record, and client-safe briefing output |

## Skills

Runtime skill files live in `skills/<skill>/SKILL.md`. SendLens exposes five focused public skills; the analyst orchestrates the full chain for broad requests. Public docs live under [docs/skills](./skills/README.md).

| Skill | Use it for | Evidence posture |
| --- | --- | --- |
| [sendlens-analyst](./skills/sendlens-analyst.md) | Performance, deliverability, reply, ICP, and copy diagnosis plus broad full-chain orchestration | Owns the shared exact, sampled, reconstructed, fetched, inferred, and unsupported evidence contract |
| [sendlens-campaign-strategist](./skills/sendlens-campaign-strategist.md) | Campaign audience, exclusions, offer, angle, sequence architecture, personalization, and experiment strategy | Consumes validated findings and preserves evidence conflicts and proof boundaries |
| [sendlens-copywriter](./skills/sendlens-copywriter.md) | Evidence-backed subjects, bodies, CTAs, follow-ups, sequences, and meaningful variants | Keeps every claim inside the validated strategy and records rendering requirements |
| [sendlens-launch-operator](./skills/sendlens-launch-operator.md) | Launch/scale QA, measurement, stop/scale rules, and learning/client handoff | Requires exact readiness evidence plus explicitly sampled personalization QA |
| [sendlens-setup](./skills/sendlens-setup.md) | First-run setup, doctor checks, host bundle verification, and zero-key demo seeding | Suppresses secrets and seeds only public-safe demo evidence when no key/cache exists |

## Commands

Commands are host entry points in `commands/*.md`. Each public skill has an explicit command; legacy workflow commands remain backward-compatible shortcuts into the owning skill and specialist agent.

| Command | Argument hint | Default agent | Notes |
| --- | --- | --- | --- |
| `/sendlens-analyst` | `[question, campaign, provider, or tag]` | `campaign-analyst` | Diagnosis plus automatic downstream orchestration for broad requests |
| `/sendlens-campaign-strategist` | `[validated-findings-or-campaign]` | `campaign-strategist` | Audience, exclusions, offer, angle, sequence, and experiment strategy |
| `/sendlens-copywriter` | `[approved-strategy-or-campaign]` | `campaign-copywriter` | Evidence-backed sequence and meaningful copy variants |
| `/sendlens-launch-operator` | `[campaign-or-approved-package]` | `launch-operator` | Readiness, configuration, measurement, stop/scale, and learning handoff |
| `/sendlens-setup` | none | `sendlens-setup` | Runs first-run setup, doctor checks, and zero-key demo seeding before analysis |
| `/workspace-health` | `[campaign-name-or-instantly-tag]` | `workspace-triager` | First stop for broad workspace diagnosis |
| `/campaign-performance` | `[campaign-name] [instantly-tag]` | `campaign-analyst` | Ranks campaigns, steps, variants, runway, and sequence fatigue |
| `/copy-analysis` | `[campaign-name] [instantly-tag]` | `copy-auditor` | Scopes to one campaign before copy and personalization analysis |
| `/icp-signals` | `[campaign-name] [instantly-tag]` | `icp-auditor` | Uses campaign payload keys instead of assuming global uploaded-metadata columns |
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
| `campaign-strategist` | Convert validated findings into campaign strategy and experiment hypothesis | `load_campaign_data`, `prepare_campaign_analysis`, `analysis_starters`, `analyze_data` |
| `campaign-copywriter` | Draft evidence-backed sequences and meaningful variants | `load_campaign_data`, `analysis_starters`, `analyze_data`, `list_columns` |
| `launch-operator` | Gate readiness and define measurement, decision rules, and learning handoff | `load_campaign_data`, `prepare_campaign_analysis`, `analysis_starters`, `analyze_data`, `refresh_status` |
| `copy-auditor` | Inspect templates, reconstructed copy, and personalization quality | `load_campaign_data`, `analysis_starters`, `analyze_data`, `list_columns` |
| `icp-auditor` | Inspect campaign lead evidence and payload fields for segment signals | `load_campaign_data`, `analysis_starters`, `analyze_data`, `list_columns`, `search_catalog` |
| `reply-auditor` | Separate positive, negative, and neutral reply cohorts | `load_campaign_data`, `analysis_starters`, `analyze_data`, `list_columns` |
| `synthesis-reviewer` | Remove unsupported claims and tighten next actions | `analysis_starters`, `analyze_data` |

## MCP Tools

MCP tools are registered by the local `sendlens` stdio server. Responses are JSON in MCP text content for host compatibility. The detailed response contract is in the existing [MCP response contract](./MCP_RESPONSE_CONTRACT.md).

| Tool | Purpose | When to use |
| --- | --- | --- |
| `setup_doctor` | Read setup readiness without shell commands | First run, missing key diagnosis, local cache readiness, stale refresh state |
| `seed_demo_workspace` | Seed synthetic provider-aware proof data for demo or recovery | No usable API key, failed credential validation, or an explicit request for demo/sample data |
| `refresh_status` | Read local refresh lifecycle state | Stale data, startup refresh, or cache-readiness questions |
| `refresh_data` | Refresh local cache from the configured source provider | Explicit fresh pull, client/workspace change, provider-scoped refresh, or stale/failed status |
| `workspace_snapshot` | First high-level read of a workspace, provider, tag, or campaign-name scope | Broad triage, provider-scoped/all-provider reads, and campaign selection |
| `load_campaign_data` | Hydrate one campaign for copy, ICP, reply, or next-test analysis | After selecting a campaign |
| `prepare_campaign_analysis` | Hydrate enough exact reply bodies and backfilled lead context for premium one-campaign diagnosis | Before working/not-working, reply-quality, winner, scale, or kill claims |
| `fetch_reply_text` | Fetch exact inbound reply body text for one campaign into local DuckDB | Only when actual reply wording is needed |
| `analysis_starters` | Return curated SQL recipes and exactness notes | Before custom analysis for common questions |
| `list_tables` | List public SendLens tables/views and descriptions | Schema orientation |
| `list_columns` | List columns and DuckDB types for one table/view | Before custom SQL |
| `search_catalog` | Search public schema names by concept, with partial matches and workflow starter hints | When the right table, column, or starter recipe is unclear |
| `analyze_data` | Run guarded read-only DuckDB `SELECT`/`WITH` analysis | Focused questions after schema and filters are clear |

## Public Data Surfaces

The local schema exposes exact aggregate tables and semantic analysis views. Common surfaces:

| Surface | Classification | Use |
| --- | --- | --- |
| `campaigns`, `campaign_analytics`, `campaign_daily_metrics`, `step_analytics`, `campaign_variants` | Exact provider-qualified campaign surfaces where available | Campaign, step, variant, template, tracking/deliverability settings, provider dimensions, and daily performance analysis |
| `accounts`, `account_daily_metrics`, `campaign_accounts` | Exact or resolved sender/account surfaces | Account health, sender coverage, and capacity checks |
| `custom_tags`, `custom_tag_mappings`, `campaign_tags`, `account_tags` | Exact tag surfaces | Campaign and sender scoping |
| `inbox_placement_tests`, `inbox_placement_analytics` | Exact when available from Instantly | Inbox placement and authentication evidence |
| `inbox_placement_test_overview`, `sender_deliverability_health` | Semantic rollups over inbox placement data | Deliverability diagnosis with availability caveats |
| `smartlead_delivery_tests`, `smartlead_delivery_evidence` | Exact support-gated Smart Delivery definitions, aggregates, and diagnostics | Smartlead placement, sender, authentication, and blacklist evidence without fake per-email rows |
| `smartlead_delivery_test_overview`, `smartlead_sender_delivery_health`, `smartlead_delivery_authentication_health` | Semantic Smart Delivery views | Provider-specific Smartlead deliverability diagnosis |
| `campaign_overview` | Semantic campaign rollup | Default campaign ranking, tracking/deliverability settings, and health view |
| `lead_evidence`, `lead_payload_kv` | Sampled lead and campaign-payload evidence | ICP and lead-variable hypotheses |
| `provider_capabilities` | Provider capability status | Explain supported, partial, or support-gated provider surfaces such as Smartlead Smart Delivery |
| `provider_overlap_risk`, `provider_overlap_risk_details` | Sampled cross-provider overlap primitives | Find duplicate normalized email, domain, or company exposure across providers within the unsafe window |
| `reply_context`, `reply_email_context`, `reply_emails` | Reply outcome context, email-anchored fetched reply context, and fetched exact reply rows | Reply cohort analysis and exact reply-body analysis when hydrated |
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

The generated bundles preserve the same operating model: read-only provider access, local DuckDB cache, bounded MCP outputs, provider-qualified campaign evidence, and one-campaign-at-a-time deep analysis.
