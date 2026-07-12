# Evidence And Metric Contract

## Evidence Classes

| Class | Use for | Allowed language |
| --- | --- | --- |
| `exact_aggregate` | Provider-derived campaign, account, step, template, tag, and deliverability aggregates | “The cached provider aggregate shows…” |
| `sampled_evidence` | Bounded lead, payload, non-reply, or outbound samples | “In the sampled evidence…” “This suggests…” |
| `reconstructed_outbound` | Locally rendered template plus sampled lead variables | “The local reconstruction rendered…” |
| `hydrated_reply_body` | Fetched inbound reply text | “The fetched inbound replies say…” |
| `inference` | Reversible analyst judgment tied to evidence | “Likely…” “I would test…” |
| `unsupported` | Missing source, scope, tool, or coverage | “SendLens cannot determine that from available evidence.” |

Never upgrade sampled, reconstructed, or inferred evidence into an exact business claim. Absent data is absent local evidence, not proof of health or failure.

## Metric Basis

- Prefer unique human reply rate over open rate for cold outbound quality.
- Treat bounce rate above 2% as attention-worthy and above 5% as a red flag unless the user supplies another threshold.
- For step or variant ranking, use `unique_reply_rate` only when step reply coverage is real. Otherwise use `opportunity_rate` and name the fallback.
- Separate human replies from automated and out-of-office replies whenever the evidence supports it.
- Treat exact new-lead runway as unknown unless a provider-specific remaining-lead field exists. Do not calculate it as `leads_count - contacted_count`.
- Distinguish new-prospect runway, remaining follow-up volume, schedule-adjusted pace, and practical sender capacity.
- For cross-provider comparisons, use normalized SendLens counts and preserve denominator caveats.

## Promotion Guard

Before calling a campaign working, a winner, ready to scale, or safe for a client recommendation:

1. Load the campaign with `load_campaign_data`.
2. Inspect exact campaign and step/variant aggregates.
3. Compare `campaign_variants`, reconstructed outbound context, and reply outcomes.
4. Call `prepare_campaign_analysis` when fetched wording could change the decision.
5. Reject false wins driven by out-of-office responses, wrong-person replies, mismatch complaints, or tiny denominators.

Until those checks pass, call the campaign a **metric leader requiring verification**.

## Reporting

- Include scope: workspace, provider, tag, campaign, time window, and active-only versus historical.
- Preserve sample size, row caps, truncation, and warnings only when material.
- Keep client-safe wording separate from internal action priority.
- Do not paste raw contact data, full reply bodies, or raw reconstructed bodies into external artifacts.
