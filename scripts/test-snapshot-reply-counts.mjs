import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DuckDBInstance } from "@duckdb/node-api";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sendlens-snapshot-replies-"));
process.env.SENDLENS_DB_PATH = path.join(dir, "fixture.duckdb");
process.env.SENDLENS_STATE_DIR = dir;
process.env.SENDLENS_DEMO_MODE = "0";
process.env.SENDLENS_SOURCE_PROVIDER = "all";
const { getDb, run, query, setActiveWorkspaceId, closeDb, resetDbConnectionForTests } = await import("../build/plugin/local-db.js");
const { createSendLensServer } = await import("../build/plugin/server.js");
const server = createSendLensServer();
const client = new Client({ name: "snapshot-reply-counts", version: "1.0.0" });
try {
  const db = await getDb();
  await setActiveWorkspaceId(db, "synthetic");
  await run(db, `INSERT INTO sendlens.campaigns
    (id, workspace_id, name, status, source_provider, provider_campaign_id,
     detail_selection_reason, recent_activity_coverage, recent_sent_count)
    VALUES ('active', 'synthetic', 'Fixture Active', 'active', 'instantly', 'active', 'active', 'available', 100),
           ('paused', 'synthetic', 'Fixture Paused', 'paused', 'instantly', 'paused', 'recent_activity', 'available', 20),
           ('smartlead:paused', 'synthetic', 'Fixture Unknown', 'active', 'smartlead', 'paused', 'active', 'unavailable', NULL)`);
  await run(db, `INSERT INTO sendlens.campaign_analytics
    (workspace_id, campaign_id, source_provider, emails_sent_count,
     reply_count, reply_count_unique, reply_count_automatic, reply_count_automatic_unique)
    VALUES ('synthetic', 'active', 'instantly', 100, 4, 2, 3, 1),
           ('synthetic', 'paused', 'instantly', 20, 0, 0, 7, 5),
           ('synthetic', 'smartlead:paused', 'smartlead', 50, NULL, NULL, NULL, NULL)`);
  closeDb(db);
  // Model an already-current v0.1.88 cache: opening it must upgrade the view,
  // without discarding campaign data or requiring a provider refresh.
  const historicalInstance = await DuckDBInstance.create(process.env.SENDLENS_DB_PATH);
  const historical = await historicalInstance.connect();
  try {
    await historical.run(`DELETE FROM sendlens.schema_migrations
      WHERE migration_id > '202608080004_analysis_receipts'`);
    await historical.run(`INSERT OR IGNORE INTO sendlens.schema_migrations
      (migration_id, applied_at) VALUES ('202608080004_analysis_receipts', CURRENT_TIMESTAMP)`);
    await historical.run(`CREATE OR REPLACE VIEW sendlens.campaign_overview AS
      SELECT workspace_id, id AS campaign_id, name AS campaign_name,
             0 AS reply_count_unique, 0 AS reply_count_automatic
      FROM sendlens.campaigns`);
  } finally {
    historical.closeSync();
    historicalInstance.closeSync();
  }
  const upgraded = await getDb();
  try {
    const rows = await query(upgraded, `SELECT reply_count, reply_count_unique,
      reply_count_automatic, reply_count_automatic_unique
      FROM sendlens.campaign_overview WHERE campaign_id = 'paused'`);
    assert.deepEqual(rows, [{ reply_count: 0, reply_count_unique: 0,
      reply_count_automatic: 7, reply_count_automatic_unique: 5 }]);
  } finally {
    closeDb(upgraded);
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  async function snapshot(args) {
    const response = await client.callTool({ name: "workspace_snapshot", arguments: args });
    assert.ok(!response.isError, JSON.stringify(response));
    const payload = JSON.parse(response.content.find((item) => item.type === "text").text);
    assert.ok(Array.isArray(payload.campaigns), JSON.stringify(payload));
    return payload;
  }
  for (const filter of [{}, { campaign_name: "Fixture" }]) {
    for (const campaign_scope of ["active", "active_or_recent"]) {
      const result = await snapshot({ ...filter, provider: "instantly", campaign_scope });
      const active = result.campaigns.find((row) => row.campaign_id === "active");
      assert.equal(active.reply_count, 4, "non-automatic event count must survive the snapshot");
      assert.equal(active.reply_count_unique, 2);
      assert.equal(active.reply_count_automatic, 3);
      assert.equal(active.reply_count_automatic_unique, 1);
      assert.equal(result.exact_metrics.total_auto_replies, 3, "headlines remain active-only");
      assert.equal(result.inventory_metrics.total_auto_replies, campaign_scope === "active" ? 3 : 10);
      assert.equal(result.inventory_metrics.total_unique_auto_replies, campaign_scope === "active" ? 1 : 6);
      const paused = result.campaigns.find((row) => row.campaign_id === "paused");
      if (campaign_scope === "active") assert.equal(paused, undefined);
      else {
        assert.equal(paused.reply_count_unique, 0);
        assert.equal(paused.reply_count_automatic, 7);
        assert.equal(paused.reply_count_automatic_unique, 5);
        assert.match(paused.reply_summary, /0 unique human replies/);
        assert.match(paused.reply_summary, /automatic replies are present/);
        assert.doesNotMatch(paused.reply_summary, /pending|missing hydration/i);
        assert.match(result.summary, /10 automatic reply events/);
      }
    }
    const mixed = await snapshot({ ...filter, provider: "all", campaign_scope: "active_or_recent" });
    const unknown = mixed.campaigns.find((row) => row.source_provider === "smartlead");
    assert.equal(unknown.provider_campaign_id, "paused");
    assert.notEqual(unknown.campaign_source_id, mixed.campaigns.find((row) => row.campaign_id === "paused").campaign_source_id);
    for (const field of ["reply_count", "reply_count_unique", "reply_count_automatic", "reply_count_automatic_unique", "unique_reply_rate_pct"]) {
      assert.equal(unknown[field], null, `${field} must not fabricate zero`);
    }
    assert.equal(mixed.exact_metrics.total_unique_replies, null);
    assert.equal(mixed.exact_metrics.unique_reply_rate_pct, null);
    assert.equal(mixed.inventory_metrics.total_auto_replies, null, "partial provider sums are not exact totals");
    assert.match(unknown.reply_summary, /unavailable/);
    assert.doesNotMatch(mixed.summary, /null|NaN/);
    assert.equal(mixed.provider_breakdown.find((row) => row.source_provider === "smartlead").total_auto_replies, null);
  }
  const pausedOnly = await snapshot({ campaign_name: "Fixture Paused", campaign_scope: "active_or_recent" });
  assert.equal(pausedOnly.exact_metrics.total_auto_replies, 0);
  assert.equal(pausedOnly.inventory_metrics.total_auto_replies, 7);
  assert.match(pausedOnly.summary, /7 automatic reply events/);
  console.log("Snapshot reply-count evidence passed across broad/scoped, active/recent, unknown and mixed-provider cases.");
} finally {
  await client.close();
  await server.close();
  await resetDbConnectionForTests();
  await fs.rm(dir, { recursive: true, force: true });
}
