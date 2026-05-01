# SendLens

SendLens is the reasoning layer over Instantly data. It runs read-only, stores data locally, and gives the host a clean way to understand what is landing, who is replying, and what to change next.

## Client Env Support

- Base env files: `.env`, `.env.local`
- Client env files: `.env.clients/<client>.env`, `.env.clients/<client>.local.env`
- Select a client profile by setting `SENDLENS_CLIENT=<client>`
- Override the client env directory with `SENDLENS_CLIENTS_DIR=<path>`

## Workflow Guidance

- `workspace-health`: Use for broad health checks, reply-rate diagnosis, account quality, and "what changed?" questions.
- `campaign-performance`: Use for campaign comparisons, step analysis, variant ranking, and prioritization.
- `copy-analysis`: Use for subject/body analysis, template review, and recommendations grounded in real replies.
- `reply-patterns`: Use for positive vs negative reply cohort analysis, intent patterns, and outcome comparisons by step or variant.
- `icp-signals`: Use for lead-segment hypotheses, campaign-variable patterns, and "who responds?" questions.
- `cold-email-best-practices`: Use as the policy layer when recommending changes or critiquing copy and setup.

## Tool Routing

- If the user mentions `SendLens`, the plugin name, the Instantly workspace, campaign performance, replies, copy health, or asks to "pull my data", do not freeform first. Start with SendLens tools immediately.
- Session start already triggers a fresh local refresh of actively sending campaigns. That startup path is intentionally lean: exact analytics, templates, and a sampled lead evidence layer with full replied leads plus bounded non-reply leads. Call `refresh_data` again only when the user explicitly asks for another fresh pull or switches clients.
- When SendLens MCP tools are available, use those tools as the whole working surface. Do not inspect local files, `refresh-status.json`, DuckDB tables via shell, or repo source files as a substitute for tool calls.
- `workspace_snapshot`: First read after refresh or for broad workspace questions. This is the default first call for "pull my data", "what's happening?", "what's working?", and "give me the snapshot".
- `refresh_status`: Use when the user asks what startup refresh is doing, whether the cache is current, or why data looks incomplete or stale.
- `load_campaign_data`: Use when the user narrows to one campaign and wants copy analysis, ICP analysis, reply outcome analysis, or reconstructed outbound for that campaign. Prefer this over a workspace-wide `refresh_data` call.
- `analysis_starters`: First stop for common workspace-health, campaign, copy, reply, ICP, or tag-filter questions before writing custom analysis.
- `list_tables`, `list_columns`, `search_catalog`: Use when the user asks for custom breakdowns and you need schema discovery.
- `analyze_data`: Use for follow-up analysis once the schema and question are clear.

## Agent Map

When the host supports native delegated agents, use these specialist reviewers:

- `workspace-triager`
  rank the workspace and choose the next one campaign to analyze
- `campaign-analyst`
  run one-campaign diagnosis after hydrating that campaign
- `copy-auditor`
  inspect templates and reconstructed copy for one campaign
- `icp-auditor`
  inspect one campaign's lead payloads, segments, and enrichment fields
- `reply-auditor`
  inspect one campaign's positive, negative, and neutral reply outcomes
- `synthesis-reviewer`
  compress and pressure-test the final answer before returning it

If the host does not expose native delegated agents, preserve the same one-campaign-at-a-time separation in the working plan.

## Preferred Query Surfaces

- Prefer `campaign_overview` for campaign ranking, health, sample coverage, and "what is working?" analysis. It is the main semantic rollup.
- Broad workspace and tag-scoped reads should default to active campaigns only. Only include inactive, paused, completed, or purely historical campaigns when the user explicitly asks for them.
- For deep analysis, prefer one campaign at a time. Use workspace-level views only to rank or choose campaigns, then move to `load_campaign_data(campaign_id=...)` before doing detailed copy, reply, or ICP analysis.
- Prefer `reply_context` for positive/negative cohort analysis and "what copy got responses?" because it joins replied leads back to template context and locally reconstructed copy.
- Prefer `rendered_outbound_context` when the user wants to inspect reconstructed lead-level copy or personalization QA. It is not exact delivered email text.
- Prefer `lead_evidence` for ICP analysis because it carries campaign-scoped lead payloads, stable Instantly lead fields, reply signals, and the preserved raw JSON payload.
- Prefer `campaign_tags` and `account_tags` over raw tag joins when the user wants client/tag scoping.

## Operating Rules

- Treat campaign and account headline metrics as exact only when they come from `campaign_analytics`, `step_analytics`, `campaigns`, or `account_daily_metrics`.
- Treat `custom_tags` and `custom_tag_mappings` as the exact tag-filter layer. Use them to scope analyses by campaign or sampled lead tags.
- Treat `lead_evidence`, `reply_context`, and `rendered_outbound_context` as the preferred semantic evidence layer.
- Treat `sampled_leads` and `sampled_outbound_emails` as storage tables behind that layer. Never project full-population totals from sampled raw rows.
- Reply outcome labels come from Instantly lead state, primarily `lt_interest_status` and related lead metadata. Do not invent sentiment labels from reply text in V1.
- In V1, do not imply we have exact inbound reply text unless the user explicitly ran a fallback email/thread fetch. Default to Instantly reply outcomes and reconstructed copy.
- Use `campaign_variants` as the source of truth for intended copy templates and `rendered_outbound_context` to verify how those templates render against stored lead variables.
- Replied leads are intentionally kept in full whenever they can be resolved from the campaign lead feed. Non-reply leads are bounded locally.
- `custom_payload` is preserved per lead as raw JSON text. Do not assume payload keys are shared across campaigns or customers. For campaign-specific variable analysis, scope to one campaign first and then query `custom_payload` with DuckDB JSON functions.
- Call out coverage limitations explicitly when raw evidence was sampled.

## Delegation Shape

The expected flow is:

1. use `workspace-triager` or `campaign_overview` to pick the campaign
2. load one campaign with `load_campaign_data`
3. use `campaign-analyst`, `copy-auditor`, `icp-auditor`, or `reply-auditor` as needed
4. use `synthesis-reviewer` to compress the result if the analysis is broad

Do not fan out multiple campaign specialists until the workspace-level triage identifies which campaigns are worth the extra work.
