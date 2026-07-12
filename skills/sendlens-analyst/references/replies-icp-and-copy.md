# Reply, ICP, And Copy Intelligence

## Reply Evidence

1. Narrow to one campaign and call `load_campaign_data`.
2. Read reply outcomes before bodies. Separate positive, negative, wrong-person, neutral, and out-of-office states.
3. Use `prepare_campaign_analysis` when enough actual wording is required for diagnosis or a recommendation. Use `fetch_reply_text` only for a lower-level, bounded manual fetch.
4. Prefer `reply_email_context` after hydration because it preserves fetched bodies and labels context gaps.
5. Exclude out-of-office status `0` unless requested.

Quote or characterize wording only from hydrated `reply_body_text` or `reply_content_preview`. If bodies are not hydrated, describe outcomes rather than inventing sentiment.

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
