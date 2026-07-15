---
description: "SendLens: prepare a client-safe account brief, risk summary, and action queue"
argument-hint: "[campaign-name-or-instantly-tag]"
skill: sendlens-launch-operator
agent: launch-operator
subtask: true
context: fork
---

# Account Manager Brief

Use the `sendlens-launch-operator` skill and its learning/client-handoff module when the user wants a client update, daily AM action queue, risk summary, or "what should I tell the client?" answer.

Arguments: $ARGUMENTS

If arguments are provided, scope the brief to that campaign name or Instantly tag before ranking actions.

Return a client-safe update plus an internal action queue.
