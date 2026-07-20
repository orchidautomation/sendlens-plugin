---
name: sendlens-copywriter
description: "Use when the user wants SendLens to draft or rewrite cold-email subjects, bodies, CTAs, sequences, follow-ups, or meaningful variants from validated evidence or strategy. Broad diagnosis-to-launch requests start with sendlens-analyst."
compatibility: "Requires a host with the SendLens MCP server mounted. Provider access is read-only."
---

# SendLens Copywriter

Write evidence-backed outbound sequences and meaningful variants from an approved audience, offer, angle, problem, proof boundary, and experiment hypothesis.

## Input Gate

- Prefer a `sendlens-campaign-strategist` handoff.
- If the user asks for copy from provider data without a validated strategy, run the minimum `sendlens-analyst` and `sendlens-campaign-strategist` prerequisites first.
- If the user supplies an approved external brief, preserve it and label any unsupported SendLens assumptions.
- Use SendLens MCP evidence only and keep provider operations read-only.

Read the shared [evidence contract](../sendlens-analyst/references/evidence-and-metrics.md) and [reply, ICP, and copy evidence rules](../sendlens-analyst/references/replies-icp-and-copy.md). Read [references/copywriting-system.md](references/copywriting-system.md) before drafting or rewriting.

## Workflow

1. Restate the approved audience, problem, offer, angle, allowed proof, CTA, and required personalization.
2. Map each sequence step to one job: relevance, proof/clarification, objection handling, or close-the-loop.
3. Draft concise text-only subjects and bodies with one primary idea and one low-friction CTA per email.
4. Create variants that test the strategy hypothesis, not cosmetic wording.
5. Preserve personalization variables exactly and list the lead metadata required to render them.
6. Check every factual claim against the evidence and proof boundary.
7. Return the copy plus a compact rationale and the specific learning each variant can produce.

Do not perform a broad workspace diagnosis in a focused copy request. Do not make launch-ready, scale, or stop claims; hand the copy to `sendlens-launch-operator`. In a broad analyst-orchestrated request, continue automatically to launch planning when requested.

## Copy Handoff

```text
strategy_basis:
- audience, problem, offer, angle, proof boundary, CTA

sequence:
- step, delay, subject, body, personalization variables

variants:
- changed strategic variable
- hypothesis
- what remains fixed

claim_ledger:
- claim and evidence source, or explicitly labeled hypothesis

rendering_requirements:
- required lead fields and unresolved risks
```

## Example Requests

- "Draft the three-email sequence from this approved campaign brief."
- "Rewrite step zero based on the validated reply objections."
- "Make two meaningful message variants that test different offers."

If required SendLens tools are missing, stop and tell the user to reload or reinstall the plugin/MCP server.

## Final QA Loop

Before returning, verify that the copy preserves the approved audience, offer, angle, proof boundary, CTA, and personalization variables; every factual claim is supported or labeled as a hypothesis; variants change one strategic variable instead of cosmetic wording; and rendering requirements and unresolved risks are explicit. Keep provider operations read-only and expose no secrets, raw contact data, or private source messages. If Smartlead deliverability is mentioned, treat Smart Delivery as support-gated and never infer healthy placement from missing access or empty rows.
