# Reply Hydration Caveats

`prepare_campaign_analysis` is the premium one-campaign workflow for enough actual inbound reply body text. `fetch_reply_text` remains the low-level manual fetch tool. Use both deliberately because they call Instantly List Email, which is rate-limited.

## When To Fetch

- Fetch only after the campaign is narrowed to exactly one campaign by ID or unambiguous name.
- Use `prepare_campaign_analysis` when the user wants working/not-working diagnosis, reply-quality analysis, or enough wording to support a recommendation.
- Fetch when the user asks what prospects actually said, asks for objections in their own words, or when reply-body wording materially changes the recommendation.
- Fetch when a campaign appears to be working from aggregate replies but the quality, relevance, or copy path of those replies could change the recommendation.
- Do not fetch during broad workspace triage or routine campaign ranking.

## Defaults

- Use `mode="sync_newest"` for current reply wording.
- `prepare_campaign_analysis` defaults to balanced depth: statuses `[1, -1, -2]`, up to 3 email pages/status, target 30 stored non-auto reply bodies/status, and lead-context backfill through `/leads/list`.
- Use default statuses `[1, -1, -2]`: interested, not interested, wrong person.
- Exclude out-of-office status `0` unless the user explicitly asks for OOO handling.
- Use `mode="continue"` only when the user asks to page older replies beyond the saved cursor.
- Avoid `mode="auto"` when the user expects fresh reply bodies.

## Evidence Classification

- Rows with `reply_email_id` and `reply_body_text` are `hydrated_reply_body` for the fetched pages/statuses.
- Prefer `reply_email_context` after premium hydration because it is anchored on fetched emails and marks `has_lead_context`, `has_template_context`, `hydrated_reply_body`, and `context_gap_reason`.
- `reply_context` without hydrated body text is reply outcome/context evidence, not exact wording.
- Hydrated reply bodies can be quoted briefly when asked; unfetched replies must be described from outcome labels only.
- If hydrated replies show prospects reacting to the wrong topic, wrong industry, or wrong template, treat the finding as setup/template-resolution risk before normal sentiment analysis.

## Fallback Behavior

- If hydration returns a cache-unavailable, WAL, replay, or readiness error, call `refresh_status` once.
- If refresh already succeeded or the error persists, tell the user to reload/restart the plugin session.
- Do not use Bash, `sleep`, filesystem inspection, raw DuckDB, repo inspection, or local cache surgery as fallback behavior.
