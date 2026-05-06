---
name: "experiment-planner"
description: "Plan the next campaign experiment with hypothesis, metric, stop condition, and evidence basis."
---

# Experiment Planner

Plan the next campaign experiment with hypothesis, metric, stop condition, and evidence basis.

## Tools In This Skill

- `workspace_snapshot`
- `analysis_starters`
- `analyze_data`
- `load_campaign_data`

## References

- `../workspace-health/references/evidence-classes.md`
- `../workspace-health/references/metric-basis.md`
- `../workspace-health/references/output-schema.md`
- `../copy-analysis/references/copy-reconstruction.md`
- `../icp-signals/references/payload-analysis.md`
- `../reply-patterns/references/reply-hydration.md`

Read the evidence, metric, and relevant specialist references before proposing an experiment.

## When To Use

- Use this when the user asks what to test next, how to improve a campaign, what experiment to run, or how to evaluate a change.
- Pick one campaign before designing the actual experiment. Use broad recipes only to choose the lane.
- Do not propose a copy test if unresolved deliverability, sender, lead supply, or launch QA blockers are more likely to constrain results.

## Protocol

### Stage 1: Rank Candidate Lanes

- Start with `workspace_snapshot`, scoped by tag or campaign name when provided.
- Pull `analysis_starters(topic="experiment-planner")` first for candidate ranking.
- Use exact campaign/account/tag aggregates to decide whether the next test lane is deliverability, launch readiness, copy, ICP/segment, reply handling, or sequence mechanics.

### Stage 2: Load The Chosen Campaign

- Once a campaign is selected, run `load_campaign_data` before designing the test.
- If the lane is copy, switch to `copy-analysis` evidence.
- If the lane is ICP/segment, switch to `icp-signals` evidence.
- If the lane is reply quality or objection handling, switch to `reply-patterns` evidence.
- Use `analyze_data` only through the SendLens MCP tool when a starter recipe or focused custom metric is needed.

### Stage 3: Define A Testable Plan

- Every experiment must include hypothesis, change, target cohort, success metric, guardrail metric, minimum read window, stop condition, evaluation date/window, and what not to change.
- Choose success metrics from the metric-basis reference: unique reply rate, opportunity rate, positive reply share, bounce guardrail, or another stated exact/sampled basis.
- Keep one primary variable per experiment unless the user explicitly wants a bundled operational fix.

### Stage 4: Calibrate Confidence

- Call out whether the plan is based on exact aggregate metrics, sampled lead evidence, reconstructed outbound copy, hydrated reply bodies, or inference.
- If evidence is thin, frame the plan as a discovery test and lower certainty.
- Do not turn sampled ICP or reconstructed-copy findings into guaranteed lift claims.

## Fallback Behavior

- If required SendLens MCP tools are missing, stop and tell the user to reload or reinstall the plugin/MCP server.
- If the evidence cannot support a clean experiment, recommend the diagnostic read needed before testing.
- Do not use Bash, `jq`, shell DuckDB access, repository inspection, local cache files, or setup scripts as fallback analysis paths.

## Output Shape

- Recommended test lane.
- Hypothesis.
- Change to make.
- Target cohort or campaign scope.
- Success metric and guardrail metric.
- Minimum read window and stop condition.
- What not to change.
- Evidence basis and caveats.

## Example Requests

- "What should we test next?"
- "Make an experiment plan for this campaign."
- "How should we improve reply rate without guessing?"
- "What test would you run first for this client?"
