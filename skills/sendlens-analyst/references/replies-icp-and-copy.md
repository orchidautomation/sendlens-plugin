# Reply, ICP, And Copy Intelligence

## Reply Evidence

1. Narrow to one campaign and call `load_campaign_data`.
2. Read reply outcomes before bodies. Separate positive, negative, wrong-person, neutral, and out-of-office states.
3. Use `prepare_campaign_analysis` when enough actual wording is required for diagnosis or a recommendation. Use `fetch_reply_text` only for a lower-level, bounded manual fetch.
4. Prefer `reply_email_context` after hydration because it preserves fetched bodies and labels context gaps.
5. Exclude out-of-office status `0` unless requested.

Quote or characterize wording only from hydrated `reply_body_text` or `reply_content_preview`. If bodies are not hydrated, describe outcomes rather than inventing sentiment.

### Required Hydration Coverage Report

After `prepare_campaign_analysis`, always use `reply_coverage_summary` and report:

1. the aggregate unique human reply count from `campaign_overview.reply_count_unique`;
2. the selected List Email statuses and whether OOO status `0` was excluded;
3. the `fetch_latest_of_thread` setting and the stored context latest-thread basis;
4. fetched and hydrated reply-body counts by status;
5. per-status and overall selected-bucket exhaustion state;
6. the explicit aggregate-to-hydrated numeric gap; and
7. the neutral coverage explanation.

Do not collapse the two surfaces into an unqualified “hydrated X of Y.” Hydrated rows are exact body evidence for the selected List Email status/latest-thread surface. The campaign aggregate is a separate exact aggregate and may not describe the same row population.

Exhausted selected status buckets mean the queried buckets exposed no further rows at that time. They do not prove every reply represented by the campaign aggregate has a hydrated body. A remaining gap can reflect unselected or unclassified provider statuses, `latest_of_thread` behavior, historical/provider-retention differences, or campaign-aggregate versus List Email semantics. Do not assert which cause applies without evidence. Once selected buckets are exhausted, maximum depth does not guarantee recovery of the gap.

## ICP And Payload Evidence

- Use exact campaign aggregates for the baseline and sampled lead/payload evidence for hypotheses.
- Inventory payload keys before value-level analysis unless the user names a key.
- Keep every payload finding campaign-scoped.
- Treat missing title, role, segment, source, or trigger fields as thin uploaded lead metadata, not provider enrichment failure.
- Convert strong sampled signals into a test cohort, not a permanent targeting rule.

Useful future-upload fields include job title, function, seniority, company category, geography, list source, and campaign-specific trigger.

## Copy Evidence

- `campaign_variants` is the source of truth for intended templates.
- `rendered_outbound_context` is sampled local reconstruction, not delivered text.
- Use reply outcomes and hydrated bodies to connect message choices to response quality.
- Run safe-summary personalization and rendered-copy recipes before opening raw detail.
- Treat unresolved account-signature tokens as reconstruction caveats. Investigate unresolved payload tokens as possible personalization failures.
- If replies discuss a different product, industry, compliance domain, or topic than the intended template, make setup/template-resolution risk the headline.

Draft or rewrite copy only after the campaign strategy identifies the audience, problem, offer, angle, and evidence. Do not generate generic rewrites disconnected from campaign evidence.
