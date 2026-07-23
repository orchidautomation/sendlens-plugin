import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const {
  getDb,
  isUnresolvedDbPath,
  resetDbConnectionForTests,
  resolveDbPath,
  run,
  setActiveWorkspaceId,
} = require("../build/plugin/local-db.js");
const { buildQueryRecipeResponse, getQueryRecipes } = require("../build/plugin/query-recipes.js");
const {
  buildCatalogSearchGuidance,
  catalogColumnCacheStatsForTests,
  CatalogPublicTableError,
  invalidateCatalogColumnCache,
  listColumns,
  resetCatalogColumnCacheForTests,
  searchCatalog,
} = require("../build/plugin/catalog.js");
const {
  buildAnalyzeDataDiagnostics,
  referencedPublicSurfaces,
} = require("../build/plugin/analyze-data-diagnostics.js");
const {
  normalizeStepAnalyticsRows,
  toPlainText,
} = require("../build/plugin/instantly-ingest.js");
const { isUnresolvedEnvValue, loadClientEnv, loadSendLensEnv } = require("../build/plugin/env.js");
const { enforceLocalWorkspaceScope } = require("../build/plugin/sql-guard.js");
const { buildWorkspaceSummary } = require("../build/plugin/summary.js");
const { readRefreshStatus } = require("../build/plugin/refresh-status.js");
const { buildSetupDoctorReport } = require("../build/plugin/setup-doctor.js");

process.env.SENDLENS_DB_PATH = path.join(
  os.tmpdir(),
  `sendlens-test-${Date.now()}.duckdb`,
);

await resetDbConnectionForTests();
const db = await getDb();

await run(
  db,
  `INSERT OR REPLACE INTO sendlens.campaigns
   (id, workspace_id, organization_id, name, status, daily_limit, synced_at)
   VALUES ('c1', 'ws_test', 'ws_test', 'Alpha', 'active', 50, CURRENT_TIMESTAMP),
          ('c2', 'ws_test', 'ws_test', 'Beta', 'paused', 25, CURRENT_TIMESTAMP),
          ('c3', 'ws_test', 'ws_test', 'Gamma', 'active', 5, CURRENT_TIMESTAMP),
          ('c4', 'ws_test', 'ws_test', 'Runway Active', 'active', 40, CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `UPDATE sendlens.campaigns
   SET detail_selection_reason = 'recent_sends',
       recent_activity_coverage = 'available',
       recent_activity_window_start = DATE '2026-06-24',
       recent_activity_window_end = DATE '2026-07-23',
       recent_activity_timezone = 'UTC',
       recent_activity_timezone_source = 'utc_fallback',
       recent_sent_count = 12,
       recent_activity_evaluated_at = TIMESTAMP '2026-07-23 12:00:00',
       recent_activity_source = 'instantly.campaigns.analytics'
   WHERE workspace_id = 'ws_test'
     AND id = 'c2'`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.campaign_analytics
   (workspace_id, campaign_id, campaign_name, leads_count, contacted_count, emails_sent_count, new_leads_contacted_count, reply_count_unique, reply_count_automatic, bounced_count, total_opportunities, total_opportunity_value, synced_at)
   VALUES
   ('ws_test', 'c1', 'Alpha', 400, 320, 800, 40, 24, 5, 8, 2, 25000, CURRENT_TIMESTAMP),
   ('ws_test', 'c2', 'Beta', 300, 100, 200, 10, 1, 0, 7, 0, 0, CURRENT_TIMESTAMP),
   ('ws_test', 'c3', 'Gamma', 50, 0, 0, 0, 0, 0, 0, 0, 0, CURRENT_TIMESTAMP),
   ('ws_test', 'c4', 'Runway Active', 970, 2475, 2475, 340, 30, 1, 2, 3, 50000, CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.campaign_daily_metrics
   (workspace_id, campaign_id, date, sent, contacted, new_leads_contacted, opened, unique_opened, replies, unique_replies, replies_automatic, unique_replies_automatic, clicks, unique_clicks, opportunities, unique_opportunities, synced_at)
   VALUES ('ws_test', 'c1', '2026-05-01'::DATE, 25, 25, 25, 5, 4, 2, 2, 0, 0, 1, 1, 1, 1, CURRENT_TIMESTAMP),
          ('ws_test', 'c1', '2026-05-02'::DATE, 15, 15, 15, 3, 2, 1, 1, 0, 0, 0, 0, 0, 0, CURRENT_TIMESTAMP),
          ('ws_test', 'c3', '2026-05-01'::DATE, 5, 5, 5, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, CURRENT_TIMESTAMP),
          ('ws_test', 'c4', CURRENT_DATE - INTERVAL 1 DAY, 170, 170, 170, 40, 30, 5, 5, 0, 0, 1, 1, 2, 2, CURRENT_TIMESTAMP),
          ('ws_test', 'c4', CURRENT_DATE - INTERVAL 8 DAY, 170, 170, 170, 42, 31, 4, 4, 0, 0, 1, 1, 1, 1, CURRENT_TIMESTAMP)`,
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
   VALUES ('ws_test', 'c1', 'l1', 'a@example.com', 'Alex', 'Avery', 'Acme Health', 'acme.test', 'active', 1, 1, 0, 0, CURRENT_TIMESTAMP, 'VP Operations', '{"campaign":"c1","Country":"United States","Category":"Healthcare","firstName":"Alex","Buyer Persona":"VP Operations","employee-band":"1001-5000","tech.stack":"Epic; Salesforce","enrichment_score":92,"is_priority":true,"intent_flags":["hiring","expansion"],"account_context":{"source":"Clay"}}', 'reply_full', CURRENT_TIMESTAMP),
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
   VALUES ('ws_test', 'c1', 0, 0, 0, 'Alpha intro', 'Hi {{firstName}}', CURRENT_TIMESTAMP),
          ('ws_test', 'c1', 1, 0, 1, 'Alpha signature', 'Hi {{firstName}} {{accountSignature}}', CURRENT_TIMESTAMP),
          ('ws_test', 'c4', 0, 0, 0, 'Runway intro', 'Hi {{firstName}}', CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.sampled_outbound_emails
   (workspace_id, campaign_id, id, to_email, subject, body_text, step_resolved, variant_resolved, sample_source, sampled_at)
   VALUES ('ws_test', 'c1', 'o1', 'a@example.com', 'Alpha intro', 'Hi Alex', '0', '0', 'reconstructed_reply_template', CURRENT_TIMESTAMP),
          ('ws_test', 'c1', 'o2', 'b@example.com', 'Hi {{missing_first_name}}', 'Saw {{unknown_company_signal}}', '0', '0', 'reconstructed_nonreply_template', CURRENT_TIMESTAMP),
          ('ws_test', 'c1', 'o3', 'completed@example.com', 'Alpha signature', 'Hi Casey {{accountSignature}}', '0', '1', 'reconstructed_reply_template', CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.reply_emails
   (workspace_id, id, campaign_id, thread_id, lead_email, message_id, eaccount, from_email, to_email, subject, body_text, body_html, sent_at, is_auto_reply, ai_interest_value, i_status, content_preview, direction, step_resolved, variant_resolved, hydrated_at, synced_at)
   VALUES ('ws_test', 're1', 'c1', 'thread1', 'a@example.com', '<m1@example.com>', 'sender@example.com', 'a@example.com', 'sender@example.com', 'Re: Alpha intro', 'Actual positive reply text', '<p>Actual positive reply text</p>', CURRENT_TIMESTAMP, false, 0.9, 1, 'Actual positive reply text', 'inbound', '0', '0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.reply_email_hydration_state
   (workspace_id, campaign_id, i_status, latest_of_thread, email_type, next_starting_after, pages_hydrated, emails_hydrated, exhausted, last_hydrated_at, synced_at)
   VALUES ('ws_test', 'c1', 1, true, 'received', 'cursor1', 1, 1, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.custom_tags
   (workspace_id, id, source_provider, label, color, synced_at)
   VALUES ('ws_test', 't1', 'instantly', 'Priority', '#ff0000', CURRENT_TIMESTAMP),
          ('ws_test', 't2', 'instantly', 'Sender Pool', '#00ff00', CURRENT_TIMESTAMP),
          ('ws_test', 't3', 'smartlead', 'Priority', '#0000ff', CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.custom_tag_mappings
   (workspace_id, tag_id, source_provider, resource_type, resource_id, synced_at)
   VALUES ('ws_test', 't1', 'instantly', '2', 'c1', CURRENT_TIMESTAMP),
          ('ws_test', 't1', 'instantly', '2', 'c3', CURRENT_TIMESTAMP),
          ('ws_test', 't1', 'smartlead', '2', 'smartlead:cross-provider-only', CURRENT_TIMESTAMP),
          ('ws_test', 't2', 'instantly', '1', 'tagged@example.com', CURRENT_TIMESTAMP),
          ('ws_test', 't2', 'instantly', '1', 'direct@example.com', CURRENT_TIMESTAMP),
          ('ws_test', 't3', 'smartlead', '2', 'c1', CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.accounts
   (workspace_id, email, status, warmup_status, warmup_score, daily_limit, total_sent_30d, total_replies_30d, total_bounces_30d, synced_at)
   VALUES ('ws_test', 'direct@example.com', '1', 'healthy', 99, 30, 100, 5, 1, CURRENT_TIMESTAMP),
          ('ws_test', 'tagged@example.com', 'active', 'healthy', 98, 20, 200, 10, 4, CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.account_daily_metrics
   (workspace_id, email, date, sent, bounced, unique_replies, synced_at)
   VALUES ('ws_test', 'direct@example.com', '2026-05-01'::DATE, 10, 1, 2, CURRENT_TIMESTAMP),
          ('ws_test', 'tagged@example.com', '2026-05-01'::DATE, 20, 0, 3, CURRENT_TIMESTAMP),
          ('ws_test', 'direct@example.com', '2026-05-02'::DATE, 15, 0, 1, CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.account_daily_metrics
   (workspace_id, email, source_provider, date, sent, bounced, unique_replies, synced_at)
   VALUES ('ws_test', 'direct@example.com', 'smartlead', '2026-05-01'::DATE, 999, 99, 99, CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.campaign_account_assignments
   (workspace_id, campaign_id, assignment_type, assignment_key, account_email, tag_id, synced_at)
   VALUES ('ws_test', 'c1', 'email', 'direct@example.com', 'direct@example.com', NULL, CURRENT_TIMESTAMP),
          ('ws_test', 'c1', 'tag', 't2', NULL, 't2', CURRENT_TIMESTAMP),
          ('ws_test', 'c2', 'email', 'direct@example.com', 'direct@example.com', NULL, CURRENT_TIMESTAMP),
          ('ws_test', 'c4', 'email', 'direct@example.com', 'direct@example.com', NULL, CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.inbox_placement_tests
   (workspace_id, id, organization_id, name, delivery_mode, description, type, sending_method, campaign_id, email_subject, email_body, emails_json, test_code, tags_json, text_only, recipients_json, recipients_labels_json, timestamp_created, timestamp_next_run, status, not_sending_status, metadata_json, raw_json, synced_at)
   VALUES ('ws_test', 'ipt1', 'ws_test', 'Alpha inbox test', 1, 'Alpha deliverability test', 1, 1, 'c1', 'Alpha intro', 'Hi there', '["sender@example.com"]', 'abc123', '["deliverability"]', true, '["seed@gmail.com","seed@outlook.com"]', '["Gmail","Outlook"]', '2026-05-01 10:00:00'::TIMESTAMP, '2026-05-08 10:00:00'::TIMESTAMP, 1, NULL, '{"source":"test"}', '{"id":"ipt1"}', CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.inbox_placement_analytics
   (workspace_id, id, organization_id, test_id, timestamp_created, timestamp_created_date, is_spam, has_category, sender_email, sender_esp, recipient_email, recipient_esp, recipient_geo, recipient_type, spf_pass, dkim_pass, dmarc_pass, smtp_ip_blacklist_report_json, authentication_failure_results_json, record_type, raw_json, synced_at)
   VALUES
   ('ws_test', 'ipa0', 'ws_test', 'ipt1', '2026-05-01 10:00:00'::TIMESTAMP, '2026-05-01'::DATE, NULL, NULL, 'sender@example.com', 1, 'seed@gmail.com', 1, 1, 1, true, true, true, NULL, NULL, 1, '{"id":"ipa0"}', CURRENT_TIMESTAMP),
   ('ws_test', 'ipa1', 'ws_test', 'ipt1', '2026-05-01 10:01:00'::TIMESTAMP, '2026-05-01'::DATE, false, false, 'sender@example.com', 1, 'seed@gmail.com', 1, 1, 1, true, true, true, NULL, NULL, 2, '{"id":"ipa1"}', CURRENT_TIMESTAMP),
   ('ws_test', 'ipa2', 'ws_test', 'ipt1', '2026-05-01 10:02:00'::TIMESTAMP, '2026-05-01'::DATE, true, false, 'sender@example.com', 1, 'seed@outlook.com', 2, 1, 1, true, false, true, '{"listed":true}', '{"dkim":"failed"}', 2, '{"id":"ipa2"}', CURRENT_TIMESTAMP),
   ('ws_test', 'ipa3', 'ws_test', 'ipt1', '2026-05-01 10:03:00'::TIMESTAMP, '2026-05-01'::DATE, false, true, 'sender@example.com', 1, 'seed@yahoo.com', 3, 1, 1, true, true, false, NULL, '{"dmarc":"failed"}', 2, '{"id":"ipa3"}', CURRENT_TIMESTAMP)`,
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

resetCatalogColumnCacheForTests();
await assert.rejects(
  listColumns(db, "schema_migrations"),
  (error) =>
    error instanceof CatalogPublicTableError
    && error.code === "non_public_table",
);
assert.equal(
  catalogColumnCacheStatsForTests().public_column_hydrations,
  0,
  "private column lookup must be rejected before information_schema hydration",
);

const broadCatalogMatches = await searchCatalog(
  db,
  "website visitor campaign reply payload rendered outbound inbox placement tags sender account runway",
);
assert.equal(
  catalogColumnCacheStatsForTests().public_column_hydrations,
  1,
  "cold catalog search should hydrate public columns once",
);
assert.ok(broadCatalogMatches.length > 0);
assert.ok(broadCatalogMatches.some((match) => match.table === "reply_emails" || match.table === "reply_context"));
assert.ok(broadCatalogMatches.some((match) => match.table === "lead_payload_kv"));
assert.ok(broadCatalogMatches.some((match) => match.table === "rendered_outbound_context"));
assert.ok(broadCatalogMatches.some((match) => match.table === "inbox_placement_tests"));
assert.ok(broadCatalogMatches.some((match) => match.table === "campaign_accounts" || match.table === "accounts"));
const broadCatalogGuidance = buildCatalogSearchGuidance(
  "website visitor campaign reply payload rendered outbound inbox placement tags sender account runway",
  broadCatalogMatches,
);
assert.ok(broadCatalogGuidance.search_terms.includes("campaign_overview"));
assert.ok(
  broadCatalogGuidance.analysis_starter_suggestions.some(
    (suggestion) =>
      suggestion.concept === "runway"
      && suggestion.topics.includes("campaign-performance")
      && suggestion.recipe_ids.includes("campaign-tag-runway-inputs"),
  ),
);
const tagDeliverabilityGuidance = buildCatalogSearchGuidance("campaign tag deliverability", []);
assert.equal(
  tagDeliverabilityGuidance.analysis_starter_suggestions[0]?.concept,
  "campaign-tag sender risk",
  "campaign-tag deliverability prompts should route to exact sender inventory before generic deliverability",
);
assert.equal(
  tagDeliverabilityGuidance.analysis_starter_suggestions[0]?.recipe_ids[0],
  "campaign-sender-inventory-by-tag",
);
const combinedSenderRiskGuidance = buildCatalogSearchGuidance(
  "show sender deliverability risk for exact campaign tag Priority",
  [],
);
assert.equal(
  combinedSenderRiskGuidance.analysis_starter_suggestions[0]?.concept,
  "campaign-tag sender risk",
  "combined campaign-tag, sender, and deliverability intent should route independently of word order",
);
assert.equal(
  combinedSenderRiskGuidance.analysis_starter_suggestions[0]?.recipe_ids[0],
  "campaign-sender-inventory-by-tag",
);
const runwayGuidance = buildCatalogSearchGuidance("runway", []);
assert.match(runwayGuidance.message ?? "", /No direct schema matches/);
assert.ok(runwayGuidance.suggested_narrower_terms.includes("campaign_overview"));
assert.ok(
  runwayGuidance.analysis_starter_suggestions.some(
    (suggestion) =>
      suggestion.concept === "runway"
      && suggestion.recipe_ids.includes("campaign-tag-runway-daily-history"),
  ),
);
const runwayCatalogMatches = await searchCatalog(db, "runway");
assert.equal(runwayCatalogMatches.length, 0);
assert.equal(
  catalogColumnCacheStatsForTests().public_column_hydrations,
  1,
  "warm catalog search should not query information_schema again",
);
await Promise.all([
  searchCatalog(db, "reply"),
  searchCatalog(db, "bounce"),
  listColumns(db, "campaign_overview"),
]);
assert.equal(
  catalogColumnCacheStatsForTests().public_column_hydrations,
  1,
  "concurrent warm catalog access should not query information_schema again",
);
const originalCatalogDbPath = process.env.SENDLENS_DB_PATH;
const originalDemoMode = process.env.SENDLENS_DEMO_MODE;
process.env.SENDLENS_DB_PATH = path.join(os.tmpdir(), `sendlens-catalog-key-${Date.now()}.duckdb`);
await searchCatalog(db, "reply");
assert.equal(
  catalogColumnCacheStatsForTests().public_column_hydrations,
  2,
  "changing the resolved DB path should use a fresh public-column cache key",
);
process.env.SENDLENS_DEMO_MODE = "1";
await searchCatalog(db, "reply");
assert.equal(
  catalogColumnCacheStatsForTests().public_column_hydrations,
  3,
  "changing demo mode should use a fresh public-column cache key",
);
process.env.SENDLENS_DB_PATH = originalCatalogDbPath;
if (originalDemoMode == null) {
  delete process.env.SENDLENS_DEMO_MODE;
} else {
  process.env.SENDLENS_DEMO_MODE = originalDemoMode;
}
await searchCatalog(db, "reply");
assert.equal(
  catalogColumnCacheStatsForTests().public_column_hydrations,
  3,
  "restoring a warm catalog cache key should not query information_schema again",
);
invalidateCatalogColumnCache();
assert.equal(
  catalogColumnCacheStatsForTests().cache_generation,
  1,
  "explicit catalog invalidation should advance cache generation",
);
await Promise.all([
  searchCatalog(db, "campaign"),
  listColumns(db, "campaign_overview"),
]);
assert.equal(
  catalogColumnCacheStatsForTests().public_column_hydrations,
  4,
  "catalog invalidation should trigger exactly one fresh public-column hydration",
);
const diagnosticCanary = "diagnostic-canary@example.invalid";
assert.deepEqual(
  referencedPublicSurfaces(
    `SELECT * FROM sendlens.campaign_overview co JOIN sendlens.schema_migrations sm ON true WHERE co.campaign_name = '${diagnosticCanary}'`,
  ),
  ["campaign_overview"],
  "diagnostics should surface only public sendlens tables and omit private names",
);
const diagnostics = buildAnalyzeDataDiagnostics({
  status: "query_error",
  startedAt: performance.now(),
  refreshStatus: {
    status: "succeeded",
    lastSuccessAt: "2026-07-17T00:00:00.000Z",
  },
  sql: `SELECT missing FROM sendlens.campaign_overview WHERE campaign_name = '${diagnosticCanary}'`,
  rowCount: 0,
  resultTruncated: false,
});
assert.equal(diagnostics.schema_version, "analyze_data_diagnostics.v1");
assert.equal(diagnostics.status, "query_error");
assert.deepEqual(diagnostics.referenced_surfaces, ["campaign_overview"]);
assert.equal(diagnostics.row_count, 0);
assert.equal(diagnostics.result_truncated, false);
assert.equal(diagnostics.cache_generation, "2026-07-17T00:00:00.000Z");
assert.equal(JSON.stringify(diagnostics).includes(diagnosticCanary), false);

const summary = await buildWorkspaceSummary(db);
assert.equal(summary.schema_version, "workspace_snapshot.v1");
assert.equal(summary.workspaceId, "ws_test");
assert.equal(summary.campaign_inventory_scope, "active");
assert.equal(summary.exact_metrics.campaign_count, 3);
assert.equal(summary.exact_metrics.active_campaign_count, 3);
assert.equal(summary.exact_metrics.total_sent, 3275);
assert.equal(summary.exact_metrics.total_unique_replies, 54);
assert.equal(summary.inventory_metrics.campaign_count, 3);
assert.equal(summary.inventory_metrics.recent_campaign_count, 0);
assert.ok(summary.summary.includes("3 custom tags stored locally"));
assert.ok(summary.summary.includes("1 Instantly inbox-placement tests"));
assert.ok(summary.summary.includes("4 Instantly per-email analytics rows"));
assert.ok(summary.summary.includes("0 Smart Delivery tests"));
assert.ok(summary.summary.includes("Sampled raw tables are evidence support only"));
assert.ok(summary.summary.includes("reply-signal leads found during bounded lead scan"));
assert.equal(summary.exact_metrics.inbox_placement_test_count, 1);
assert.equal(summary.exact_metrics.inbox_placement_analytics_rows, 4);
assert.equal(summary.coverage.length, 1);
assert.equal(summary.campaigns.length, 3);
const alphaSummaryCampaign = summary.campaigns.find((campaign) => campaign.campaign_id === "c1");
assert.ok(alphaSummaryCampaign);
assert.equal(alphaSummaryCampaign.campaign_name, "Alpha");
assert.equal(alphaSummaryCampaign.emails_sent_count, 800);
assert.equal(alphaSummaryCampaign.reply_count_unique, 24);
assert.equal(alphaSummaryCampaign.unique_reply_rate_pct, 3);
assert.equal(alphaSummaryCampaign.total_opportunity_value, 25000);
assert.equal(summary.output_limits.campaign_limit, 100);

const activeOrRecentSummary = await buildWorkspaceSummary(db, undefined, "all", "active_or_recent");
assert.equal(activeOrRecentSummary.campaign_inventory_scope, "active_or_recent");
assert.equal(activeOrRecentSummary.exact_metrics.campaign_count, 3);
assert.equal(activeOrRecentSummary.exact_metrics.total_sent, 3275);
assert.equal(activeOrRecentSummary.inventory_metrics.campaign_count, 4);
assert.equal(activeOrRecentSummary.inventory_metrics.recent_campaign_count, 1);
const betaSummaryCampaign = activeOrRecentSummary.campaigns.find((campaign) => campaign.campaign_id === "c2");
assert.ok(betaSummaryCampaign);
assert.equal(betaSummaryCampaign.status, "paused");
assert.equal(betaSummaryCampaign.detail_selection_reason, "recent_sends");
assert.equal(betaSummaryCampaign.recent_activity_coverage, "available");
assert.equal(betaSummaryCampaign.recent_sent_count, 12);

const allInventorySummary = await buildWorkspaceSummary(db, undefined, "all", "all");
assert.equal(allInventorySummary.campaign_inventory_scope, "all");
assert.equal(allInventorySummary.inventory_metrics.campaign_count, 4);
assert.equal(allInventorySummary.exact_metrics.campaign_count, 3);

const campaignOverview = await runQuery(
  db,
  "SELECT campaign_name, detail_selection_reason, recent_activity_coverage, emails_sent_count, reply_count_unique, bounced_count, total_opportunities, total_opportunity_value, reply_lead_rows, nonreply_rows_sampled, unique_reply_rate_pct, bounce_rate_pct, tracking_status, deliverability_settings_status FROM sendlens.campaign_overview WHERE campaign_id = 'c1'",
);
assert.equal(campaignOverview[0].campaign_name, "Alpha");
assert.equal(campaignOverview[0].detail_selection_reason, "active");
assert.equal(campaignOverview[0].recent_activity_coverage, "not_evaluated");
assert.equal(Number(campaignOverview[0].emails_sent_count), 800);
assert.equal(Number(campaignOverview[0].reply_count_unique), 24);
assert.equal(Number(campaignOverview[0].bounced_count), 8);
assert.equal(Number(campaignOverview[0].total_opportunities), 2);
assert.equal(Number(campaignOverview[0].total_opportunity_value), 25000);
assert.equal(Number(campaignOverview[0].reply_lead_rows), 10);
assert.equal(Number(campaignOverview[0].nonreply_rows_sampled), 1);
assert.equal(Number(campaignOverview[0].unique_reply_rate_pct), 3);
assert.equal(Number(campaignOverview[0].bounce_rate_pct), 1);
assert.equal(campaignOverview[0].tracking_status, "tracking_unknown");
assert.equal(campaignOverview[0].deliverability_settings_status, "deliverability_settings_unknown");

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
  "SELECT lead_email, reply_outcome_label, reply_email_id, reply_body_text, reply_email_i_status, template_subject, rendered_subject FROM sendlens.reply_context WHERE campaign_id = 'c1' ORDER BY lead_email",
);
assert.equal(replyContext.length, 9);
assert.equal(replyContext.some((row) => row.lead_email === "ooo@example.com"), false);
const alphaReplyContext = replyContext.find((row) => row.lead_email === "a@example.com");
assert.equal(alphaReplyContext.reply_email_id, "re1");
assert.equal(alphaReplyContext.reply_body_text, "Actual positive reply text");
assert.equal(Number(alphaReplyContext.reply_email_i_status), 1);
assert.equal(alphaReplyContext.template_subject, "Alpha intro");
assert.equal(alphaReplyContext.rendered_subject, "Alpha intro");

await run(
  db,
  `INSERT OR REPLACE INTO sendlens.reply_emails
   (workspace_id, id, campaign_id, thread_id, lead_email, lead_id, message_id, eaccount, from_email, to_email, subject, body_text, body_html, sent_at, is_auto_reply, ai_interest_value, i_status, content_preview, direction, step_resolved, variant_resolved, hydrated_at, synced_at)
   VALUES ('ws_test', 're_missed', 'c1', 'thread-missed', 'missed@example.com', 'lead-missed', '<missed@example.com>', 'sender@example.com', 'missed@example.com', 'sender@example.com', 'Re: Alpha intro', 'Fetched body for missed lead sample', '<p>Fetched body for missed lead sample</p>', CURRENT_TIMESTAMP, false, 0.1, -1, 'Fetched body for missed lead sample', 'inbound', '0', '0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
);
const emailAnchoredGap = await runQuery(
  db,
  `SELECT lead_email, reply_body_text, has_lead_context, has_template_context, hydrated_reply_body, context_gap_reason
   FROM sendlens.reply_email_context
   WHERE campaign_id = 'c1'
     AND reply_email_id = 're_missed'`,
);
assert.equal(emailAnchoredGap.length, 1);
assert.equal(emailAnchoredGap[0].reply_body_text, "Fetched body for missed lead sample");
assert.equal(Boolean(emailAnchoredGap[0].has_lead_context), false);
assert.equal(Boolean(emailAnchoredGap[0].has_template_context), true);
assert.equal(Boolean(emailAnchoredGap[0].hydrated_reply_body), true);
assert.equal(emailAnchoredGap[0].context_gap_reason, "missing_lead_context");

await run(
  db,
  `INSERT OR REPLACE INTO sendlens.sampled_leads
   (workspace_id, campaign_id, id, email, first_name, last_name, company_name, company_domain, status, email_reply_count, lt_interest_status, email_replied_step, email_replied_variant, timestamp_last_reply, job_title, custom_payload, sample_source, sampled_at)
   VALUES ('ws_test', 'c1', 'lead-missed', 'missed@example.com', 'Mira', 'Missed', 'Missed Co', 'missed.test', 'active', 1, -1, 0, 0, CURRENT_TIMESTAMP, 'VP Marketing', '{"campaign":"c1","stage":"backfilled"}', 'reply_email_contact_backfill', CURRENT_TIMESTAMP)`,
);
const emailAnchoredBackfilled = await runQuery(
  db,
  `SELECT company_name, job_title, has_lead_context, has_template_context, hydrated_reply_body, context_gap_reason
   FROM sendlens.reply_email_context
   WHERE campaign_id = 'c1'
     AND reply_email_id = 're_missed'`,
);
assert.equal(emailAnchoredBackfilled.length, 1);
assert.equal(emailAnchoredBackfilled[0].company_name, "Missed Co");
assert.equal(emailAnchoredBackfilled[0].job_title, "VP Marketing");
assert.equal(Boolean(emailAnchoredBackfilled[0].has_lead_context), true);
assert.equal(Boolean(emailAnchoredBackfilled[0].has_template_context), true);
assert.equal(Boolean(emailAnchoredBackfilled[0].hydrated_reply_body), true);
assert.equal(emailAnchoredBackfilled[0].context_gap_reason, "covered");

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
  "SELECT source_provider, campaign_source_id, tag_label, campaign_tag_label FROM sendlens.campaign_tags WHERE campaign_id = 'c1' ORDER BY source_provider",
);
assert.deepEqual(
  campaignTags.map((row) => ({
    source_provider: row.source_provider,
    campaign_source_id: row.campaign_source_id,
    tag_label: row.tag_label,
    campaign_tag_label: row.campaign_tag_label,
  })),
  [
    {
      source_provider: "instantly",
      campaign_source_id: "instantly:c1",
      tag_label: "Priority",
      campaign_tag_label: "Priority",
    },
    {
      source_provider: "smartlead",
      campaign_source_id: "smartlead:c1",
      tag_label: "Priority",
      campaign_tag_label: "Priority",
    },
  ],
  "provider-native campaign ID collisions must stay provider-qualified in tag views",
);

const campaignAccounts = await runQuery(
  db,
  "SELECT account_email, assignment_source, tag_label, assignment_account_tag_label, total_sent_30d, bounce_rate_30d_pct FROM sendlens.campaign_accounts WHERE campaign_id = 'c1' ORDER BY account_email, assignment_source",
);
assert.equal(campaignAccounts.length, 3);
assert.equal(campaignAccounts[0].account_email, "direct@example.com");
assert.equal(campaignAccounts[0].assignment_source, "direct");
assert.equal(Number(campaignAccounts[0].bounce_rate_30d_pct), 1);
assert.equal(campaignAccounts[1].account_email, "direct@example.com");
assert.equal(campaignAccounts[1].assignment_source, "tag");
assert.equal(campaignAccounts[1].tag_label, "Sender Pool");
assert.equal(campaignAccounts[1].assignment_account_tag_label, "Sender Pool");
assert.equal(Number(campaignAccounts[1].total_sent_30d), 100);
assert.equal(campaignAccounts[2].account_email, "tagged@example.com");
assert.equal(campaignAccounts[2].assignment_source, "tag");
assert.equal(campaignAccounts[2].tag_label, "Sender Pool");
assert.equal(campaignAccounts[2].assignment_account_tag_label, "Sender Pool");
assert.equal(Number(campaignAccounts[2].total_sent_30d), 200);

const tagScopeViewRows = await runQuery(
  db,
  "SELECT source_provider, inferred_resource_scope, tagged_resources FROM sendlens.tag_scope_audit WHERE normalized_tag_label = 'priority' ORDER BY source_provider",
);
assert.deepEqual(
  tagScopeViewRows.map((row) => ({
    source_provider: row.source_provider,
    inferred_resource_scope: row.inferred_resource_scope,
    tagged_resources: Number(row.tagged_resources),
  })),
  [
    { source_provider: "instantly", inferred_resource_scope: "campaign", tagged_resources: 2 },
    { source_provider: "smartlead", inferred_resource_scope: "campaign", tagged_resources: 1 },
  ],
);

const senderCoverageViewRows = await runQuery(
  db,
  "SELECT campaign_id, coverage_status FROM sendlens.campaign_tag_sender_coverage WHERE normalized_tag_label = 'priority' ORDER BY coverage_status DESC, campaign_id",
);
assert.equal(senderCoverageViewRows.length, 2);
assert.equal(senderCoverageViewRows.some((row) => row.campaign_id === "c1" && row.coverage_status === "covered"), true);
assert.equal(senderCoverageViewRows.some((row) => row.campaign_id === "c3" && row.coverage_status === "missing_sender_inventory"), true);

const dailyVolumeViewRows = await runQuery(
  db,
  "SELECT date, active_campaigns, configured_campaign_daily_limit_total, deduped_sender_sent FROM sendlens.campaign_tag_daily_volume_deduped WHERE normalized_tag_label = 'priority' ORDER BY date DESC",
);
assert.equal(dailyVolumeViewRows.length, 2);
assert.equal(Number(dailyVolumeViewRows[0].active_campaigns), 2);
assert.equal(Number(dailyVolumeViewRows[0].configured_campaign_daily_limit_total), 55);
assert.equal(Number(dailyVolumeViewRows[1].deduped_sender_sent), 30);

const utilizationViewRows = await runQuery(
  db,
  "SELECT date, resolved_account_daily_limit_total, campaign_limit_utilization_pct, account_limit_utilization_pct FROM sendlens.campaign_tag_daily_volume_utilization WHERE normalized_tag_label = 'priority' ORDER BY date DESC",
);
assert.equal(Number(utilizationViewRows[0].resolved_account_daily_limit_total), 50);
assert.equal(Number(utilizationViewRows[0].campaign_limit_utilization_pct), 27.27);
assert.equal(Number(utilizationViewRows[0].account_limit_utilization_pct), 30);

const trendViewRows = await runQuery(
  db,
  "SELECT date, rolling_7_day_avg_sent, peak_daily_sent, cached_sending_days FROM sendlens.campaign_tag_daily_volume_trend WHERE normalized_tag_label = 'priority' ORDER BY date DESC",
);
assert.equal(Number(trendViewRows[0].peak_daily_sent), 30);
assert.equal(Number(trendViewRows[0].cached_sending_days), 2);

const trueDailyVolumeRows = await runQuery(
  db,
  "SELECT date, active_campaigns_with_daily_metrics, configured_campaign_daily_limit_total, campaign_attributed_sent, campaign_attributed_unique_replies, campaign_attributed_opportunities FROM sendlens.campaign_tag_true_daily_volume WHERE normalized_tag_label = 'priority' ORDER BY date DESC",
);
assert.equal(trueDailyVolumeRows.length, 2);
assert.equal(String(trueDailyVolumeRows[0].date).slice(0, 10), "2026-05-02");
assert.equal(Number(trueDailyVolumeRows[0].active_campaigns_with_daily_metrics), 1);
assert.equal(Number(trueDailyVolumeRows[0].configured_campaign_daily_limit_total), 50);
assert.equal(Number(trueDailyVolumeRows[0].campaign_attributed_sent), 15);
assert.equal(String(trueDailyVolumeRows[1].date).slice(0, 10), "2026-05-01");
assert.equal(Number(trueDailyVolumeRows[1].active_campaigns_with_daily_metrics), 2);
assert.equal(Number(trueDailyVolumeRows[1].configured_campaign_daily_limit_total), 55);
assert.equal(Number(trueDailyVolumeRows[1].campaign_attributed_sent), 30);
assert.equal(Number(trueDailyVolumeRows[1].campaign_attributed_unique_replies), 2);
assert.equal(Number(trueDailyVolumeRows[1].campaign_attributed_opportunities), 1);

const trueTrendRows = await runQuery(
  db,
  "SELECT date, rolling_7_day_avg_sent, peak_daily_sent, cached_sending_days FROM sendlens.campaign_tag_true_daily_volume_trend WHERE normalized_tag_label = 'priority' ORDER BY date DESC",
);
assert.equal(Number(trueTrendRows[0].peak_daily_sent), 30);
assert.equal(Number(trueTrendRows[0].cached_sending_days), 2);

const leadPayloadKv = await runQuery(
  db,
  "SELECT payload_key, payload_key_normalized, payload_key_family, payload_value, payload_value_normalized, payload_value_type, payload_is_scalar, payload_value_json FROM sendlens.lead_payload_kv WHERE campaign_id = 'c1' AND email = 'a@example.com' ORDER BY payload_key",
);
assert.equal(leadPayloadKv.some((row) => row.payload_key === "Country" && row.payload_value === "United States"), true);
assert.equal(leadPayloadKv.some((row) => row.payload_key === "firstName" && row.payload_value === "Alex"), true);
const payloadByKey = new Map(leadPayloadKv.map((row) => [row.payload_key, row]));
assert.equal(payloadByKey.get("Buyer Persona").payload_key_normalized, "buyer_persona");
assert.equal(payloadByKey.get("Buyer Persona").payload_key_family, "persona");
assert.equal(payloadByKey.get("Buyer Persona").payload_value_normalized, "vp operations");
assert.equal(payloadByKey.get("Buyer Persona").payload_value_type, "VARCHAR");
assert.equal(Boolean(payloadByKey.get("Buyer Persona").payload_is_scalar), true);
assert.equal(payloadByKey.get("employee-band").payload_key_family, "company_size");
assert.equal(payloadByKey.get("tech.stack").payload_key_family, "technology_stack");
assert.equal(payloadByKey.get("enrichment_score").payload_value_type, "UBIGINT");
assert.equal(Boolean(payloadByKey.get("enrichment_score").payload_is_scalar), true);
assert.equal(payloadByKey.get("is_priority").payload_value_type, "BOOLEAN");
assert.equal(Boolean(payloadByKey.get("is_priority").payload_is_scalar), true);
assert.equal(payloadByKey.get("intent_flags").payload_value_type, "ARRAY");
assert.equal(Boolean(payloadByKey.get("intent_flags").payload_is_scalar), false);
assert.match(String(payloadByKey.get("intent_flags").payload_value_json), /hiring/);
assert.equal(payloadByKey.get("account_context").payload_value_type, "OBJECT");
assert.equal(Boolean(payloadByKey.get("account_context").payload_is_scalar), false);

const inboxPlacementOverview = await runQuery(
  db,
  "SELECT test_name, campaign_name, analytics_rows, sent_records, received_records, spam_records, category_records, primary_inbox_records, primary_inbox_rate_pct, spam_rate_pct, dkim_failures, dmarc_failures FROM sendlens.inbox_placement_test_overview WHERE test_id = 'ipt1'",
);
assert.equal(inboxPlacementOverview[0].test_name, "Alpha inbox test");
assert.equal(inboxPlacementOverview[0].campaign_name, "Alpha");
assert.equal(Number(inboxPlacementOverview[0].analytics_rows), 4);
assert.equal(Number(inboxPlacementOverview[0].sent_records), 1);
assert.equal(Number(inboxPlacementOverview[0].received_records), 3);
assert.equal(Number(inboxPlacementOverview[0].spam_records), 1);
assert.equal(Number(inboxPlacementOverview[0].category_records), 1);
assert.equal(Number(inboxPlacementOverview[0].primary_inbox_records), 1);
assert.equal(Number(inboxPlacementOverview[0].primary_inbox_rate_pct), 33.33);
assert.equal(Number(inboxPlacementOverview[0].spam_rate_pct), 33.33);
assert.equal(Number(inboxPlacementOverview[0].dkim_failures), 1);
assert.equal(Number(inboxPlacementOverview[0].dmarc_failures), 1);

const senderDeliverability = await runQuery(
  db,
  "SELECT sender_email, inbox_placement_tests, received_records, primary_inbox_records, primary_inbox_rate_pct, spam_rate_pct, dkim_failures, dmarc_failures FROM sendlens.sender_deliverability_health WHERE sender_email = 'sender@example.com'",
);
assert.equal(senderDeliverability[0].sender_email, "sender@example.com");
assert.equal(Number(senderDeliverability[0].inbox_placement_tests), 1);
assert.equal(Number(senderDeliverability[0].received_records), 3);
assert.equal(Number(senderDeliverability[0].primary_inbox_records), 1);
assert.equal(Number(senderDeliverability[0].primary_inbox_rate_pct), 33.33);
assert.equal(Number(senderDeliverability[0].spam_rate_pct), 33.33);
assert.equal(Number(senderDeliverability[0].dkim_failures), 1);
assert.equal(Number(senderDeliverability[0].dmarc_failures), 1);

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
const replyRecipes = getQueryRecipes("reply-patterns");
assert.equal(
  replyRecipes.some((recipe) => recipe.id === "fetched-reply-text-by-campaign" && recipe.sql.includes("reply_content_preview")),
  true,
);
assert.equal(
  replyRecipes.some(
    (recipe) =>
      recipe.id === "fetched-reply-text-raw-detail-by-campaign" &&
      recipe.sql.includes("reply_body_text") &&
      recipe.notes.some((note) => /do not paste raw bodies or contact fields/i.test(note)),
  ),
  true,
);
for (const recipeId of [
  "reply-email-context-feed",
  "reply-feed",
  "fetched-reply-text-by-campaign",
]) {
  const recipe = replyRecipes.find((candidate) => candidate.id === recipeId);
  assert.ok(recipe, `${recipeId} should exist`);
  assert.doesNotMatch(recipe.sql, /^\s*(lead_email|reply_from_email|reply_body_text)\b/im);
}
const replyEmailContextFeedRecipe = replyRecipes.find((recipe) => recipe.id === "reply-email-context-feed");
assert.ok(replyEmailContextFeedRecipe);
const replyEmailContextFeedRows = await runQuery(
  db,
  enforceLocalWorkspaceScope(replyEmailContextFeedRecipe.sql.replaceAll("{{campaign_id}}", "c1"), "ws_test"),
);
assert.equal(replyEmailContextFeedRows.length > 0, true);
const coveredReplyEmailContextFeedRow = replyEmailContextFeedRows.find(
  (row) => row.context_gap_reason === "covered",
);
assert.ok(coveredReplyEmailContextFeedRow);
assert.equal(coveredReplyEmailContextFeedRow.campaign_id, "c1");
assert.equal(Number(coveredReplyEmailContextFeedRow.reply_email_rows), 1);
assert.equal(Number(coveredReplyEmailContextFeedRow.matched_leads), 1);
for (const row of replyEmailContextFeedRows) {
  assert.ok(!("lead_email" in row));
  assert.ok(!("reply_body_text" in row));
}
const campaignPerformanceIndex = buildQueryRecipeResponse({ topic: "campaign-performance" });
assert.equal(campaignPerformanceIndex.output_shape, "compact_recipe_index");
assert.equal(campaignPerformanceIndex.mode, "summary");
assert.equal(campaignPerformanceIndex.recipe_count >= 10, true);
assert.equal(campaignPerformanceIndex.returned_count, 10);
assert.equal(campaignPerformanceIndex.page_size, 10);
assert.equal(campaignPerformanceIndex.has_more, true);
assert.equal(
  campaignPerformanceIndex.recipes.every((recipe) => recipe.sql === undefined && recipe.sql_available === true),
  true,
);
assert.equal(JSON.stringify(campaignPerformanceIndex).length < 25_000, true);
const stepFatigueLookup = buildQueryRecipeResponse({
  topic: "campaign-performance",
  recipe_id: "step-fatigue-by-campaign",
});
assert.equal(stepFatigueLookup.output_shape, "single_recipe");
assert.equal(stepFatigueLookup.returned_count, 1);
assert.equal(stepFatigueLookup.recipes[0].id, "step-fatigue-by-campaign");
assert.equal(stepFatigueLookup.recipes[0].sql.includes("{{campaign_id}}"), true);
const icpRecipes = getQueryRecipes("icp-signals");
const metadataCoverageRecipe = icpRecipes.find((recipe) => recipe.id === "campaign-metadata-coverage");
assert.ok(metadataCoverageRecipe);
assert.match(metadataCoverageRecipe.sql, /payload_key_family/);
assert.match(metadataCoverageRecipe.sql, /sparse_value_count/);
const metadataCoverageRows = await runQuery(
  db,
  enforceLocalWorkspaceScope(metadataCoverageRecipe.sql.replaceAll("{{campaign_id}}", "c1"), "ws_test"),
);
const personaCoverage = metadataCoverageRows.find((row) => row.payload_key === "Buyer Persona");
assert.ok(personaCoverage);
assert.equal(personaCoverage.payload_key_family, "persona");
assert.equal(Number(personaCoverage.sampled_leads), 12);
assert.equal(Number(personaCoverage.leads_with_key), 1);
assert.equal(Number(personaCoverage.sparse_value_count), 1);
const intentCoverage = metadataCoverageRows.find((row) => row.payload_key === "intent_flags");
assert.ok(intentCoverage);
assert.equal(Number(intentCoverage.non_scalar_rows), 1);
const leadListSourceRecipe = icpRecipes.find((recipe) => recipe.id === "lead-list-source-quality");
assert.ok(leadListSourceRecipe);
const leadListSourceRows = await runQuery(
  db,
  enforceLocalWorkspaceScope(leadListSourceRecipe.sql.replaceAll("{{campaign_id}}", "c1"), "ws_test"),
);
assert.equal(leadListSourceRows.length > 0, true);
const companyDomainQualityRecipe = icpRecipes.find((recipe) => recipe.id === "company-domain-quality");
assert.ok(companyDomainQualityRecipe);
const companyDomainQualityRows = await runQuery(
  db,
  enforceLocalWorkspaceScope(companyDomainQualityRecipe.sql.replaceAll("{{campaign_id}}", "c1"), "ws_test"),
);
assert.equal(companyDomainQualityRows.length > 0, true);
const duplicateExposureRecipe = icpRecipes.find((recipe) => recipe.id === "duplicate-contact-company-exposure");
assert.ok(duplicateExposureRecipe);
assert.match(duplicateExposureRecipe.sql, /campaigns_seen/);
const crossProviderOverlapRecipe = icpRecipes.find((recipe) => recipe.id === "cross-provider-overlap-risk");
assert.ok(crossProviderOverlapRecipe);
assert.match(crossProviderOverlapRecipe.sql, /provider_overlap_risk/);
const payloadKeySignalsRecipe = icpRecipes.find((recipe) => recipe.id === "campaign-payload-key-signals");
assert.ok(payloadKeySignalsRecipe);
assert.match(payloadKeySignalsRecipe.sql, /sendlens\.lead_payload_kv/);
assert.doesNotMatch(payloadKeySignalsRecipe.sql, /json_extract_string/);
const payloadInventoryRecipe = icpRecipes.find((recipe) => recipe.id === "campaign-payload-key-inventory");
assert.ok(payloadInventoryRecipe);
assert.match(payloadInventoryRecipe.sql, /sendlens\.lead_payload_kv/);
assert.doesNotMatch(payloadInventoryRecipe.sql, /json_each/);
const payloadInventoryRows = await runQuery(
  db,
  enforceLocalWorkspaceScope(payloadInventoryRecipe.sql.replaceAll("{{campaign_id}}", "c1"), "ws_test"),
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
  enforceLocalWorkspaceScope(payloadPresenceRecipe.sql.replaceAll("{{campaign_id}}", "c1"), "ws_test"),
);
const countryPresence = payloadPresenceRows.find((row) => row.payload_key === "Country");
assert.ok(countryPresence);
assert.equal(Number(countryPresence.sampled_leads), 12);
assert.equal(Number(countryPresence.leads_with_key), 3);
assert.equal(Number(countryPresence.leads_without_key), 9);
assert.equal(Number(countryPresence.replying_leads_with_key), 1);
assert.equal(Number(countryPresence.positive_leads_with_key), 1);
await runQuery(
  db,
  enforceLocalWorkspaceScope(
    payloadKeySignalsRecipe.sql
      .replaceAll("{{campaign_id}}", "c1")
      .replaceAll("{{payload_key}}", "Country"),
    "ws_test",
  ),
);

const campaignRecipes = getQueryRecipes("campaign-performance");
const accountManagerRecipes = getQueryRecipes("account-manager-brief");
const launchQaRecipes = getQueryRecipes("campaign-launch-qa");
const experimentPlannerRecipes = getQueryRecipes("experiment-planner");
const workspaceHealthRecipes = getQueryRecipes("workspace-health");
const tagCatalogRecipe = tagRecipes.find((recipe) => recipe.id === "tag-catalog");
assert.ok(tagCatalogRecipe);
const tagCatalogRows = await runQuery(db, enforceLocalWorkspaceScope(tagCatalogRecipe.sql, "ws_test"));
const priorityTagCatalog = tagCatalogRows.find(
  (row) => row.tag_name === "Priority" && row.source_provider === "instantly",
);
assert.ok(priorityTagCatalog);
assert.equal(priorityTagCatalog.normalized_tag_name, "priority");
assert.equal(Number(priorityTagCatalog.tagged_campaigns), 2);
assert.equal(Number(priorityTagCatalog.tagged_accounts), 0);
const smartleadPriorityTagCatalog = tagCatalogRows.find(
  (row) => row.tag_name === "Priority" && row.source_provider === "smartlead",
);
assert.ok(smartleadPriorityTagCatalog);
assert.equal(Number(smartleadPriorityTagCatalog.tagged_campaigns), 1);
const tagScopeAuditRecipe = tagRecipes.find((recipe) => recipe.id === "tag-scope-audit");
assert.ok(tagScopeAuditRecipe);
const tagScopeRows = await runQuery(
  db,
  enforceLocalWorkspaceScope(
    tagScopeAuditRecipe.sql.replaceAll("{{tag_name}}", " priority "),
    "ws_test",
  ),
);
assert.deepEqual(
  tagScopeRows.map((row) => ({
    source_provider: row.source_provider,
    inferred_resource_scope: row.inferred_resource_scope,
    tagged_resources: Number(row.tagged_resources),
  })),
  [
    { source_provider: "instantly", inferred_resource_scope: "campaign", tagged_resources: 2 },
    { source_provider: "smartlead", inferred_resource_scope: "campaign", tagged_resources: 1 },
  ],
);
const senderCoverageRecipe = workspaceHealthRecipes.find((recipe) => recipe.id === "campaign-tag-sender-coverage");
assert.ok(senderCoverageRecipe);
const senderCoverageRows = await runQuery(
  db,
  enforceLocalWorkspaceScope(
    senderCoverageRecipe.sql.replaceAll("{{tag_name}}", " priority "),
    "ws_test",
  ),
);
assert.equal(senderCoverageRows.length, 2);
assert.equal(senderCoverageRows[0].campaign_id, "c3");
assert.equal(senderCoverageRows[0].coverage_status, "missing_sender_inventory");
assert.equal(senderCoverageRows[1].campaign_id, "c1");
assert.equal(senderCoverageRows[1].coverage_status, "covered");
const trueDailyVolumeRecipe = campaignRecipes.find((recipe) => recipe.id === "campaign-tag-true-daily-volume");
assert.ok(trueDailyVolumeRecipe);
assert.equal(trueDailyVolumeRecipe.sql.includes("sendlens.campaign_tag_true_daily_volume"), true);
const trueDailyVolumeRecipeRows = await runQuery(
  db,
  enforceLocalWorkspaceScope(
    trueDailyVolumeRecipe.sql.replaceAll("{{tag_name}}", "Priority"),
    "ws_test",
  ),
);
assert.equal(trueDailyVolumeRecipeRows.length, 2);
assert.equal(Number(trueDailyVolumeRecipeRows[0].campaign_attributed_sent), 15);
const trueDailyTrendRecipe = campaignRecipes.find((recipe) => recipe.id === "campaign-tag-true-daily-volume-trend");
assert.ok(trueDailyTrendRecipe);
assert.equal(trueDailyTrendRecipe.sql.includes("sendlens.campaign_tag_true_daily_volume_trend"), true);
const dailyVolumeRecipe = campaignRecipes.find((recipe) => recipe.id === "campaign-tag-daily-volume");
assert.ok(dailyVolumeRecipe);
assert.equal(dailyVolumeRecipe.sql.includes("sendlens.account_daily_metrics"), true);
assert.equal(dailyVolumeRecipe.sql.includes("campaign_daily_limit"), true);
const dailyVolumeRows = await runQuery(
  db,
  enforceLocalWorkspaceScope(
    dailyVolumeRecipe.sql.replaceAll("{{tag_name}}", "Priority"),
    "ws_test",
  ),
);
assert.equal(dailyVolumeRows.length, 2);
assert.equal(String(dailyVolumeRows[0].date).slice(0, 10), "2026-05-02");
assert.equal(Number(dailyVolumeRows[0].campaign_daily_limit), 50);
assert.equal(Number(dailyVolumeRows[0].sender_scoped_sent), 15);
const dedupedDailyVolumeRecipe = campaignRecipes.find((recipe) => recipe.id === "campaign-tag-daily-volume-deduped");
assert.ok(dedupedDailyVolumeRecipe);
assert.equal(dedupedDailyVolumeRecipe.sql.includes("SELECT DISTINCT"), true);
assert.equal(dedupedDailyVolumeRecipe.sql.includes("deduped_sender_sent"), true);
const dedupedDailyVolumeRows = await runQuery(
  db,
  enforceLocalWorkspaceScope(
    dedupedDailyVolumeRecipe.sql.replaceAll("{{tag_name}}", "Priority"),
    "ws_test",
  ),
);
assert.equal(dedupedDailyVolumeRows.length, 2);
assert.equal(String(dedupedDailyVolumeRows[0].date).slice(0, 10), "2026-05-02");
assert.equal(Number(dedupedDailyVolumeRows[0].active_campaigns), 2);
assert.equal(Number(dedupedDailyVolumeRows[0].configured_campaign_daily_limit_total), 55);
assert.equal(Number(dedupedDailyVolumeRows[0].deduped_sender_sent), 15);
assert.equal(String(dedupedDailyVolumeRows[1].date).slice(0, 10), "2026-05-01");
assert.equal(Number(dedupedDailyVolumeRows[1].deduped_sender_sent), 30);
const utilizationRecipe = campaignRecipes.find((recipe) => recipe.id === "campaign-tag-daily-volume-utilization");
assert.ok(utilizationRecipe);
const utilizationRows = await runQuery(
  db,
  enforceLocalWorkspaceScope(
    utilizationRecipe.sql.replaceAll("{{tag_name}}", "PRIORITY"),
    "ws_test",
  ),
);
assert.equal(utilizationRows.length, 2);
assert.equal(Number(utilizationRows[0].configured_campaign_daily_limit_total), 55);
assert.equal(Number(utilizationRows[0].resolved_account_daily_limit_total), 50);
assert.equal(Number(utilizationRows[0].deduped_sender_sent), 15);
assert.equal(Number(utilizationRows[0].campaign_limit_utilization_pct), 27.27);
assert.equal(Number(utilizationRows[0].account_limit_utilization_pct), 30);
const tagAccountRunwayRecipe = campaignRecipes.find((recipe) => recipe.id === "campaign-tag-account-tag-capacity-runway");
assert.ok(tagAccountRunwayRecipe);
const tagAccountRunwayRows = await runQuery(
  db,
  enforceLocalWorkspaceScope(
    tagAccountRunwayRecipe.sql
      .replaceAll("{{campaign_tag_name}}", "Priority")
      .replaceAll("{{account_tag_name}}", "Sender Pool"),
    "ws_test",
  ),
);
assert.equal(tagAccountRunwayRows.length, 2);
const alphaTagAccountRunway = tagAccountRunwayRows.find((row) => row.campaign_id === "c1");
assert.ok(alphaTagAccountRunway);
assert.equal(Number(alphaTagAccountRunway.tagged_sender_accounts), 2);
assert.equal(Number(alphaTagAccountRunway.tagged_sender_daily_limit_total), 50);
assert.equal(Number(alphaTagAccountRunway.effective_configured_daily_capacity_for_tagged_inboxes), 50);
assert.equal(Number(alphaTagAccountRunway.completed_count), 0);
const leadStateSampleRecipe = campaignRecipes.find((recipe) => recipe.id === "campaign-lead-state-sample-by-step");
assert.ok(leadStateSampleRecipe);
const leadStateSampleRows = await runQuery(
  db,
  enforceLocalWorkspaceScope(
    leadStateSampleRecipe.sql.replaceAll("{{campaign_id}}", "c1"),
    "ws_test",
  ),
);
assert.equal(leadStateSampleRows.length > 0, true);
const campaignMoversRecipe = campaignRecipes.find((recipe) => recipe.id === "workspace-campaign-recent-movers");
assert.ok(campaignMoversRecipe);
assert.match(campaignMoversRecipe.sql, /sent_delta_vs_prior_7d/);
const trendRecipe = campaignRecipes.find((recipe) => recipe.id === "campaign-tag-daily-volume-trend");
assert.ok(trendRecipe);
const trendRows = await runQuery(
  db,
  enforceLocalWorkspaceScope(
    trendRecipe.sql.replaceAll("{{tag_name}}", "Priority"),
    "ws_test",
  ),
);
assert.equal(trendRows.length, 2);
assert.equal(Number(trendRows[0].cached_sending_days), 2);
assert.equal(Number(trendRows[0].peak_daily_sent), 30);
assert.equal(Number(trendRows[0].avg_daily_sent_all_cached_days), 22.5);
assert.equal(
  workspaceHealthRecipes.some((recipe) => recipe.id === "campaign-sender-inventory-by-tag" && recipe.sql.includes("sendlens.campaign_accounts")),
  true,
);
const senderLoadBalanceRecipe = workspaceHealthRecipes.find((recipe) => recipe.id === "sender-load-balance-by-campaign-tag");
assert.ok(senderLoadBalanceRecipe);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.campaigns
   (id, workspace_id, source_provider, provider_campaign_id, campaign_source_id, organization_id, name, status, daily_limit, synced_at)
   VALUES ('smartlead:c1', 'ws_test', 'smartlead', 'c1', 'smartlead:c1', 'ws_test', 'Smartlead Alpha', 'active', 10, CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.accounts
   (workspace_id, email, source_provider, provider_account_id, account_source_id, status, warmup_status, warmup_score, daily_limit, total_sent_30d, total_replies_30d, total_bounces_30d, synced_at)
   VALUES ('ws_test', 'direct@example.com', 'smartlead', 'smart-acct-1', 'smartlead:smart-acct-1', 'active', 'healthy', 90, 10, 999, 99, 99, CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.custom_tag_mappings
   (workspace_id, tag_id, source_provider, resource_type, resource_id, provider_resource_id, synced_at)
   VALUES ('ws_test', 't3', 'smartlead', '2', 'smartlead:c1', 'c1', CURRENT_TIMESTAMP),
          ('ws_test', 't1', 'instantly', '2', 'c2', 'c2', CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.campaign_account_assignments
   (workspace_id, campaign_id, source_provider, provider_campaign_id, campaign_source_id, assignment_type, assignment_key, account_email, provider_account_id, tag_id, synced_at)
   VALUES ('ws_test', 'smartlead:c1', 'smartlead', 'c1', 'smartlead:c1', 'email', 'direct@example.com', 'direct@example.com', 'smart-acct-1', NULL, CURRENT_TIMESTAMP)`,
);
const senderLoadBalanceRows = await runQuery(
  db,
  enforceLocalWorkspaceScope(
    senderLoadBalanceRecipe.sql
      .replaceAll("{{tag_name}}", "Priority")
      .replaceAll("CURRENT_DATE - INTERVAL 30 DAY", "'2026-05-03'::DATE - INTERVAL 30 DAY"),
    "ws_test",
  ),
);
assert.equal(senderLoadBalanceRows.length, 3);
assert.equal(senderLoadBalanceRows.some((row) => row.account_email === "direct@example.com"), true);
assert.equal(senderLoadBalanceRows.some((row) => row.account_email === "tagged@example.com"), true);
const directSenderLoadRow = senderLoadBalanceRows.find(
  (row) => row.source_provider === "instantly" && row.account_email === "direct@example.com",
);
assert.equal(directSenderLoadRow.source_provider, "instantly");
assert.equal(Number(directSenderLoadRow.account_sent_30d), 25, "sender load must not mix Smartlead daily metrics for the same email");
assert.equal(Number(directSenderLoadRow.all_active_campaigns_using_sender), 2, "paused campaign assignments must not inflate active sharing");
assert.equal(Number(directSenderLoadRow.tagged_campaign_count), 1);
const smartleadSenderLoadRow = senderLoadBalanceRows.find(
  (row) => row.source_provider === "smartlead" && row.account_email === "direct@example.com",
);
assert.ok(smartleadSenderLoadRow);
assert.equal(Number(smartleadSenderLoadRow.account_sent_30d), 999);
assert.equal(Number(smartleadSenderLoadRow.all_active_campaigns_using_sender), 1);
assert.equal(Number(smartleadSenderLoadRow.tagged_campaign_count), 1);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.accounts
   (workspace_id, email, status, warmup_status, warmup_score, daily_limit, total_sent_30d, total_replies_30d, total_bounces_30d, synced_at)
   VALUES ('ws_test', 'disabled@example.com', 'disabled', 'paused', 10, 25, 333, 7, 33, CURRENT_TIMESTAMP)`,
);
await run(
  db,
  `INSERT OR REPLACE INTO sendlens.campaign_account_assignments
   (workspace_id, campaign_id, assignment_type, assignment_key, account_email, tag_id, synced_at)
   VALUES ('ws_test', 'c1', 'email', 'disabled@example.com', 'disabled@example.com', NULL, CURRENT_TIMESTAMP)`,
);
const campaignSenderInventoryRecipe = workspaceHealthRecipes.find((recipe) => recipe.id === "campaign-sender-inventory-by-tag");
assert.ok(campaignSenderInventoryRecipe);
assert.equal(campaignSenderInventoryRecipe.sql.includes("sendlens.account_daily_metrics"), false);
assert.match(campaignSenderInventoryRecipe.sql, /campaign_tag_label/);
assert.match(campaignSenderInventoryRecipe.sql, /assignment_account_tag_label/);
assert.doesNotMatch(campaignSenderInventoryRecipe.sql, /ct\.tag_label|ca\.tag_label/);
assert.match(campaignSenderInventoryRecipe.sql, /source_provider = co\.source_provider/);
assert.match(campaignSenderInventoryRecipe.sql, /lower\(COALESCE\(co\.status, ''\)\) = 'active'/);
const senderInventoryRows = await runQuery(
  db,
  enforceLocalWorkspaceScope(
    campaignSenderInventoryRecipe.sql.replaceAll("{{tag_name}}", " priority "),
    "ws_test",
  ),
);
assert.equal(senderInventoryRows.length, 4);
assert.equal(senderInventoryRows.some((row) => row.campaign_id === "c3"), false);
assert.equal(senderInventoryRows.some((row) => row.campaign_id === "c2"), false);
const disabledInventoryRow = senderInventoryRows.find((row) => row.account_email === "disabled@example.com");
assert.ok(disabledInventoryRow);
assert.equal(disabledInventoryRow.account_status, "disabled");
assert.equal(disabledInventoryRow.sender_risk_signal, "disabled_or_inactive_sender");
assert.equal(Number(disabledInventoryRow.stored_account_sent_30d), 333);
const directInventoryRow = senderInventoryRows.find(
  (row) => row.source_provider === "instantly" && row.account_email === "direct@example.com",
);
assert.ok(directInventoryRow);
assert.equal(directInventoryRow.account_status, "1");
assert.notEqual(directInventoryRow.sender_risk_signal, "disabled_or_inactive_sender");
assert.equal(directInventoryRow.sender_risk_signal, "shared_active_sender");
assert.equal(Number(directInventoryRow.active_provider_campaigns_using_sender), 2);
assert.equal(Number(directInventoryRow.stored_account_sent_30d), 100);
assert.equal(directInventoryRow.assignment_source, "direct");
assert.equal(directInventoryRow.assignment_account_tag_label, "Sender Pool");
const smartleadInventoryRow = senderInventoryRows.find(
  (row) => row.source_provider === "smartlead" && row.account_email === "direct@example.com",
);
assert.ok(smartleadInventoryRow);
assert.equal(smartleadInventoryRow.campaign_id, "smartlead:c1");
assert.equal(smartleadInventoryRow.campaign_source_id, "smartlead:c1");
assert.equal(Number(smartleadInventoryRow.active_provider_campaigns_using_sender), 1);
assert.equal(Number(smartleadInventoryRow.stored_account_sent_30d), 999);
assert.equal(smartleadInventoryRow.sender_risk_signal, "high_bounce_risk");
const taggedInventoryRow = senderInventoryRows.find((row) => row.account_email === "tagged@example.com");
assert.ok(taggedInventoryRow);
assert.equal(taggedInventoryRow.campaign_tag_label, "Priority");
assert.equal(taggedInventoryRow.assignment_account_tag_label, "Sender Pool");
assert.equal(Number(taggedInventoryRow.stored_account_sent_30d), 200);
await run(
  db,
  `DELETE FROM sendlens.campaign_account_assignments
   WHERE workspace_id = 'ws_test' AND source_provider = 'smartlead' AND campaign_id = 'smartlead:c1'`,
);
await run(
  db,
  `DELETE FROM sendlens.custom_tag_mappings
   WHERE workspace_id = 'ws_test'
     AND ((source_provider = 'smartlead' AND tag_id = 't3' AND resource_id = 'smartlead:c1')
       OR (source_provider = 'instantly' AND tag_id = 't1' AND resource_id = 'c2'))`,
);
await run(
  db,
  `DELETE FROM sendlens.accounts
   WHERE workspace_id = 'ws_test' AND source_provider = 'smartlead' AND email = 'direct@example.com'`,
);
await run(
  db,
  `DELETE FROM sendlens.campaigns
   WHERE workspace_id = 'ws_test' AND source_provider = 'smartlead' AND id = 'smartlead:c1'`,
);
const negativeConcentrationRecipe = workspaceHealthRecipes.find((recipe) => recipe.id === "negative-unsubscribe-concentration");
assert.ok(negativeConcentrationRecipe);
assert.match(negativeConcentrationRecipe.sql, /unsubscribed_count/);
assert.equal(
  workspaceHealthRecipes.some((recipe) => recipe.id === "inbox-placement-test-overview" && recipe.sql.includes("sendlens.inbox_placement_test_overview")),
  true,
);
assert.equal(
  workspaceHealthRecipes.some((recipe) => recipe.id === "sender-deliverability-health" && recipe.sql.includes("sendlens.sender_deliverability_health")),
  true,
);
assert.equal(
  workspaceHealthRecipes.some((recipe) => recipe.id === "inbox-placement-auth-failures" && recipe.sql.includes("sendlens.inbox_placement_analytics")),
  true,
);
const launchQaChecklistRecipe = launchQaRecipes.find((recipe) => recipe.id === "campaign-launch-qa-checklist");
assert.ok(launchQaChecklistRecipe);
const launchQaRows = await runQuery(
  db,
  enforceLocalWorkspaceScope(
    launchQaChecklistRecipe.sql.replaceAll("{{campaign_name}}", "Alpha"),
    "ws_test",
  ),
);
assert.equal(launchQaRows[0].launch_qa_status, "review_settings_unknown");
const runwayLaunchQaRows = await runQuery(
  db,
  enforceLocalWorkspaceScope(
    launchQaChecklistRecipe.sql.replaceAll("{{campaign_name}}", "Runway Active"),
    "ws_test",
  ),
);
assert.equal(runwayLaunchQaRows.length, 1);
assert.equal(runwayLaunchQaRows[0].launch_qa_status, "review_settings_unknown");
assert.equal(runwayLaunchQaRows[0].exact_uncontacted_leads, null);
assert.equal(runwayLaunchQaRows[0].lead_supply_exactness, "unknown_no_exact_uncontacted_lead_field");
assert.equal(Number(runwayLaunchQaRows[0].new_leads_contacted_count), 340);
const accountManagerBriefRecipe = accountManagerRecipes.find((recipe) => recipe.id === "account-manager-client-brief");
assert.ok(accountManagerBriefRecipe);
const accountManagerBriefRows = await runQuery(
  db,
  enforceLocalWorkspaceScope(accountManagerBriefRecipe.sql, "ws_test"),
);
const runwayAccountManagerBrief = accountManagerBriefRows.find((row) => row.campaign_id === "c4");
assert.ok(runwayAccountManagerBrief);
assert.equal(runwayAccountManagerBrief.am_attention_reason, "monitor");
assert.equal(runwayAccountManagerBrief.exact_uncontacted_leads, null);
assert.equal(runwayAccountManagerBrief.lead_supply_exactness, "unknown_no_exact_uncontacted_lead_field");
const experimentPlannerRecipe = experimentPlannerRecipes.find((recipe) => recipe.id === "experiment-planner-candidates");
assert.ok(experimentPlannerRecipe);
const experimentPlannerRows = await runQuery(
  db,
  enforceLocalWorkspaceScope(experimentPlannerRecipe.sql, "ws_test"),
);
const runwayExperimentCandidate = experimentPlannerRows.find((row) => row.campaign_id === "c4");
assert.ok(runwayExperimentCandidate);
assert.notEqual(runwayExperimentCandidate.recommended_test_lane, "lead_supply_or_segment_refill_test");
assert.equal(runwayExperimentCandidate.exact_uncontacted_leads, null);
assert.equal(runwayExperimentCandidate.lead_supply_exactness, "unknown_no_exact_uncontacted_lead_field");
const settingsRecipe = launchQaRecipes.find((recipe) => recipe.id === "campaign-tracking-deliverability-settings");
assert.ok(settingsRecipe);
const settingsRows = await runQuery(db, enforceLocalWorkspaceScope(settingsRecipe.sql, "ws_test"));
assert.equal(settingsRows[0].settings_review_status, "review_settings_unknown");
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
for (const recipeId of ["rendered-outbound-sample", "personalization-leak-audit"]) {
  const recipe = copyRecipes.find((candidate) => candidate.id === recipeId);
  assert.ok(recipe, `${recipeId} should exist`);
  assert.doesNotMatch(recipe.sql, /^\s*(rendered_body_text|template_body_text)\b/im);
  assert.doesNotMatch(recipe.sql, /\b(lr\.)?to_email\s+AS\b|\bAS\s+sample_email\b/im);
}
for (const recipeId of ["rendered-outbound-raw-detail", "personalization-leak-raw-detail"]) {
  const recipe = copyRecipes.find((candidate) => candidate.id === recipeId);
  assert.ok(recipe, `${recipeId} should exist`);
  assert.equal(
    recipe.notes.some((note) => /do not paste raw bodies or contact fields/i.test(note)),
    true,
  );
}
const leakRecipe = copyRecipes.find((recipe) => recipe.id === "personalization-leak-audit");
assert.ok(leakRecipe);
assert.match(leakRecipe.sql, /sendlens\.rendered_outbound_context/);
assert.match(leakRecipe.sql, /unresolved_token/);
const leakRows = await runQuery(
  db,
  leakRecipe.sql.replaceAll("{{campaign_id}}", "c1"),
);
assert.equal(leakRows.length, 2);
assert.equal(Number(leakRows[0].affected_campaigns), 1);
assert.equal(Number(leakRows[0].affected_step_variants), 1);
assert.equal(Number(leakRows[0].affected_leads), 1);
assert.equal(Number(leakRows[0].affected_rendered_rows), 1);
assert.equal(Number(leakRows[0].rendered_rows_with_payload_tokens), 1);
assert.equal(Number(leakRows[0].rendered_rows_with_account_signature_tokens), 1);
const safeLeakRowsByClassification = new Map(
  leakRows.map((row) => [row.token_classification, row]),
);
assert.equal(
  safeLeakRowsByClassification.has("payload_personalization_unresolved"),
  true,
);
assert.equal(
  safeLeakRowsByClassification.has("signature_unresolved_reconstruction_caveat"),
  true,
);
assert.equal(
  Number(
    safeLeakRowsByClassification.get("payload_personalization_unresolved")
      .payload_token_rows,
  ),
  1,
);
assert.equal(
  Number(
    safeLeakRowsByClassification.get("signature_unresolved_reconstruction_caveat")
      .account_signature_token_rows,
  ),
  1,
);
assert.equal(
  safeLeakRowsByClassification.get("payload_personalization_unresolved")
    .payload_unresolved_token_names,
  "missing_first_name, unknown_company_signal",
);
assert.equal(
  safeLeakRowsByClassification.get("signature_unresolved_reconstruction_caveat")
    .account_signature_token_names,
  "accountSignature",
);
assert.equal(
  leakRows.some((row) =>
    String(row.example_rendered_subject_preview).includes("{{missing_first_name}}")
  ),
  true,
);
assert.equal(
  leakRows.some((row) =>
    String(row.example_rendered_body_preview).includes("{{accountSignature}}")
  ),
  true,
);

const rawLeakRecipe = copyRecipes.find((recipe) => recipe.id === "personalization-leak-raw-detail");
assert.ok(rawLeakRecipe);
const rawLeakRows = await runQuery(
  db,
  rawLeakRecipe.sql.replaceAll("{{campaign_id}}", "c1"),
);
assert.equal(rawLeakRows.length, 2);
const rawLeakRowsByEmail = new Map(rawLeakRows.map((row) => [row.sample_email, row]));
assert.equal(Boolean(rawLeakRowsByEmail.get("b@example.com").subject_has_unresolved_token), true);
assert.equal(Boolean(rawLeakRowsByEmail.get("b@example.com").body_has_unresolved_token), true);
assert.equal(
  rawLeakRowsByEmail.get("b@example.com").unresolved_token_names,
  "missing_first_name, unknown_company_signal",
);
assert.equal(rawLeakRowsByEmail.get("b@example.com").token_classification, "payload_personalization_unresolved");
assert.equal(Number(rawLeakRowsByEmail.get("b@example.com").payload_unresolved_token_count), 2);
assert.equal(Number(rawLeakRowsByEmail.get("b@example.com").account_signature_token_count), 0);
assert.equal(
  rawLeakRowsByEmail.get("completed@example.com").unresolved_token_names,
  "accountSignature",
);
assert.equal(
  rawLeakRowsByEmail.get("completed@example.com").token_classification,
  "signature_unresolved_reconstruction_caveat",
);
assert.equal(Number(rawLeakRowsByEmail.get("completed@example.com").payload_unresolved_token_count), 0);
assert.equal(Number(rawLeakRowsByEmail.get("completed@example.com").account_signature_token_count), 1);

const normalizedStepAnalytics = normalizeStepAnalyticsRows([
  {
    step: null,
    variant: null,
    sent: 0,
    opened: 0,
    unique_opened: 0,
    replies: 0,
    unique_replies: 0,
    replies_automatic: 6,
    unique_replies_automatic: 6,
    clicks: 0,
    unique_clicks: 0,
    opportunities: 0,
    unique_opportunities: 0,
  },
  {
    step: "null",
    variant: null,
    sent: 0,
    opened: 0,
    replies: 0,
    unique_replies: 0,
    replies_automatic: 1,
    unique_replies_automatic: 1,
    clicks: 0,
    opportunities: 0,
  },
  { step: null, variant: 2, sent: 10 },
  { step: "Step 1", variant: "", sent: 20, opens: 5 },
  { step: 2, variant: 3, sent: 30, opened: 8 },
]);
assert.equal(normalizedStepAnalytics.skippedRows, 1);
assert.equal(normalizedStepAnalytics.ignoredUnattributedRows, 2);
assert.deepEqual(normalizedStepAnalytics.validRows, [
  {
    step: 1,
    variant: 0,
    sent: 20,
    opened: 5,
    uniqueOpened: undefined,
    replies: undefined,
    repliesAutomatic: undefined,
    uniqueRepliesAutomatic: undefined,
    uniqueReplies: undefined,
    clicks: undefined,
    uniqueClicks: undefined,
    bounces: undefined,
    opportunities: undefined,
    uniqueOpportunities: undefined,
    meetingsBooked: undefined,
  },
  {
    step: 2,
    variant: 3,
    sent: 30,
    opened: 8,
    uniqueOpened: undefined,
    replies: undefined,
    repliesAutomatic: undefined,
    uniqueRepliesAutomatic: undefined,
    uniqueReplies: undefined,
    clicks: undefined,
    uniqueClicks: undefined,
    bounces: undefined,
    opportunities: undefined,
    uniqueOpportunities: undefined,
    meetingsBooked: undefined,
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

const contextEnvRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sendlens-context-env-"));
await fs.mkdir(path.join(contextEnvRoot, ".env.clients"));
await fs.writeFile(
  path.join(contextEnvRoot, ".env"),
  [
    "INSTANTLY_API_KEY=generic-key",
    "SENDLENS_CLIENT=bravo",
  ].join("\n"),
);
await fs.writeFile(
  path.join(contextEnvRoot, ".env.clients", "bravo.env"),
  "SENDLENS_DB_PATH=$HOME/.sendlens/bravo.duckdb\n",
);
delete process.env.SENDLENS_INSTANTLY_API_KEY;
delete process.env.SENDLENS_CLIENT;
delete process.env.SENDLENS_CLIENTS_DIR;
delete process.env.SENDLENS_DB_PATH;
delete process.env.INSTANTLY_API_KEY;
process.env.SENDLENS_CONTEXT_ROOT = contextEnvRoot;
loadSendLensEnv();
assert.equal(process.env.SENDLENS_INSTANTLY_API_KEY, undefined);
assert.equal(process.env.INSTANTLY_API_KEY, "generic-key");
assert.equal(process.env.SENDLENS_CLIENT, "bravo");
assert.equal(process.env.SENDLENS_DB_PATH, path.join(os.homedir(), ".sendlens", "bravo.duckdb"));
delete process.env.SENDLENS_CONTEXT_ROOT;

process.env.SENDLENS_INSTANTLY_API_KEY = "${SENDLENS_INSTANTLY_API_KEY}";
assert.equal(isUnresolvedEnvValue(process.env.SENDLENS_INSTANTLY_API_KEY), true);
loadSendLensEnv();
assert.equal(process.env.SENDLENS_INSTANTLY_API_KEY, undefined);
process.env.SENDLENS_INSTANTLY_API_KEY = "your_key";
assert.equal(isUnresolvedEnvValue(process.env.SENDLENS_INSTANTLY_API_KEY), true);
loadSendLensEnv();
assert.equal(process.env.SENDLENS_INSTANTLY_API_KEY, undefined);

process.env.SENDLENS_DB_PATH = path.join(
  os.homedir(),
  "Documents",
  "+ name +",
);
assert.equal(isUnresolvedDbPath(process.env.SENDLENS_DB_PATH), true);
assert.equal(
  resolveDbPath(),
  path.join(os.homedir(), ".sendlens", "workspace-cache.duckdb"),
);
process.env.SENDLENS_DB_PATH = "${SENDLENS_DB_PATH}";
assert.equal(isUnresolvedDbPath(process.env.SENDLENS_DB_PATH), true);
assert.equal(
  resolveDbPath(),
  path.join(os.homedir(), ".sendlens", "workspace-cache.duckdb"),
);
delete process.env.SENDLENS_DB_PATH;

const statusRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sendlens-status-"));
process.env.SENDLENS_DB_PATH = path.join(statusRoot, "workspace-cache.duckdb");
process.env.SENDLENS_STATE_DIR = statusRoot;
await fs.writeFile(
  path.join(statusRoot, "refresh-status.json"),
  JSON.stringify({
    status: "running",
    source: "session_start",
    pid: 999999,
    dbPath: path.join(statusRoot, ".workspace-cache.duckdb.refreshing"),
  }),
);
const staleStatus = await readRefreshStatus();
assert.equal(staleStatus.status, "failed");
assert.equal(staleStatus.dbPath, process.env.SENDLENS_DB_PATH);
assert.match(String(staleStatus.message), /no longer active/);

await fs.writeFile(
  path.join(statusRoot, "refresh-status.json"),
  JSON.stringify({
    status: "failed",
    source: "session_start",
    pid: 123,
    message:
      "Session-start refresh skipped because SENDLENS_INSTANTLY_API_KEY is not set. Existing local DuckDB cache remains usable; configure the key before running refresh_data.",
    dbPath: process.env.SENDLENS_DB_PATH,
  }),
);
const missingKeyStatus = await readRefreshStatus();
assert.equal(missingKeyStatus.status, "idle");
assert.match(String(missingKeyStatus.message), /skipped/);

process.env.SENDLENS_PROVIDER = "smartlead";
await fs.writeFile(
  path.join(statusRoot, "refresh-status.json"),
  JSON.stringify({
    status: "idle",
    source: "session_start",
    pid: 123,
    message:
      "Session-start refresh skipped because SENDLENS_SMARTLEAD_API_KEY is not set for SENDLENS_PROVIDER=smartlead.",
    dbPath: process.env.SENDLENS_DB_PATH,
  }),
);
const missingSmartleadKeyStatus = await readRefreshStatus();
assert.equal(missingSmartleadKeyStatus.status, "idle");
assert.match(String(missingSmartleadKeyStatus.message), /skipped.*SENDLENS_PROVIDER=smartlead/i);
assert.match(String(missingSmartleadKeyStatus.message), /configure the Smartlead provider/i);
delete process.env.SENDLENS_PROVIDER;

delete process.env.SENDLENS_INSTANTLY_API_KEY;
delete process.env.SENDLENS_DEMO_MODE;
const noKeyNoCacheDoctorReport = await buildSetupDoctorReport();
assert.equal(noKeyNoCacheDoctorReport.setup_status, "blocked");
assert.equal(noKeyNoCacheDoctorReport.capabilities.demo_seed, true);
assert.equal(noKeyNoCacheDoctorReport.active_data_state.status, "no_workspace");
assert.match(
  noKeyNoCacheDoctorReport.active_data_state.message,
  /No SendLens workspace is available yet/i,
);
assert.match(
  noKeyNoCacheDoctorReport.active_data_state.recommended_action,
  /seed_demo_workspace/i,
);
assert.match(
  String(noKeyNoCacheDoctorReport.next_steps[0]),
  /Call seed_demo_workspace now/,
);
assert.match(
  String(noKeyNoCacheDoctorReport.failures[0]),
  /Instantly API key is not set and no local DuckDB cache exists/,
);

const originalFetch = globalThis.fetch;
process.env.SENDLENS_INSTANTLY_API_KEY = "bad-key";
globalThis.fetch = async () => ({
  ok: false,
  status: 401,
});
const invalidKeyDoctorReport = await buildSetupDoctorReport();
assert.equal(invalidKeyDoctorReport.setup_status, "blocked");
assert.equal(invalidKeyDoctorReport.capabilities.live_refresh, false);
assert.equal(invalidKeyDoctorReport.capabilities.demo_seed, true);
assert.equal(invalidKeyDoctorReport.capabilities.instantly_key_validated, false);
assert.match(
  String(invalidKeyDoctorReport.failures[0]),
  /Instantly API key is configured but Instantly rejected it/,
);
assert.match(
  invalidKeyDoctorReport.next_steps.join("\n"),
  /seed_demo_workspace/,
);

await fs.writeFile(
  path.join(statusRoot, "refresh-status.json"),
  JSON.stringify({
    status: "succeeded",
    source: "manual",
    lastRefreshScope: "provider_workspace",
    refreshScope: {
      type: "provider_workspace",
      label: "Provider-scoped workspace refresh for instantly.",
      provider: "instantly",
      workspaceFreshness: "provider_workspace",
    },
    lastSuccessAt: new Date().toISOString(),
    campaignsTotal: 8,
    campaignsProcessed: 8,
    dbPath: process.env.SENDLENS_DB_PATH,
  }),
);
await fs.writeFile(process.env.SENDLENS_DB_PATH, "");
process.env.SENDLENS_INSTANTLY_API_KEY = "test-key";
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ items: [{ id: "campaign_1" }] }),
});
const doctorReport = await buildSetupDoctorReport();
assert.equal(doctorReport.cache_freshness.status, "succeeded");
assert.equal(doctorReport.cache_freshness.age_seconds < 60, true);
assert.match(doctorReport.cache_freshness.label, /just now/);
assert.equal(doctorReport.cache_freshness.last_refresh_scope, "provider_workspace");
assert.equal(doctorReport.cache_freshness.workspace_freshness, "provider_workspace");
assert.equal(doctorReport.capabilities.live_refresh, true);
assert.equal(doctorReport.capabilities.instantly_key_validated, true);
assert.match(String(doctorReport.next_steps[0]), /Current cache freshness: just now/);

await fs.writeFile(
  path.join(statusRoot, "refresh-status.json"),
  JSON.stringify({
    status: "succeeded",
    source: "manual",
    lastRefreshScope: "campaign",
    refreshScope: {
      type: "campaign",
      label: "Campaign-scoped refresh matched 1 of 1 requested campaigns.",
      provider: "instantly",
      requestedCampaignIds: ["campaign_1"],
      campaignIds: ["campaign_1"],
      campaignsMatched: 1,
      workspaceFreshness: "scoped",
    },
    lastSuccessAt: new Date().toISOString(),
    campaignsTotal: 1,
    campaignsProcessed: 1,
    dbPath: process.env.SENDLENS_DB_PATH,
  }),
);
const scopedDoctorReport = await buildSetupDoctorReport();
assert.equal(scopedDoctorReport.cache_freshness.status, "succeeded");
assert.equal(scopedDoctorReport.cache_freshness.last_refresh_scope, "campaign");
assert.equal(scopedDoctorReport.cache_freshness.workspace_freshness, "scoped");
assert.match(scopedDoctorReport.cache_freshness.label, /just now/);
assert.match(String(scopedDoctorReport.next_steps[0]), /last refresh was campaign-scoped/);
assert.match(
  scopedDoctorReport.checks.find((check) => check.name === "Refresh status")?.message ?? "",
  /Campaign-scoped refresh matched 1 of 1 requested campaigns/,
);
globalThis.fetch = originalFetch;
delete process.env.SENDLENS_INSTANTLY_API_KEY;
delete process.env.SENDLENS_DB_PATH;
delete process.env.SENDLENS_STATE_DIR;

console.log("plugin runtime tests passed");

async function runQuery(conn, sql) {
  const rows = await conn.run(sql);
  return rows.getRowObjectsJson();
}
