---
description: "SendLens: inspect one campaign's sampled ICP, targeting, and payload signals"
argument-hint: "[campaign-name] [provider-tag]"
skill: sendlens-analyst
agent: icp-auditor
subtask: true
context: fork
---

# ICP Signals

Use the `sendlens-analyst` skill and its reply/ICP/copy module when the user wants to infer who responds best by campaign-specific variables, account type, or other segment clues.

Arguments: $ARGUMENTS

If arguments are provided, use campaign name and provider tag to isolate the exact campaign or campaign set before inspecting payload variables. Treat tag support as provider-specific evidence.
