# Evidence-Backed Copywriting System

## Evidence Ladder

Use the strongest available input in this order:

1. Approved campaign strategy and allowed proof.
2. Exact intended templates from `campaign_variants`.
3. Hydrated reply wording from `reply_email_context` or `reply_context`.
4. Sampled campaign-scoped lead and payload evidence.
5. Reconstructed outbound evidence for rendering and personalization QA.
6. Explicitly labeled hypotheses.

Never promote reconstructed, sampled, or inferred language into customer proof.

## Sequence Rules

- Give each email one job and one low-friction CTA.
- Prefer concise text-only copy.
- Lead with relevance and the prospect's problem, not an unsupported company claim.
- Use follow-ups to add a new reason to respond, clarify the offer, address a real objection, or close the loop.
- Keep open and link tracking off for ordinary cold outbound unless the approved strategy gives a deliberate exception.
- Preserve approved exclusions and avoid language that would attract a disqualified segment.

## Meaningful Variants

A valid variant changes one strategic variable while holding the rest constant:

- problem framing
- offer framing
- proof type
- CTA friction
- sequence timing or step purpose

Synonyms, punctuation, greeting changes, and superficial subject changes are not meaningful experiments.

## Personalization And Claims

- Preserve variables exactly and list every required source field.
- Do not invent fallback values that could render as false personalization.
- Treat unresolved payload tokens as launch risks.
- Do not fabricate customer proof, quantified lift, product capabilities, urgency, scarcity, or reply language.
- Remove an unsupported claim or label it as a hypothesis outside the send-ready copy.

## Output

For each step include delay, subject variants, body variants, CTA, personalization variables, and strategic job. Then record the experiment contract separately: the changed strategic variable, hypothesis, and variables that remain fixed. Finish with a claim ledger and rendering requirements.
