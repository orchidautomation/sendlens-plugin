---
name: "reply-patterns"
description: "Surface what prospects are saying, separate human replies from auto-noise, and summarize recurring themes."
---

# Reply Patterns

Surface what prospects are saying, separate human replies from auto-noise, and summarize recurring themes.

## Tools In This Skill

- `workspace_snapshot`
- `hydrate_reply_text`
- `analysis_starters`
- `analyze_data`

## Usage

- If the user provides a campaign name or Instantly tag, use that scope first before grouping reply outcomes.
- Pull `analysis_starters(topic="reply-patterns")` before custom analysis.
- Stay inside the SendLens MCP tool surface. If required SendLens tools are missing, stop and tell the user to reload or reinstall the plugin/MCP server. Do not inspect local files, run shell setup checks, parse cached outputs with `jq`, or query DuckDB through shell fallbacks.
- Keep reply analysis scoped to one campaign at a time unless the user explicitly asks for a workspace-wide comparison.
- If the user narrows to one campaign and wants stronger reply evidence, run `load_campaign_data` for that campaign first.
- Query `reply_context` first. If the user needs actual reply wording and `reply_body_text` is empty, run `hydrate_reply_text` for exactly one campaign, then query `reply_context` again.
- If `hydrate_reply_text` returns a cache-unavailable or WAL/replay error, check `refresh_status` once and tell the user to reload or restart the plugin session if the refresh already succeeded. Do not use Bash, `sleep`, `ls`, `rm`, or local DuckDB inspection as a fallback.
- Prefer the default `hydrate_reply_text` statuses `[1, -1, -2]` for interested, not interested, and wrong-person replies. Do not include out-of-office status `0` unless the user explicitly asks for OOO replies.
- Use `hydrate_reply_text(mode="auto")` before analysis; use `mode="continue"` only when the user wants more rows beyond the cached page.
- Separate positive, negative, and neutral outcomes from Instantly lead status before grouping by step or variant.
- When segmenting replies by enrichment variables, stay inside one campaign and read those variables from `lead_payload_kv`.
- Only quote or characterize exact reply-body language from hydrated `reply_body_text`; otherwise use Instantly reply outcomes and say reply bodies have not been hydrated yet.

## Example Requests

- "What are prospects actually saying?"
- "What objections keep showing up?"
- "Show me the human replies, not the OOO noise."
