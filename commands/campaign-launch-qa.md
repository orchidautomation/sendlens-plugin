---
description: "SendLens: QA campaign evidence and blockers before launch, scale, resume, or handoff"
argument-hint: "[campaign-name]"
skill: sendlens-launch-operator
agent: launch-operator
subtask: true
context: fork
---

# Campaign Launch QA

Use the `sendlens-launch-operator` skill when the user wants to know whether a campaign is ready to launch, scale, resume, clone, or hand off.

Arguments: $ARGUMENTS

If arguments are provided, treat them as the campaign name or campaign ID. Return blockers first, then tracking/deliverability guardrail warnings, ready checks, and next actions.
