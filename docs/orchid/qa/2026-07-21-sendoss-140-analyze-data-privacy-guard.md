# SENDOSS-140 Analyze Data Privacy Guard QA

## Scope

SENDOSS-140 hardens `analyze_data` after a cohort-analysis prompt accidentally grouped by a raw provider status metadata field. The implementation keeps custom read-only SQL available, but makes unsafe raw/high-cardinality cohorts hard to choose and blocks unsafe results before tool output reaches the model.

## Privacy invariants covered

- `list_columns` and `search_catalog` expose column safety metadata: `safe_to_select`, `safe_to_group_by`, `contains_pii`, `raw_json`, `high_cardinality`, `prefer_derived_field`, and `recommended_cohort_field`.
- `status_summary`, raw payload JSON, raw message bodies, and reply/rendered body fields are unsafe for direct `analyze_data` selection or grouping.
- Safe cohort fields such as `status`, reply labels, step/variant fields, provider/source fields, and payload-key views remain available.
- `analyze_data` returns `code: "privacy_guard"` with safe alternatives for unsafe column usage or singleton-heavy high-cardinality aggregates.
- Result rows are redacted for email-like identifiers inside arbitrary strings, including JSON-shaped strings.

## Validation run on 2026-07-21

Passed:

- `npm run test:analyze-data-privacy`
- `npm run test:mcp-response-contract`
- `npm run test:query-recipes`
- `npm run test:sql-guard`
- `node scripts/test-mcp-version-sync.mjs`
- `npm run validate:plugin`
- `npm run lint:plugin` (0 errors, existing translation/runtime warnings only)
- `git diff --check`

Known local smoke blockers:

- `npm run test:plugin:smoke` stops at the pre-existing stdio transport fixture with `McpError: MCP error -32000: Connection closed` on Node.js v24.15.0 before the new privacy test runs.
- Running the remaining smoke commands after skipping that first fixture reaches `scripts/test-skill-eval-runner.mjs` and fails on the existing raw-eval-output assertion (`raw eval output outside the ignored artifact workspace must fail`).

## Residual risk

The guard intentionally does not remove custom SQL. It blocks known raw fields before execution, redacts direct identifiers in returned strings, and rejects singleton-heavy fake aggregates after execution. Future follow-up can add more first-class derived cohort views if operators need richer segmentation than the existing safe labels and payload-key surfaces.
