# Bounded agent analytics routing

## Context

SendLens already exposes saved SQL recipes, public semantic views, schema tools, and guarded local DuckDB reads. An exact campaign-tag sender-risk request nevertheless took a broad path, confused campaign tags with assignment account tags, and recomputed sender aggregates that were already available. The same work exposed an `analyze_data` failure path that could return submitted SQL or private cache details.

## Decision

Skills remain the workflow authority. Routine exact questions start with an exact `analysis_starters(recipe_id=...)` lookup and one guarded `analyze_data` call; broad snapshots and schema discovery are later escalation steps. `campaign-sender-inventory-by-tag` is the canonical exact tag route and preserves provider-qualified campaign identity, active-campaign scope, campaign-versus-assignment tag semantics, and sender-scoped stored 30-day aggregates.

Route cards add bounded intent, grain, time basis, scope, cost, privacy, and adaptation guidance to high-risk/common recipes. In compact topic listings, recipes with route cards appear first because they carry this safer execution context. This ordering is deterministic metadata prioritization, not free-form prompt ranking; the response guidance states that reason. Combined campaign-tag, sender, and deliverability catalog hints are deterministic and keep the canonical recipe first without replacing skill routing.

Catalog suggestions expose a smaller route-card projection than exact recipe retrieval. SENDOSS-117 limits that projection to the proof-corpus sender-risk route and its directly linked `tag-scope-audit` correction, deduplicates cards deterministically, and caps the suggestion envelope at 8 KiB. The catalog projection contains no SQL, detailed notes, or campaign evidence rows. A zero-row sender-inventory result names `tag-scope-audit` and then stops; it never authorizes broadening, an impossible fifth-call retry, or an ad hoc schema aggregate. The four-call follow-up budget begins at the primary recipe lookup, so catalog discovery is outside that count. Focused public-view custom SQL remains the bounded escalation for novel supported questions after the recipe ladder is exhausted.

`analyze_data` failures return stable, generic codes plus bounded diagnostics. They never return submitted or rewritten SQL, literal values, credentials, workspace/client identifiers, cache fingerprints, or local paths. Diagnostic elapsed time and row caps are observability only; they do not claim query timeout, interruption, or resource enforcement.

## Ownership

- SendLens owns: skill routing, route-card semantics, saved recipes, public views, guarded local query behavior, evidence caveats, and privacy-safe MCP responses.
- Pluxx owns: cross-host compilation, installation, host discovery, and generated bundle portability.

## Consequences

Exact routine analysis is faster and more predictable, while novel questions may still use bounded custom SQL against public views after the recipe and catalog ladder is exhausted. Typed recipe parameters, runtime query interruption, automatic workflow planning, and tool removal remain separate decisions. Inbox inventory and sender aggregates remain operational risk evidence, not proof of inbox placement or authentication health.

## Validation

- `scripts/test-local-plugin-runtime.mjs` proves combined-intent routing, exact provider-qualified sender rows, active-campaign filtering, numeric Instantly status handling, and stored-aggregate reuse.
- `scripts/test-query-recipes-contract.mjs` proves route-card shape, compact ordering rationale, safe literal guidance, guarded execution, and exact recipe lookup.
- `scripts/test-analyze-data-runtime.mjs` proves generic parser, binder, runtime, guard, and cache-failure responses and checks response/stderr canaries.
- `scripts/test-behavioral-routing.mjs`, analyst evals, prompt contracts, and generated-host tests preserve the exact route and call-budget guidance across shipped surfaces.
