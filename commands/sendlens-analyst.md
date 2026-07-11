---
description: "SendLens: diagnose outbound evidence and orchestrate an end-to-end answer when requested"
argument-hint: "[question, campaign, provider, or tag]"
agent: campaign-analyst
subtask: false
---

# SendLens Analyst

Use the `sendlens-analyst` skill to diagnose outbound performance. When the request is broad, let it orchestrate `sendlens-campaign-strategist`, `sendlens-copywriter`, and `sendlens-launch-operator` automatically.

Arguments: $ARGUMENTS

Preserve any campaign, provider, or tag scope in the arguments. Start broad only when the decision is broad, then narrow to one campaign before deep reply, ICP, or copy diagnosis.
