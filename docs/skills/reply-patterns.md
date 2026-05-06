# `reply-patterns`

Surfaces reply outcome patterns, separates human replies from noise, and uses exact reply body text only when it has been fetched.

Related: [catalog](../CATALOG.md), [trust and privacy](../TRUST_AND_PRIVACY.md), [synthetic examples](../examples/SYNTHETIC_OUTPUTS.md).

## Use When

- The user asks what prospects are saying.
- Positive, negative, neutral, wrong-person, or out-of-office cohorts need to be separated.
- The user wants objections, interest signals, or reply outcomes by step, variant, or segment.

## Primary Surfaces

- Skill source: `skills/reply-patterns/SKILL.md`
- Command: `/reply-patterns`
- Default agent: `reply-auditor`
- MCP tools: `workspace_snapshot`, `fetch_reply_text`, `analysis_starters`, `analyze_data`, plus `load_campaign_data` for one-campaign work

## Expected Flow

1. Scope to one campaign unless the user explicitly asks for a workspace-wide comparison.
2. Pull `analysis_starters(topic="reply-patterns")`.
3. Query `reply_context` first for reply outcome evidence.
4. Run `fetch_reply_text` for exactly one campaign only when actual reply wording is needed.
5. Separate positive, negative, and neutral outcomes from Instantly lead status before grouping by step or variant.

## Output Shape

- Reply outcome mix.
- Positive patterns.
- Negative or wrong-person patterns.
- Step, variant, or segment concentrations.
- Fetched reply-body themes when available.
- Caveat on whether exact reply body text was fetched.

## Evidence Boundaries

By default, reply labels come from Instantly lead state. Only quote or characterize actual reply-body language from `reply_body_text` after `fetch_reply_text` has written exact reply rows into local DuckDB. Out-of-office status `0` is excluded by default unless the user asks for OOO replies.
