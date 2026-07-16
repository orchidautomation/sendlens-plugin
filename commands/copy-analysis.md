---
description: "SendLens: inspect one campaign's templates and reconstructed copy"
argument-hint: "[campaign-name] [provider-tag]"
skill: sendlens-analyst
agent: copy-auditor
subtask: true
context: fork
---

# Copy Analysis

Use the `sendlens-analyst` skill and its reply/ICP/copy module when the user wants a critique of subjects, body copy, template structure, personalization quality, or concrete rewrite guidance.

Arguments: $ARGUMENTS

If arguments are provided, use campaign name and provider tag to scope the analysis before looking at templates or reconstructed copy. Treat tag support as provider-specific evidence.
