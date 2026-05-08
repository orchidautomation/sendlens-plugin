---
name: "campaign-launch-qa"
description: "Use when checking whether a campaign is ready to launch, scale, resume, clone, or hand off."
---

# Campaign Launch QA

Check whether a campaign is ready to launch or scale before sending.

## Tools In This Skill

- `workspace_snapshot`
- `analysis_starters`
- `analyze_data`
- `load_campaign_data`

## References

- `../workspace-health/references/evidence-classes.md`
- `../workspace-health/references/metric-basis.md`
- `../workspace-health/references/output-schema.md`
- `../copy-analysis/references/copy-reconstruction.md`

Read the evidence and copy reconstruction references before marking a campaign ready.

## When To Use

- Use this when the user asks whether a campaign is ready to turn on, scale, resume, clone, or hand to an AM/client.
- If the user provides a campaign name, campaign ID, or Instantly tag, treat that as the scope.
- Do not mark a campaign ready when sender inventory, lead supply, templates, or blocking settings are missing.

## Protocol

### Stage 1: Resolve Scope

- Start with `workspace_snapshot` when the campaign is not already uniquely identified.
- Pull `analysis_starters(topic="campaign-launch-qa")` before custom analysis.
- If a tag maps to multiple campaigns, list the candidates and inspect one campaign at a time.

### Stage 2: Load Campaign Evidence

- Run the launch QA checklist recipe with the campaign name or campaign ID.
- Run `campaign-tracking-deliverability-settings` when the user asks whether tracking, bounce protection, risky contacts, unsubscribe headers, or ESP matching are on per campaign.
- Run `load_campaign_data` for the selected campaign when checking copy, sampled replies, or reconstructed personalization.
- Use `analyze_data` only through the SendLens MCP tool and only after a starter recipe or schema surface is clear.

### Stage 3: Check Blockers Before Polish

- Check sender assignment, uncontacted leads, sequence templates, blank copy, tracking settings, deliverability guardrails, schedule/timezone, sequence steps/delays, and sender health.
- Apply cold-email best practices when interpreting open tracking, link tracking, disabled bounce protection, allowed risky contacts, bounce risk, and text/HTML choices.
- Treat `open_tracking`, `link_tracking`, `match_lead_esp`, `allow_risky_contacts`, `disable_bounce_protect`, and `insert_unsubscribe_header` as exact campaign settings when present in `campaign_overview`.
- If the user asks for personalization safety, pair launch QA with the `personalization-leak-audit` copy-analysis recipe and the copy reconstruction caveat reference.

### Stage 4: Calibrate The Verdict

- `blocked` means a missing or risky prerequisite should stop launch/scale.
- `ready_with_warnings` means the campaign can run only with an explicit caveat or monitoring action.
- `ready` requires no known blocker in the exact campaign/settings evidence and no material sampled reconstruction warning.
- Mark evidence as exact aggregate, sampled evidence, reconstructed outbound, or inference.

## Fallback Behavior

- If required SendLens MCP tools are missing, stop and tell the user to reload or reinstall the plugin/MCP server.
- If evidence is missing, report the missing coverage as a blocker or warning instead of guessing.
- Do not use Bash, `jq`, shell DuckDB access, repository inspection, local cache files, or setup scripts as fallback analysis paths.

## Output Shape

- Verdict: `ready`, `ready_with_warnings`, or `blocked`.
- Blockers: issues that should stop launch.
- Warnings: issues that can launch only with eyes open.
- Ready checks: what looks correct.
- Evidence basis: source and evidence class for material checks.
- Next actions: exact fixes in priority order.

## Example Requests

- "Is this campaign ready to launch?"
- "QA this campaign before I turn it on."
- "Can I scale this campaign?"
- "Check for blockers before we send."
