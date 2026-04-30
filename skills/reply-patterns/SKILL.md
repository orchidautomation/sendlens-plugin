---
name: "reply-patterns"
description: "Surface what prospects are saying, separate human replies from auto-noise, and summarize recurring themes."
---

# Reply Patterns

Surface what prospects are saying, separate human replies from auto-noise, and summarize recurring themes.

## Tools In This Skill

- `workspace_snapshot`
- `analysis_starters`
- `analyze_data`

## Usage

- If the user provides a campaign name or Instantly tag, use that scope first before grouping reply outcomes.
- Pull `analysis_starters(topic="reply-patterns")` before custom analysis.
- Keep reply analysis scoped to one campaign at a time unless the user explicitly asks for a workspace-wide comparison.
- If the user narrows to one campaign and wants stronger reply evidence, run `load_campaign_data` for that campaign first.
- Query `reply_context` first.
- Separate positive, negative, and neutral outcomes from Instantly lead status before grouping by step or variant.
- When segmenting replies by enrichment variables, stay inside one campaign and read those variables from `custom_payload`.
- In V1, do not imply we have exact reply-body language unless the workflow explicitly fetched fallback email/thread data.

## Example Requests

- "What are prospects actually saying?"
- "What objections keep showing up?"
- "Show me the human replies, not the OOO noise."
