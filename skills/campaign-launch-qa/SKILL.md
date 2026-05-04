---
name: "campaign-launch-qa"
description: "Check whether a campaign is ready to launch or scale before sending."
---

# Campaign Launch QA

Check whether a campaign is ready to launch or scale before sending.

## Tools In This Skill

- `workspace_snapshot`
- `analysis_starters`
- `analyze_data`
- `load_campaign_data`

## Usage

- Use this when the user asks whether a campaign is ready to turn on, scale, resume, clone, or hand to an AM/client.
- Pull `analysis_starters(topic="campaign-launch-qa")` before custom analysis.
- Stay inside the SendLens MCP tool surface. If required SendLens tools are missing, stop and tell the user to reload or reinstall the plugin/MCP server. Do not inspect local files, run shell setup checks, parse cached outputs with `jq`, or query DuckDB through shell fallbacks.
- If the user provides a campaign name, run the launch QA checklist recipe with that campaign name or campaign ID.
- If the user asks for personalization safety, run `load_campaign_data` for that campaign and pair launch QA with the `personalization-leak-audit` copy-analysis recipe.
- Check blockers before polish: sender assignment, uncontacted leads, templates, blank copy, tracking settings, schedule/timezone, sequence steps/delays, and sender health.
- Apply cold-email best-practices when interpreting tracking and bounce risk.
- Do not mark a campaign ready when sender inventory or lead supply is missing.

## Output Shape

- Verdict: `ready`, `ready_with_warnings`, or `blocked`.
- Blockers: issues that should stop launch.
- Warnings: issues that can launch only with eyes open.
- Ready checks: what looks correct.
- Next actions: exact fixes in priority order.

## Example Requests

- "Is this campaign ready to launch?"
- "QA this campaign before I turn it on."
- "Can I scale this campaign?"
- "Check for blockers before we send."
