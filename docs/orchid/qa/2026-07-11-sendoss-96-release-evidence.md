# SENDOSS-96 release evidence

## Outcome

SendLens 0.1.45 refreshes an atomic, current workspace snapshot at session start across generated Codex and Claude host bundles. Refresh launch is deduplicated across native hooks and the MCP-start fallback, pagination follows opaque provider cursors, and a lead sample is labeled `full_raw` only when cursor exhaustion and provider count reconciliation both prove completeness.

## Correctness coverage

- Full unscoped refreshes rebuild the shadow database without inheriting deleted live rows.
- A workspace with zero active campaigns promotes a valid empty-active snapshot instead of retaining stale active data.
- Scoped refreshes preserve unrelated workspace rows and directory metadata.
- Campaign, account, tag, account-campaign, and campaign-tag ingestion follows all provider pages until cursor exhaustion or an explicit safety ceiling.
- Lead pagination records pages fetched, cursor exhaustion, and termination reason. Count mismatches or page ceilings are surfaced as incomplete bounded sampling.
- Account provider codes, warmup scores, string recipients, and exact unique/by-step analytics fields are stored in DuckDB.
- Logs and errors redact provider credentials and avoid campaign/customer identifiers in refresh diagnostics.

## Rate-limit and lifecycle coverage

- Requests retain conservative per-process throttling beneath Instantly's documented limits, honor `Retry-After`, retry transient failures, and have a 30-second request timeout.
- The session hook uses an atomic launch lock. Recent abandoned locks are conservatively held for ten minutes; older inactive state is cleaned on the next launch.
- When a workspace contains exactly one client environment, host startup selects it automatically; users do not need to set `SENDLENS_CLIENT` for the hook or MCP fallback.
- Pluxx 0.1.29 preserves the host launch workspace even when no root `.env` exists. SendLens consumes that runtime contract before resolving `.env.clients`, so credential isolation does not break automatic startup.
- Generated Codex and Claude bundles contain the native session hook and the idempotent MCP-start fallback.

## Validation

- `npm run test:plugin`
- `npm run validate:plugin`
- `npm run lint:plugin` — 0 errors; 87 documented host-translation warnings
- `npm run test:host-bundles`
- `git diff --check`
- Live privacy-safe aggregate refresh against the existing The Kiln Sendoso context: 94 campaigns, 322 accounts, 10 tags, 410 tag mappings, 333 account mappings, and 77 campaign mappings; no null provider codes or warmup scores.
- Independent agent review performed before release; initial blockers were converted into regressions and corrected, followed by a second independent review.
- A clean v0.1.43 Codex task correctly failed verification because startup had not selected the workspace's sole client. That finding was fixed, covered by a host-start regression, independently reviewed again, and rereleased as v0.1.44.
- A clean v0.1.44 task then exposed the upstream Pluxx workspace-root dependency on a root `.env`. The fix was implemented and released in the Pluxx CLI/runtime generator itself, consumed by SendLens, and locally proven with a generated Codex bundle launched from The Kiln.

No raw customer records, credentials, provider identifiers, or private replies are included in this artifact.
