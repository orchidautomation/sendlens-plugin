# SENDOSS-116 sanitized agentic routing proof

## Command

Run the deterministic local proof in demo/CI mode:

```bash
npm run test:agentic-routing-proof
```

For an operator-facing proof summary plus sanitized JSON:

```bash
npm run proof:agentic-routing
```

The command can write sanitized JSON to an explicit `--json-out` path. Move or summarize the JSON into `docs/orchid/qa/` only after confirming it contains no private values.
CI mode uses a fixed timestamp and zeroed receipt timings so the report is deterministic; local operator mode may include wall-clock timing metadata.

## What the proof covers

- Broad workspace-health prompt handle uses one `workspace_snapshot` analysis call.
- Exact campaign-tag sender-risk and equivalent/reversed prompt handles use `analysis_starters` for `campaign-sender-inventory-by-tag`, then one focused `analyze_data` call.
- Missing exact tag uses one declared correction check through `tag-scope-audit` and stops within four analysis calls.
- Novel safe analysis uses `search_catalog` before one focused public-view `analyze_data` query.
- Success, zero-row, guard, and query-error canaries validate that reportable proof output contains only route/tool/recipe/public-surface/status/timing metadata.
- The recipe registry is derived from `getQueryRecipes()`, checked for zero/duplicate IDs, and compared to the reviewed v0.1.64 baseline of 58 IDs so unreviewed additions/removals fail loudly.
- Exact sender-risk proof cases bind back to the shipped behavioral routing matrix case before executing the recipe, so the executable proof fails if that route card drifts.

## Proof limits

This is a demo/CI proof harness. It does not prove installed-host latency, runtime enforcement of natural-language intent, query interruption, compute limits, exact column lineage, persisted telemetry, provider network behavior, or provider mutations.

## 2026-07-18 validation evidence

- `npm run test:agentic-routing-proof` — passed; sanitized JSON summary reported 6 cases, 15 user-analysis calls, 2 setup calls excluded, and 58 recipe IDs. Captured stdout/stderr are scanned before the report asserts output canary absence.
- `npm run test:skill-routing` — passed.
- `npm run test:query-recipes` — passed.
- `npm run test:mcp-response-contract` — passed.
- `npm run test:plugin` — passed when rerun outside the restricted sandbox; the sandboxed run failed only in the existing DB lock subprocess readiness check, and the focused DB lock test passed outside the sandbox.
- `npm run eval:plugin` — passed with the existing semantic warning threshold output.
- `npm run validate:plugin` — passed.
- `npm run lint:plugin` — passed with existing host-translation warnings.
- `npm run build:hosts` — passed.
- `npm run test:host-bundles -- --assume-dist` — passed when rerun outside the restricted sandbox; the sandboxed run reached the fresh `dist/codex` runtime dependency bootstrap and failed to install/verify platform-native dependencies.
- `git diff --check` — passed.
