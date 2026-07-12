# Workspace And Campaign Performance

## Broad Triage

1. Start with `workspace_snapshot`, preserving campaign, provider, or tag scope.
2. Pull the matching `analysis_starters` topic before custom SQL.
3. Rank exact risks and opportunities: reply efficiency, bounce risk, opportunity production, recent movement, sender coverage, capacity, tracking settings, and evidence gaps.
4. Choose the single campaign and specialist lane that deserve depth.

Default broad reads to active campaigns. Include inactive or historical campaigns only when requested.

## Diagnostic Order

1. Evidence freshness and coverage.
2. Sending volume, recent movement, and runway.
3. Sender assignment, account health, and deliverability evidence.
4. Human reply and opportunity quality.
5. ICP/list quality.
6. Step, variant, template, and copy mechanics.

Do not blame copy before checking available sender and deliverability evidence.

## Campaign, Step, And Variant Decisions

- Use `campaign_overview` or `campaign_analytics` for campaign ranking.
- Use `campaign_daily_metrics` for recent-versus-prior movement.
- Use `step_analytics` for sequence fatigue and step/variant ranking.
- Use `campaign_variants` to connect a metric back to the intended subject and body.
- State whether the ranking basis is unique reply rate, opportunity rate, exact reply outcomes, or sampled evidence.
- Treat low-volume leaders as candidates for validation, not winners.

## Runway And Capacity

- Do not infer exact uncontacted leads from total minus contacted.
- Use campaign-attributed daily pace for schedule-aware activity.
- Separate campaign limits from resolved sender-account limits and observed peak capacity.
- Distinguish exhausted new-lead supply from remaining follow-up volume.

## Deliverability

- Combine campaign tracking/guardrail settings, account health, sender coverage, and placement tests.
- Missing placement rows mean no local test evidence.
- Do not infer spam placement, categories, SPF, DKIM, DMARC, or blacklist failure from reply rate.
- Treat Smartlead placement as unsupported unless `provider_capabilities` or Smart Delivery surfaces show support.
