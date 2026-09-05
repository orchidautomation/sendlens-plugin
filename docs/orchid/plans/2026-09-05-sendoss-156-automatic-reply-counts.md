# SENDOSS-156: Snapshot reply aggregate evidence

## Context and objective

`campaign_analytics` already stores four nullable reply aggregates. The
`campaign_overview` view in `plugin/local-db.ts` omits event and unique automatic
counts and coalesces other missing counts to zero. `plugin/summary.ts` and the
scoped snapshot in `plugin/server.ts` lose further fields.

Expose cached reply evidence consistently without changing providers, refresh,
classification, or hydration. Work directly in Codex; no workers or deployment.

## Scope and acceptance mapping

1. Preserve all four nullable counts in `campaign_overview`; preserve unknown
   unique reply rates. No table migration or provider API calls are required.
2. Share count aggregation/formatting between both snapshot paths. Campaign rows
   expose event, unique non-automatic, automatic event, and unique automatic
   counts. Null means unavailable; zero is confirmed zero.
3. Preserve existing active-only headline KPI scope. Add reply totals to
   `inventory_metrics` across the full requested inventory, including recently
   sending paused campaigns. Incomplete totals remain null, not partial sums
   presented as exact totals. Provider breakdowns retain provider identity.
4. Explain the zero-human/nonzero-automatic case using provider aggregates;
   keep reply-body coverage separate and make no assertion of hydrated bodies.
5. Add synthetic regression coverage using a paused campaign with automatic
   replies, missing aggregates, and colliding provider-native IDs. Exercise
   broad and filtered MCP snapshots for active and active_or_recent scopes.
6. Document nullable fields and inventory versus active totals in
   `docs/MCP_RESPONSE_CONTRACT.md`. Advance the root package manifest and lockfile together to 0.1.89.

## Ordered implementation and proof

Add a focused snapshot regression script using the existing local DB and MCP
in-memory transport test patterns; demonstrate failure against current code.
Repair the view, shared reply helpers, broad summary and scoped snapshot.
Wire the regression into the fast test tier. Run focused tests, full
`test:plugin`, `validate:plugin`, `lint:plugin`, host bundle checks, Orchid repo
preflight and `git diff --check`. Review the diff before one PR linking
SENDOSS-156 and GitHub #90, with `ai:autofix-enabled`.

## Compatibility, risks and rollback

Keep `workspace_snapshot.v1`, existing keys, campaign scope defaults, row caps,
provider-qualified IDs and hydration metadata. Reply counts/rates previously
fabricated as zero become null when unknown; consumers must handle null.
Historical ingestion that already discarded availability cannot be recovered
by this view change. Do not infer provider classification beyond cached fields.
New totals are null if any contributing campaign lacks that field, including
mixed-provider snapshots. Roll back the PR to restore prior view/response
behavior; no destructive data migration is involved. Release remains the
normal reviewed PR pipeline and merge is Brandon-owned.

## Readiness

READY_TO_PIN. No issue dependencies or existing PR. The user explicitly
selected this previously parked issue for implementation on 2026-09-05.
