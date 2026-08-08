# `experiment-planner`

Plans the next campaign experiment with a hypothesis, change, target cohort, success metric, guardrail, stop condition, and evidence basis.

Related: [catalog](../CATALOG.md), [trust and privacy](../TRUST_AND_PRIVACY.md), [synthetic examples](../examples/SYNTHETIC_OUTPUTS.md).

## Use When

- The user asks what to test next.
- A campaign needs improvement without guessing.
- The team needs to evaluate a change cleanly.

## Primary Surfaces

- Public skill: `skills/sendlens-campaign-strategist/SKILL.md`
- Reference: `skills/sendlens-campaign-strategist/references/campaign-design.md`
- Command: `/experiment-planner`
- Default agent: `campaign-strategist`
- MCP tools: `workspace_snapshot`, `analysis_starters`, `analyze_data`, `load_campaign_data`

## Expected Flow

1. Pull `analysis_starters(topic="experiment-planner")` for candidate ranking.
2. Pick one campaign before designing the experiment.
3. Run `experiment-validity-audit` before comparing variants, sender quality, sequence steps, reply cohorts, list freshness, or providers; use `decision-risk-evidence-gaps` for the remediation queue.
4. Do not propose copy tests while launch, sender, deliverability, or exact lead-supply blockers remain unresolved; do not infer a lead-supply blocker from `leads_count - contacted_count`.
5. Use analyst evidence for the selected reply, ICP, or copy lane.
6. Use the campaign strategist to define the hypothesis, cohort, changed variable, and intended learning.
7. Use the launch operator to define measurement, guardrails, read window, and stop/iterate/scale rules.
8. Check `diagnostics.analysis_eligibility` and the validity `comparison_state` before comparing variants or providers; invalid frames return a bounded evidence action instead of a statistical or winner claim.
9. When comparing saved report runs, cite the `analysis_receipt.receipt_id` and run `analysis-receipt-semantic-diff` before interpreting result changes; a changed freshness, sampling frame, dependency set, or metric contract is not outcome lift.

## Output Shape

- Recommended test lane.
- Hypothesis.
- Change to make.
- Target cohort or campaign scope.
- Success metric and guardrail metric.
- Minimum read window.
- Stop condition and evaluation date/window.
- Evidence basis and caveats.

## Evidence Boundaries

Every experiment should identify whether it is based on exact aggregate metrics, sampled lead evidence, fetched replies, reconstructed outbound copy, or operator judgment. The plan should avoid implying statistical certainty when the underlying evidence is directional.

`decision_eligible` is a local evidence-readiness state, not a significance result. `spillover_risk`, `measurement_gap`, and `non_comparable` require the named remediation before interpretation. Cross-provider matches remain guarded until metric definitions, exposure windows, denominators, and frame completeness are explicitly compatible.
