# Campaign Design Contract

## Strategy Gate

Do not recommend a new campaign until the analysis identifies the primary constraint and verifies that a campaign or message test is the right intervention. A metric leader requiring verification is not enough evidence for a scale or clone recommendation.

## Opportunity Selection

Prefer opportunities supported by at least two compatible surfaces, such as exact campaign performance plus hydrated reply language, or exact reply outcomes plus sampled campaign-scoped segment evidence. Preserve conflicting evidence instead of averaging it away.

Choose one opportunity:

- Scale a validated audience/message combination into a controlled adjacent cohort.
- Repair a clear audience, offer, angle, or sequence mismatch.
- Test a reply-derived problem or objection with an explicit proof boundary.
- Improve lead metadata or evidence coverage before testing when the current opportunity is underdetermined.

## Campaign Recommendation Contract

Return:

```text
Campaign opportunity
- Goal and business outcome
- Evidence supporting the opportunity
- How it differs from existing campaigns

Audience
- Target segment
- Inclusion criteria
- Exclusion criteria
- Required uploaded lead fields

Message strategy
- Problem
- Offer
- Angle
- Allowed proof
- CTA

Sequence architecture
- Step count and delays
- Purpose of each step
- Subject and body variant hypotheses
- Personalization requirements

Experiment contract
- Hypothesis
- Target cohort
- One strategic variable to change
- Variables to hold fixed
- Intended learning
- Primary outcome signal for launch-operator handoff

Evidence ledger
- Exact findings
- Hydrated reply findings
- Sampled or reconstructed findings
- Inferences, conflicts, and missing evidence
```

## Boundaries

- Do not fabricate customer proof, quantified lift, product capabilities, or reply language.
- Do not use sampled ICP evidence as a permanent targeting rule.
- Do not turn cosmetic synonym changes into separate experiment variants.
- Do not draft full email bodies in a strategy-only workflow.
- Do not invent operational thresholds, read windows, or scale/stop rules; `sendlens-launch-operator` owns measurement and decision operations.
- Do not recommend launch or scale when the launch operator would classify a known prerequisite as blocked.
