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
- Default agent: `campaign-analyst`
- MCP tools: `workspace_snapshot`, `analysis_starters`, `analyze_data`, `load_campaign_data`

## Expected Flow

1. Pull `analysis_starters(topic="experiment-planner")` for candidate ranking.
2. Pick one campaign before designing the experiment.
3. Do not propose copy tests while launch, sender, deliverability, or exact lead-supply blockers remain unresolved; do not infer a lead-supply blocker from `leads_count - contacted_count`.
4. Use analyst evidence for the selected reply, ICP, or copy lane.
5. Use the campaign strategist to define the hypothesis, cohort, changed variable, and intended learning.
6. Use the launch operator to define measurement, guardrails, read window, and stop/iterate/scale rules.

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
