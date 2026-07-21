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
const { buildSetupDoctorReport } = require("../build/plugin/setup-doctor.js");
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
assert.equal(seeded.campaign_ids.length, 4);
assert.ok(seeded.campaign_ids.includes("smartlead:demo-alpha"));

const db = await getDb();
try {
  const summary = await buildWorkspaceSummary(db);
  assert.equal(summary.workspaceId, "demo_workspace");
  assert.equal(summary.active_data_state.status, "demo_workspace");
  assert.equal(summary.active_data_state.is_demo_workspace, true);
  assert.match(summary.summary, /synthetic demo fixtures|synthetic demo workspace/i);
  assert.match(summary.warnings.join("\n"), /synthetic demo fixture data/i);
  assert.equal(summary.exact_metrics.active_campaign_count, 4);
  assert.ok(summary.exact_metrics.total_sent > 0);
  assert.ok(summary.summary.includes("Sampled raw tables are evidence support only"));
  assert.deepEqual(
    summary.provider_breakdown.map((row) => row.source_provider).sort(),
    ["instantly", "smartlead"],
  );
  assert.ok(
    summary.provider_capabilities.some(
      (row) =>
        row.source_provider === "smartlead"
        && row.capability === "inbox_placement"
        && row.support_status === "supported",
    ),
  );

  const emptyPublicSurfaces = [];
  const optionalDemoEmptySurfaces = new Set([
    "provider_overlap_risk",
    "provider_overlap_risk_details",
  ]);
  for (const tableName of PUBLIC_TABLES) {
    const countRows = await query(
      db,
      `SELECT COUNT(*) AS row_count FROM sendlens.${tableName}`,
    );
    if (
      Number(countRows[0].row_count) <= 0
      && !optionalDemoEmptySurfaces.has(tableName)
    ) {
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
       AND reply_email_id = 'reply-alpha-1'
     ORDER BY reply_received_at DESC, reply_email_id
     LIMIT 1`,
  );
  assert.ok(String(replyRows[0].reply_body_text).includes("referral leakage"));

  const settingRows = await query(
    db,
    `SELECT
       campaign_id,
       tracking_status,
       deliverability_settings_status
     FROM sendlens.campaign_overview
     ORDER BY campaign_id`,
  );
  assert.equal(settingRows.some((row) => row.tracking_status === "tracking_unknown"), false);
  assert.equal(
    settingRows.some((row) => row.deliverability_settings_status === "deliverability_settings_unknown"),
    false,
  );
  const riskCampaign = settingRows.find((row) => row.campaign_id === "demo-risk");
  assert.equal(riskCampaign.tracking_status, "open_and_link_tracking_on");
  assert.equal(riskCampaign.deliverability_settings_status, "deliverability_guardrails_relaxed");

  const status = await readRefreshStatus();
  assert.equal(status.status, "succeeded");
  assert.equal(status.workspaceId, "demo_workspace");
  assert.match(String(status.message), /Synthetic SendLens demo workspace/);
  const doctor = await buildSetupDoctorReport();
  assert.equal(doctor.active_data_state.status, "demo_workspace");
  assert.match(doctor.active_data_state.message, /No live provider workspace is configured/i);
  assert.ok(
    doctor.checks.some(
      (check) => check.name === "Active data state" && check.status === "warn",
    ),
  );

  const ambiguousNameRows = await query(
    db,
    `SELECT source_provider, provider_campaign_id, campaign_source_id
     FROM sendlens.campaign_overview
     WHERE campaign_name = 'Demo - Healthcare Operators'
     ORDER BY source_provider`,
  );
  assert.deepEqual(
    ambiguousNameRows.map((row) => row.source_provider),
    ["instantly", "smartlead"],
  );
  assert.equal(ambiguousNameRows[1].campaign_source_id, "smartlead:demo-alpha");

  const smartleadReplyRows = await query(
    db,
    `SELECT source_provider, reply_body_text
     FROM sendlens.reply_context
     WHERE campaign_id = 'smartlead:demo-alpha'
       AND reply_email_id IS NOT NULL
     LIMIT 1`,
  );
  assert.equal(smartleadReplyRows[0].source_provider, "smartlead");
  assert.match(
    String(smartleadReplyRows[0].reply_body_text),
    /Smartlead demo thread/,
  );
} finally {
  closeDb(db);
}

console.log("demo workspace tests passed");
