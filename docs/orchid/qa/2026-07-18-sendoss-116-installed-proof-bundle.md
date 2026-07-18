# SENDOSS-116 Installed Proof Bundle Addendum

## Scope

PR #74 shipped the deterministic local-first SENDOSS-116 agentic routing proof harness in v0.1.65. Post-release VPS install smoke showed the host bundle included `scripts/proof-agentic-routing.mjs` but did not include the proof matrix fixture file required for installed-bundle execution. This addendum records the narrow follow-up release-surface repair for the same SENDOSS-116 lifecycle.

## Change

- v0.1.66 copies the opaque behavioral routing matrix into each generated host bundle under `.pluxx/behavioral-routing-matrix.json` after Pluxx generation.
- Host bundle inventory now requires that bundled matrix for all four host bundles.
- Host bundle inventory now runs the proof harness inside a freshly copied Codex host bundle after runtime bootstrap, so the release gate catches missing installed-bundle proof inputs.
- The proof script converts missing/unreadable matrix startup failures into path-free stable errors.

## Proof level

- Demo/CI local-first proof: covered by `npm run test:agentic-routing-proof`.
- Installed-style bundle proof: covered by `npm run test:host-bundles -- --assume-dist` on a fresh Codex bundle copy.
- Final installed-host proof remains required after the published patch release is installed on the VPS host.

## Validation

- `npm run test:agentic-routing-proof` — pass.
- `npm run test:skill-routing` — pass.
- `npm run test:query-recipes` — pass.
- `npm run test:mcp-response-contract` — pass.
- `npm run build:hosts` — pass with existing Pluxx translation warnings.
- `npm run test:host-bundles -- --assume-dist` — pass; sandboxed run hung during fresh runtime bootstrap, unsandboxed run completed.
- `npm run test:plugin` — pass.
- `npm run validate:plugin` — pass.
- `npm run lint:plugin` — pass with existing Pluxx translation warnings.
- `npm run eval:plugin` — pass with existing semantic warning below warning threshold but above failure threshold.
- `npm run test:release-state` — pass.
- `git diff --check` — pass.

## Privacy review

This patch does not change provider access, SQL guard policy, public views, MCP response contracts, or recipe execution. The bundled fixture is the existing opaque behavioral matrix; proof output remains bounded to route, tool, recipe, public-surface, status, timing, and proof-limit metadata. The new missing-matrix startup error avoids printing local filesystem paths.
