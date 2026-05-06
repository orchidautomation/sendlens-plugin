# SendLens Evidence Classes

Use these labels whenever a SendLens answer makes a claim. If a claim mixes sources, report the weakest material class.

## Classes

| Class | What qualifies | Allowed language | Suppress or caveat |
|-------|----------------|------------------|--------------------|
| `exact_aggregate` | Instantly-derived local aggregate or metadata tables/views: `campaigns`, `campaign_analytics`, `campaign_daily_metrics`, `step_analytics`, `campaign_variants`, account/tag/inbox-placement surfaces, and `campaign_overview`. | "The cached Instantly aggregate shows..." "This campaign has..." | Do not imply causation from aggregates alone. Do not treat missing inbox-placement rows as clean deliverability. |
| `sampled_evidence` | Bounded lead, payload, non-reply, or outbound samples: `lead_evidence`, `lead_payload_kv`, `sampled_leads`, `sampled_outbound_emails`, sample sections from `load_campaign_data`. | "In the sampled evidence..." "This suggests..." "Worth testing..." | Do not say "all leads", "best ICP", or "statistically proven" from sampled rows. Include sample size or coverage when available. |
| `reconstructed_outbound` | `rendered_outbound_context`, `rendered_outbound_sample`, or copy reconstructed from templates plus lead variables. | "Locally reconstructed outbound copy..." "This may indicate a rendering issue..." | Never call it exact delivered email text. Do not quote it as what the prospect definitely received. |
| `hydrated_reply_body` | `reply_body_text`/`reply_content_preview` returned after `fetch_reply_text` or rows with `reply_email_id` from `reply_context`. | "Fetched inbound reply body..." "The fetched reply says..." | Only use for fetched statuses/pages. Do not imply unfetched replies contain the same language. |
| `inference` | Model judgment from exact, sampled, reconstructed, or hydrated evidence. | "Likely..." "A reasonable next test is..." "I would prioritize..." | Tie the inference to evidence and keep it reversible. Avoid certainty language. |
| `unsupported` | The claim needs data SendLens did not return, a missing tool, a missing campaign scope, or an unavailable evidence surface. | "SendLens cannot determine that from the available evidence." | Suppress as a finding unless the user needs to know why an answer cannot be given. Do not fill gaps with assumptions. |

## Calibration Rules

- Exactness is source-specific, not query-specific. A precise query over sampled evidence is still sampled.
- `analysis_starters.exactness` is authoritative recipe guidance; preserve it in the answer when the recipe drove the analysis.
- `analyze_data` returns JSON text with `row_count`, `result_truncated`, `warnings`, and `output_limits`. Those fields are part of the evidence basis, not footnotes to ignore.
- If a result is truncated, narrowed, capped, or sampled, mention that only when it materially affects the recommendation.
- Treat absent data as absent local evidence, not proof of health or proof of failure.
- Never upgrade `sampled_evidence`, `reconstructed_outbound`, or `inference` into an exact business claim.

## Public-Safe Reporting

- Do not expose raw personal data unless the user explicitly asks for examples and the tool returned those examples.
- Prefer campaign names, step/variant labels, aggregate counts, and short paraphrases over long copied bodies.
- Quote fetched reply bodies only when the user asked for wording and keep excerpts short.
