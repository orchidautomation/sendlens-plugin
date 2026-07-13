# SENDOSS-92 Specialist Delegation Enforcement

Date: 2026-07-12
Origin: `SENDOSS-92`, `docs/orchid/decisions/2026-07-12-deterministic-analysis-workflow-review.md`
Target: PR #56 to `main`

## Goal

Make the existing five-skill SendLens architecture explicitly require bounded specialist subagent delegation on hosts that support it, while preserving direct fast paths, one-campaign scoping, read-only provider behavior, privacy boundaries, and an honest inline fallback on hosts without delegation.

## Scope Boundaries

- Do not add MCP planner, ranking, execution, or workflow-bundle tools.
- Do not change provider, data-model, query, demo, or MCP response contracts.
- Do not add provider writes, nested specialist spawning, unbounded fan-out, or parallel dependent stages.
- Keep simple inventory, freshness, setup, and status requests on direct MCP or owning-skill paths without specialist spawning.
- Keep the root coordinator responsible for every spawn, handoff, evidence synthesis, conflict, and final answer.

## Key Decisions

- Broad workspace diagnosis must delegate `workspace-triager` first on capable hosts.
- Campaign-depth lanes may delegate only after one campaign is selected, and only to the specialist needed for the decision: `campaign-analyst`, `reply-auditor`, `icp-auditor`, or `copy-auditor`.
- Focused strategy, copy, and launch requests delegate the owning specialist after minimum prerequisites are satisfied.
- Broad analysis-to-launch work runs sequentially through analyst evidence, `campaign-strategist`, `campaign-copywriter`, and `launch-operator`.
- Broad or client-safe recommendations receive a final `synthesis-reviewer` pass.
- Hosts without native delegation execute the same lane boundaries inline and must not claim a spawn occurred.

## Implementation Units

### U1. Prompt orchestration contract

Files:

- `INSTRUCTIONS.md`
- `skills/sendlens-analyst/SKILL.md`

Approach:

- Replace discretionary specialist language with explicit capability-aware must-delegate rules.
- State the no-spawn fast paths, triage-before-depth ordering, sequential downstream chain, bounded parallelism, synthesis gate, coordinator ownership, and inline fallback.

Verification scenarios:

- Simple inventory/freshness stays direct.
- Broad workspace diagnosis delegates triage before depth.
- One-campaign reply/ICP/copy work delegates only the owning lane.
- Full-chain work delegates dependent stages sequentially.
- Client-safe broad output receives synthesis review.
- Unsupported hosts preserve the same lanes inline without pretending to spawn.

### U2. Semantic prompt and host-bundle contracts

Files:

- `scripts/test-prompt-contracts.mjs`
- `scripts/test-host-bundle-inventory.mjs`

Execution note: strengthen the contract tests first and observe the expected failure before changing prompts.

Approach:

- Assert imperative delegation language, all required agent names, ordering, no-spawn fast paths, bounded parallelism, coordinator ownership, and inline fallback.
- Assert generated Codex guidance preserves the same orchestration contract and all specialist registrations.

Verification scenarios:

- Removing a required agent, ordering clause, fallback clause, or no-spawn rule fails prompt contracts.
- Generated host guidance fails when delegation semantics disappear during translation.

### U3. Eval coverage and public workflow documentation

Files:

- `skills/sendlens-analyst/evals/evals.json`
- `skills/sendlens-analyst/evals/trigger-queries.json`
- `README.md` only if the public workflow summary requires alignment.

Approach:

- Add behavioral expectations for actual delegation lanes, sequential order, anti-fan-out, no-spawn fast paths, and inline fallback.
- Keep eval data public-safe and provider-neutral.

### U4. Validation, review, merge, and release

Validation:

- `npm run test:prompt-contracts`
- `npm run test:host-bundles`
- `npm run test:plugin:smoke`
- `npm run validate:plugin`
- `npm run lint:plugin`
- `npm run test:plugin`
- official skills validation for all five public skills when available
- `npm run release:check`

Closeout:

- Run code review and resolve findings.
- Update PR #56 and SENDOSS-92 with implementation evidence.
- Merge only after GitHub reports the current head review/check gates clean.
- Follow the repository's established release process for the next patch version; verify the released tag/package and installed host bundle without exposing private data.

## Definition of Done

- The coordinator's specialist delegation behavior is explicit and test-enforced across source prompts and generated host guidance.
- All focused lanes remain bounded, read-only, privacy-safe, and compatible with Instantly, Smartlead V1, demo mode, and current MCP contracts.
- Focused and full plugin validation passes.
- PR #56 is merged to `main`, SENDOSS-92 is closed with proof, and the next patch release is published and verified.
