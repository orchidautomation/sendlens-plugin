# SENDOSS-171 replayable receipts QA

## Scope

SENDOSS-171 adds local, bounded, versioned analysis receipts; explicit metric reconciliation records; and a receipt-only semantic diff path. The implementation remains read-only and does not persist SQL, contacts, message bodies, paths, or diagnostic canaries.

Active task branch: `codex/sendoss-171-replayable-receipts`.

## Result

- `analysis_receipts` stores question, rationale, recipe, SQL, metric-contract, provider-capability, freshness, sampling, dependency-set, and bounded result hashes plus truncation and claim-limit metadata.
- `report_dependencies` stores hash-based public-surface dependencies with evidence frame, provider, and freshness metadata.
- `metric_reconciliations` records authoritative/decomposition surfaces, residual, compatibility outcome, severity, expected semantic causes, and unsupported reasons.
- Receipt result hashing is bounded to a fixed prefix; provider, freshness, and sampling snapshots are capped before persistence.
- Known recipe hashes bind the recipe route card and SQL contract without storing those values in the receipt.
- `analysis-receipt-semantic-diff` classifies missing receipts, incompatible contracts, changed questions/rationales/recipes, provider capability, sampling, freshness, dependencies, status, evidence limits, and material result changes. It marks incompatible question/recipe/metric contracts non-replayable.
- Aggregate campaign reply counts versus hydrated List Email rows remain explicitly scope-incompatible; retrieval failures are recorded separately as `retrieval_defect`.
- `analyze_data` and `prepare_campaign_analysis` return safe receipt/reconciliation metadata, and existing analyst, launch-operator, and reply-auditor guidance cites those records without requesting private fields.

## Validation

| Check | Result |
|---|---|
| `node scripts/test-analysis-receipts.mjs` | Passed, including privacy, migration-backed storage, semantic diff, bounded reconciliation, and unsupported cases |
| `node scripts/test-query-recipes-contract.mjs` | Passed |
| `node scripts/test-schema-migrations.mjs` | Passed |
| `node scripts/test-analyze-data-runtime.mjs` | Passed |
| `npm run test:plugin` | Passed, including MCP/privacy/runtime/behavioral proof and 73-recipe catalog |
| `npm run ci:plugin` | Passed: container config, validation, lint, host bundles, and legacy installer compatibility |
| `npm run test:release-state` | Passed |
| `npm run validate:plugin` | Passed for `sendlens@0.1.86` |
| `npm run lint:plugin` | Passed with 0 errors and 46 host-translation/runtime warnings |
| `npm run eval:plugin` | Completed with 0 errors and the existing semantic warning: 70/100 |
| `npm run test:host-bundles` | Passed: 5 skills, 15 commands, 9 agents |
| `git diff --check` | Passed |

## Residual risks and limits

- The semantic evaluation warning is existing plugin-quality debt, not a SENDOSS-171 runtime failure.
- `npm ci` reported six audit advisories in the existing dependency tree (1 low, 3 moderate, 2 high); no dependency upgrade is part of this ticket.
- The repository’s site production-audit check has been a known external gate exception on the preceding merged SENDOSS PRs; plugin, container, host-bundle, release-state, and installer gates pass here. The GitHub PR check result is the source of truth for any site-specific status.
- Proof is local/demo and does not claim provider network behavior, mutation paths, installed-host UI behavior, or unrestricted SQL replay.
