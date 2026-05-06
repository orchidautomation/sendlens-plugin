# Payload Analysis Rules

Lead payload fields are campaign-specific sampled evidence. Treat them as hypothesis material unless the user has provided external proof.

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
- Require enough rows before ranking values; if sample counts are thin, say which enrichment should be collected or tested next.

## Language

- Allowed: "sampled leads with this key were more likely to reply", "directional segment hypothesis", "candidate ICP test".
- Disallowed: "this is the ICP", "all companies in this segment perform better", "exclude this segment" without an exact or tested basis.
