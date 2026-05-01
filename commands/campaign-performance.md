---
description: "SendLens: analyze one campaign's performance and step or variant winners"
argument-hint: "[campaign-name] [instantly-tag]"
agent: campaign-analyst
subtask: true
---

# Campaign Performance

Use the `campaign-performance` skill when the user wants campaign comparisons, step or variant ranking, or a campaign-by-campaign prioritization pass.

Arguments: $ARGUMENTS

If arguments are provided, treat them as the preferred scope for the analysis:

- campaign name first
- Instantly tag second

Use them to narrow the workspace before ranking steps, variants, or winners.

Default broad ranking to active campaigns only unless the user explicitly asks for inactive or historical campaigns.
