# Deterministic analysis workflow re-evaluation

Date: 2026-07-12  
Baseline: `v0.1.49` / `c70a6e5`  
Linear: `SENDOSS-89`, `SENDOSS-90`, `SENDOSS-92`, `SENDOSS-94`; related `SENDOSS-91`, `SENDOSS-93`, `SENDOSS-62`

## Decision

Consolidate and re-scope the project. Do not build `plan_analysis` (`SENDOSS-90`), free-form `analysis_starters(question=...)` ranking (`SENDOSS-92`), or standalone MCP workflow bundles (`SENDOSS-93`) as written. They duplicate intent routing that now belongs to the five-skill layer. Cancel `SENDOSS-94` as a standalone implementation issue and treat its scenarios as acceptance criteria owned by each behavior slice.

Brandon subsequently clarified the product requirement: the five-skill architecture must explicitly spawn or delegate bounded specialist subagents on hosts that support them, and prompt/tests must enforce that behavior. Re-scope `SENDOSS-92` as the single review-ready implementation slice. Do not start code until Brandon approves its Linear contract.

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

### `SENDOSS-92`: enforce delegated specialist execution

The current package proves that nine specialist agents exist, use `mode: subagent`, and survive host generation. It does not require the coordinator to spawn them. `INSTRUCTIONS.md` says to invoke a specialist only when native delegated agents are available and the extra pass materially improves the answer; `sendlens-analyst` says to use focused skills and continue through downstream stages. Prompt tests assert those terms and generated mappings, but not a required delegation sequence.

The replacement contract is narrower than a new MCP planner and stronger than the current prose:

- the coordinator explicitly spawns or delegates the owning specialist when a supported host has native subagents and the request crosses a specialist boundary;
- workspace triage selects one campaign before deeper campaign, reply, ICP, or copy delegation;
- dependent strategy → copy → launch work runs sequentially using the compact handoff contract rather than parallel fan-out;
- unrelated specialist work may run in parallel only after scope is fixed and file/data/tool contention is absent;
- the coordinator owns evidence calibration, conflict resolution, and the final answer;
- hosts without native subagents follow the same bounded lanes inline instead of silently dropping the specialist pass;
- prompt contracts, generated-host inventory checks, skill evals, and at least one available host-native behavioral receipt fail or flag when required delegation is absent.

This enforces the shipped architecture at the orchestration boundary without adding `plan_analysis`, recipe ranking, typed execution, or workflow-bundle MCP tools.

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
- Preserve bounded orchestration: no campaign-specialist fan-out before workspace triage selects scope, and no parallel execution for strategy/copy/launch stages that depend on prior handoffs.
- Use host-native specialist subagents when available; preserve an explicit inline fallback when a host cannot delegate.

## Recommended Linear changes

- `SENDOSS-90`: cancel as superseded by the five-skill architecture plus the explicit delegation contract in `SENDOSS-92`.
- `SENDOSS-92`: rewrite as the single high-priority Todo for human review: enforce bounded specialist spawning/delegation in prompts, generated bundles, evals, and behavioral verification.
- `SENDOSS-94`: cancel as a standalone issue; move applicable acceptance scenarios into `SENDOSS-92`, `SENDOSS-91`, and any future behavior-bearing PR.
- `SENDOSS-93`: cancel as superseded by enforced specialist delegation through the existing skills and agents.
- `SENDOSS-91`: keep as low-priority future research; typed execution remains independent and has no current evidence gate.
- `SENDOSS-62`: cancel the stale generated-map proposal; future behavior slices own source-derived semantic drift tests.
- `SENDOSS-89` / project: make `SENDOSS-92` the sole active review queue and list all other work as future or sunset.

## Evidence reviewed

- Local git history and diffs for `v0.1.47`–`v0.1.49`, including PRs #52–#55 and their review/validation records.
- Current `skills/*/SKILL.md`, `agents/*.md`, `INSTRUCTIONS.md`, `README.md`, `docs/CATALOG.md`, `docs/MCP_RESPONSE_CONTRACT.md`, and the PR #53 decision/plan artifacts.
- Current `plugin/query-recipes.ts`, `plugin/catalog.ts`, `plugin/server.ts`, `plugin/campaign-analysis-response.ts`, and relevant prompt, host-bundle, runtime, MCP-response, and reply-coverage tests.
- Current prompt/test gap: specialist registration and `mode: subagent` are enforced, but coordinator spawning/delegation is discretionary and has no behavioral contract assertion.
- Full Linear descriptions, relations, attachments, comments, project description, project comments, and project status updates for `SENDOSS-89`–`SENDOSS-94` and `SENDOSS-62`. No issue attachments or child comments existed; `SENDOSS-62` had one adoption comment.
- Entire was checked, but this repo has no checkpoints on the branch and the CLI is not authenticated for search, so git/PR/Linear records are the available provenance source.

## Stop condition

Do not implement code until Brandon reviews and approves the re-scoped `SENDOSS-92` Linear contract. After approval, route to `ce-plan` and then `ce-work`; keep all other deterministic-analysis tickets out of the active queue.
