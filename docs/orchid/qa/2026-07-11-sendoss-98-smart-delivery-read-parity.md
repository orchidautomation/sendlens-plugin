# SENDOSS-98 Smart Delivery read parity QA

Date: 2026-07-11

Issue: SENDOSS-98

Plan: `docs/orchid/plans/2026-07-11-sendoss-98-smart-delivery-read-parity.md`

Branch: `codex/sendoss-97-smartlead-parity-audit`

PR: https://github.com/orchidautomation/sendlens-plugin/pull/51

## Result

SendLens now supports Smartlead Smart Delivery as a conditional, read-only provider surface. A full Smartlead refresh reads exact test definitions, run counts, provider/region and sender aggregates, per-seed authentication checks, and blacklist/IP/spam-filter diagnostics when the configured key is authorized. Standard API ingest remains usable when Smart Delivery returns a support-gated 401/403/404.

No Smartlead or Smart Delivery create, update, stop, delete, send, reply, forward, folder mutation, webhook mutation, or other write path was added.

## Truthful local model

| Surface | Local destination | Exactness |
| --- | --- | --- |
| Test list/detail | `smartlead_delivery_tests` | Exact allowlisted definition fields |
| Schedule history | `smartlead_delivery_evidence`, `smartlead_delivery_test_overview` | Exact run counts; rates derived only from those counts |
| Provider/geo reports | `smartlead_delivery_evidence` | Exact provider-reported aggregates; non-completed wrappers abort refresh |
| Sender report/list | `smartlead_delivery_evidence`, `smartlead_sender_delivery_health` | Exact provider-reported sender aggregates and membership |
| SPF/DKIM/rDNS/domain blacklist | `smartlead_delivery_evidence`, authentication view | Exact per-seed checks returned by Smart Delivery |
| IP blacklist/IP analytics/spam filters | `smartlead_delivery_evidence`, authentication view | Exact allowlisted diagnostics |
| Instantly per-email placement | Existing Instantly tables/views | Kept separate; Smartlead aggregates never become fake per-email rows |

Legacy `inbox_placement_analytics_rows` remains an Instantly per-email count. Smart Delivery uses separate `smart_delivery_test_count` and `smart_delivery_evidence_rows` metrics so unlike evidence types are not added together.

## Reliability and privacy proof

- Standard and Smart Delivery requests share the same `SmartleadClient`, limiter, semaphore, timeout, retry, and query-key redaction state.
- The initial delivery-list probe alone maps 401/403/404 to an unsupported capability after Standard API access succeeds.
- Any selected per-test/report failure, processing provider/geo wrapper, timeout, or transient error aborts before DuckDB mutation and preserves the prior complete snapshot.
- Successful full refresh deletes stale delivery rows and replaces them in the same transaction as the core Smartlead snapshot.
- Campaign-scoped refresh preserves workspace-global Smart Delivery rows and capability state.
- Test/report raw JSON is built from explicit allowlists. Synthetic forbidden email-body and raw-header drift is absent from stored JSON.
- Test email content and reply-header endpoints are never requested.
- Smartlead query credentials do not appear in URLs, errors, traces, fixtures, docs, or committed artifacts.

## Review resolution

The independent review found six initial issues: swallowed report 404s, denylisted raw payloads, separate per-key rate budgets, discarded report completion status, unlike summary row counts, and contradictory later provider-contract sections. All six were fixed and rechecked.

The follow-up found four additional issues: invalid two-key `all` startup without `SENDLENS_CLIENT`, omitted safe documented allowlist fields, host tests using source-root runtime assets, and stale README capability language. All four were fixed. The final independent verification reported no unresolved findings.

The existing PR review also contained eight findings from the first SENDOSS-97 commit. This update resolves the account optional-field completeness bug, non-finite timeout fallback, startup status normalization, installer/session whitespace handling, behavioral bundled startup coverage, and source-receipt mismatch. The generated-host test now executes bundle-root scripts for Smartlead-only and one-key `all`, requires bundled `refresh-cli.js`, and proves invalid two-key `all` stays idle without `SENDLENS_CLIENT`.

A final post-push review found two boundary defects: duplicate seed identifiers for the same sender could collide in the evidence snapshot, and the host-bundle polling assertion did not re-read after its final yield. Evidence keys now include the documented per-group index, with a duplicate-seed regression, and the polling check performs a final bounded read before failing.

## Validation

| Command | Result |
| --- | --- |
| `npm run test:smartlead-client` | Passed: shared cross-host rate budget, delivery host/read POST construction, timeout fallback, retry/redaction fixtures. |
| `npm run test:smartlead-ingest` | Passed: supported/unsupported access, processing/404 preservation, allowlists, exact mapping, atomic rollback, stale deletion, scoped preservation. |
| `npm run test:plugin:smoke` | Passed. |
| `npm run test:plugin` | Passed full plugin suite. |
| `npm run validate:plugin` | Passed for Claude Code, Cursor, Codex, and OpenCode. |
| `npm run lint:plugin` | Passed with 0 errors and 87 known cross-host translation warnings. |
| `npm run test:host-bundles` | Passed: bundle inventory and behavioral Smartlead/`all` startup launch. |
| Orchid repo preflight | Passed with 0 failures and 0 warnings. |
| `git diff --check` | Passed. |

## Residual limits

- No live customer workspace or private Smart Delivery payload was used. Tests use public-doc-derived synthetic payloads only.
- Smart Delivery access remains support-gated by Smartlead.
- All test definitions are stored, while detailed report hydration is bounded to the newest 20 tests and reported in capability coverage.
- Smart Delivery exposes aggregate provider/region/sender evidence rather than an Instantly-equivalent per-email placement feed.
- No standalone DMARC read endpoint was found in the checked current Smart Delivery reference, so SendLens does not claim DMARC evidence.
- Raw test email content and reply headers remain intentionally excluded.

## Release hold

PR #51 remains targeted to `codex/smartlead-api-parity-map`. Do not merge or release until the coordinator confirms the parity-base merge sequence.
