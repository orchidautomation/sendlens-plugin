---
name: "workspace-health"
description: "Diagnose overall workspace health, reply-rate issues, bounce risk, and next actions."
---

# Workspace Health

Diagnose overall workspace health, reply-rate issues, bounce risk, and next actions.

## Tools In This Skill

- `refresh_data`
- `workspace_snapshot`
- `analysis_starters`
- `analyze_data`

## Usage

- If the user provides a campaign name or Instantly tag, use that scope first instead of defaulting to the full workspace.
- Session start should already have refreshed local data. Start from `workspace_snapshot` unless the user explicitly asks for another fresh pull.
- Pull `analysis_starters(topic="workspace-health")` before writing custom analysis.
- Keep broad workspace reads active-only by default. Include inactive or historical campaigns only when the user explicitly asks for them.
- Stay inside the SendLens MCP tool surface. If required SendLens tools are missing, stop and tell the user to reload or reinstall the plugin/MCP server. Do not inspect local files, run shell setup checks, parse cached outputs with `jq`, or query DuckDB through shell fallbacks.
- When the host supports delegated agents, use `workspace-triager` for the initial pass and keep the main context focused on the highest-priority campaign.
- Focus on reply rate, bounce rate, active campaign count, account health, and coverage warnings.
- Treat headline metrics as exact only when they come from aggregate tables.
- For deliverability questions, combine `account-health`, `inbox-placement-test-overview`, `sender-deliverability-health`, and `inbox-placement-auth-failures` before blaming copy.
- Treat inbox placement rows as exact Instantly test evidence, but remember missing inbox placement data means no local test data was available, not that sender health is clean.
- Do not infer spam placement, category placement, SPF, DKIM, DMARC, or blacklist failures from reply rates alone.
- If the diagnosis turns into lead segmentation, pivot to one campaign and inspect `lead_payload_kv` there rather than trying to normalize payload fields workspace-wide.
- End with specific actions ordered by likely impact.

## Example Requests

- "What is working and not working in this workspace?"
- "Why is reply rate low?"
- "Are we landing in spam or categories?"
- "Which sender accounts look risky?"
- "What should I change next?"
