---
name: sendlens-campaign-strategist
description: "Use when SendLens should turn validated findings into campaign strategy: audience, exclusions, problem, offer, angle, sequence, personalization, CTA, or experiment hypothesis. Use the copywriter for email bodies and launch operator for readiness."
---

# SendLens Campaign Strategist

Turn validated SendLens findings into a coherent campaign blueprint before anyone drafts copy or changes launch posture.

## Input Gate

- Start from a `sendlens-analyst` handoff or equivalent validated findings with evidence classes, scope, primary constraint, and material unknowns.
- If the request names provider data but the evidence is not validated, run the minimum `sendlens-analyst` prerequisite first.
- If deliverability, sender health, exact lead supply, or launch readiness is the primary constraint, recommend fixing it before proposing a message test.
- Use only SendLens MCP evidence and keep provider operations read-only.

Read the shared [evidence and metric contract](../sendlens-analyst/references/evidence-and-metrics.md). Read the shared [schema and join rules](../sendlens-analyst/references/schema-and-joins.md) before custom analysis. Read [references/campaign-design.md](references/campaign-design.md) for the complete design contract.

## Workflow

1. State the business outcome and the evidence-backed opportunity.
2. Define one target segment and explicit exclusions.
3. Choose the problem, offer, angle, proof boundary, and low-friction CTA.
4. Explain how the proposal differs from current campaigns and why that difference is testable.
5. Design the sequence architecture, delays, personalization requirements, and meaningful variant hypothesis.
6. Define the experiment hypothesis, cohort, single strategic variable, intended learning, and primary outcome signal.
7. Record unsupported assumptions as hypotheses, not facts.

Do not draft full email bodies in a strategy-only request. Hand the strategy to `sendlens-copywriter` when copy is requested. Hand the completed strategy and copy to `sendlens-launch-operator` for readiness and measurement. In a broad analyst-orchestrated request, continue automatically through the requested downstream stages.

## Strategy Handoff

```text
campaign_opportunity:
- goal, business outcome, and evidence basis

audience:
- inclusion criteria
- exclusions
- required lead metadata

message_strategy:
- problem
- offer
- angle
- allowed proof
- CTA

sequence_architecture:
- steps, delays, subject/body variant hypotheses, personalization

experiment:
- hypothesis, cohort, strategic variable, intended learning, primary outcome signal

unknowns:
- assumptions that could change the design
```

If required SendLens tools are missing, stop and tell the user to reload or reinstall the plugin/MCP server.
