# SendLens

SendLens is the reasoning layer over Instantly data. It runs read-only, stores data locally, and gives the host a clean way to understand what is landing, who is replying, and what to change next.

## Client Env Support

- Base env files: `.env`, `.env.local`
- Client env files: `.env.clients/<client>.env`, `.env.clients/<client>.local.env`
- Select a client profile by setting `SENDLENS_CLIENT=<client>`
- Override the client env directory with `SENDLENS_CLIENTS_DIR=<path>`

## Workflow Guidance

- `using-sendlens`: Use as the shared product behavior contract for MCP-first routing, evidence calibration, safe fallbacks, and workflow selection.
- `workspace-health`: Use for broad health checks, reply-rate diagnosis, account quality, and "what changed?" questions.
- `campaign-performance`: Use for campaign comparisons, step analysis, variant ranking, and prioritization.
- `account-manager-brief`: Use for client-safe updates, daily AM action queues, risk summaries, and "what should I tell the client?" questions.
- `campaign-launch-qa`: Use before turning on, scaling, resuming, cloning, or handing off a campaign.
- `experiment-planner`: Use for "what should we test next?", campaign improvement plans, and experiment evaluation design.
- `copy-analysis`: Use for subject/body analysis, template review, and recommendations grounded in real replies.
- `reply-patterns`: Use for positive vs negative reply cohort analysis, intent patterns, and outcome comparisons by step or variant.
- `icp-signals`: Use for lead-segment hypotheses, campaign-variable patterns, and "who responds?" questions.
- `cold-email-best-practices`: Use as the policy layer when recommending changes or critiquing copy and setup.

## Startup Operating Contract

Treat this file as the host startup bias for SendLens. The user should not need to invoke `/using-sendlens` or ask for a SendLens skill before campaign, reply, copy, ICP, deliverability, or Instantly workspace questions route through SendLens.

- For simple inventory, freshness, and status questions, call `workspace_snapshot` and `refresh_status` directly, then answer without loading extra SendLens skills.
- For diagnostic or recommendation questions, start from `workspace_snapshot`, then use `analysis_starters` for the matching topic before custom SQL.
- For winner, scale, kill, working, or client-safe claims, treat broad aggregates as triage only. Load the campaign with `load_campaign_data` before making the claim.
- For copy, reply, ICP, launch QA, and experiment planning, narrow to one campaign before deep analysis.
- Keep evidence labels honest: `exact_aggregate`, `sampled_evidence`, `reconstructed_outbound`, `hydrated_reply_body`, `inference`, or `unsupported`.
- Do not expose internal routing, skill-selection, or setup mechanics in the final answer unless the user asks. Show the evidence and answer the business question.

## Linear Planning

- For SendLens Linear board, roadmap, project, issue, subissue, label, milestone, dependency, pricing, cloud, services, or enterprise planning work, use the `sendlens-linear-planning` skill first.
- Use `linear-board-planning` underneath for reusable Linear structure rules, including labels, milestones, parent issues, subissues, dependencies, definitions of good, and sync/privacy decisions.
- Route public-safe OSS bugs, docs, tests, install issues, local runtime work, and MCP behavior to the `SendLens OSS` Linear team.
- Route pricing, customer discovery, services, cloud, enterprise, GTM, data-source expansion, and sensitive strategy to the private `SendLens` Linear team.
- Default uncertain strategy, customer context, pricing, or enterprise notes to Linear-only/private. Do not put private strategy, pricing, customer names, or enterprise notes into GitHub-synced OSS issues.

## Tool Routing

- Treat `using-sendlens` as the routing contract for SendLens product behavior. Cross-platform and cross-agent startup delivery belongs in Pluxx, not in SendLens.
- If the user mentions `SendLens`, the plugin name, the Instantly workspace, campaign performance, replies, copy health, or asks to "pull my data", do not freeform first. Start with SendLens tools immediately.
- In Codex, this `AGENTS.md` file is the always-on SendLens operating contract. For simple inventory and freshness questions such as "what campaigns do you see?" or "when was SendLens last refreshed?", do not load SendLens skills first. Call `workspace_snapshot` and `refresh_status` directly, then answer concisely. Use SendLens skills only for deeper diagnosis, copy/reply/ICP analysis, launch QA, experiment planning, setup checks, or when the user explicitly asks how to use SendLens.
- Session start already triggers a fresh local refresh of actively sending campaigns. That startup path is intentionally lean: exact analytics, templates, and a sampled lead evidence layer with full replied leads plus bounded non-reply leads. Call `refresh_data` again only when the user explicitly asks for another fresh pull or switches clients.
- Use SendLens MCP tools as the whole working surface for SendLens analysis. If those tools are missing or unavailable in the host session, stop and tell the user to reload or reinstall the SendLens plugin so the MCP server mounts correctly. Do not inspect local files, run shell setup checks such as `claude mcp list`, parse cached tool outputs with `jq`, query DuckDB through shell, read `refresh-status.json`, wait with shell commands such as `sleep`, or inspect repo source as a substitute for SendLens tool calls.
- `workspace_snapshot`: First read after refresh or for broad workspace questions. This is the default first call for "pull my data", "what's happening?", "what's working?", and "give me the snapshot".
- `refresh_status`: Use when the user asks what startup refresh is doing, whether the cache is current, or why data looks incomplete or stale.
- `load_campaign_data`: Use when the user narrows to one campaign and wants copy analysis, ICP analysis, reply outcome analysis, or reconstructed outbound for that campaign. Prefer this over a workspace-wide `refresh_data` call.
- For "what seems to be working", "winner", "scale", or client recommendation questions, broad aggregates only shortlist candidates. Before promoting a campaign as working, run `load_campaign_data` for the campaign and inspect reply quality plus the intended/reconstructed copy path.
- `analysis_starters`: First stop for common workspace-health, campaign, copy, reply, ICP, or tag-filter questions before writing custom analysis.
- For AM operating workflows, use `analysis_starters(topic="account-manager-brief")`, `analysis_starters(topic="campaign-launch-qa")`, or `analysis_starters(topic="experiment-planner")` before custom analysis.
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
- Prefer `lead_evidence` for lead-level ICP context and `lead_payload_kv` for campaign payload key/value analysis.
- Prefer `campaign_tags` and `account_tags` over raw tag joins when the user wants client/tag scoping.

## Operating Rules

- Treat campaign and account headline metrics as exact only when they come from `campaign_analytics`, `step_analytics`, `campaigns`, or `account_daily_metrics`.
- Keep campaign-level ranking on `campaign_analytics.reply_count_unique` and derived campaign reply rate when available. Do not assume step-level `unique_replies` has the same coverage.
- Treat high reply rate, opp count, or rank as a metric lead, not proof that the campaign is working. Validate `reply_context` and `campaign_variants` before making scale, copy, or client-safe winner claims.
- If hydrated reply bodies show prospects objecting to the wrong topic, industry, compliance domain, or template, prioritize that as setup/template-resolution risk. Do not count those replies as signal that the intended angle worked.
- For step or sequence ranking, use `step_analytics.unique_replies` only when coverage is clearly present for that campaign. If step-level reply counts are sparse or null, switch the ranking basis to `step_analytics.opportunities` and derived opportunity rate, and say so explicitly.
- For AM briefs, separate internal action priority from client-safe wording. Include an action queue when the user asks what to do next.
- For launch QA, blockers come first. Do not mark a campaign ready when sender inventory, lead supply, or templates are missing.
- For experiment planning, choose one campaign and one test lane before prescribing changes. Include hypothesis, metric, guardrail, stop condition, and evidence basis.
- Treat `custom_tags` and `custom_tag_mappings` as the exact tag-filter layer. Use them to scope analyses by campaign or sampled lead tags.
- Treat `lead_evidence`, `lead_payload_kv`, `reply_context`, and `rendered_outbound_context` as the preferred semantic evidence layer.
- Treat `sampled_leads` and `sampled_outbound_emails` as storage tables behind that layer. Never project full-population totals from sampled raw rows.
- Reply outcome labels come from Instantly lead state, primarily `lt_interest_status` and related lead metadata. Do not invent sentiment labels from reply text in V1.
- Default to Instantly reply outcomes and reconstructed outbound copy unless `fetch_reply_text` has returned exact reply bodies.
- Use `campaign_variants` as the source of truth for intended copy templates and `rendered_outbound_context` to verify how those templates render against stored lead variables.
- Replied leads are intentionally kept in full whenever they can be resolved from the campaign lead feed. Non-reply leads are bounded locally.
- `custom_payload` is preserved per lead as raw JSON text, but campaign-variable analysis should use `lead_payload_kv` and the ICP payload recipes. Do not assume payload keys are shared across campaigns or customers.
- Call out coverage limitations explicitly when raw evidence was sampled.

## Delegation Shape

The expected flow is:

1. use `workspace-triager` or `campaign_overview` to pick the campaign
2. load one campaign with `load_campaign_data`
3. use `campaign-analyst`, `copy-auditor`, `icp-auditor`, or `reply-auditor` as needed
4. use `synthesis-reviewer` to compress the result if the analysis is broad

Do not fan out multiple campaign specialists until the workspace-level triage identifies which campaigns are worth the extra work.
