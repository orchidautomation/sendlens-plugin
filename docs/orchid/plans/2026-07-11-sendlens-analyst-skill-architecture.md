# SendLens Analyst Skill Architecture

Linear: `SEND-199`

## Goal

Make sophisticated outbound analysis feel like one request while preserving the evidence discipline, specialist review lanes, and read-only provider boundary already built into SendLens.

## Product Shape

- Publish five focused public skills: analyst, campaign strategist, copywriter, launch operator, and setup.
- Keep `sendlens-analyst` as the broad orchestrator so an end-to-end request still feels like one action.
- Keep `sendlens-setup` separate because installation and runtime troubleshooting have different triggers and failure modes.
- Keep shared evidence/schema rules under the analyst and job-specific depth under each focused skill.
- Retain legacy slash commands as explicit shortcuts and host-specific specialist routing, not as competing public skills.
- Keep the MCP server and semantic tables as the deterministic data layer. Skills choose evidence and reason over it; they do not bypass it.

## Closed Loop

1. Resolve the business decision.
2. Read workspace-level exact aggregates and freshness.
3. Choose one campaign for depth.
4. Hydrate and validate reply, ICP, template, and rendered-copy evidence.
5. Diagnose the constraint and preserve conflicting evidence.
6. Hand validated findings to the campaign strategist for audience, offer, angle, proof, CTA, sequence, exclusions, and experiment design.
7. Hand the strategy to the copywriter for evidence-backed sequence drafting.
8. Hand strategy and copy to the launch operator for blockers, measurement, stop/scale rules, and learning/client summary.

## Evaluation

- Validate all five public skills against the official Agent Skills specification.
- Keep realistic output-evaluation cases for every skill plus a broad full-chain orchestration case.
- Keep positive and near-miss trigger-query corpora to catch over-triggering and under-triggering.
- Enforce the architecture in prompt-contract and generated-host inventory tests.
- Run plugin smoke, validation, lint, and host-bundle tests before closeout.

## Migration

- Existing workflow command names remain available.
- Existing specialist agent files remain available.
- Current Instantly and Smartlead read-only behavior, MCP response contracts, local storage, demo mode, and privacy boundaries remain unchanged.
- Pluxx remains responsible for translating commands and agents across Claude Code, Cursor, Codex, and OpenCode.
