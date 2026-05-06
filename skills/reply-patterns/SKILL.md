---
name: "reply-patterns"
description: "Surface what prospects are saying, separate human replies from auto-noise, and summarize recurring themes."
---

# Reply Patterns

Surface what prospects are saying, separate human replies from auto-noise, and summarize recurring themes.

## Tools In This Skill

- `workspace_snapshot`
- `load_campaign_data`
- `fetch_reply_text`
- `analysis_starters`
- `analyze_data`
- `refresh_status`

## References

- `../workspace-health/references/evidence-classes.md`
- `../workspace-health/references/output-schema.md`
- `references/reply-hydration.md`

Read the evidence and hydration references before quoting, paraphrasing, or grouping reply language.

## When To Use

- Use this when the user asks what prospects are saying, which objections show up, how positive/negative replies differ, or how to separate human replies from OOO noise.
- Keep reply analysis scoped to one campaign at a time unless the user explicitly asks for a workspace-wide comparison.
- If the user provides a campaign name or Instantly tag, use that scope first before grouping reply outcomes.

## Protocol

### Stage 1: Resolve One Campaign

- Start with `workspace_snapshot` when the campaign is ambiguous.
- Pull `analysis_starters(topic="reply-patterns")` before custom analysis.
- If the user narrows to one campaign and wants stronger reply evidence, run `load_campaign_data` for that campaign.

### Stage 2: Read Outcomes Before Bodies

- Query `reply_context` first for positive, negative, and neutral outcomes, step/variant, and existing hydrated reply columns.
- Separate human outcomes from out-of-office and automated noise using Instantly lead status and `reply_email_i_status` where available.
- When segmenting replies by enrichment variables, stay inside one campaign and read variables from `lead_payload_kv`.

### Stage 3: Hydrate Only When Needed

- If the user needs actual reply wording, run `fetch_reply_text` for exactly one campaign in default `mode="sync_newest"`, then query `reply_context` again.
- Prefer default statuses `[1, -1, -2]`. Do not include out-of-office status `0` unless the user explicitly asks for OOO replies.
- Use `mode="continue"` only when the user asks for older rows beyond the saved cursor.
- Avoid `mode="auto"` when the user expects fresh reply bodies.

### Stage 4: Answer With Evidence Calibration

- Quote or characterize exact reply-body language only from hydrated `reply_body_text`/`reply_content_preview`.
- If reply bodies have not been fetched, use Instantly reply outcomes and say that exact bodies have not been hydrated.
- Label each material theme as hydrated reply body, exact reply outcome aggregate, sampled evidence, or inference.

## Fallback Behavior

- If `fetch_reply_text` returns a cache-unavailable, WAL, replay, or readiness error, call `refresh_status` once.
- If refresh already succeeded or the error persists, tell the user to reload or restart the plugin session.
- If required SendLens MCP tools are missing, stop and tell the user to reload or reinstall the plugin/MCP server.
- Do not use Bash, `sleep`, `ls`, `rm`, `jq`, shell DuckDB access, repository inspection, local cache files, or setup scripts as fallback analysis paths.

## Output Shape

- Verdict: strongest reply pattern in one sentence.
- Evidence basis: fetched bodies vs outcomes-only, statuses, campaign scope, and caps.
- Positive themes.
- Negative themes or objections.
- Neutral/wrong-person/OOO notes when relevant.
- Recommended response/copy/segment actions.
- Caveats.

## Example Requests

- "What are prospects actually saying?"
- "What objections keep showing up?"
- "Show me the human replies, not the OOO noise."
