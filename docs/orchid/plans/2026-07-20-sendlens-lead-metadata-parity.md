---
title: SendLens lead metadata preservation and activation
date: 2026-07-20
linear_issue: SENDOSS-138
artifact_readiness: implementation-ready
---

# SendLens Lead Metadata Preservation And Activation

## Problem

Instantly and Smartlead both distinguish native lead fields from arbitrary campaign enrichment. Instantly accepts `custom_variables` and returns them in `payload`; Smartlead accepts and returns `custom_fields`. SendLens already stores those objects and expands their top-level keys through `lead_payload_kv`, but the provider contract is not proven symmetrically and several documented Smartlead native fields are not promoted into agent-friendly surfaces.

The implementation must preserve unknown enrichment without customer-specific schema changes while making metadata discovery, coverage, value type, and safe cohort activation obvious to SQL-using agents.

## Decisions

1. **Keep `custom_payload` as the lossless provider envelope.** Do not replace arbitrary JSON with fixed columns.
2. **Preserve original keys and values.** Add normalized discovery fields; never rewrite the raw provider key or value.
3. **Use metadata families for discovery, not silent semantic merging.** Families such as persona, segment, company size, and technology stack help agents find candidate fields while exact keys remain the grouping contract.
4. **Represent non-scalar values explicitly.** Keep JSON and value type available; value-level cohort recipes remain scalar-first.
5. **Promote documented Smartlead native fields into the same queryable envelope.** When a native field conflicts with an identically named custom field, retain the custom field under its original key and expose the native value under a `smartlead_native_*` key.
6. **Keep evidence sampled and campaign-scoped.** Coverage and value recipes must not imply a full-population ICP.

## Implementation Units

### U1 — Provider preservation contract

**Files:**

- `plugin/smartlead-ingest.ts`
- `scripts/fixtures/smartlead-client/campaign-leads.page-0.json`
- `scripts/test-smartlead-ingest.mjs`
- `scripts/test-ingest-template-fixtures.mjs`

**Approach:**

- Preserve `phone_number`, `location`, `linkedin_profile`, and `company_url` from documented Smartlead campaign-lead rows.
- Accept documented field-name variants while retaining the original `custom_fields` object.
- Ensure native Smartlead placeholders can participate in local template reconstruction.
- Extend fixtures with the same flat persona, segment, headcount, industry, and technology-stack enrichment used by the Instantly template fixture.

**Test scenarios:**

- Smartlead custom fields survive exactly in `custom_payload` and `lead_payload_kv`.
- Native Smartlead fields appear in agent-queryable payload rows and canonical phone/website fields where applicable.
- A conflicting custom/native field retains both values under distinct keys.
- Instantly and Smartlead custom variables render from equivalent metadata.

### U2 — Lossless metadata semantics

**Files:**

- `plugin/local-db.ts`
- `plugin/constants.ts`
- `scripts/test-schema-migrations.mjs`
- `scripts/test-local-plugin-runtime.mjs`
- `scripts/test-mcp-response-contract.mjs`

**Approach:**

- Add additive columns to `lead_payload_kv` for normalized key, metadata family, JSON type, scalar status, and normalized scalar value.
- Advance the schema migration ledger so existing caches recreate the semantic view.
- Preserve `payload_key`, `payload_value`, and `payload_value_json` unchanged.

**Test scenarios:**

- Mixed punctuation/case keys normalize predictably while raw keys remain unchanged.
- Common aliases receive a discovery family without being collapsed into one raw key.
- strings, numbers, booleans, nulls, arrays, and objects report explicit types; JSON remains available.
- historical caches receive the new view columns through a once-only migration.

### U3 — Metadata coverage and activation recipes

**Files:**

- `plugin/query-recipes.ts`
- `plugin/catalog.ts`
- `scripts/test-query-recipes-contract.mjs`
- `scripts/test-local-plugin-runtime.mjs`

**Approach:**

- Add a campaign metadata coverage recipe with total sample size, key coverage, scalar/non-scalar counts, cardinality, and sparse-value counts.
- Keep value-level signal analysis on exact payload keys and scalar values with the existing minimum cohort threshold.
- Route payload/persona/segment/headcount/technology questions through the coverage recipe before value-level inference.

**Test scenarios:**

- Coverage reports denominator and percentage for each key.
- Sparse values are counted even when excluded from value-level output.
- Non-scalar fields are visible but not accidentally treated as scalar cohorts.
- Existing recipe SQL remains guard-safe and executable.

### U4 — Agent and documentation contract

**Files:**

- `agents/icp-auditor.md`
- `agents/reply-auditor.md`
- `agents/copy-auditor.md`
- `skills/sendlens-analyst/references/replies-icp-and-copy.md`
- `docs/skills/icp-signals.md`
- `docs/SMARTLEAD_PROVIDER_CONTRACT.md`
- `README.md`
- `scripts/test-prompt-contracts.mjs`

**Approach:**

- Require metadata coverage before choosing value-level cohorts unless the exact key is named.
- Explain raw key preservation, metadata-family discovery, scalar boundaries, and provider-native field behavior.
- Keep privacy and sampled-evidence suppression rules intact.

**Test scenarios:**

- Prompt contracts require coverage-first and exact-key grouping behavior.
- Public docs describe Instantly `custom_variables` → `payload` and Smartlead `custom_fields` → `custom_payload` accurately.
- No guidance encourages raw contact or customer payload export.

### U5 — Release and proof

**Files:**

- `package.json`
- `package-lock.json`
- `docs/orchid/qa/2026-07-20-sendlens-lead-metadata-parity.md`

**Approach:**

- Advance both manifests to the next unreleased version.
- Run focused tests continuously, then required plugin smoke/validation/lint and the full plugin suite when feasible.
- Record validation evidence and residual risk before PR creation.

## Validation

- `npm run test:plugin:smoke`
- `npm run test:smartlead-ingest`
- `npm run test:query-recipes`
- focused Instantly template/ingest tests
- MCP response and prompt-contract tests
- `npm run validate:plugin`
- `npm run lint:plugin`
- `npm run test:plugin` when feasible
- `git diff --check`

## Out Of Scope

- Provider mutations or writes.
- Customer-specific fixed Clay schemas.
- Treating bounded metadata evidence as full-population proof.
- Exporting raw lead payloads or private contact data to external artifacts.

