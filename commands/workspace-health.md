---
description: "SendLens: triage workspace health and choose the next campaign to analyze"
argument-hint: "[campaign-name-or-provider-tag]"
skill: sendlens-analyst
agent: workspace-triager
subtask: true
context: fork
---

# Workspace Health

Use the `sendlens-analyst` skill and its workspace/performance module when the user wants a high-level diagnosis of campaign quality, deliverability risk, account health, or the top actions to take next.

Arguments: $ARGUMENTS

If arguments are provided, prefer scoping the triage to that campaign name or provider tag before expanding to the broader workspace. Treat tag support as provider-specific evidence.

Default broad reads to active campaigns only unless the user explicitly asks for inactive or historical campaigns.
