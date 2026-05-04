---
description: "SendLens: prepare a client-safe AM brief and action queue"
argument-hint: "[campaign-name-or-instantly-tag]"
agent: workspace-triager
subtask: true
---

# Account Manager Brief

Use the `account-manager-brief` skill when the user wants a client update, daily AM action queue, risk summary, or "what should I tell the client?" answer.

Arguments: $ARGUMENTS

If arguments are provided, scope the brief to that campaign name or Instantly tag before ranking actions.

Return a client-safe update plus an internal action queue.
