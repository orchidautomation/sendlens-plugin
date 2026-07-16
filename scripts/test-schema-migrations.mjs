import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { DuckDBInstance } = require("@duckdb/node-api");
const {
  CURRENT_SCHEMA_MIGRATION_ID,
  SchemaMigrationError,
  closeDb,
  getDb,
  query,
  run,
} = require("../build/plugin/local-db.js");
const { enforceLocalWorkspaceScope, LocalSqlGuardError } = require("../build/plugin/sql-guard.js");

async function withTempDb(prefix, callback) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(tempDir, "workspace-cache.duckdb");
  const previousDbPath = process.env.SENDLENS_DB_PATH;
  process.env.SENDLENS_DB_PATH = dbPath;
  try {
    await callback(dbPath);
  } finally {
    if (previousDbPath == null) {
      delete process.env.SENDLENS_DB_PATH;
    } else {
      process.env.SENDLENS_DB_PATH = previousDbPath;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function createHistoricalDb(dbPath) {
  const instance = await DuckDBInstance.create(dbPath);
  const conn = await instance.connect();
  try {
    await conn.run("CREATE SCHEMA IF NOT EXISTS sendlens");
    await conn.run(
      `CREATE TABLE sendlens.plugin_state (
        key VARCHAR PRIMARY KEY,
        value VARCHAR,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
    );
    await conn.run(
      `CREATE TABLE sendlens.campaigns (
        id VARCHAR,
        workspace_id VARCHAR NOT NULL,
        organization_id VARCHAR,
        name VARCHAR,
        status VARCHAR,
        daily_limit INTEGER,
        text_only BOOLEAN,
        open_tracking BOOLEAN,
        link_tracking BOOLEAN,
        schedule_timezone VARCHAR,
        sequence_count INTEGER,
        step_count INTEGER,
        timestamp_created TIMESTAMP,
        timestamp_updated TIMESTAMP,
        synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (workspace_id, id)
      )`,
    );
    await conn.run(
      `INSERT INTO sendlens.campaigns (id, workspace_id, name, status)
       VALUES ('legacy-campaign', 'ws_legacy', 'Legacy Campaign', 'active')`,
    );
    await conn.run(
      `CREATE TABLE sendlens.sampled_leads (
        workspace_id VARCHAR NOT NULL,
        campaign_id VARCHAR NOT NULL,
        id VARCHAR,
        email VARCHAR NOT NULL,
        first_name VARCHAR,
        last_name VARCHAR,
        company_name VARCHAR,
        company_domain VARCHAR,
        status VARCHAR,
        email_open_count INTEGER,
        email_reply_count INTEGER,
        email_click_count INTEGER,
        lt_interest_status INTEGER,
        timestamp_last_contact TIMESTAMP,
        timestamp_last_reply TIMESTAMP,
        custom_payload VARCHAR,
        sample_source VARCHAR,
        sampled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (workspace_id, campaign_id, email)
      )`,
    );
    await conn.run(
      `INSERT INTO sendlens.sampled_leads (workspace_id, campaign_id, id, email)
       VALUES ('ws_legacy', 'legacy-campaign', 'lead-1', 'lead@example.com')`,
    );
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

async function openAndClose() {
  const db = await getDb({ timeoutMs: 0 });
  closeDb(db);
}

await withTempDb("sendlens-schema-fresh-", async () => {
  await openAndClose();
  const db = await getDb({ timeoutMs: 0 });
  try {
    const migrations = await query(
      db,
      "SELECT migration_id FROM sendlens.schema_migrations ORDER BY migration_id",
    );
    assert.deepEqual(migrations, [{ migration_id: CURRENT_SCHEMA_MIGRATION_ID }]);
    const tables = await query(
      db,
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'sendlens' AND table_name = 'campaigns'`,
    );
    assert.equal(tables.length, 1, "fresh DB must create the current schema");
  } finally {
    closeDb(db);
  }
});

await withTempDb("sendlens-schema-historical-", async (dbPath) => {
  await createHistoricalDb(dbPath);
  await openAndClose();
  const db = await getDb({ timeoutMs: 0 });
  try {
    const migratedRows = await query(
      db,
      `SELECT name
       FROM pragma_table_info('sendlens.sampled_leads')
       WHERE name IN ('source_provider', 'normalized_email')
       ORDER BY name`,
    );
    assert.deepEqual(
      migratedRows.map((row) => row.name),
      ["normalized_email", "source_provider"],
    );
    const campaignRows = await query(
      db,
      "SELECT id, workspace_id, name FROM sendlens.campaigns WHERE workspace_id = 'ws_legacy'",
    );
    assert.deepEqual(campaignRows, [
      { id: "legacy-campaign", workspace_id: "ws_legacy", name: "Legacy Campaign" },
    ]);
    const migrations = await query(
      db,
      "SELECT migration_id FROM sendlens.schema_migrations",
    );
    assert.deepEqual(migrations, [{ migration_id: CURRENT_SCHEMA_MIGRATION_ID }]);
  } finally {
    closeDb(db);
  }
});

await withTempDb("sendlens-schema-run-once-", async () => {
  await openAndClose();
  let db = await getDb({ timeoutMs: 0 });
  try {
    await run(db, "CREATE OR REPLACE VIEW sendlens.campaign_overview AS SELECT 'sentinel' AS marker");
  } finally {
    closeDb(db);
  }

  await openAndClose();
  db = await getDb({ timeoutMs: 0 });
  try {
    const rows = await query(db, "SELECT marker FROM sendlens.campaign_overview");
    assert.deepEqual(rows, [{ marker: "sentinel" }], "recorded migrations must not replay broad DDL");
    const migrations = await query(
      db,
      "SELECT COUNT(*) AS count FROM sendlens.schema_migrations",
    );
    assert.equal(Number(migrations[0].count), 1);
  } finally {
    closeDb(db);
  }
});

await withTempDb("sendlens-schema-failure-", async (dbPath) => {
  const previousFailure = process.env.SENDLENS_TEST_FAIL_SCHEMA_MIGRATION_ID;
  process.env.SENDLENS_TEST_FAIL_SCHEMA_MIGRATION_ID = CURRENT_SCHEMA_MIGRATION_ID;
  await assert.rejects(
    openAndClose(),
    (error) =>
      error instanceof SchemaMigrationError
      && /not recorded and will be retried/.test(error.message),
  );
  if (previousFailure == null) {
    delete process.env.SENDLENS_TEST_FAIL_SCHEMA_MIGRATION_ID;
  } else {
    process.env.SENDLENS_TEST_FAIL_SCHEMA_MIGRATION_ID = previousFailure;
  }

  const instance = await DuckDBInstance.create(dbPath);
  const conn = await instance.connect();
  try {
    const rows = await (await conn.run("SELECT COUNT(*) AS count FROM sendlens.schema_migrations")).getRowObjectsJson();
    assert.equal(Number(rows[0].count), 0, "failed migrations must not be recorded");
  } finally {
    conn.closeSync();
    instance.closeSync();
  }

  await openAndClose();
});

await withTempDb("sendlens-schema-newer-", async (dbPath) => {
  const instance = await DuckDBInstance.create(dbPath);
  const conn = await instance.connect();
  try {
    await conn.run("CREATE SCHEMA IF NOT EXISTS sendlens");
    await conn.run(
      `CREATE TABLE sendlens.schema_migrations (
        migration_id VARCHAR PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
    );
    await conn.run(
      "INSERT INTO sendlens.schema_migrations (migration_id) VALUES ('999999999999_future_schema')",
    );
  } finally {
    conn.closeSync();
    instance.closeSync();
  }

  await assert.rejects(
    openAndClose(),
    (error) =>
      error instanceof SchemaMigrationError
      && /newer unsupported plugin schema migration/.test(error.message),
  );
});

await withTempDb("sendlens-cache-version-newer-", async (dbPath) => {
  const instance = await DuckDBInstance.create(dbPath);
  const conn = await instance.connect();
  try {
    await conn.run("CREATE SCHEMA IF NOT EXISTS sendlens");
    await conn.run(
      `CREATE TABLE sendlens.plugin_state (
        key VARCHAR PRIMARY KEY,
        value VARCHAR,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
    );
    await conn.run(
      "INSERT INTO sendlens.plugin_state (key, value) VALUES ('cache_schema_version', 'sendlens.cache.v999')",
    );
  } finally {
    conn.closeSync();
    instance.closeSync();
  }

  await assert.rejects(
    openAndClose(),
    (error) =>
      error instanceof SchemaMigrationError
      && /newer unsupported schema version/.test(error.message),
  );

  const verifyInstance = await DuckDBInstance.create(dbPath);
  const verifyConn = await verifyInstance.connect();
  try {
    const rows = await (
      await verifyConn.run(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'sendlens'
           AND table_name = 'schema_migrations'`,
      )
    ).getRowObjectsJson();
    assert.equal(rows.length, 0, "future caches without ledgers must not be mutated");
  } finally {
    verifyConn.closeSync();
    verifyInstance.closeSync();
  }
});

assert.throws(
  () => enforceLocalWorkspaceScope("SELECT * FROM sendlens.schema_migrations", "ws_test"),
  (error) =>
    error instanceof LocalSqlGuardError
    && error.code === "disallowed_table"
    && /schema_migrations/.test(error.message),
);
