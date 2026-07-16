---
description: "SendLens: plan the next evidence-backed campaign experiment and measurement contract"
argument-hint: "[campaign-name-or-provider-tag]"
skill: sendlens-campaign-strategist
agent: campaign-strategist
subtask: true
context: fork
---

# Experiment Planner

Use the `sendlens-campaign-strategist` skill when the user asks what to test next, how to improve a campaign, or how to define the campaign hypothesis and cohort.

Arguments: $ARGUMENTS

If arguments are provided, scope candidate selection to that campaign name or provider tag. Treat tag support as provider-specific evidence. Include the hypothesis, strategic change, target cohort, and evidence basis; hand measurement and operational stop/scale rules to `sendlens-launch-operator`.
