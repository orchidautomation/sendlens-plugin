---
name: sendlens-analyst
description: "Use when the user wants SendLens diagnosis of outbound performance, deliverability, replies, ICP, or copy, or asks what is working and what to run or write next. Focused strategy, drafting, launch operations, and setup use their dedicated skills."
---

# SendLens Analyst

Diagnose the workspace or campaign, establish what the evidence supports, and orchestrate the downstream SendLens skills when the request spans analysis through action.

## Non-Negotiables

- Use SendLens MCP tools as the working surface. Do not inspect repository files, raw DuckDB files, cached JSON, shell output, or setup scripts as analysis fallbacks.
- Keep provider operations read-only. Recommend actions; never create, edit, send, or mutate provider resources.
- Preserve `source_provider`, `provider_campaign_id`, and `campaign_source_id` in mixed-provider workspaces.
- Keep provider-qualified evidence explicit in mixed-provider workspaces. Smartlead V1 support is read-only and provider-qualified where implemented.
- Label material claims with the weakest evidence class that supports them.
- Treat broad aggregates as triage. Validate reply quality and the intended copy path before calling a campaign working, a winner, or ready to scale.
- Keep deep reply, ICP, copy, and campaign work scoped to one campaign at a time.

## Diagnostic Workflow

1. **Resolve the decision.** Preserve any campaign, provider, tag, and time scope. Decide whether the user needs diagnosis only or an end-to-end answer.
2. **Start with exact evidence.** Use `workspace_snapshot` for broad or ambiguous requests. If the user gives an exact campaign, provider, campaign tag, or known routine intent, bypass broad snapshot triage and route to the matching `analysis_starters` recipe first. Use `refresh_status` only for readiness or freshness questions, and call `refresh_data` only when the user explicitly requests fresh data or changes workspace context.
3. **Choose the narrowest evidence lane.** Use `analysis_starters` before custom `analyze_data`. For exact campaign-tag sender-risk or deliverability questions, choose `campaign-sender-inventory-by-tag` first and execute it before placement, daily-volume, broad workspace, or schema-discovery routes. Use `search_catalog` or `list_columns` only when the schema is uncertain after no exact recipe fits. Read [references/schema-and-joins.md](references/schema-and-joins.md) before custom SQL or cross-surface joins.
4. **Diagnose constraints in order.** Check evidence readiness, volume and runway, sender and deliverability health, reply quality, ICP/lead quality, and copy or sequence mechanics. Read [references/workspace-and-performance.md](references/workspace-and-performance.md) for workspace, campaign, step, variant, runway, or deliverability work.
5. **Load one campaign for depth.** Call `load_campaign_data` before deep copy, reply, ICP, launch, or campaign work. Call `prepare_campaign_analysis` when fetched reply wording could change working/not-working, scale/kill, copy, ICP, or client-safe recommendations. After every preparation call, use `reply_coverage_summary` to report the aggregate unique human reply count separately from selected-status hydration, including OOO exclusion, `fetch_latest_of_thread`, the stored context latest-thread basis, per-status fetched/hydrated counts, exhaustion, the numeric gap, and the neutral scope explanation.
6. **Connect evidence to message and audience.** Read [references/replies-icp-and-copy.md](references/replies-icp-and-copy.md) before interpreting reply language, payload fields, intended templates, reconstructed outbound, or personalization.

Read [references/evidence-and-metrics.md](references/evidence-and-metrics.md) before making diagnostic, winner, scale, ICP, copy, campaign, or client-safe claims.

## Orchestration Contract

Use focused skills without forcing the user to name them:

1. `sendlens-analyst` establishes validated findings, the primary constraint, evidence classes, and unknowns.
2. `sendlens-campaign-strategist` converts eligible findings into the audience, exclusions, problem, offer, angle, sequence architecture, and experiment hypothesis.
3. `sendlens-copywriter` drafts the requested sequence and meaningful variants from that strategy.
4. `sendlens-launch-operator` gates launch or scale, defines measurement and stop/scale rules, and records the learning handoff.

For a broad request such as “analyze what is working and tell me what to run and write next,” continue through every requested downstream stage in one answer. Do not stop after diagnosis or make the user invoke each skill.

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

Do not expose internal spawning or routing mechanics in an ordinary final answer unless the user asks.

For a focused request, use only the owning skill:

- Campaign recommendation without full email bodies: `sendlens-campaign-strategist`.
- Draft, rewrite, subject lines, sequence bodies, CTAs, or copy variants: `sendlens-copywriter`.
- Launch QA, scale/stop decision, measurement, or learning handoff: `sendlens-launch-operator`.
- Installation, provider access, runtime, cache, refresh, or demo readiness: `sendlens-setup`.

If a downstream skill lacks validated evidence, run the minimum analyst prerequisite and then return to that skill. Do not silently replace missing evidence with generic advice.

## Analyst Handoff

Pass this compact contract downstream:

```text
validated_findings:
- finding; evidence_class; source; scope; material coverage limit

primary_constraint:
- deliverability | sender/capacity | lead supply | audience | offer/angle | copy/sequence | insufficient evidence

eligible_opportunity:
- the opportunity that remains after operational blockers

unknowns:
- only gaps that could change the recommendation
```

If required SendLens tools are missing, stop and tell the user to reload or reinstall the plugin/MCP server.

## Query Budget Ladder

- Exact routine fast path: one exact `analysis_starters` lookup plus one focused `analyze_data` call. Do not add `workspace_snapshot`, schema discovery, placement scans, or day-level recomputation.
- Zero-row correction: use at most one targeted provider/tag/case/trim/coverage check and one corrected retry. Stop after the second failed filter.
- Supported custom question: use one compact catalog or route lookup, one focused read-only `analyze_data` query, and at most one error-informed repair.
- Broad triage: use `workspace_snapshot` only when the request is workspace-wide, ambiguous, or explicitly asks for a broad snapshot.

Never silently broaden provider, campaign, tag, time, or population scope during recovery. If local public evidence is absent, unsafe, or the correction budget is exhausted, return `unsupported` with the precise gap instead of continuing to scan.

## Example Requests

- "What's working and not working in my outbound workspace?"
- "Rank my campaigns and tell me which one deserves a deeper reply and ICP review."
- "Analyze everything, recommend the next campaign, write it, and plan the launch."

## Default Output

```text
Verdict
- The decision in one sentence.

Evidence
- Finding — evidence class; metric basis; scope; material coverage limit.

Primary constraint
- The bottleneck and why it outranks alternatives.

Recommended actions
1. Highest-impact action.
2. Downstream skill handoff or next diagnostic.

Caveats
- Only uncertainty that could change the decision.
```
