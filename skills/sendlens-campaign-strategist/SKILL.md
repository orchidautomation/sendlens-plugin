---
name: sendlens-campaign-strategist
description: "Use when SendLens should turn validated findings into focused campaign strategy: audience, exclusions, problem, offer, angle, sequence, personalization, CTA, or experiment hypothesis. Broad diagnosis-to-launch requests start with sendlens-analyst."
compatibility: "Requires a host with the SendLens MCP server mounted. Provider access is read-only."
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
- hypothesis, cohort, strategic variable, variables held fixed, intended learning, primary outcome signal

copy_handoff:
- defer drafting to sendlens-copywriter with the audience, offer, angle, proof boundary, CTA, and personalization inputs

evidence_ledger:
- exact findings
- hydrated reply findings
- sampled or reconstructed findings
- inferences, conflicts, and missing evidence

unknowns:
- assumptions that could change the design
```

## Example Requests

- "Recommend the next campaign from these validated findings."
- "Define the audience, exclusions, offer, and angle for our next outbound test."
- "Synthetic brief: an exact 1,200-send campaign has a 0.7% bounce rate and 18 human replies; hydrated replies show five pricing objections, while the sampled operations-manager segment has the strongest positive-reply signal. Design one campaign blueprint with explicit exclusions, allowed proof, a low-friction CTA, and one test variable."

If required SendLens tools are missing, stop and tell the user to reload or reinstall the plugin/MCP server.

## Final QA Loop

Before returning, verify that the blueprint traces to the validated findings; unsupported assumptions remain labeled as hypotheses; the audience, exclusions, proof boundary, CTA, fixed variables, and single strategic test variable are explicit; and no full email bodies, provider mutations, secrets, raw contact data, or private message bodies appear. If Smartlead deliverability affects the design, treat Smart Delivery as support-gated and never infer healthy placement from missing access or empty rows.
