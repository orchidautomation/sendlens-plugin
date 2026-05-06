# Metric Basis Rules

Use the metric that matches the question and evidence surface. Always name the basis when a ranking, winner, or runway estimate depends on it.

## Headline Performance

- Prefer `campaign_overview` or `campaign_analytics` for campaign-level ranking.
- Use unique reply rate over open rate for cold outbound quality.
- Treat bounce rate above 2% as attention-worthy and above 5% as a red flag unless the user provides a different operating threshold.
- Separate human replies from out-of-office and automated noise when the surface allows it.

## Step and Variant Ranking

- Use `step_analytics.unique_replies` and `unique_reply_rate_pct` only when coverage is real for the campaign/workspace.
- If step reply coverage is sparse or mostly null, switch to opportunities and `opportunity_rate_pct`.
- Preserve any recipe-provided `metric_basis` field, especially from `step-fatigue-by-campaign`.
- Do not compare subject lines, variants, or steps without stating whether the basis is `unique_reply_rate`, `opportunity_rate`, exact reply outcomes, or sampled reply evidence.

## Runway and Capacity

- New-lead runway is uncontacted lead supply divided by observed new-lead contact pace.
- Volume runway is the remaining sequence/follow-up tail based on step count, sent-by-step distribution, and delays.
- Schedule-adjusted pace should use observed campaign-attributed sending days, not a naive seven-calendar-day average.
- Real capacity should be grounded in recent observed peak and sender/account coverage before treating configured `daily_limit` as deliverable capacity.
- Always distinguish "out of new prospects" from "out of send volume"; follow-up steps can keep sending after step 0 is exhausted.

## Deliverability

- Use inbox-placement and sender/account evidence before blaming copy for low replies.
- Missing inbox-placement evidence means no local test data was available, not that inbox placement is healthy.
- Do not infer spam placement, SPF/DKIM/DMARC failures, blacklist issues, or tab/category placement from reply rate alone.
