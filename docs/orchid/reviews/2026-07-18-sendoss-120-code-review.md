---
issue: SENDOSS-120
reviewed_at: 2026-07-18
base: origin/main
review_type: focused-boundary-correctness
result: pass
---

# SENDOSS-120 Focused Code Review

## Outcome

No unresolved P0, P1, or P2 findings remain. The review covered the Streamable HTTP boundary, connection lifecycle, stdio compatibility, packaged runtime dependencies, and operator documentation.

One test-coverage gap was fixed during review: the HTTP proof now asserts that an unset transport remains `stdio`, `http` is accepted, and an unknown transport value fails startup.

## Boundary reviewed

- HTTP mode fails closed without a token-safe deployment credential of at least 32 UTF-8 bytes.
- The configured credential is reduced to a SHA-256 digest before request handling; supplied credentials are digest-compared with `timingSafeEqual`.
- Host validation and exact optional Origin validation run before access control; access control runs before the bounded JSON parser.
- Every MCP POST, GET, and DELETE requires access. Browser OPTIONS preflight is the documented exception and remains behind Host and Origin validation.
- The health response is deliberately public and contains only static status, package version, and transport name.
- Request errors and lifecycle logs exclude authorization values, request bodies, connection identifiers, query strings, provider data, and workspace paths.
- Public deployment requires external HTTPS termination. One deployment credential grants access to the single process-wide workspace; this is not a multi-tenant authorization model.

## Correctness and reliability reviewed

- The default entry point still creates a fresh MCP server over stdio.
- HTTP creates one MCP server and SDK Streamable HTTP transport per initialized connection.
- Missing, unknown, malformed, over-capacity, and terminated-connection paths return bounded generic errors.
- Pending initializations count toward the connection cap, and active/opening connections are closed during shutdown.
- Controller and per-connection cleanup are idempotent.
- Express is declared as a direct production dependency and included in runtime bootstrap metadata.

## Automated evidence

- `npm run test:http-transport`
- `npm run test:plugin:smoke`
- `npm run validate:plugin`
- `npm run lint:plugin` (zero errors; existing host-translation warnings only)
- `npm run test:mcp-response-contract`
- `npm run test:host-bundles`
- `npm run test:plugin`
- `node scripts/runtime-dependencies.cjs assert-current`
- `git diff --check`

The focused HTTP proof uses the official TypeScript SDK clients for both stdio and Streamable HTTP. It covers config failure, health, access parity, Host/Origin rejection, CORS preflight, bounded/malformed bodies, initialization, connection routing, capacity, tool listing, `setup_doctor`, termination, cleanup, and log-canary absence.

Cross-model review was attempted with the configured Claude, Grok/Cursor, and Composer adapters; none was available in this environment. The required correctness, testing, maintainability, project-standards, API-contract, reliability, adversarial, and explicit boundary-review lenses were therefore completed inline.

## Human deployment gate

Before public release, a human must verify the real TLS-terminating proxy, delivered Host header, deployment secret handling, MCP Inspector flow, and production log redaction. No vendor-specific Railway or reverse-proxy deployment configuration is part of this change.
