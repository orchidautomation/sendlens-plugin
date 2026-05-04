---
description: "SendLens: QA a campaign before launch, scale, or resume"
argument-hint: "[campaign-name]"
agent: campaign-analyst
subtask: true
---

# Campaign Launch QA

Use the `campaign-launch-qa` skill when the user wants to know whether a campaign is ready to launch, scale, resume, clone, or hand off.

Arguments: $ARGUMENTS

If arguments are provided, treat them as the campaign name or campaign ID. Return blockers first, then warnings, ready checks, and next actions.
