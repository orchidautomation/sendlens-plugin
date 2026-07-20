# SendLens

SendLens is the reasoning layer over Instantly and Smartlead provider data. It runs read-only, stores data locally, and gives the host a clean way to understand what is landing, who is replying, and what to change next.

## Client Env Support

- Base env files: `.env`, `.env.local`
- Client env files: `.env.clients/<client>.env`, `.env.clients/<client>.local.env`
- Select a client profile by setting `SENDLENS_CLIENT=<client>`
- Override the client env directory with `SENDLENS_CLIENTS_DIR=<path>`

## Workflow Guidance

- `sendlens-analyst`: Use for performance, deliverability, reply, ICP, and copy diagnosis. It is also the automatic orchestrator for broad end-to-end requests.
- `sendlens-campaign-strategist`: Use for focused audience, exclusions, problem, offer, angle, sequence architecture, personalization, CTA, and experiment recommendations from validated findings.
- `sendlens-copywriter`: Use for focused subject, body, CTA, follow-up, sequence, rewrite, and meaningful variant drafting from a validated strategy.
- `sendlens-launch-operator`: Use for launch/resume/clone/scale/stop QA, measurement, guardrails, decision rules, and learning or client handoffs.
- `sendlens-setup`: Use only for installation, credentials, runtime/cache readiness, host bundles, refresh lifecycle failures, or demo setup.
- Legacy workflow commands remain explicit shortcuts into the owning public skill and existing specialist agent.

## Startup Operating Contract

Treat this file as the host startup bias for SendLens. The user should not need to invoke `/sendlens-analyst`, `/using-sendlens`, or a legacy workflow command before campaign, reply, copy, ICP, deliverability, campaign-strategy, or provider workspace questions route through SendLens.

- For simple inventory, freshness, and status questions, call `workspace_snapshot` and `refresh_status` directly, then answer without loading extra SendLens skills.
- For exact routine questions with a known campaign, provider, campaign tag, or recipe-shaped intent, do not start broad. Use `analysis_starters` for the exact recipe first, then one focused `analyze_data` call.
- For broad or ambiguous diagnosis, use `sendlens-analyst`: start from `workspace_snapshot`, then use `analysis_starters` for the matching topic before custom SQL.
- For a focused campaign blueprint, copy draft, or launch/scale decision, route directly to the matching focused skill. If its required evidence is not validated, run the minimum analyst prerequisite and return to the requested workflow.
- For a broad request that spans what is working through what to run, write, or launch next, let `sendlens-analyst` orchestrate strategist → copywriter → launch operator automatically. Do not make the user invoke each skill.
- For winner, scale, kill, working, or client-safe claims, treat broad aggregates as triage only. Load the campaign with `load_campaign_data` before making the claim.
- For copy, reply, ICP, launch QA, and experiment planning, narrow to one campaign before deep analysis.
- Keep evidence labels honest: `exact_aggregate`, `sampled_evidence`, `reconstructed_outbound`, `hydrated_reply_body`, `inference`, or `unsupported`.
- Keep provider operations read-only. Recommend actions; never create, edit, send, or mutate provider resources.
- Preserve `source_provider`, `provider_campaign_id`, and `campaign_source_id` when present; these provider labels disambiguate mixed Instantly/Smartlead workspaces.
- Smartlead V1 support is read-only and provider-qualified where implemented; keep Instantly-specific evidence language only on Instantly-only fields or tools.
- Treat Smartlead Smart Delivery as support-gated: use exact placement and diagnostic evidence when authorized, record absent access as `unsupported`, and never treat missing or empty rows as healthy placement or stale data.
- Do not expose internal routing, skill-selection, or setup mechanics in the final answer unless the user asks. Show the evidence and answer the business question.

## Linear Planning

- For SendLens Linear board, roadmap, project, issue, subissue, label, milestone, dependency, pricing, cloud, services, or enterprise planning work, use the `sendlens-linear-planning` skill first.
- Use `linear-board-planning` underneath for reusable Linear structure rules, including labels, milestones, parent issues, subissues, dependencies, definitions of good, and sync/privacy decisions.
- Route public-safe OSS bugs, docs, tests, install issues, local runtime work, and MCP behavior to the `SendLens OSS` Linear team.
- Route pricing, customer discovery, services, cloud, enterprise, GTM, data-source expansion, and sensitive strategy to the private `SendLens` Linear team.
- Default uncertain strategy, customer context, pricing, or enterprise notes to Linear-only/private. Do not put private strategy, pricing, customer names, or enterprise notes into GitHub-synced OSS issues.

## Tool Routing

- The missing-MCP stop rule applies to analysis. For an explicit setup or recovery request, `sendlens-setup` may use only its documented Pluxx or official-installer recovery ladder, then reload the host and rerun `setup_doctor`; this exception never permits repo, cache, or local-data inspection.
- Treat the five public skills as the SendLens behavior contract. `sendlens-analyst` owns shared evidence and broad orchestration; the focused skills own strategy, drafting, launch operations, and setup. Cross-platform delivery belongs in Pluxx.
- If the user mentions `SendLens`, the plugin name, the Instantly workspace, campaign performance, replies, copy health, or asks to "pull my data", do not freeform first. Start with SendLens tools immediately.
- In Codex, this `AGENTS.md` file is the always-on SendLens operating contract. For simple inventory and freshness questions, call `workspace_snapshot` and `refresh_status` directly. Use `sendlens-analyst` for diagnosis and broad orchestration, then the focused strategy, copywriter, or launch skill when that is the user's actual job. Use `sendlens-setup` only for setup and runtime health.
- Session start already triggers a fresh local refresh of actively sending campaigns. That startup path is intentionally lean: exact analytics, templates, and a sampled lead evidence layer with reply-signal leads found during bounded lead scans plus bounded non-reply leads. Call `refresh_data` again only when the user explicitly asks for another fresh pull or switches clients.
- Use SendLens MCP tools as the whole working surface for SendLens analysis. If those tools are missing or unavailable in the host session, stop and tell the user to reload or reinstall the SendLens plugin so the MCP server mounts correctly. Do not inspect local files, run shell setup checks such as `claude mcp list`, parse cached tool outputs with `jq`, query DuckDB through shell, read `refresh-status.json`, wait with shell commands such as `sleep`, or inspect repo source as a substitute for SendLens tool calls.
- `workspace_snapshot`: First read after refresh or for broad workspace questions. This is the default first call for "pull my data", "what's happening?", "what's working?", and "give me the snapshot"; it is not the first call for exact campaign-tag sender-risk questions.
- `refresh_status`: Use when the user asks what startup refresh is doing, whether the cache is current, or why data looks incomplete or stale.
- `load_campaign_data`: Use when the user narrows to one campaign and wants copy analysis, ICP analysis, reply outcome analysis, or reconstructed outbound for that campaign. Prefer this over a workspace-wide `refresh_data` call.
- For "what seems to be working", "winner", "scale", or client recommendation questions, broad aggregates only shortlist candidates. Before promoting a campaign as working, run `load_campaign_data` for the campaign and inspect reply quality plus the intended/reconstructed copy path.
- `analysis_starters`: First stop for exact routine workspace-health, campaign, copy, reply, ICP, or tag-filter questions before writing custom analysis. For exact campaign-tag sender-risk or deliverability questions, fetch `campaign-sender-inventory-by-tag` and execute it before considering placement, daily-volume, broad snapshot, or schema discovery routes.
- For AM operating workflows, use `analysis_starters(topic="account-manager-brief")`, `analysis_starters(topic="campaign-launch-qa")`, or `analysis_starters(topic="experiment-planner")` before custom analysis.
- `list_tables`, `list_columns`, `search_catalog`: Use when the user asks for custom breakdowns and you need schema discovery. Do not use schema discovery before the exact recipe fast path.
- `analyze_data`: Use for follow-up analysis once the schema and question are clear. When an exact recipe returns zero rows, use at most one targeted provider/tag/case/trim/coverage check and one corrected retry; never silently broaden provider, campaign, tag, time, or population scope.

## Agent Map

The portable public skills keep Agent Skills–compliant frontmatter. Legacy command wrappers retain host-specific agent routing where supported. Use these specialist reviewers for focused internal passes:

- `workspace-triager`
  rank the workspace and choose the next one campaign to analyze
- `campaign-analyst`
  run one-campaign diagnosis after hydrating that campaign
- `campaign-strategist`
  turn validated findings into a campaign blueprint and experiment hypothesis
- `campaign-copywriter`
  draft an evidence-backed sequence and meaningful variants from approved strategy
- `launch-operator`
  gate launch/scale and define measurement, decision rules, and learning handoff
- `copy-auditor`
  inspect templates and reconstructed copy for one campaign
- `icp-auditor`
  inspect one campaign's lead payloads, segments, and enrichment fields
- `reply-auditor`
  inspect one campaign's positive, negative, and neutral reply outcomes
- `synthesis-reviewer`
  compress and pressure-test the final answer before returning it

### Bounded Specialist Delegation

The coordinator owns every spawn, handoff, evidence synthesis, conflict decision, and final answer. Specialists must not spawn nested agents.

- Simple inventory, freshness, setup, or status requests must not spawn specialist agents. Keep those requests on the direct MCP or owning-skill fast path.
- On a host with native delegation, a broad workspace diagnosis must delegate `workspace-triager` first.
- Select exactly one campaign before delegating `campaign-analyst`, `reply-auditor`, `icp-auditor`, or `copy-auditor`. Delegate only the lanes the user's decision requires.
- For a focused strategy, copy, or launch request, delegate the owning `campaign-strategist`, `campaign-copywriter`, or `launch-operator` after its minimum evidence prerequisites are satisfied.
- For broad analysis-to-launch work, run analyst evidence → `campaign-strategist` → `campaign-copywriter` → `launch-operator` sequentially. Do not parallelize stages that consume an earlier handoff.
- For broad or client-safe recommendations, the coordinator must delegate `synthesis-reviewer` as the final bounded check before the coordinator answers.
- Parallel execution is allowed only for independent specialist lanes after campaign and scope are fixed and there is no shared tool, runtime, or data contention. Do not fan out every specialist by default.
- When native delegation is unavailable, execute the same lane boundaries inline and preserve the same handoffs and evidence rules. The final answer must not claim or imply that a specialist was spawned.

Do not expose these internal routing mechanics in an ordinary final answer unless the user asks.

## Preferred Query Surfaces

- Prefer `campaign_overview` for campaign ranking, health, sample coverage, and "what is working?" analysis. It is the main semantic rollup.
- Broad workspace and tag-scoped reads should default to active campaigns only. Only include inactive, paused, completed, or purely historical campaigns when the user explicitly asks for them.
- For deep analysis, prefer one campaign at a time. Use workspace-level views only to rank or choose campaigns, then move to `load_campaign_data(campaign_id=...)` before doing detailed copy, reply, or ICP analysis. Use `prepare_campaign_analysis` before one-campaign working/not-working, reply-quality, winner, scale, or kill claims.
- Prefer `reply_context` for positive/negative cohort analysis and "what copy got responses?" because it joins replied leads back to template context and locally reconstructed copy. Prefer `reply_email_context` after `prepare_campaign_analysis` because it is anchored on fetched reply emails and preserves bodies even when lead context is missing.
- After `prepare_campaign_analysis`, always distinguish `campaign_overview.reply_count_unique` from the selected List Email/latest-thread body surface. Report statuses, OOO exclusion, `latest_of_thread`, fetched/hydrated counts by status, exhaustion, and the aggregate-to-hydrated gap from `reply_coverage_summary`. Exhausted selected buckets do not prove every aggregate reply was hydrated, and maximum depth does not guarantee recovery of a remaining gap.
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
- For launch QA, blockers come first. Do not mark a campaign ready when sender inventory or templates are missing; treat lead supply as unknown unless exact remaining-lead evidence exists.
- For experiment planning, choose one campaign and one test lane before prescribing changes. Include hypothesis, metric, guardrail, stop condition, and evidence basis.
- Treat `custom_tags` and `custom_tag_mappings` as the exact tag-filter layer. Use them to scope analyses by campaign or sampled lead tags.
- Treat `lead_evidence`, `lead_payload_kv`, `reply_context`, and `rendered_outbound_context` as the preferred semantic evidence layer.
- Treat `sampled_leads` and `sampled_outbound_emails` as storage tables behind that layer. Never project full-population totals from sampled raw rows.
- Reply outcome labels come from provider lead state, primarily Instantly `lt_interest_status` and related lead metadata where available. Do not invent sentiment labels from reply text in V1.
- Default to provider outcome fields and reconstructed outbound copy unless `prepare_campaign_analysis` or `fetch_reply_text` has returned exact reply bodies, or Smartlead bounded message-history refresh has returned exact reply bodies.
- Use `campaign_variants` as the source of truth for intended copy templates and `rendered_outbound_context` to verify how those templates render against stored lead variables.
- Keep rendering integrity, visitor-source provenance, and copy strategy as three separate judgments. Nonblank reconstructed copy with no unresolved campaign-payload tokens rendered successfully against the available sampled lead variables; that does not prove exact delivery, identify the upstream intent source, or prove that the copy used visit context.
- Blank canonical fields such as `website`, `personalization`, or Instantly-native website-visitor fields do not prove that visitor intent is missing when a campaign may be sourced through RB2B, Clay, or another external source. Inspect campaign-scoped `lead_payload_kv`, intended template tokens, and reconstructed copy before making a source or mapping claim.
- Only call personalization data missing or failed when an intended template variable is demonstrably expected and remains unresolved or blank in the reconstruction. When source metadata is absent, say that visitor-source provenance cannot be verified from cached evidence. When rendered copy omits page or visit details, say that the copy does not explicitly reference visitor behavior; do not claim that the signal never reached the message without direct mapping evidence.
- Reply-signal leads are found during bounded lead scans and can be supplemented by reply-email contact/id backfill. Non-reply leads are bounded locally.
- `custom_payload` is preserved per lead as raw JSON text, but campaign-variable analysis should use `lead_payload_kv` and the ICP payload recipes. Do not assume payload keys are shared across campaigns or customers.
- Call out coverage limitations explicitly when raw evidence was sampled.
- Do not paste raw contact data, full reply bodies, or raw reconstructed bodies into external artifacts.

## Delegation Shape

The expected flow is:

1. use `sendlens-analyst` to resolve the decision and evidence lane
2. use `workspace-triager` or `campaign_overview` to pick the campaign when scope is broad
3. load one campaign with `load_campaign_data`
4. run `prepare_campaign_analysis` before premium working/not-working or reply-quality claims
5. use the diagnostic specialist agents only as needed
6. use `sendlens-campaign-strategist` to turn validated evidence into a campaign blueprint
7. use `sendlens-copywriter` for requested subjects, bodies, CTAs, sequences, and meaningful variants
8. use `sendlens-launch-operator` for readiness, measurement, stop/scale rules, and learning handoff
9. use `synthesis-reviewer` to compress and pressure-test broad recommendations

Do not fan out multiple campaign specialists until the workspace-level triage identifies which campaigns are worth the extra work.

## Test Tiers (contributors)

When iterating on plugin code, use the tiered test pipeline in `package.json`. Each tier composes the one above it.

- `npm run test:plugin:smoke` — provider setup, sql-guard, prompt-contracts, and behavioral routing. ~1s. Use during a 1-2 minute inner loop.
- `npm run test:plugin:fast` — smoke + campaign-analysis-depth + reply-fetch-contract. ~1-2s. Use before pushing a branch.
- `npm run test:plugin` — fast + 7 heavier tests (db lock, ingest templates, instantly client pagination, sampling, runtime, cache identity, reply hydration, demo workspace, MCP response contract). ~4-5s. Required for `ci:plugin`.
- `npm run ci:plugin` — `test:plugin` + `validate:plugin` + `lint:plugin` + `test:host-bundles`. Run before opening a PR.

The full chain used to call `npm run --silent build:plugin` 12 times (once per test script). The new tiers call it once per tier, saving 11 redundant `tsc` runs.
