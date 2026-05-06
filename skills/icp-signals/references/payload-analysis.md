# Payload Analysis Rules

Lead payload fields are campaign-specific sampled evidence. In normal Instantly workflows these fields come from the uploaded lead list or campaign custom fields. Treat them as hypothesis material unless the user has provided external proof.

## Protocol

1. Fix the campaign scope before payload analysis.
2. Run the payload-key inventory recipe when the user has not named a specific key.
3. Use payload presence signals to decide which key deserves value-level analysis.
4. Use payload key signals only after choosing one exact key.
5. Keep value-level claims scoped to the sampled rows and campaign.

## Evidence Discipline

- `lead_payload_kv` avoids JSON path edge cases and should be preferred over raw JSON functions.
- Payload-key presence is not causal proof.
- Payload keys are not portable across campaigns unless exact evidence shows the same key exists in each scoped campaign.
- Blank `job_title`, role, segment, or payload fields mean the uploaded lead metadata is thin or not populated in the sampled rows. Do not describe this as an Instantly enrichment failure.
- Require enough rows before ranking values; if sample counts or metadata coverage are thin, say which fields should be added to future uploaded lead lists and how those fields would improve future analysis.

## Language

- Allowed: "sampled leads with this key were more likely to reply", "directional segment hypothesis", "candidate ICP test".
- Allowed: "future uploads should include job title, function, seniority, company category, geography, source/list, or trigger fields so SendLens can analyze these segments more thoroughly."
- Disallowed: "this is the ICP", "all companies in this segment perform better", "exclude this segment" without an exact or tested basis.
- Disallowed: "Instantly enrichment never loaded titles", "Instantly failed to enrich these leads", or other phrasing that blames Instantly for metadata that is normally supplied by uploaded lists.
