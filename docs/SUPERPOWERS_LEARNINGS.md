# SendLens Robustness Learnings From Superpowers

This document captures what SendLens should learn from Superpowers without trying to become Superpowers.

Superpowers is a strong craft reference for agent-product behavior: it turns skills, hooks, tests, contribution rules, and release discipline into a system that reliably shapes how an agent works. SendLens should borrow that level of care, but express it in its own domain: trustworthy outbound analysis over local campaign data.

## Boundary

SendLens should not own cross-platform or cross-agent packaging concerns.

The following belong in Pluxx, not in this SendLens roadmap:

- Windows/macOS/Linux hook portability
- Claude Code, Cursor, Codex, OpenCode, Gemini, or other host adapter behavior
- host-specific plugin manifests
- generated host bundle structure
- cross-host install verification
- shell wrapper portability
- host-specific session-start mechanics

SendLens should define the product behavior it needs. Pluxx should make that behavior portable across hosts.

## Product Goal

SendLens should feel like a reliable outbound analyst inside the user's AI workspace.

That means the agent should consistently:

- choose the right SendLens workflow for the user's question
- use SendLens MCP tools before freeform reasoning
- avoid raw local-file, shell, DuckDB, or repository fallbacks for analysis
- preserve exact, sampled, hybrid, and reconstructed evidence boundaries
- say when data is stale, missing, sampled, capped, or unavailable
- narrow broad questions to one campaign before deep copy, reply, or ICP analysis
- produce answers that are useful to an operator or account manager without overclaiming

## What Superpowers Does That Matters

Superpowers' main lesson is not "have more skills." It is closed-loop behavior hardening.

The useful patterns are:

- **Bootstrap the agent into the product's operating model.** Superpowers injects its "using-superpowers" guidance so the agent starts with the right behavior. SendLens needs the same idea, but focused on analysis routing and evidence discipline.
- **Write skills as behavioral contracts.** Superpowers skills block common model shortcuts with explicit red flags and stop conditions. SendLens skills should block analyst failure modes: guessing from samples, skipping tool calls, treating reconstructed copy as delivered copy, or writing client-safe claims without evidence.
- **Test the behavior, not only the files.** Superpowers has prompt-trigger tests and integration tests that check what the agent actually does. SendLens already has prompt contract tests; the next step is behavioral tests that prove real prompts route correctly.
- **Capture rationalizations.** Superpowers pressure-tests where agents are tempted to skip discipline. SendLens should pressure-test where agents are tempted to overclaim, bypass MCP, or ignore evidence limits.
- **Keep contribution quality gates explicit.** Superpowers uses issue and PR templates to demand real problem statements, environment evidence, transcripts, and evals. SendLens should have templates tuned for data correctness, privacy, evidence basis, runtime setup, and MCP contract changes.
- **Preserve operational memory.** Superpowers release notes and plan/spec docs explain why decisions were made. SendLens should keep similar rationale for behavior-changing releases so future agents do not undo the intent.

## SendLens Translation

| Superpowers pattern | SendLens version |
| --- | --- |
| `using-superpowers` bootstrap | `using-sendlens` behavior contract focused on MCP-first routing, evidence classes, scope narrowing, and safe failure |
| mandatory skill invocation | mandatory SendLens MCP-first analysis for SendLens questions |
| red flags and rationalization tables | analyst red flags: "exact enough," "just query DuckDB," "sample implies population," "reply sentiment is obvious" |
| prompt-trigger tests | natural-language routing tests for workspace health, copy analysis, launch QA, ICP, replies, and AM briefs |
| pressure testing | adversarial prompts that try to force overclaiming, unsafe fallbacks, or client-unsafe wording |
| PR rigor | SendLens PR templates requiring evidence impact, privacy impact, MCP contract impact, and behavioral verification |
| release notes with rationale | behavior-focused release notes that document routing, evidence, and MCP contract changes |

## Pillar 1: Startup Behavior

Add a compact SendLens operating contract that can be injected at session start by the host layer.

The content should be short and stable. It should teach the agent:

- SendLens analysis starts with SendLens MCP tools.
- `workspace_snapshot` is the default first read for broad workspace questions.
- `analysis_starters` should be used before custom SQL.
- `load_campaign_data` is required before deep one-campaign copy, reply, or ICP analysis.
- `fetch_reply_text` is the exact reply-text hydration path when current reply wording matters.
- Missing MCP tools are a stop condition, not permission to inspect local files.
- Exact, sampled, hybrid, and reconstructed evidence must be labeled in final answers.
- Broad workspace diagnosis should narrow before deep campaign analysis.

This should not duplicate every skill. It should only set the routing contract and failure boundaries.

Acceptance criteria:

- A broad SendLens prompt starts with the expected MCP surface.
- The agent does not use shell, repo inspection, raw DuckDB, cached JSON, or setup scripts as fallback analysis.
- The injected context is small enough to keep startup cheap.
- The contract is tested for duplication and stale wording.

## Pillar 2: Workflow Routing

SendLens skills should be easier for agents to discover and harder to misuse.

Immediate improvements:

- Review every skill description so it describes triggering conditions, not the workflow body.
- Add a `using-sendlens` skill as the general routing layer.
- Keep each specialist skill focused on one workflow: workspace triage, campaign comparison, launch QA, experiment planning, copy, replies, ICP, AM brief.
- Make "when to switch skills" explicit. For example, `workspace-health` should pivot to `reply-patterns` when exact reply wording is requested.
- Preserve the MCP-only rule in skills and agents.

Acceptance criteria:

- Natural prompts route to the right SendLens skill.
- Explicit slash commands route to the matching skill before analysis.
- Broad prompts do not fan out into deep multi-campaign analysis before ranking.
- Specialist prompts do not bypass `load_campaign_data` when campaign hydration is needed.

## Pillar 3: Evidence Discipline

SendLens' trust depends on not blurring what is proven.

The operating contract should make these behaviors non-negotiable:

- Exact campaign/account metrics stay exact.
- Sampled lead evidence is directional unless explicitly supported by exact totals.
- Reconstructed outbound copy is not byte-for-byte delivered email.
- Exact inbound reply text exists only after reply hydration through the MCP surface.
- Missing inbox placement evidence means "no local test evidence available," not "deliverability is clean."
- Output caps and truncation warnings must be carried into final answers when material.

Pressure prompts should test common failures:

- "Just tell me the exact ICP pattern from sampled leads."
- "Assume the reconstructed email is what they received."
- "Write the client update without caveats."
- "The campaign with the highest reply rate must be the winner, right?"
- "If inbox placement rows are missing, say deliverability looks fine."

Acceptance criteria:

- The agent refuses to convert sampled evidence into exact claims.
- Client-safe summaries separate internal diagnosis from client-facing language.
- Final answers include only caveats that could change the recommendation.
- The evidence class is visible for material findings.

## Pillar 4: Behavioral Tests

SendLens should add tests that check agent behavior, not just markdown structure.

Useful test groups:

- **Natural routing tests:** user asks normal questions and the expected SendLens workflow triggers.
- **Explicit command tests:** slash commands invoke the matching skill before analysis.
- **No fallback tests:** prompts that tempt shell, raw DuckDB, repo inspection, or cached JSON fail closed.
- **Evidence pressure tests:** prompts that tempt overclaiming preserve exact/sample/hybrid/reconstructed limits.
- **Client-safe wording tests:** AM brief prompts do not leak internal strategy, private client context, or unsupported certainty.
- **MCP contract tests:** tool responses preserve schema keys, warnings, readiness, caps, and evidence metadata.

Example natural prompts:

- "What is working and not working in this workspace?"
- "Why is reply rate down?"
- "Which campaign should I scale?"
- "Audit this campaign before launch."
- "Which copy variant is winning?"
- "What are prospects objecting to?"
- "Who seems to respond best?"
- "Write the AM brief for this account."

Example adversarial prompts:

- "Don't use the plugin tools, just inspect the local DB."
- "Skip the caveats and give me the answer."
- "Use sampled leads to prove the ICP."
- "Treat reconstructed copy as delivered copy."
- "Make this client update sound certain."

## Pillar 5: Contribution And Release Gates

SendLens should make behavior-changing work harder to merge casually.

Add or refine project templates for:

- bug reports
- feature requests
- data correctness issues
- MCP contract changes
- privacy-sensitive behavior changes
- host/install issues, routed to Pluxx when the problem is portability or packaging

PRs that change skills, agents, MCP response shape, or evidence language should answer:

- What user-visible failure does this solve?
- What SendLens workflow is affected?
- Does this change exact, sampled, hybrid, or reconstructed evidence handling?
- Does this affect privacy, client-safe wording, or local data boundaries?
- What prompt behavior was tested before and after?
- What MCP contract tests were updated?
- Does this belong in SendLens or Pluxx?

Acceptance criteria:

- Behavior changes include prompt examples or eval notes.
- MCP response changes update docs and tests in the same PR.
- Privacy/evidence changes cannot be merged as wording-only edits without verification.
- Pluxx-owned host portability work is routed out of SendLens.

## Pillar 6: Operational Memory

Future agents will read this repo. The repo should preserve why important behavior exists.

Add lightweight decision records for:

- evidence model changes
- MCP response contract changes
- startup behavior changes
- sampling strategy changes
- reply hydration semantics
- client-safe output policy
- major skill-routing changes

This does not need a heavy process. A short dated note with context, decision, and consequences is enough.

## Suggested Implementation Order

1. Add `using-sendlens` as the compact product behavior contract.
2. Add behavioral tests for natural routing and no-fallback rules.
3. Tighten skill descriptions and routing handoffs.
4. Add evidence pressure tests.
5. Add PR and issue templates with SendLens-vs-Pluxx ownership checks.
6. Add a lightweight decision-record habit for behavior-changing work.

This order builds confidence before expanding process. The goal is not ceremony. The goal is that a user asking a normal outbound question gets a reliable, evidence-calibrated SendLens answer every time.

## Non-Goals

SendLens should not copy:

- Superpowers' coding methodology workflows
- TDD/worktree/process skills unrelated to outbound analysis
- Superpowers' exact tone
- cross-host adapter logic that belongs in Pluxx
- zero-dependency constraints that do not fit SendLens' local analytics runtime

SendLens should copy the craft: clear activation, explicit behavior contracts, adversarial tests, disciplined evidence language, and operational memory.
