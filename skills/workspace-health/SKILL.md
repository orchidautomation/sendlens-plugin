---
name: "workspace-health"
description: "Use when diagnosing workspace health, reply-rate issues, deliverability risk, sender risk, or next actions; not for simple inventory or freshness checks."
---

# Workspace Health

Diagnose overall workspace health, reply-rate issues, bounce risk, and next actions.

## Tools In This Skill

- `refresh_data`
- `workspace_snapshot`
- `analysis_starters`
- `analyze_data`
- `refresh_status`

## References

- `references/evidence-classes.md`
- `references/metric-basis.md`
- `references/output-schema.md`

Read the evidence and output references before making a diagnostic claim. These are prompt references only; do not inspect local runtime files, repository source, raw DuckDB files, shell output, or cached JSON as a fallback for SendLens analysis.

## When To Use

- Use this when the user asks what is working, why reply rate is low, which campaigns or senders are risky, whether deliverability is healthy, or what to change next.
- If the user provides a campaign name or Instantly tag, preserve that as scope before broad workspace analysis.
- Keep workspace reads active-only by default. Include inactive or historical campaigns only when the user explicitly asks for them.

## Protocol

### Stage 1: Start From The Snapshot

- Session start should already have refreshed local data. Start with `workspace_snapshot` unless the user explicitly asks for a fresh pull or `refresh_status` indicates stale/failed data.
- Pass `campaign_name` or `instantly_tag` to `workspace_snapshot` when the user gives one.
- If the snapshot is unavailable because startup refresh is still running, call `refresh_status` once and retry only when the status is no longer running.

### Stage 2: Pull Curated Starters

- Run `analysis_starters(topic="workspace-health")` before custom analysis.
- Use starter recipes for account health, inbox placement, sender deliverability, campaign overview, and tag-scoped sender coverage before writing custom `analyze_data` SQL.
- Use `analyze_data` only through the SendLens MCP tool, with focused SELECT/WITH queries against public `sendlens.*` surfaces.

### Stage 3: Diagnose In Order

- First read headline exact aggregates: active campaigns, reply rate, bounce rate, active campaign count, account health, and coverage warnings.
- For deliverability questions, combine `account-health`, `inbox-placement-test-overview`, `sender-deliverability-health`, and `inbox-placement-auth-failures` before blaming copy.
- Use `inbox_placement_analytics_labeled` when provider, recipient geography, or recipient type labels matter; use raw `inbox_placement_analytics` only when integer codes are enough.
- Treat inbox placement rows as exact Instantly test evidence when present. Missing inbox placement data means no local test evidence was available, not that sender health is clean.
- Do not infer spam placement, category placement, SPF, DKIM, DMARC, blacklist failures, or provider placement from reply rates alone.

### Stage 4: Narrow Before Deep Analysis

- If the diagnosis turns into copy, ICP, reply-body, or sequence analysis, pick one campaign and switch to the relevant specialist skill.
- If the user asks for lead segmentation, pivot to one campaign and inspect `lead_payload_kv` there rather than normalizing payload fields workspace-wide.
- If segment fields are sparse, recommend improving future uploaded lead metadata/custom fields before expecting deeper ICP analysis. Do not blame Instantly enrichment for blank role/title fields.
- If the user asks for current reply wording, pivot to `reply-patterns`; do not hydrate replies during workspace triage.

### Stage 5: Answer With Evidence Calibration

- Label material claims with evidence classes from `references/evidence-classes.md`.
- Apply `references/metric-basis.md` for reply-rate, bounce, deliverability, step/variant, and runway language.
- End with specific actions ordered by likely impact.
- Include only caveats that could change the recommendation.

## Fallback Behavior

- If required SendLens MCP tools are missing, stop and tell the user to reload or reinstall the plugin/MCP server.
- If a SendLens tool returns truncation, output caps, or readiness warnings, narrow scope or report the limitation.
- Do not use Bash, `jq`, shell DuckDB access, repository inspection, local cache files, or setup scripts as fallback analysis paths.

## Output Shape

Use `references/output-schema.md` unless the user asks for a different format. The required fields are:

- Verdict
- Evidence basis
- Findings
- Actions
- Caveats

## Example Requests

- "What is working and not working in this workspace?"
- "Why is reply rate low?"
- "Are we landing in spam or categories?"
- "Which sender accounts look risky?"
- "What should I change next?"
