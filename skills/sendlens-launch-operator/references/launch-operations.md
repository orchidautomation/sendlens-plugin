# Launch Operations And Learning Handoff

## Readiness Gate

Check:

- correct provider-qualified campaign identity
- sender assignment and account health
- exact lead-supply evidence when available; otherwise state that supply is unknown
- schedule, timezone, sequence delays, and step ordering
- intended templates and blank-body risk
- open/link tracking posture, bounce protection, risky-contact handling, and unsubscribe behavior
- available inbox-placement, authentication, blacklist, spam-filter, and provider capability evidence
- sampled personalization rendering and unresolved tokens

Verdicts:

- `blocked`: a missing or risky prerequisite should stop launch, resume, clone, or scale.
- `ready_with_warnings`: operation can proceed only with an explicit remediation or monitoring action.
- `ready`: exact campaign/settings evidence shows no known blocker and sampled reconstruction shows no material warning.

## Scale And Stop Rules

- Do not scale a metric leader until reply quality, intended copy, and denominator quality are validated.
- Set an initial bounded cohort and volume rather than an unqualified full rollout.
- Use unique human reply or opportunity rate as the primary outcome when coverage supports it.
- Track bounce, negative/mismatch replies, sender health, placement, and personalization failures as guardrails.
- Stop for material sender/deliverability deterioration, wrong-template evidence, personalization leakage, or a predeclared failure threshold.
- Iterate when the test is operationally valid but the primary outcome misses its threshold.
- Scale only when the primary outcome clears its threshold without violating guardrails.

## Learning Handoff

Record:

1. Original hypothesis and target cohort.
2. Strategy and copy variables intentionally changed.
3. Variables held fixed.
4. Launch configuration and evidence coverage.
5. Primary and guardrail metrics.
6. Stop/iterate/scale decision and rationale.
7. New evidence to feed back to `sendlens-analyst`, `sendlens-campaign-strategist`, or `sendlens-copywriter`.

## Client Or Account Handoff

Separate internal action priority from client-safe language. Include current read, what changed, the operational decision, ranked next actions, watchlist, and only evidence caveats that change the recommendation. Do not expose raw contact data, private reply bodies, or unsupported causation.
