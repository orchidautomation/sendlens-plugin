import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const {
  getDb,
  resetDbConnectionForTests,
  run,
  setActiveWorkspaceId,
} = require("../build/plugin/local-db.js");
const { getQueryRecipes } = require("../build/plugin/query-recipes.js");
const {
  normalizeStepAnalyticsRows,
  toPlainText,
} = require("../build/plugin/instantly-ingest.js");
const { loadClientEnv } = require("../build/plugin/env.js");
const { enforceLocalWorkspaceScope } = require("../build/plugin/sql-guard.js");
const { buildWorkspaceSummary } = require("../build/plugin/summary.js");

process.env.SENDLENS_DB_PATH = path.join(
  os.tmpdir(),
  `sendlens-test-${Date.now()}.duckdb`,
);

await resetDbConnectionForTests();
const db = await getDb();

await run(
  db,
  `INSERT OR REPLACE INTO sendlens.campaigns
   (id, workspace_id, organization_id, name, status, synced_at)
   VALUES ('c1', 'ws_test', 'ws_test', 'Alpha', 'active', CURRENT_TIMESTAMP),
          ('c2', 'ws_test', 'ws_test', 'Beta', 'paused', CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.campaign_analytics
   (workspace_id, campaign_id, campaign_name, leads_count, emails_sent_count, reply_count_unique, reply_count_automatic, bounced_count, total_opportunities, synced_at)
   VALUES
   ('ws_test', 'c1', 'Alpha', 400, 800, 24, 5, 8, 2, CURRENT_TIMESTAMP),
   ('ws_test', 'c2', 'Beta', 300, 200, 1, 0, 7, 0, CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.sampled_leads
   (workspace_id, campaign_id, id, email, email_reply_count, lt_interest_status, email_replied_step, email_replied_variant, timestamp_last_reply, job_title, custom_payload, sample_source, sampled_at)
   VALUES ('ws_test', 'c1', 'l1', 'a@example.com', 1, 1, 0, 0, CURRENT_TIMESTAMP, 'VP Operations', '{"campaign":"c1","Country":"United States","Category":"Healthcare","firstName":"Alex"}', 'reply_full', CURRENT_TIMESTAMP),
          ('ws_test', 'c1', 'l2', 'b@example.com', 0, NULL, NULL, NULL, NULL, 'Director', '{"campaign":"c1","Country":"Canada","Category":"Healthcare"}', 'nonreply_sample', CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.campaign_variants
   (workspace_id, campaign_id, sequence_index, step, variant, subject, body_text, synced_at)
   VALUES ('ws_test', 'c1', 0, 0, 0, 'Alpha intro', 'Hi {{firstName}}', CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.sampled_outbound_emails
   (workspace_id, campaign_id, id, to_email, subject, body_text, step_resolved, variant_resolved, sample_source, sampled_at)
   VALUES ('ws_test', 'c1', 'o1', 'a@example.com', 'Alpha intro', 'Hi Alex', '0', '0', 'reconstructed_reply_template', CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.custom_tags
   (workspace_id, id, label, color, synced_at)
   VALUES ('ws_test', 't1', 'Priority', '#ff0000', CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.custom_tag_mappings
   (workspace_id, tag_id, resource_type, resource_id, synced_at)
   VALUES ('ws_test', 't1', '2', 'c1', CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.sampling_runs
   (workspace_id, campaign_id, ingest_mode, total_leads, total_sent, reply_rows, reply_lead_rows, nonreply_sample_target, nonreply_rows_sampled, outbound_sample_target, outbound_rows_sampled, reply_outbound_rows, filtered_lead_rows, coverage_note, created_at)
   VALUES
   ('ws_test', 'c1', 'full', 400, 800, 1, 1, 100, 1, 100, 1, 1, 0, 'full raw ingest', CURRENT_TIMESTAMP),
   ('ws_test', 'c2', 'hybrid', 300, 200, 0, 0, 100, 0, 100, 0, 0, 0, 'hybrid sample', CURRENT_TIMESTAMP)`,
);

await setActiveWorkspaceId(db, "ws_test");

const summary = await buildWorkspaceSummary(db);
assert.equal(summary.workspaceId, "ws_test");
assert.equal(summary.exact_metrics.campaign_count, 2);
assert.equal(summary.exact_metrics.active_campaign_count, 1);
assert.equal(summary.exact_metrics.total_sent, 1000);
assert.equal(summary.exact_metrics.total_unique_replies, 25);
assert.ok(summary.summary.includes("1 custom tags stored locally"));
assert.ok(summary.summary.includes("Sampled raw tables are evidence support only"));
assert.ok(summary.summary.includes("full reply leads"));
assert.equal(summary.coverage.length, 2);

const campaignOverview = await runQuery(
  db,
  "SELECT campaign_name, reply_lead_rows, nonreply_rows_sampled FROM sendlens.campaign_overview WHERE campaign_id = 'c1'",
);
assert.equal(campaignOverview[0].campaign_name, "Alpha");
assert.equal(Number(campaignOverview[0].reply_lead_rows), 1);

const leadEvidence = await runQuery(
  db,
  "SELECT campaign_name, has_reply_signal, reply_outcome_label, custom_payload FROM sendlens.lead_evidence WHERE email = 'a@example.com'",
);
assert.equal(leadEvidence[0].campaign_name, "Alpha");
assert.equal(String(leadEvidence[0].reply_outcome_label), "positive");
assert.match(String(leadEvidence[0].custom_payload), /"campaign":"c1"/);

const replyContext = await runQuery(
  db,
  "SELECT template_subject, rendered_subject FROM sendlens.reply_context WHERE campaign_id = 'c1' LIMIT 1",
);
assert.equal(replyContext[0].template_subject, "Alpha intro");
assert.equal(replyContext[0].rendered_subject, "Alpha intro");

const campaignTags = await runQuery(
  db,
  "SELECT tag_label FROM sendlens.campaign_tags WHERE campaign_id = 'c1' LIMIT 1",
);
assert.equal(campaignTags[0].tag_label, "Priority");

const rewritten = enforceLocalWorkspaceScope(
  "SELECT c.name, ca.reply_count_unique FROM sendlens.campaigns c JOIN sendlens.campaign_analytics ca ON c.id = ca.campaign_id",
  "ws_test",
);
assert.ok(rewritten.includes("workspace_id = 'ws_test'"));

const tagRecipes = getQueryRecipes("tags");
assert.equal(tagRecipes.length >= 2, true);
assert.equal(tagRecipes[0].topic, "tags");
assert.equal(
  tagRecipes.some((recipe) => recipe.id === "sampled-leads-by-tag" && recipe.sql.includes("sendlens.campaign_tags")),
  true,
);
const icpRecipes = getQueryRecipes("icp-signals");
assert.equal(
  icpRecipes.some((recipe) => recipe.id === "campaign-payload-key-signals" && recipe.sql.includes("json_extract_string(custom_payload")),
  true,
);

const normalizedStepAnalytics = normalizeStepAnalyticsRows([
  { step: null, variant: 2, sent: 10 },
  { step: "Step 1", variant: "", sent: 20, opens: 5 },
  { step: 2, variant: 3, sent: 30, opened: 8 },
]);
assert.equal(normalizedStepAnalytics.skippedRows, 1);
assert.deepEqual(normalizedStepAnalytics.validRows, [
  {
    step: 1,
    variant: 0,
    sent: 20,
    opened: 5,
    replies: undefined,
    repliesAutomatic: undefined,
    uniqueReplies: undefined,
    clicks: undefined,
    bounces: undefined,
    opportunities: undefined,
  },
  {
    step: 2,
    variant: 3,
    sent: 30,
    opened: 8,
    replies: undefined,
    repliesAutomatic: undefined,
    uniqueReplies: undefined,
    clicks: undefined,
    bounces: undefined,
    opportunities: undefined,
  },
]);

assert.equal(
  toPlainText({
    children: [
      { text: "Hi {{firstName}}" },
      { text: "<p>We saw your CHNA cycle coming up.</p>" },
    ],
  }),
  "Hi {{firstName}} We saw your CHNA cycle coming up.",
);
assert.equal(
  toPlainText({ html: "<div>Line one</div><div>Line two</div>" }),
  "Line one Line two",
);

const envRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sendlens-env-"));
await fs.mkdir(path.join(envRoot, ".env.clients"));
await fs.writeFile(
  path.join(envRoot, ".env"),
  [
    "SENDLENS_INSTANTLY_API_KEY=base-key",
    "SENDLENS_DB_PATH=$HOME/.sendlens/workspace-cache.duckdb",
    "SENDLENS_CLIENT=acme",
  ].join("\n"),
);
await fs.writeFile(
  path.join(envRoot, ".env.local"),
  "SENDLENS_INSTANTLY_API_KEY=local-key\n",
);
await fs.writeFile(
  path.join(envRoot, ".env.clients", "acme.env"),
  "SENDLENS_INSTANTLY_API_KEY=client-key\n",
);
process.env.SENDLENS_INSTANTLY_API_KEY = "ambient-key";
delete process.env.SENDLENS_DB_PATH;
delete process.env.SENDLENS_CLIENT;
loadClientEnv(envRoot);
assert.equal(process.env.SENDLENS_INSTANTLY_API_KEY, "client-key");
assert.equal(
  process.env.SENDLENS_DB_PATH,
  path.join(os.homedir(), ".sendlens", "workspace-cache.duckdb"),
);
assert.equal(process.env.SENDLENS_CLIENT, "acme");

console.log("plugin runtime tests passed");

async function runQuery(conn, sql) {
  const rows = await conn.run(sql);
  return rows.getRowObjectsJson();
}
