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
  `INSERT OR REPLACE INTO sendlens.step_analytics
   (workspace_id, campaign_id, step, variant, sent, opens, replies, replies_automatic, unique_replies, clicks, bounces, opportunities, synced_at)
   VALUES ('ws_test', 'c1', 0, 0, 200, 80, 8, 0, 8, 2, 2, 1, CURRENT_TIMESTAMP),
          ('ws_test', 'c1', 1, 0, 160, 50, 2, 0, 2, 1, 1, 0, CURRENT_TIMESTAMP),
          ('ws_test', 'c1', 2, 0, 120, 25, 0, 0, 0, 0, 0, 0, CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.sampled_leads
   (workspace_id, campaign_id, id, email, first_name, last_name, company_name, company_domain, status, email_reply_count, lt_interest_status, email_replied_step, email_replied_variant, timestamp_last_reply, job_title, custom_payload, sample_source, sampled_at)
   VALUES ('ws_test', 'c1', 'l1', 'a@example.com', 'Alex', 'Avery', 'Acme Health', 'acme.test', 'active', 1, 1, 0, 0, CURRENT_TIMESTAMP, 'VP Operations', '{"campaign":"c1","Country":"United States","Category":"Healthcare","firstName":"Alex"}', 'reply_full', CURRENT_TIMESTAMP),
          ('ws_test', 'c1', 'l2', 'b@example.com', 'Blake', 'Baker', 'Beta Health', 'beta.test', 'active', 0, NULL, NULL, NULL, NULL, 'Director', '{"campaign":"c1","Country":"Canada","Category":"Healthcare"}', 'nonreply_sample', CURRENT_TIMESTAMP),
          ('ws_test', 'c1', 'l3', 'ooo@example.com', 'Olive', 'Out', 'OOO Co', 'ooo.test', 'active', 1, 0, 0, 0, CURRENT_TIMESTAMP, 'Manager', '{"campaign":"c1","Country":"United States"}', 'reply_full', CURRENT_TIMESTAMP),
          ('ws_test', 'c1', 'l4', 'won@example.com', 'Wynn', 'Won', 'Won Co', 'won.test', 'active', 1, 4, 0, 0, CURRENT_TIMESTAMP, 'CRO', '{"campaign":"c1","stage":"won"}', 'reply_full', CURRENT_TIMESTAMP),
          ('ws_test', 'c1', 'l5', 'completed@example.com', 'Casey', 'Complete', 'Complete Co', 'complete.test', 'active', 1, 3, 0, 0, CURRENT_TIMESTAMP, 'VP Sales', '{"campaign":"c1","stage":"meeting_completed"}', 'reply_full', CURRENT_TIMESTAMP),
          ('ws_test', 'c1', 'l6', 'booked@example.com', 'Brook', 'Booked', 'Booked Co', 'booked.test', 'active', 1, 2, 0, 0, CURRENT_TIMESTAMP, 'RevOps Lead', '{"campaign":"c1","stage":"meeting_booked"}', 'reply_full', CURRENT_TIMESTAMP),
          ('ws_test', 'c1', 'l7', 'not@example.com', 'Nico', 'No', 'No Co', 'no.test', 'active', 1, -1, 0, 0, CURRENT_TIMESTAMP, 'VP Finance', '{"campaign":"c1","stage":"not_interested"}', 'reply_full', CURRENT_TIMESTAMP),
          ('ws_test', 'c1', 'l8', 'wrong@example.com', 'Riley', 'Wrong', 'Wrong Co', 'wrong.test', 'active', 1, -2, 0, 0, CURRENT_TIMESTAMP, 'Founder', '{"campaign":"c1","stage":"wrong_person"}', 'reply_full', CURRENT_TIMESTAMP),
          ('ws_test', 'c1', 'l9', 'lost@example.com', 'Logan', 'Lost', 'Lost Co', 'lost.test', 'active', 1, -3, 0, 0, CURRENT_TIMESTAMP, 'COO', '{"campaign":"c1","stage":"lost"}', 'reply_full', CURRENT_TIMESTAMP),
          ('ws_test', 'c1', 'l10', 'noshow@example.com', 'Nova', 'NoShow', 'No Show Co', 'noshow.test', 'active', 1, -4, 0, 0, CURRENT_TIMESTAMP, 'VP Growth', '{"campaign":"c1","stage":"no_show"}', 'reply_full', CURRENT_TIMESTAMP),
          ('ws_test', 'c1', 'l11', 'neutral@example.com', 'Noel', 'Neutral', 'Neutral Co', 'neutral.test', 'active', 1, NULL, 0, 0, CURRENT_TIMESTAMP, 'Director Ops', '{"campaign":"c1","stage":"neutral"}', 'reply_full', CURRENT_TIMESTAMP)`,
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
   VALUES ('ws_test', 'c1', 'o1', 'a@example.com', 'Alpha intro', 'Hi Alex', '0', '0', 'reconstructed_reply_template', CURRENT_TIMESTAMP),
          ('ws_test', 'c1', 'o2', 'b@example.com', 'Hi {{missing_first_name}}', 'Saw {{unknown_company_signal}}', '0', '0', 'reconstructed_nonreply_template', CURRENT_TIMESTAMP)`,
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
   ('ws_test', 'c1', 'full', 400, 800, 10, 10, 100, 1, 100, 1, 1, 0, 'full raw ingest', CURRENT_TIMESTAMP),
   ('ws_test', 'c2', 'hybrid', 300, 200, 0, 0, 100, 0, 100, 0, 0, 0, 'hybrid sample', CURRENT_TIMESTAMP)`,
);

await setActiveWorkspaceId(db, "ws_test");

const summary = await buildWorkspaceSummary(db);
assert.equal(summary.workspaceId, "ws_test");
assert.equal(summary.exact_metrics.campaign_count, 1);
assert.equal(summary.exact_metrics.active_campaign_count, 1);
assert.equal(summary.exact_metrics.total_sent, 800);
assert.equal(summary.exact_metrics.total_unique_replies, 24);
assert.ok(summary.summary.includes("1 custom tags stored locally"));
assert.ok(summary.summary.includes("Sampled raw tables are evidence support only"));
assert.ok(summary.summary.includes("full reply leads"));
assert.equal(summary.coverage.length, 1);

const campaignOverview = await runQuery(
  db,
  "SELECT campaign_name, emails_sent_count, reply_count_unique, bounced_count, total_opportunities, reply_lead_rows, nonreply_rows_sampled, unique_reply_rate_pct, bounce_rate_pct FROM sendlens.campaign_overview WHERE campaign_id = 'c1'",
);
assert.equal(campaignOverview[0].campaign_name, "Alpha");
assert.equal(Number(campaignOverview[0].emails_sent_count), 800);
assert.equal(Number(campaignOverview[0].reply_count_unique), 24);
assert.equal(Number(campaignOverview[0].bounced_count), 8);
assert.equal(Number(campaignOverview[0].total_opportunities), 2);
assert.equal(Number(campaignOverview[0].reply_lead_rows), 10);
assert.equal(Number(campaignOverview[0].nonreply_rows_sampled), 1);
assert.equal(Number(campaignOverview[0].unique_reply_rate_pct), 3);
assert.equal(Number(campaignOverview[0].bounce_rate_pct), 1);

const leadEvidence = await runQuery(
  db,
  "SELECT campaign_name, first_name, company_name, company_domain, has_reply_signal, lt_interest_label, reply_outcome_label, custom_payload FROM sendlens.lead_evidence WHERE email = 'a@example.com'",
);
assert.equal(leadEvidence[0].campaign_name, "Alpha");
assert.equal(leadEvidence[0].first_name, "Alex");
assert.equal(leadEvidence[0].company_name, "Acme Health");
assert.equal(leadEvidence[0].company_domain, "acme.test");
assert.equal(Boolean(leadEvidence[0].has_reply_signal), true);
assert.equal(String(leadEvidence[0].lt_interest_label), "interested");
assert.equal(String(leadEvidence[0].reply_outcome_label), "positive");
assert.match(String(leadEvidence[0].custom_payload), /"campaign":"c1"/);

const labelRows = await runQuery(
  db,
  `SELECT email, lt_interest_label, reply_outcome_label, has_reply_signal
   FROM sendlens.lead_evidence
   WHERE campaign_id = 'c1'
   ORDER BY email`,
);
const labelsByEmail = new Map(labelRows.map((row) => [String(row.email), row]));
const expectedReplyLabels = [
  ["a@example.com", "interested", "positive", true],
  ["booked@example.com", "meeting_booked", "positive", true],
  ["completed@example.com", "meeting_completed", "positive", true],
  ["lost@example.com", "lost", "negative", true],
  ["neutral@example.com", "unclassified", "neutral", true],
  ["noshow@example.com", "no_show", "negative", true],
  ["not@example.com", "not_interested", "negative", true],
  ["ooo@example.com", "out_of_office", "out_of_office", false],
  ["won@example.com", "won", "positive", true],
  ["wrong@example.com", "wrong_person", "negative", true],
];
for (const [email, ltInterestLabel, replyOutcomeLabel, hasReplySignal] of expectedReplyLabels) {
  const row = labelsByEmail.get(email);
  assert.ok(row, `missing lead_evidence row for ${email}`);
  assert.equal(String(row.lt_interest_label), ltInterestLabel);
  assert.equal(String(row.reply_outcome_label), replyOutcomeLabel);
  assert.equal(Boolean(row.has_reply_signal), hasReplySignal);
}
assert.equal(String(labelsByEmail.get("b@example.com").reply_outcome_label), "no_reply");
assert.equal(Boolean(labelsByEmail.get("b@example.com").has_reply_signal), false);

const oooLeadEvidence = await runQuery(
  db,
  "SELECT has_reply_signal, reply_outcome_label, lt_interest_label FROM sendlens.lead_evidence WHERE email = 'ooo@example.com'",
);
assert.equal(Boolean(oooLeadEvidence[0].has_reply_signal), false);
assert.equal(String(oooLeadEvidence[0].reply_outcome_label), "out_of_office");
assert.equal(String(oooLeadEvidence[0].lt_interest_label), "out_of_office");

const replyContext = await runQuery(
  db,
  "SELECT lead_email, reply_outcome_label, template_subject, rendered_subject FROM sendlens.reply_context WHERE campaign_id = 'c1' ORDER BY lead_email",
);
assert.equal(replyContext.length, 9);
assert.equal(replyContext.some((row) => row.lead_email === "ooo@example.com"), false);
const alphaReplyContext = replyContext.find((row) => row.lead_email === "a@example.com");
assert.equal(alphaReplyContext.template_subject, "Alpha intro");
assert.equal(alphaReplyContext.rendered_subject, "Alpha intro");

const renderedOutboundContext = await runQuery(
  db,
  "SELECT campaign_name, rendered_subject, rendered_body_text, template_subject, template_body_text FROM sendlens.rendered_outbound_context WHERE id = 'o1' LIMIT 1",
);
assert.equal(renderedOutboundContext[0].campaign_name, "Alpha");
assert.equal(renderedOutboundContext[0].rendered_subject, "Alpha intro");
assert.equal(renderedOutboundContext[0].rendered_body_text, "Hi Alex");
assert.equal(renderedOutboundContext[0].template_subject, "Alpha intro");
assert.equal(renderedOutboundContext[0].template_body_text, "Hi {{firstName}}");

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
const payloadInventoryRecipe = icpRecipes.find((recipe) => recipe.id === "campaign-payload-key-inventory");
assert.ok(payloadInventoryRecipe);
assert.match(payloadInventoryRecipe.sql, /json_each/);
const payloadInventoryRows = await runQuery(
  db,
  payloadInventoryRecipe.sql.replaceAll("{{campaign_id}}", "c1"),
);
const countryInventory = payloadInventoryRows.find((row) => row.payload_key === "Country");
assert.ok(countryInventory);
assert.equal(Number(countryInventory.sampled_leads_with_key), 3);
assert.equal(Number(countryInventory.distinct_sampled_values), 2);
assert.equal(Number(countryInventory.sampled_replying_leads_with_key), 1);
assert.equal(Number(countryInventory.sampled_positive_leads_with_key), 1);

const payloadPresenceRecipe = icpRecipes.find((recipe) => recipe.id === "campaign-payload-presence-signals");
assert.ok(payloadPresenceRecipe);
const payloadPresenceRows = await runQuery(
  db,
  payloadPresenceRecipe.sql.replaceAll("{{campaign_id}}", "c1"),
);
const countryPresence = payloadPresenceRows.find((row) => row.payload_key === "Country");
assert.ok(countryPresence);
assert.equal(Number(countryPresence.sampled_leads), 11);
assert.equal(Number(countryPresence.leads_with_key), 3);
assert.equal(Number(countryPresence.leads_without_key), 8);
assert.equal(Number(countryPresence.replying_leads_with_key), 1);
assert.equal(Number(countryPresence.positive_leads_with_key), 1);

const campaignRecipes = getQueryRecipes("campaign-performance");
const stepFatigueRecipe = campaignRecipes.find((recipe) => recipe.id === "step-fatigue-by-campaign");
assert.ok(stepFatigueRecipe);
assert.match(stepFatigueRecipe.sql, /metric_basis/);
const stepFatigueRows = await runQuery(
  db,
  stepFatigueRecipe.sql.replaceAll("{{campaign_id}}", "c1"),
);
assert.equal(stepFatigueRows.length, 3);
assert.equal(Number(stepFatigueRows[0].step), 0);
assert.equal(String(stepFatigueRows[0].metric_basis), "unique_reply_rate");
assert.equal(Number(stepFatigueRows[0].unique_reply_coverage_pct), 100);
assert.equal(Number(stepFatigueRows[0].metric_value_pct), 4);
assert.equal(Number(stepFatigueRows[1].previous_step_metric_value_pct), 4);
assert.equal(Number(stepFatigueRows[1].metric_delta_from_previous_step_pct_points), -2.75);
const copyRecipes = getQueryRecipes("copy-analysis");
const leakRecipe = copyRecipes.find((recipe) => recipe.id === "personalization-leak-audit");
assert.ok(leakRecipe);
assert.match(leakRecipe.sql, /sendlens\.rendered_outbound_context/);
assert.match(leakRecipe.sql, /unresolved_token/);
const leakRows = await runQuery(
  db,
  leakRecipe.sql.replaceAll("{{campaign_id}}", "c1"),
);
assert.equal(leakRows.length, 1);
assert.equal(Number(leakRows[0].affected_campaigns), 1);
assert.equal(Number(leakRows[0].affected_step_variants), 1);
assert.equal(Number(leakRows[0].affected_leads), 1);
assert.equal(Number(leakRows[0].affected_rendered_rows), 1);
assert.equal(leakRows[0].sample_email, "b@example.com");
assert.equal(Boolean(leakRows[0].subject_has_unresolved_token), true);
assert.equal(Boolean(leakRows[0].body_has_unresolved_token), true);

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
assert.equal(process.env.SENDLENS_INSTANTLY_API_KEY, "ambient-key");
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
