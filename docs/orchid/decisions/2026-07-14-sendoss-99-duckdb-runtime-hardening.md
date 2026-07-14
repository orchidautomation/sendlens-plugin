# DuckDB 1.5 runtime hardening decision

Date: 2026-07-14
Linear: `SENDOSS-99`
Branch: `blocks/sendoss-99-evaluate-duckdb-15-runtime-hardening-for-sendlens-oss`

## Decision

SendLens should keep DuckDB as the local-first analytical cache and harden the embedded runtime in small follow-up slices. Do not rewrite refresh around `MERGE INTO`, do not expose arbitrary DuckDB file/network reads, do not adopt `VARIANT` for public cache schema yet, and do not implement encryption-at-rest without a separate reviewed key-management design.

Recommended follow-up order:

1. Pin and validate the latest compatible `@duckdb/node-api` / `@duckdb/node-bindings` 1.5.x release.
2. Add explicit DuckDB runtime resource policy with operator env overrides for memory, threads, temp directory, and temp-directory size.
3. Reuse a same-process DuckDB instance cache only after preserving the current refresh-promotion, WAL/lock retry, and test-reset contracts.
4. Run a separate opt-in encryption spike before any implementation. Treat encryption as defense in depth, not a compliance claim.
5. Reject `VARIANT` for now. Revisit only when the Node API can safely serialize SendLens-facing values and a schema migration is justified by larger representative data.

## Evidence summary

### Version inventory

Source dependency state:

| Surface | Current value |
| --- | --- |
| `package.json` | `@duckdb/node-api: ^1.5.1-r.1` |
| `package-lock.json` | `@duckdb/node-api: 1.5.1-r.2`; `@duckdb/node-bindings: 1.5.1-r.2`; native bindings for darwin/linux/win32 arm64/x64 at `1.5.1-r.2` |
| Runtime probe from `scripts/benchmark-duckdb-runtime.mjs` | DuckDB engine `v1.5.1`; Node API package `1.5.1-r.2`; bindings package `1.5.1-r.2` |
| npm registry on 2026-07-14 | latest `@duckdb/node-api` and `@duckdb/node-bindings` are `1.5.4-r.1` |

Generated host bundles are built from the same package manifest and lockfile rather than carrying a separate DuckDB version pin. `scripts/test-host-bundle-inventory.mjs` should remain the validation surface for generated bundle presence after build.

### DuckDB release facts

DuckDB 1.4 is the LTS line through 2026-09-16 and introduced database encryption, `MERGE INTO`, and Iceberg writes. DuckDB documents encryption as covering the database file, WAL, and temporary files when an encrypted database is attached with an encryption key. Source: https://duckdb.org/2025/09/16/announcing-duckdb-140

DuckDB 1.5 introduced `VARIANT`, the new CLI, PEG parser work, and core `GEOMETRY`. Its release notes also flag future DuckDB 2.0 behavior changes such as disabling single-arrow lambda syntax by default and staged geometry axis-order changes. Source: https://duckdb.org/2026/03/09/announcing-duckdb-150

DuckDB configuration docs confirm that runtime options can be set via configuration/`SET`, with defaults of `memory_limit` at 80% RAM, `threads` at CPU cores, `temp_directory` beside the database file, and `max_temp_directory_size` at 90% of available disk. They also document `temp_file_encryption`, `storage_compatibility_version`, and `variant_minimum_shredding_size`. Source: https://duckdb.org/docs/current/configuration/overview

DuckDB warns that `memory_limit` applies to the buffer manager and actual process memory can exceed it because vectors, query results, and some aggregate state allocate outside the buffer manager. Source: https://duckdb.org/docs/current/configuration/pragmas

The installed Node API supports `DuckDBInstance.create(path, options)` and `DuckDBInstance.fromCache(path, options)`, and its README says multiple instances in the same process should not attach the same database; use an instance cache to prevent that.

## Current SendLens runtime contract

Current source behavior:

- `plugin/local-db.ts` opens `DuckDBInstance.create(dbPath)` without explicit runtime options, connects, ensures schema, and stores a `DuckDBInstance` per returned connection in a `WeakMap` for close cleanup.
- `getDb()` retries transient lock and WAL replay errors, then returns `LocalDbUnavailableError` after timeout.
- `closeDb()` closes both connection and instance.
- `resetDbConnectionForTests()` is currently a no-op because no singleton is retained.
- `plugin/instantly-ingest.ts` refreshes into a shadow database, checkpoints it, promotes it atomically, moves any live WAL with the live database backup, cleans shadow/backup files, then stamps cache-owner metadata on the promoted live database.
- `plugin/server.ts` wraps `analyze_data` results in an outer row cap, but the underlying query can still do large joins, aggregations, sorts, and window work before the cap is applied.
- `plugin/sql-guard.ts` blocks mutation, unqualified tables, non-`sendlens.*` schemas, disallowed private tables, set operations, table-valued functions, and external-source functions such as `read_csv_auto`, `read_parquet`, `read_json_auto`, and `query_table`.
- `docs/TRUST_AND_PRIVACY.md` defines the local cache as potentially containing campaign data, sampled leads, custom payload JSON, reconstructed outbound copy, and fetched exact reply body text after explicit hydration.

These are invariants for follow-up implementation.

## Synthetic benchmark

Command:

```bash
node scripts/benchmark-duckdb-runtime.mjs
```

Fixture:

- 80,000 synthetic rows.
- No provider credentials.
- No real cache inspection.
- Refresh-like workload creates synthetic lead-event and campaign tables, then checkpoints.
- Analysis-like workload joins, groups, aggregates, orders, and returns only 8 rows, proving that small returned output does not bound internal work.
- `VARIANT` probe compares persisted text JSON and persisted `VARIANT` on synthetic payloads.

Results on the 2026-07-14 agent host:

| Scenario | DuckDB settings | Ingest | Join/group/sort | DB bytes | WAL bytes |
| --- | --- | ---: | ---: | ---: | ---: |
| Default | `memory_limit=12.4 GiB`, `threads=8`, `max_temp_directory_size=90% of available disk`, temp beside DB | 150 ms | 24 ms | 2,109,440 | 0 |
| Bounded | `memory_limit=244.1 MiB`, `threads=2`, `max_temp_directory_size=488.2 MiB`, explicit temp dir | 150 ms | 17 ms | 2,109,440 | 0 |

This small fixture does not prove the ideal production limit, but it does prove that the Node API accepts the intended configuration options and that a conservative resource policy can preserve representative SendLens-shaped work. Larger fixtures should be part of the implementation PR.

`VARIANT` results:

| Probe | Result |
| --- | --- |
| Default new DB storage compatibility | `storage_compatibility_version=v0.10.2`; persisted `VARIANT` table creation fails because `VARIANT` storage requires v1.5.0 |
| Explicit `storage_compatibility_version=v1.5.0` | persisted `VARIANT` table creation succeeds |
| Text JSON ingest | 49 ms; database after text table 536,576 bytes |
| `VARIANT` table creation from text table | 83 ms; estimated table delta 262,144 bytes |
| Raw `VARIANT` serialization through current Node API | fails with `Unexpected type id: 0` when row objects are materialized |
| Cast-to-`VARCHAR` read | succeeds |

The storage-compatibility and Node-serialization caveats are enough to reject `VARIANT` for SendLens public schema in this issue.

## Resource policy recommendation

Add a small runtime-options layer around `DuckDBInstance.create()`:

- `SENDLENS_DUCKDB_MEMORY_LIMIT`, default initially `512MB` or `1GB` after a larger benchmark pass.
- `SENDLENS_DUCKDB_THREADS`, default `2`.
- `SENDLENS_DUCKDB_TEMP_DIRECTORY`, default under `SENDLENS_STATE_DIR` when set, otherwise beside the configured DB path.
- `SENDLENS_DUCKDB_MAX_TEMP_DIRECTORY_SIZE`, default `1GB`.

Implementation should pass these as instance creation options, report effective settings through setup doctor, and keep current failure wording private-safe. For out-of-memory, temp-limit, or disk-full errors, return a bounded `duckdb_unavailable`-style error that recommends setup doctor and env overrides without printing query text, payload values, paths containing secrets, or provider credentials.

Do not imply that output row caps protect host resources. Keep `analyze_data` guidance focused on constrained SQL, but enforce resource limits at DuckDB runtime.

## Instance lifecycle decision

Do not reuse one connection globally. A single shared connection would complicate concurrent MCP calls and test isolation.

Do consider `DuckDBInstance.fromCache(dbPath, options)` or an explicit `DuckDBInstanceCache` per process, with one connection per operation. That matches the Node API guidance against multiple same-process instances attaching the same database.

Required implementation checks:

- A refresh process and an MCP process are separate processes; same-process caching cannot solve multi-process writer contention, so lock/WAL retry remains required.
- Shadow refresh promotion changes the live DB file underneath future reads; cached instances must not hold stale file handles after promotion. Reads should either use the cache only for stable process lifetime with explicit invalidation after local refresh, or skip caching for the refresh path.
- `resetDbConnectionForTests()` must invalidate any process cache.
- `closeDb()` must not close a cached instance while other same-process connections are active.
- Atomic promotion, scoped refresh seeding, `CHECKPOINT`, WAL cleanup, and backup rollback must remain unchanged.

Given those constraints, instance reuse is worthwhile only as a focused follow-up with concurrency and refresh-promotion tests. It should not be bundled with resource limits.

## Encryption-at-rest assessment

Encryption is plausible but not ready for implementation in this issue.

Minimum design requirements:

- Opt-in only until Brandon approves defaults and key management.
- Key must be provided through environment, OS keychain, or host secret mechanism; never store it in DuckDB, refresh status, traces, setup output, Linear, PRs, or docs.
- Setup doctor can report configured/missing/unusable state, but must never print key material.
- Coverage must include live DB, WAL, shadow refresh DB, backup DB, and temp spill files. DuckDB documents encrypted DB temp-file coverage, but SendLens still has to verify its own shadow/backup lifecycle.
- Loss path must be rebuild-oriented: if the key is lost, users can rebuild from providers or demo fixtures. Do not promise recovery.
- Rotation and migration need an explicit procedure from unencrypted to encrypted and from old key to new key.
- Client isolation should encourage per-client DB paths and avoid sharing one encrypted cache across clients unless explicitly configured.
- `ATTACH`, external-source access, extension loading, and SQL guard boundaries must stay blocked at MCP level. Encryption must not become a reason to expose raw DuckDB power.

Security/privacy review is required before any encryption implementation issue is marked ready.

## DuckDB 2.0 compatibility notes

Record these triggers for future validation:

- Run the full plugin suite before any DuckDB 2.0 dependency update.
- Add focused SQL parser/guard checks for any changed `node-sql-parser` or DuckDB syntax behavior.
- Confirm no SendLens SQL uses deprecated single-arrow lambda syntax.
- Keep `GEOMETRY`, spatial extensions, arbitrary `ATTACH`, and external file reads out of scope.
- Recheck storage compatibility before adopting 1.5-only persisted types.
- Treat storage-format changes as migration work, not a dependency-only bump.

## Follow-up SENDOSS issue drafts

### `SENDOSS-100`: Runtime dependency update

Route: `ce-work`

Scope:

- Update `@duckdb/node-api` and `@duckdb/node-bindings` to latest compatible 1.5.x.
- Rebuild and validate host bundles.
- Confirm engine version, lockfile integrity, native platform bindings, and no MCP response contract drift.

Acceptance:

- `package.json` and `package-lock.json` pin/resolve the selected 1.5.x version.
- Runtime probe reports the expected DuckDB engine and package versions.
- `npm run test:plugin`, `npm run validate:plugin`, `npm run lint:plugin`, and `npm run test:host-bundles` pass.

### `SENDOSS-101`: Explicit DuckDB resource policy

Route: `ce-work`

Scope:

- Add parsed env config for memory, threads, temp directory, and max temp size.
- Pass options into every `DuckDBInstance.create()` / cache creation path.
- Report effective settings and private-safe failure hints through setup doctor.
- Add synthetic resource tests, including a small-result/high-internal-work query.

Acceptance:

- Defaults are conservative and overrideable.
- Invalid env values fail closed with clear private-safe messages.
- Existing demo, refresh, cache identity, SQL guard, and lock retry tests pass.

### `SENDOSS-102`: Same-process DuckDB instance cache

Route: `ce-work`

Scope:

- Evaluate `DuckDBInstance.fromCache()` or a repo-owned instance cache with per-operation connections.
- Preserve multi-process lock retry, refresh promotion, WAL replay, and test reset.
- Add tests for concurrent reads, refresh promotion, and cache invalidation.

Acceptance:

- No stale live-cache reads after refresh promotion.
- `resetDbConnectionForTests()` reliably clears process state.
- Lock retry behavior remains equivalent across processes.

### `SENDOSS-103`: Encryption-at-rest spike

Route: `ce-plan` then security/privacy review before `ce-work`

Scope:

- Design opt-in encrypted cache, WAL, shadow, backup, and temp spill coverage.
- Define key provisioning, redaction, loss/rebuild, migration, rotation, doctor UX, and client isolation.
- Produce a proof with synthetic/demo data only.

Acceptance:

- No key material appears in output, traces, status, docs, fixtures, PRs, or Linear.
- Existing unencrypted demo cache has a clear migration or rebuild path.
- Human approval records whether encryption remains opt-in or becomes default.

## Validation performed

- `npm install`
- `npm view @duckdb/node-api version versions --json`
- `npm view @duckdb/node-bindings version versions --json`
- `node scripts/benchmark-duckdb-runtime.mjs`
- `npm run test:plugin`
- `npm run validate:plugin`
- `npm run lint:plugin` (passed with existing Pluxx translation warnings)
- `npm run test:host-bundles`
- `git diff --check`

This PR intentionally changes only a decision artifact and a synthetic benchmark harness. Full validation remains required again before merging any implementation follow-up.
