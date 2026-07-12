# Deterministic analysis workflow re-evaluation

Date: 2026-07-12  
Baseline: `v0.1.49` / `c70a6e5`  
Linear: `SENDOSS-89`, `SENDOSS-90`, `SENDOSS-92`, `SENDOSS-94`; related `SENDOSS-91`, `SENDOSS-93`, `SENDOSS-62`

## Decision

Consolidate and re-scope the project. Do not build `plan_analysis` (`SENDOSS-90`), free-form `analysis_starters(question=...)` ranking (`SENDOSS-92`), or standalone MCP workflow bundles (`SENDOSS-93`) as written. They duplicate intent routing that now belongs to the five-skill layer. Cancel `SENDOSS-94` as a standalone implementation issue and treat its scenarios as acceptance criteria owned by each behavior slice.

No implementation issue is ready to start. The exact next action is a bounded evidence audit, coordinated in re-scoped `SENDOSS-92`, that separates three possible failure classes: host/skill routing, recipe selection, and SQL copy/parameter execution. The result determines whether to improve skill/eval coverage, design structured recipe discovery, or plan typed `execute_recipe` (`SENDOSS-91`). This review tranche does not implement code.

## Why the original sequence no longer holds

The project was scoped against `v0.1.42` on 2026-07-08. The current release is `v0.1.49`, and review of four shipped changes shows that three materially altered the decision:

- `0fac378` / PR #52 shipped Smartlead read-only parity, provider-qualified IDs, provider capability evidence, support-gated Smart Delivery semantics, and additional recipes/views. Any planner would now need to duplicate and continuously track a larger provider/evidence contract.
- `47da9be` / PR #53 replaced the previous public workflow surface with five tested skills. `sendlens-analyst` now owns diagnosis and broad orchestration; focused strategy, copy, launch, and setup skills own their decisions. Prompt and host-bundle tests enforce the routing and handoff contract.
- `cd65d06` / PR #54 added a structured `reply_coverage_summary` at the data/MCP boundary. This is the right pattern for deterministic claim semantics: put factual coverage state in the tool that owns the evidence, while skills decide when the evidence is required.
- `6a4f3ac` / PR #55 changed host packaging only. It strengthens install reliability but does not create a missing analysis-planning contract.

The Linear baseline is also stale in ways that increase maintenance risk: the parent/project cite 55 recipes and `SENDOSS-62` cites 37 public tables, while the current source contains 58 recipes and 45 public tables.

## Capability-by-capability evaluation

### `SENDOSS-90`: do not pursue

`plan_analysis` would duplicate the newly shipped skill layer. The current public contract already determines the broad-to-narrow sequence:

1. `workspace_snapshot` for broad reads;
2. `analysis_starters` before custom SQL;
3. one-campaign `load_campaign_data` for depth;
4. `prepare_campaign_analysis` before working/winner/scale/kill or reply-quality claims;
5. strategist → copywriter → launch operator when the request spans action.

That sequence is present in `INSTRUCTIONS.md`, the five public skills, nine specialist agents, generated host surfaces, and prompt/package tests. A second MCP response containing workflow, tools, evidence classes, claim gates, caveats, and next calls would not enforce that the host follows the plan; it would add another large contract that can drift from skills, provider capability rows, recipe metadata, and tool response schemas.

The likely costs exceed the residual benefit:

- response bloat before any evidence read;
- duplicated routing language across MCP, skills, agents, docs, and tests;
- new compatibility obligations for Instantly, Smartlead, demo mode, and legacy commands;
- privacy risk if optional scope fields or future planner output start echoing customer identifiers;
- false confidence from a deterministic-looking plan whose downstream calls remain model-directed.

Keep deterministic facts at their owning tool boundary, as PR #54 does. Keep workflow selection in the tested skill layer.

### `SENDOSS-92`: do not pursue as written

`analysis_starters` still accepts only `topic`, `recipe_id`, mode, and pagination. The agent must already know the topic. `search_catalog` partially fills the gap with deterministic concept hints for runway, scale, refill, deliverability, sender, rendered outbound, reply/reply body, payload, and tags, but it is a schema-discovery tool and does not rank the 58 recipes or cover every workflow family in `SENDOSS-92`.

That gap is real but not yet proven to be more consequential than the SQL copy/parameter failures in `SENDOSS-91`. Accepting a second free-form natural-language question at the MCP layer would also create two intent authorities: skills would interpret the user's job while `analysis_starters` independently interprets the same prose to choose recipes.

Re-scope `SENDOSS-92` as the evidence gate rather than an implementation issue. Run representative broad, campaign-depth, reply-quality, action-spanning, and multi-concept recipe requests against the supported host bundles that can be exercised locally. For representative parameterized recipes, record whether failure occurs during skill selection, recipe selection, placeholder/parameter handling, or guarded execution. Use public-safe demo fixtures only.

If the audit shows a material recipe-selection failure after the correct skill is active, re-scope the interface so the skill layer translates natural language into shared explicit concept tokens and `analysis_starters` ranks from those tokens. Any future slice must:

- reuse the existing concept-hint vocabulary rather than create a second matcher;
- return 3–5 compact recipe summaries by default, with explicit match reasons;
- prefer safe-summary recipes and suppress raw-detail defaults;
- preserve existing topic, exact-ID, mode, and pagination behavior exactly;
- land compatibility, privacy, provider-caveat, and response-size tests in the same PR.

### `SENDOSS-94`: consolidate into behavior slices

The standalone test issue mixes current metadata checks, future planner assertions, future typed-execution assertions, future ranking assertions, future bundle assertions, and the table-map work from `SENDOSS-62`. That creates TODO/stub pressure and separates behavior from its proof.

Each implementation PR should own its semantic contract tests. If recipe ranking is later justified, fold these `SENDOSS-94` cases into that behavior slice:

- compatibility for topic-only and exact-ID calls;
- deterministic multi-concept ranking;
- safe-summary-first behavior for reply bodies, rendered copy, recipients, and identifiers;
- bounded shortlist and no SQL by default;
- explicit match reasons and stable output fields;
- provider/capability caveat preservation where ranking touches unsupported evidence.

Keep only genuinely cross-cutting drift work as a re-scoped `SENDOSS-62` follow-up. Do not require every public table to appear in a recipe: operational, storage, and directly tool-owned tables can be valid without recipe references. Prefer source-derived semantic assertions over a checked-in generated JSON map that can become another stale artifact.

## Compatibility and safety boundaries

- Preserve all existing `analysis_starters` topic, recipe-ID, mode, pagination, and response fields.
- Preserve Instantly behavior, Smartlead V1 read-only parity, provider-qualified campaign IDs, support-gated Smart Delivery semantics, demo mode, and local-only data handling.
- Do not add provider mutations or automatic broad reply hydration.
- Do not return raw reply bodies, rendered bodies, recipient fields, contact fields, private identifiers, or customer campaign rows from routing/ranking calls.
- Default to compact metadata. Full SQL remains an explicit exact-recipe or bounded-page request.
- Treat skill routing as the workflow authority and MCP tools as deterministic evidence/query primitives.

## Recommended Linear changes

- `SENDOSS-90`: move to research/parked. Cancel only after the routed-request audit supports the five-skill supersession claim; a failed audit should improve the owning skill/eval surface before assuming an MCP planner is the fix.
- `SENDOSS-92`: rewrite as the single research action: run the bounded routed-request, recipe-selection, and parameter-execution audit, then record which implementation issue—if any—is justified.
- `SENDOSS-94`: cancel as a standalone issue; move applicable acceptance scenarios into `SENDOSS-92`, `SENDOSS-91`, and any future behavior-bearing PR.
- `SENDOSS-93`: move to research/parked with `SENDOSS-90`; cancel only if representative action-spanning requests confirm the five skills reliably compose the workflow.
- `SENDOSS-91`: remove the `SENDOSS-90` blocker but do not plan implementation yet. Proceed only if the audit reproduces material SQL-copy or parameter-validation failures.
- `SENDOSS-62`: return to research/rewrite before implementation because its counts and proposed all-table-reference invariant are stale.
- `SENDOSS-89` / project: change the current focus from MCP workflow planning to the bounded behavioral evidence gate.

## Evidence reviewed

- Local git history and diffs for `v0.1.47`–`v0.1.49`, including PRs #52–#55 and their review/validation records.
- Current `skills/*/SKILL.md`, `agents/*.md`, `INSTRUCTIONS.md`, `README.md`, `docs/CATALOG.md`, `docs/MCP_RESPONSE_CONTRACT.md`, and the PR #53 decision/plan artifacts.
- Current `plugin/query-recipes.ts`, `plugin/catalog.ts`, `plugin/server.ts`, `plugin/campaign-analysis-response.ts`, and relevant prompt, host-bundle, runtime, MCP-response, and reply-coverage tests.
- Full Linear descriptions, relations, attachments, comments, project description, project comments, and project status updates for `SENDOSS-89`–`SENDOSS-94` and `SENDOSS-62`. No issue attachments or child comments existed; `SENDOSS-62` had one adoption comment.
- Entire was checked, but this repo has no checkpoints on the branch and the CLI is not authenticated for search, so git/PR/Linear records are the available provenance source.

## Stop condition

Do not implement code in this review tranche. Resume implementation only after the re-scoped `SENDOSS-92` audit identifies a material failure class and the corresponding issue contract, dependency/privacy boundaries, and project Execution Index agree with that evidence.
