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

## Usage

- Use this when the user asks what to test next, how to improve a campaign, what experiment to run, or how to evaluate a change.
- Pull `analysis_starters(topic="experiment-planner")` first for candidate ranking.
- Stay inside the SendLens MCP tool surface. If required SendLens tools are missing, stop and tell the user to reload or reinstall the plugin/MCP server. Do not inspect local files, run shell setup checks, parse cached outputs with `jq`, or query DuckDB through shell fallbacks.
- Pick one campaign before designing the actual experiment. Use the candidate recipe only to choose the lane.
- Do not propose a copy test if the campaign has unresolved deliverability, sender, lead supply, or launch QA blockers.
- If the test lane is copy, switch to `copy-analysis` after loading the campaign.
- If the test lane is ICP/segment, switch to `icp-signals` after loading the campaign.
- If the test lane is reply quality or objection handling, switch to `reply-patterns`.
- Every experiment must include hypothesis, change, target cohort, success metric, minimum read window, stop condition, and what not to change during the test.
- Call out whether the plan is based on exact aggregate metrics, sampled lead evidence, fetched replies, or reconstructed outbound copy.

## Output Shape

- Recommended test lane.
- Hypothesis.
- Change to make.
- Target cohort or campaign scope.
- Success metric and guardrail metric.
- Stop condition and evaluation date/window.
- Evidence basis and caveats.

## Example Requests

- "What should we test next?"
- "Make an experiment plan for this campaign."
- "How should we improve reply rate without guessing?"
- "What test would you run first for this client?"
