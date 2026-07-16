---
description: "SendLens: inspect one campaign's positive, negative, and neutral reply outcomes"
argument-hint: "[campaign-name] [provider-tag]"
skill: sendlens-analyst
agent: reply-auditor
subtask: true
context: fork
---

# Reply Patterns

Use the `sendlens-analyst` skill and its reply/ICP/copy module when the user asks what prospects are saying, what objections show up, or which replies signal interest versus noise.

Arguments: $ARGUMENTS

If arguments are provided, use campaign name and provider tag to narrow the reply analysis before comparing outcomes. Treat tag support as provider-specific evidence.
