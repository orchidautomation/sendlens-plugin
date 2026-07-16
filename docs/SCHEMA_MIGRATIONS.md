# Schema Migrations

SendLens stores local analytics data in DuckDB under the private `sendlens`
schema. The plugin upgrades that schema through an explicit migration ledger:

```sql
sendlens.schema_migrations(migration_id, applied_at)
```

The ledger is private implementation metadata. It must not be added to
`PUBLIC_TABLES`, table descriptions, catalog docs, or any `analyze_data`
surface.

## Rules

- Add new migrations with a unique, ordered, immutable ID such as
  `YYYYMMDDNNNN_short_description`.
- Never rewrite, rename, reorder, or remove a migration that has shipped.
- Record success only after all statements in the migration complete.
- Keep migrations idempotent when possible so partially upgraded historical
  databases can recover by reconnecting after the cause is fixed.
- Wrap migration DDL in a transaction when DuckDB supports the required
  operation. If an operation cannot be transactional, document the recovery
  behavior in the migration comment and add a focused fixture test.
- If a database contains an unknown migration ID, the plugin must fail safely
  with an actionable upgrade message rather than mutating the cache.

## Tests

Update `scripts/test-schema-migrations.mjs` for every schema migration. Cover:

- a fresh database reaching the current schema;
- a representative historical database preserving rows through upgrade;
- failed/interrupted migration behavior and retry;
- routine reconnects skipping broad DDL replay;
- SQL guard privacy for migration metadata.

Run at least:

```bash
npm run test:schema-migrations
npm run test:plugin:smoke
```
