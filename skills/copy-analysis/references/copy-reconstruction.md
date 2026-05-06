# Copy Reconstruction Caveats

SendLens exposes both intended templates and locally reconstructed outbound copy. Keep them separate.

## Evidence Sources

- `campaign_variants` is exact intended template evidence from campaign details: step, variant, subject, body, delays.
- `rendered_outbound_context` and `rendered_outbound_sample` are locally reconstructed from templates plus sampled lead variables.
- `reply_context` can join reply outcomes, templates, reconstructed outbound, and hydrated reply bodies when available.

## Allowed Claims

- From `campaign_variants`: "the live/intended template for step X variant Y says..."
- From reconstructed outbound: "the local reconstruction rendered this way for sampled leads..."
- From unresolved token scans: "sampled reconstructed rows show unresolved `{{...}}` tokens..."
- From hydrated replies: "fetched inbound replies objected to..."

## Disallowed Claims

- Do not call reconstructed outbound exact delivered email text.
- Do not say every recipient saw a malformed variable from sampled reconstruction alone.
- Do not infer reply-body language from status labels.
- Do not recommend generic marketing rewrites without tying them to campaign evidence and cold-email constraints.

## Personalization Analysis

- Narrow to one campaign before inspecting variables.
- Use `lead_payload_kv` for campaign-specific payload variables; do not assume shared payload keys across campaigns.
- Pair token leak findings with affected sampled rows, step/variant, and whether the evidence is reconstructed or hydrated.
