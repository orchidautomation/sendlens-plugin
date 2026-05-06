import assert from "node:assert/strict";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { seedDemoWorkspace } = require("../build/plugin/demo-workspace.js");
const {
  closeDb,
  getDb,
  query,
  resetDbConnectionForTests,
} = require("../build/plugin/local-db.js");
const { PUBLIC_TABLES } = require("../build/plugin/constants.js");
const { buildWorkspaceSummary } = require("../build/plugin/summary.js");
const { readRefreshStatus } = require("../build/plugin/refresh-status.js");

process.env.SENDLENS_DB_PATH = path.join(
  os.tmpdir(),
  `sendlens-demo-test-${Date.now()}.duckdb`,
);
process.env.SENDLENS_STATE_DIR = path.dirname(process.env.SENDLENS_DB_PATH);
process.env.SENDLENS_DEMO_MODE = "1";

await resetDbConnectionForTests();
const seeded = await seedDemoWorkspace();
assert.equal(seeded.schema_version, "sendlens_demo_seed.v1");
assert.equal(seeded.workspaceId, "demo_workspace");
assert.equal(seeded.campaign_ids.length, 3);

const db = await getDb();
try {
  const summary = await buildWorkspaceSummary(db);
  assert.equal(summary.workspaceId, "demo_workspace");
  assert.equal(summary.exact_metrics.active_campaign_count, 3);
  assert.ok(summary.exact_metrics.total_sent > 0);
  assert.ok(summary.summary.includes("Sampled raw tables are evidence support only"));

  const emptyPublicSurfaces = [];
  for (const tableName of PUBLIC_TABLES) {
    const countRows = await query(
      db,
      `SELECT COUNT(*) AS row_count FROM sendlens.${tableName}`,
    );
    if (Number(countRows[0].row_count) <= 0) {
      emptyPublicSurfaces.push(tableName);
    }
  }
  assert.deepEqual(emptyPublicSurfaces, []);

  const payloadRows = await query(
    db,
    `SELECT payload_key, payload_value, reply_outcome_label
     FROM sendlens.lead_payload_kv
     WHERE campaign_id = 'demo-alpha'
       AND payload_key = 'segment'
     ORDER BY payload_value`,
  );
  assert.ok(payloadRows.length >= 1);
  assert.equal(payloadRows[0].payload_key, "segment");

  const replyRows = await query(
    db,
    `SELECT reply_body_text
     FROM sendlens.reply_context
     WHERE campaign_id = 'demo-alpha'
       AND reply_email_id IS NOT NULL
     ORDER BY reply_received_at DESC
     LIMIT 1`,
  );
  assert.ok(String(replyRows[0].reply_body_text).includes("referral leakage"));

  const status = await readRefreshStatus();
  assert.equal(status.status, "succeeded");
  assert.equal(status.workspaceId, "demo_workspace");
  assert.match(String(status.message), /Synthetic SendLens demo workspace/);
} finally {
  closeDb(db);
}

console.log("demo workspace tests passed");
