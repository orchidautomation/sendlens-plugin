---
title: SendLens lead metadata parity QA
date: 2026-07-20
linear_issue: SENDOSS-138
branch: codex/sendoss-138-lead-metadata
---

# Lead Metadata Parity QA

## Scope reviewed

- Smartlead native lead fields and arbitrary `custom_fields` preservation
- Instantly/Smartlead equivalent enrichment fixtures
- additive `lead_payload_kv` metadata semantics and historical-cache migration
- campaign metadata coverage and scalar-only value activation
- ICP/reply/copy agent guidance and public provider contracts

## Proof-first evidence

Before the Smartlead mapping change, the focused ingest assertion for the documented native phone field failed with `actual: null`. After implementation, the focused provider, view, migration, recipe, prompt, template, and MCP-contract tests pass.

## Passing validation

- `npm run test:plugin:fast` — passed under Node 22 before the final collision-safe fallback hardening; the affected Smartlead test was rerun afterward.
- `node scripts/test-smartlead-ingest.mjs`
- `node scripts/test-local-plugin-runtime.mjs`
- `node scripts/test-schema-migrations.mjs`
- `node scripts/test-query-recipes-contract.mjs`
- `node scripts/test-prompt-contracts.mjs`
- `node scripts/test-ingest-template-fixtures.mjs`
- `node scripts/test-mcp-response-contract.mjs`
- `npm run validate:plugin`
- `npm run lint:plugin` — zero errors; existing cross-host translation warnings remain.
- `npm run eval:plugin` — zero errors; existing semantic-score warning remains.
- `git diff --check`

## Environment-limited checks

- A later full `npm run test:plugin` attempt could not complete on this VPS: child-process tests (`test-http-transport` and `test-db-lock-retry`) exited before their readiness handshakes under both the system Node 24 runtime and a cached Node 22.23.1 runtime. The failures did not report an assertion in changed metadata code; all directly affected tests pass independently.
- `npm run test:host-bundles` produced no result for more than two minutes and was stopped. CI remains the authoritative host-bundle and full-suite gate before merge.

## Manual review

The Compound Engineering multi-agent reviewer was unavailable in this harness, so the changed production SQL, migration ledger, provider conflict handling, privacy boundary, and focused tests were manually diff-reviewed. That review found and fixed two issues before shipping:

1. Smartlead fallback keys could overwrite a user-defined `smartlead_native_*` custom key; fallback allocation is now collision-safe and tested.
2. The value-signal recipe described scalar-only behavior but did not enforce it; it now excludes arrays, objects, and blank scalar values in SQL.

## Residual risk and rollout

- Metadata coverage remains bounded by SendLens sampled lead evidence and must not be described as full-population completeness.
- Semantic families are discovery hints only; exact raw keys remain authoritative.
- Monitor refresh logs for Smartlead ingest failures and compare `campaign-metadata-coverage` output on one known Instantly campaign and one known Smartlead campaign after deployment.
- Roll back the plugin release if schema migration fails, provider refresh errors increase, or known custom fields disappear from `lead_payload_kv`.
