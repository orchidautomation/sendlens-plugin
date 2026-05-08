---
name: "cold-email-best-practices"
description: "Use when applying cold-email rules to campaign settings, copy critique, benchmarks, or evidence-backed recommendations."
---

# Cold Email Best Practices

Apply SendLens cold-email rules and benchmarks when critiquing campaigns or suggesting changes.

## Tools In This Skill

- `workspace_snapshot`
- `analysis_starters`
- `analyze_data`

## References

- `../workspace-health/references/evidence-classes.md`
- `../workspace-health/references/metric-basis.md`
- `../workspace-health/references/output-schema.md`

Read the evidence and metric references when applying these rules to actual SendLens data. If the user only asks for general operator guidance, no data tool is required.

## Rules

- Reply rate matters more than open rate for cold outbound.
- Bounce rate above 2% deserves attention; above 5% is a red flag.
- Open tracking and link tracking should stay off for cold outbound unless the user has a very specific reason.
- Disabled bounce protection and allowed risky contacts are launch-review warnings unless the user has a deliberate exception.
- Text-only beats polished HTML for most cold-email use cases.
- Separate auto-replies from human replies in every performance read where the evidence surface supports it.
- Keep recommendations concise, specific, and tied to campaign evidence.

## Protocol

### Stage 1: Determine Whether Data Is Needed

- If the user asks for general best practice, answer directly from the rules.
- If the user asks whether a campaign/workspace is healthy, start with `workspace_snapshot`, scoped by campaign name or tag when provided.
- Pull the relevant `analysis_starters` topic before using `analyze_data` for a metric-backed critique.

### Stage 2: Apply Evidence-Calibrated Benchmarks

- Use exact aggregates for reply rate, bounce rate, tracking settings, deliverability guardrails, sender health, and campaign settings when available.
- Use sampled evidence only for examples, themes, or hypotheses.
- Do not blame copy when sender health, inbox placement, launch readiness, or lead supply is the stronger evidence-backed explanation.
- Do not over-index on open rate, especially when open tracking is disabled or should be disabled.

### Stage 3: Give Operator-Grade Recommendations

- State the rule, the evidence, and the action.
- Suppress generic advice that is not connected to the user's campaign or stated goal.
- If the recommendation is an inference, label it as such and name the diagnostic that would confirm it.

## Fallback Behavior

- If required SendLens MCP tools are missing for a data-backed critique, stop and tell the user to reload or reinstall the plugin/MCP server.
- If evidence is missing, give a general best-practice answer and clearly mark it as not evidence-backed.
- Do not use Bash, `jq`, shell DuckDB access, repository inspection, local cache files, or setup scripts as fallback analysis paths.

## Output Shape

- Verdict.
- Evidence-backed rules triggered.
- Recommended changes in priority order.
- What not to optimize yet.
- Caveats.

## Example Requests

- "Are these settings healthy?"
- "What best-practice changes should I make?"
- "Critique this campaign like a cold-email operator."
