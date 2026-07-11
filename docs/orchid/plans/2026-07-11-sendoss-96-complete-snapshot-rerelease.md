---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
issue: SENDOSS-96
date: 2026-07-11
---

# SENDOSS-96: Complete automatic snapshots and host-safe rerelease

## Goal Capsule

Ship a SendLens release that automatically produces a current, internally consistent, privacy-safe, rate-limit-safe local snapshot in Codex and Claude Code CLI/Desktop without requiring users to understand hooks, refresh scopes, cursors, or DuckDB lifecycle details.

“Complete” applies to provider resources and exact metrics SendLens claims to contain. Lead bodies, outbound examples, and reply text may remain bounded, sampled, reconstructed, or separately hydrated, but their coverage must be explicit and must never be labeled complete when a cursor or cap remains.

## Product Contract

- R1: An unscoped refresh represents current provider state and cannot retain deleted campaigns, stale inactive campaign details, or obsolete workspace metadata from the previous cache.
- R2: A scoped refresh changes only requested campaigns and preserves unrelated campaign directory and detail fields.
- R3: Provider cursor pagination continues until cursor exhaustion, repetition, or an explicit safety cap; page length is not an exhaustion signal.
- R4: Current Instantly V2 Account and Email schemas are authoritative.
- R5: Failed, timed-out, or rate-limited refreshes preserve the last complete live cache.
- R6: Trace and setup surfaces never disclose credentials, mailbox addresses, lead searches, or raw provider identifiers.
- R7: Automatic refresh works through host session hooks and an idempotent MCP-start fallback for Codex and Claude Code CLI/Desktop.
- R8: Provider pacing remains below documented workspace limits, retains the separate `/emails` lane, honors `Retry-After`, and cannot retry indefinitely.
- R9: Existing Smartlead, demo, MCP response, evidence-language, and read-only/privacy boundaries remain compatible.

## Scope Decisions

1. Unscoped refresh starts from a clean shadow schema. The live cache is copied only for explicitly scoped patch refreshes.
2. Unscoped campaign directory and aggregate analytics cover every currently listed campaign. Heavy campaign detail/sample hydration remains active-campaign-only, but clean rebuild semantics guarantee inactive/deleted detail rows cannot survive.
3. Custom-tag mappings are collected without a `resource_ids` filter during workspace refresh.
4. All list iterators treat provider cursors as opaque and use repeat/max-page guards.
5. MCP startup invokes the existing background session-refresh launcher. Host hooks remain enabled; the existing lock makes duplicate entry safe.
6. General rate limits remain conservative unless live validation proves the documented ceiling is safe. Correctness and cross-process workspace safety take precedence over maximum throughput.
7. SENDOSS-95 / PR #46 is the landed prerequisite. SENDOSS-96 owns the broader correctness and release work.

## Implementation Units

### U1: Cursor-authoritative, privacy-safe Instantly client

Files:
- `plugin/instantly-client.ts`
- `scripts/test-instantly-client-pagination.mjs`

Work:
- Remove endpoint-specific cursor-shape rejection.
- Add reusable cursor exhaustion/repetition guards to every iterator.
- Stop using short page length as a terminal condition.
- Add bounded per-attempt request deadlines without logging raw query values.
- Redact trace query values while preserving path, parameter names, counts, lane, attempt, status, and timing.
- Keep 429 `Retry-After`, retry caps, and the separate email lane.

Test scenarios:
- Composite `timestamp_created&email` account cursor reaches every page.
- A short nonterminal page with a next cursor continues.
- Repeated cursor stops without looping.
- Timeout retries are bounded and preserve a useful error.
- Trace output excludes email/cursor/search/resource values.

### U2: Clean workspace snapshots and surgical scoped patches

Files:
- `plugin/instantly-ingest.ts`
- `plugin/local-db.ts`
- `scripts/test-cache-identity.mjs`
- focused snapshot regression test under `scripts/`

Work:
- Seed a shadow from live only for explicitly scoped refreshes.
- Fully clear/rebuild unscoped provider state.
- Keep directory and aggregate analytics for all current campaigns; hydrate active campaign detail/evidence only.
- Ensure scoped directory upserts do not null unrelated `sequence_count` or `step_count`.
- Remove upstream-deleted resources on unscoped refresh.

Test scenarios:
- Inactive and deleted rows in a seeded prior cache do not survive unscoped refresh.
- Failed unscoped refresh leaves the old live DB untouched.
- Scoped refresh updates only the target and preserves unrelated counts/details.
- Atomic promotion and rollback behavior from SENDOSS-95 remains intact.

### U3: Current schemas, complete mappings, and truthful coverage

Files:
- `plugin/instantly-ingest.ts`
- `plugin/local-db.ts`
- `scripts/test-reply-hydration-db-reuse.mjs`
- `scripts/test-local-plugin-sampling.mjs`
- `scripts/test-ingest-template-fixtures.mjs`

Work:
- Parse comma-separated Email recipient strings with legacy-array compatibility.
- Map Account `provider_code` and `stat_warmup_score`.
- Fetch all custom-tag mappings unfiltered.
- Prevent full lead ingestion from claiming completeness when capped or cursor-unexhausted.
- Persist or expose exhaustion/coverage metadata using existing evidence contracts where possible.
- Preserve exact-versus-sampled language.

Test scenarios:
- Current Email string recipient maps to the mailbox recipient.
- Current Account fields populate provider and warmup score.
- Account and campaign mappings outside active scope are stored.
- Large low-send campaigns cannot be labeled full after a 5,000-row cap.

### U4: Capability-aware setup and automatic host refresh fallback

Files:
- `plugin/instantly-client.ts`
- `plugin/setup-doctor.ts`
- `scripts/start-mcp.sh`
- `scripts/session-start.sh`
- `scripts/test-provider-config-setup-doctor.mjs`
- host bundle contract tests

Work:
- Describe campaign-only validation honestly or add bounded capability probes for ingestion-critical scopes.
- Start the idempotent background refresh from MCP startup as a fallback when host hooks do not fire.
- Preserve no-key cache mode and demo behavior.
- Verify lock behavior prevents duplicate hook/startup refreshes.

Test scenarios:
- MCP startup launches background refresh once when configured.
- Concurrent host hook and MCP startup result in one active refresh.
- Missing keys do not crash local-cache mode.
- Setup distinguishes campaign access from complete-ingestion readiness.

### U5: Pluxx host parity and generated release surfaces

Repository: `orchidautomation/pluxx`

Work:
- Verify current SessionStart translation and installer feature/trust handling for Codex and Claude Code.
- Update Pluxx only where a general host compiler/installer defect exists.
- Regenerate SendLens Claude Code, Codex, Cursor, and OpenCode bundles from canonical SendLens source.
- Verify CLI/Desktop-compatible installed shapes and MCP-start fallback inclusion.

Test scenarios:
- Claude Code generated hook and MCP launcher both include the canonical refresh entry.
- Codex bundle contains valid hook companions and installer hook feature guidance.
- `verify-install` proves installed runtime paths and fallback scripts exist.
- Generated bundles do not contain credentials or workspace-specific values.

### U6: Review, release, install, and new-task proof

Work:
- Run full SendLens and relevant Pluxx gates.
- Run independent subagent review after implementation and resolve actionable findings.
- Commit, push, open linked PRs, and add `ai:autofix-enabled` when safe.
- Merge only after CI/review passes.
- Bump SendLens patch version, tag, and verify GitHub release assets.
- Reinstall the released Codex and Claude Code artifacts.
- Create a brand-new Codex task and verify session-triggered refresh without manually calling `refresh_data`.
- Record privacy-safe counts, lifecycle timestamps, host versions, release/commit SHAs, and residual limitations in `docs/orchid/qa/`.

## Verification Contract

- `npm run test:instantly-client`
- focused snapshot, sampling, reply, setup, and host bundle tests
- `npm run test:plugin:smoke`
- `npm run validate:plugin`
- `npm run lint:plugin`
- `npm run test:plugin`
- `npm run ci:plugin`
- Pluxx `npm test` and `npm run release:check` for any Pluxx source change
- `git diff --check` in both repos
- privacy-safe live provider/cache aggregate comparison
- released installer/bundle verification
- new Codex task automatic-refresh proof

## Risks and Mitigations

- Full raw lead history can be prohibitively large: keep bounded evidence, make coverage truthful, and make exact directory/analytics/resource state complete.
- Multiple processes share workspace limits: preserve conservative pacing, honor provider backoff, and use locks plus bounded concurrency.
- Hook execution differs by host/version: retain native hooks and add MCP-start fallback rather than relying on one lifecycle primitive.
- Clean rebuild can expose missing mapping/storage assumptions: use a shadow DB and promote only after validation/checkpoint succeeds.
- Trace redaction can remove diagnostic value: log parameter names/counts, hashed correlation identifiers, timing, status, and provider error class.

## Definition of Done

- Every R1–R9 requirement is proven by automated or recorded manual evidence.
- SendLens and any required Pluxx PRs are merged with green CI and review.
- A new SendLens patch release is public with current generated host assets.
- Local Codex and Claude Code installs are updated from that release.
- A newly created Codex task automatically starts and completes a fresh snapshot without user intervention.
- SENDOSS-96 and related release/host issues contain PR, release, validation, and residual-risk links.
