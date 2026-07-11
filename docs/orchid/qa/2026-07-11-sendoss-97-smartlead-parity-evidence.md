# SENDOSS-97 Smartlead V1 parity evidence

> Scope update (2026-07-11): SENDOSS-98 extends this evidence with read-only Smart Delivery support. Statements below that call Smart Delivery out of scope describe the pre-extension audit and are superseded by the SENDOSS-98 QA artifact.

Date: 2026-07-11

Issue: SENDOSS-97

Plan: `docs/orchid/plans/2026-07-11-sendoss-97-smartlead-parity-hardening.md`

Branch: `codex/sendoss-97-smartlead-parity-audit`

Required PR base: `codex/smartlead-api-parity-map`

## Result

The official-document and synthetic-fixture audit is complete. The Smartlead
provider remains V1 read-only. No campaign, lead, account, email, webhook, or
settings mutation was added.

The remediation closes the audited transport, completeness, mapping, privacy,
snapshot, startup-hook, and host-bundle gaps. No live customer access was used.

## Official source receipt

The complete official Smartlead documentation snapshot was fetched from
`https://api.smartlead.ai/llms-full.txt` on 2026-07-11.

- SHA-256: `ab4c1a1bc65f3331b9d813f8509c67ca3b3014d80e4954e5d34fe7a6fe164a2b`
- Size: 968,892 bytes
- Lines: 36,188
- Repository policy: the raw snapshot is excluded from version control

Primary checked references are preserved in the plan source table. They cover
campaign list/detail/sequences, campaign and date-range analytics, step and
mailbox statistics, campaign/workspace accounts, warmup stats, campaign leads,
single/bulk message history, rate limits, error handling, provider-wide
analytics, lead lists, and Smart Delivery.

## Endpoint and ingestion audit

| Refresh event | Audited outcome |
| --- | --- |
| Campaign directory | Direct and common wrapped arrays accepted; no undocumented pagination invented. |
| Campaign detail | Current sending-limit, plain-text, stop-policy, ESP-matching, tracking, and timezone names mapped. Unknown stop-policy values stay nullable. |
| Sequences | Direct/wrapped sequences and variants accepted; nested delay fields mapped without changing step indexing. |
| Campaign analytics | Raw totals remain totals. Unique opens/replies use explicit unique fields or fully covered per-lead signals, never aggregate-total aliases. |
| Date-range analytics | Date-bearing rows only populate daily tables; aggregate range payloads are not relabeled as daily evidence. |
| Step statistics | Page size remains at the documented maximum 1000; unique replies remain nullable without an explicit unique field. |
| Mailbox statistics | Page size corrected to the documented maximum 20; timezone and date filters are forwarded. Sender unique/contacted fields remain nullable unless explicit. |
| Campaign accounts | Direct assignments preserved with provider-qualified identity. |
| Workspace accounts | Page size remains 100 and pages exhaust or fail. Stored raw metadata uses an allowlist that excludes mailbox connection, routing, and signature fields. |
| Warmup stats | Best-effort account health remains separate from campaign-volume facts. |
| Campaign leads | Pages exhaust or fail; complete per-lead signal coverage is required before deriving a unique count. |
| Message history | Existing bounded reply-signal hydration and coverage notes are preserved; bulk read-equivalent POST remains read-only. |
| Provider-wide analytics | Client methods remain client-only and are not claimed as normalized refresh coverage. |
| Smart Delivery | Official reads use a separate support-gated service and remain explicitly unsupported in V1. |

## Remediated findings

- Added a 30-second full-response timeout; internal timeouts retry with bounded
  exponential backoff while caller cancellation still aborts immediately.
- Added `502` to transient retry handling and retained `Retry-After` support.
- Removed query values and provider response bodies from diagnostics; addresses
  and access values are redacted from thrown/logged text.
- Pagination now throws on safety-cap exhaustion, repeated offsets,
  non-advancing offsets, and empty nonterminal pages.
- Corrected mailbox page size from 100 to 20.
- Added current campaign and nested sequence-delay mappings.
- Replaced account raw payload persistence with an explicit safe allowlist.
- Removed inferred unique values from campaign daily, step, and account daily
  rows. Campaign unique derivation requires complete, defined per-lead fields.
- Moved all remote reads ahead of provider mutation and wrapped the DuckDB
  provider-scoped replacement, summary, and success log in one transaction.
- Preserved full-refresh stale-row deletion, other-provider rows, scoped
  campaign isolation, and provider-wide account rollups.
- Enabled Smartlead and one-key `all` session-start/installer refresh eligibility
  through the existing provider-aware atomic refresh CLI.
- Rebuilt and inventoried Claude Code, Codex, Cursor, and OpenCode bundles.
- Updated capability and operator documentation for support-gated Smart
  Delivery and client-only analytics surfaces.

## Independent review

An independent read-only subagent reviewed the final working-tree diff for
correctness, privacy, API contracts, reliability, atomicity, and hook behavior.
It reported five findings:

1. Internal timeouts were initially classified as caller aborts.
2. Success bookkeeping initially occurred after commit.
3. Repeated pagination offsets could initially stop silently.
4. Partial or undefined lead signals could initially undercount unique values.
5. Unknown stop-policy values could initially become false facts.

All five were fixed. The reviewer rechecked the affected sections; its final
follow-up on undefined signals was also resolved by accepting only defined
boolean/numeric signal semantics. Focused and full validation passed afterward.

## Validation evidence

| Command | Result |
| --- | --- |
| `npm run test:smartlead-client` | Passed: timeout/body timeout, retry, cancellation, redaction, pagination, and page-cap fixtures. |
| `npm run test:smartlead-ingest` | Passed: mappings, unique semantics, raw allowlist, transactional rollback, full/scoped refresh, stale deletion, and provider preservation. |
| `npm run test:plugin` | Passed: full plugin suite including Smartlead, Instantly, DuckDB, MCP response, demo, cache, and runtime regressions. |
| `npm run test:host-bundles` | Passed: 11 skills, 11 commands, 6 agents across generated host bundles. |
| `npm run validate:plugin` | Passed: configuration valid for Claude Code, Cursor, Codex, and OpenCode. |
| `npm run lint:plugin` | Passed with 0 errors and 87 existing cross-host translation warnings. |
| `git diff --check` | Passed. |

## Residual limits

- Live Smartlead response shapes were not tested because no customer access was
  used. The client accepts documented direct/common wrappers and fixtures cover
  conflicting documented shapes.
- Message-history evidence remains intentionally bounded and coverage-labeled.
- Campaign date-range analytics remain partial unless the response contains
  actual date-bearing rows.
- Provider-wide analytics are not normalized by refresh.
- Smart Delivery remains support-gated and outside V1.
- The Pluxx lint warnings describe known host translation ceilings; there are
  no lint errors.

## Release gate

The PR must target `codex/smartlead-api-parity-map`, carry SENDOSS-97 and the
`ai:autofix-enabled` label, and remain unmerged and unreleased until the
coordinator confirms the parity-base merge sequence.
