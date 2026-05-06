# `experiment-planner`

Plans the next campaign experiment with a hypothesis, change, target cohort, success metric, guardrail, stop condition, and evidence basis.

Related: [catalog](../CATALOG.md), [trust and privacy](../TRUST_AND_PRIVACY.md), [synthetic examples](../examples/SYNTHETIC_OUTPUTS.md).

## Use When

- The user asks what to test next.
- A campaign needs improvement without guessing.
- The team needs to evaluate a change cleanly.

## Primary Surfaces

- Skill source: `skills/experiment-planner/SKILL.md`
- Command: `/experiment-planner`
- Default agent: `campaign-analyst`
- MCP tools: `workspace_snapshot`, `analysis_starters`, `analyze_data`, `load_campaign_data`

## Expected Flow

1. Pull `analysis_starters(topic="experiment-planner")` for candidate ranking.
2. Pick one campaign before designing the experiment.
3. Do not propose copy tests while launch, sender, deliverability, or lead-supply blockers remain unresolved.
4. Switch to `copy-analysis`, `icp-signals`, or `reply-patterns` based on the selected test lane.
5. State what must not change during the test.

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
