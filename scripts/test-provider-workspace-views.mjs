#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const {
  closeDb,
  getDb,
  query,
  resetDbConnectionForTests,
  run,
  setActiveWorkspaceId,
} = require("../build/plugin/local-db.js");
const { buildWorkspaceSummary } = require("../build/plugin/summary.js");

const workspaceId = "mixed_provider_workspace";
const instantlyOnlyWorkspaceId = "instantly_only_workspace";
const smartleadEmptyWorkspaceId = "smartlead_configured_empty_workspace";

process.env.SENDLENS_DB_PATH = path.join(
  os.tmpdir(),
  `sendlens-provider-views-${Date.now()}.duckdb`,
);
delete process.env.SENDLENS_DEMO_MODE;
delete process.env.SENDLENS_INSTANTLY_API_KEY;
delete process.env.SENDLENS_SMARTLEAD_API_KEY;
delete process.env.SENDLENS_PROVIDER;

await resetDbConnectionForTests();

const db = await getDb();
try {
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.campaigns
     (id, workspace_id, source_provider, provider_campaign_id, campaign_source_id, organization_id, name, status, daily_limit, open_tracking, link_tracking, synced_at)
     VALUES
     ('inst-1', '${workspaceId}', 'instantly', 'inst-1', NULL, 'mixed-org', 'Shared Expansion Campaign', 'active', 40, true, true, CURRENT_TIMESTAMP),
     ('inst-old', '${workspaceId}', 'instantly', 'inst-old', NULL, 'mixed-org', 'Dormant Expansion Campaign', 'completed', 0, true, true, CURRENT_TIMESTAMP),
     ('smartlead:101', '${workspaceId}', 'smartlead', '101', 'smartlead:101', 'mixed-org', 'Shared Expansion Campaign', 'active', 30, true, false, CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.campaign_analytics
     (workspace_id, campaign_id, source_provider, provider_campaign_id, campaign_source_id, campaign_name, leads_count, contacted_count, emails_sent_count, reply_count_unique, bounced_count, total_opportunities, synced_at)
     VALUES
     ('${workspaceId}', 'inst-1', 'instantly', 'inst-1', NULL, 'Shared Expansion Campaign', 120, 80, 100, 10, 1, 2, CURRENT_TIMESTAMP),
     ('${workspaceId}', 'smartlead:101', 'smartlead', '101', 'smartlead:101', 'Shared Expansion Campaign', 80, 50, 50, 5, 5, 1, CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.sampling_runs
     (workspace_id, campaign_id, source_provider, provider_campaign_id, campaign_source_id, ingest_mode, total_leads, total_sent, reply_rows, reply_lead_rows, nonreply_rows_sampled, outbound_rows_sampled, coverage_note, created_at)
     VALUES
     ('${workspaceId}', 'inst-1', 'instantly', 'inst-1', NULL, 'fixture', 120, 100, 10, 1, 1, 0, 'synthetic Instantly mixed-provider fixture', CURRENT_TIMESTAMP),
     ('${workspaceId}', 'smartlead:101', 'smartlead', '101', 'smartlead:101', 'fixture', 80, 50, 5, 1, 1, 0, 'synthetic Smartlead mixed-provider fixture', CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.provider_capabilities
     (workspace_id, source_provider, capability, support_status, confidence, coverage_note, synced_at)
     VALUES
     ('${workspaceId}', 'instantly', 'inbox_placement', 'supported', 'high', 'Instantly fixture supports inbox placement evidence.', CURRENT_TIMESTAMP),
     ('${workspaceId}', 'smartlead', 'inbox_placement', 'unsupported', 'high', 'Smartlead has no checked equivalent inbox placement API for V1.', CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.sampled_leads
     (workspace_id, campaign_id, source_provider, provider_campaign_id, campaign_source_id, id, provider_lead_id, email, normalized_email, normalized_domain, first_name, last_name, company_name, company_domain, status, email_reply_count, lt_interest_status, timestamp_last_contact, timestamp_last_reply, job_title, custom_payload, sample_source, sampled_at)
     VALUES
     ('${workspaceId}', 'inst-1', 'instantly', 'inst-1', NULL, 'inst-lead-1', 'inst-lead-1', 'shared@example.com', 'shared@example.com', 'example.com', 'Sam', 'Shared', 'Acme Health', 'acme.example', 'active', 1, -1, '2026-06-01 09:00:00'::TIMESTAMP, '2026-06-02 09:00:00'::TIMESTAMP, 'VP Ops', '{"segment":"health"}', 'reply_full', '2026-06-01 09:00:00'::TIMESTAMP),
     ('${workspaceId}', 'inst-old', 'instantly', 'inst-old', NULL, 'inst-lead-old', 'inst-lead-old', 'shared@example.com', 'shared@example.com', 'example.com', 'Sam', 'Shared', 'Acme Health', 'acme.example', 'active', 0, NULL, '2025-06-01 09:00:00'::TIMESTAMP, NULL, 'VP Ops', '{"segment":"health"}', 'historical_sample', '2025-06-01 09:00:00'::TIMESTAMP),
     ('${workspaceId}', 'smartlead:101', 'smartlead', '101', 'smartlead:101', '1001', '1001', 'shared@example.com', 'shared@example.com', 'example.com', 'Sam', 'Shared', 'Acme Health', 'acme.example', 'active', 1, 1, '2026-06-06 09:00:00'::TIMESTAMP, '2026-06-07 09:00:00'::TIMESTAMP, 'VP Ops', '{"segment":"health"}', 'reply_full', '2026-06-06 09:00:00'::TIMESTAMP)`,
  );
  await setActiveWorkspaceId(db, workspaceId, "fast");

  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.campaigns
     (id, workspace_id, source_provider, provider_campaign_id, campaign_source_id, organization_id, name, status, daily_limit, open_tracking, link_tracking, synced_at)
     VALUES
     ('inst-only-1', '${instantlyOnlyWorkspaceId}', 'instantly', 'inst-only-1', 'instantly:inst-only-1', 'inst-only-org', 'Instantly Only Campaign', 'active', 20, true, true, CURRENT_TIMESTAMP),
     ('inst-empty-1', '${smartleadEmptyWorkspaceId}', 'instantly', 'inst-empty-1', 'instantly:inst-empty-1', 'smartlead-empty-org', 'Smartlead Empty Control Campaign', 'active', 20, true, true, CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.campaign_analytics
     (workspace_id, campaign_id, source_provider, provider_campaign_id, campaign_source_id, campaign_name, leads_count, contacted_count, emails_sent_count, reply_count_unique, bounced_count, total_opportunities, synced_at)
     VALUES
     ('${instantlyOnlyWorkspaceId}', 'inst-only-1', 'instantly', 'inst-only-1', 'instantly:inst-only-1', 'Instantly Only Campaign', 25, 10, 10, 1, 0, 0, CURRENT_TIMESTAMP),
     ('${smartleadEmptyWorkspaceId}', 'inst-empty-1', 'instantly', 'inst-empty-1', 'instantly:inst-empty-1', 'Smartlead Empty Control Campaign', 25, 10, 10, 1, 0, 0, CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.provider_capabilities
     (workspace_id, source_provider, capability, support_status, confidence, coverage_note, synced_at)
     VALUES
     ('${smartleadEmptyWorkspaceId}', 'smartlead', 'inbox_placement', 'unsupported', 'high', 'Smartlead was configured but returned no active campaigns for this fixture.', CURRENT_TIMESTAMP)`,
  );

  const overview = await query(
    db,
    `SELECT campaign_id, source_provider, provider_campaign_id, campaign_source_id, unique_reply_rate_pct, bounce_rate_pct
     FROM sendlens.campaign_overview
     WHERE workspace_id = '${workspaceId}'
       AND status = 'active'
     ORDER BY source_provider`,
  );
  assert.deepEqual(
    overview.map((row) => ({
      campaign_id: row.campaign_id,
      source_provider: row.source_provider,
      provider_campaign_id: row.provider_campaign_id,
      campaign_source_id: row.campaign_source_id,
    })),
    [
      {
        campaign_id: "inst-1",
        source_provider: "instantly",
        provider_campaign_id: "inst-1",
        campaign_source_id: "instantly:inst-1",
      },
      {
        campaign_id: "smartlead:101",
        source_provider: "smartlead",
        provider_campaign_id: "101",
        campaign_source_id: "smartlead:101",
      },
    ],
  );
  assert.equal(Number(overview[0].unique_reply_rate_pct), 10);
  assert.equal(Number(overview[1].bounce_rate_pct), 10);

  const allSummary = await buildWorkspaceSummary(db, workspaceId, "all");
  assert.equal(allSummary.source_provider_scope, "all");
  assert.equal(allSummary.exact_metrics.active_campaign_count, 2);
  assert.equal(allSummary.exact_metrics.total_sent, 150);
  assert.deepEqual(
    allSummary.provider_breakdown.map((row) => row.source_provider),
    ["instantly", "smartlead"],
  );
  assert.ok(
    allSummary.provider_capabilities.some((row) =>
      row.source_provider === "smartlead"
      && row.capability === "inbox_placement"
      && row.support_status === "unsupported"
    ),
  );
  assert.ok(allSummary.rate_caveats[0].includes("Cross-provider rates"));
  assert.ok(
    allSummary.warnings.some((warning) =>
      warning.includes("Smartlead inbox placement is explicitly unsupported")
    ),
  );

  const smartleadSummary = await buildWorkspaceSummary(db, workspaceId, "smartlead");
  assert.equal(smartleadSummary.source_provider_scope, "smartlead");
  assert.equal(smartleadSummary.exact_metrics.active_campaign_count, 1);
  assert.equal(smartleadSummary.exact_metrics.total_sent, 50);
  assert.equal(smartleadSummary.exact_metrics.inbox_placement_test_count, 0);
  assert.deepEqual(smartleadSummary.rate_caveats, []);
  assert.deepEqual(
    smartleadSummary.campaigns.map((row) => row.source_provider),
    ["smartlead"],
  );

  const smartleadNotConfiguredSummary = await buildWorkspaceSummary(
    db,
    instantlyOnlyWorkspaceId,
    "smartlead",
  );
  assert.equal(smartleadNotConfiguredSummary.exact_metrics.active_campaign_count, 0);
  assert.equal(smartleadNotConfiguredSummary.exact_metrics.total_sent, 0);
  assert.ok(
    !smartleadNotConfiguredSummary.warnings.some((warning) =>
      warning.includes("unique reply rate is below 1%")
    ),
  );
  assert.ok(
    smartleadNotConfiguredSummary.warnings.some((warning) =>
      warning.includes("Smartlead is not configured")
    ),
  );

  const smartleadConfiguredEmptySummary = await buildWorkspaceSummary(
    db,
    smartleadEmptyWorkspaceId,
    "smartlead",
  );
  assert.equal(smartleadConfiguredEmptySummary.exact_metrics.active_campaign_count, 0);
  assert.equal(smartleadConfiguredEmptySummary.exact_metrics.total_sent, 0);
  assert.ok(
    !smartleadConfiguredEmptySummary.warnings.some((warning) =>
      warning.includes("unique reply rate is below 1%")
    ),
  );
  assert.ok(
    smartleadConfiguredEmptySummary.warnings.some((warning) =>
      warning.includes("Smartlead capability rows exist")
    ),
  );

  const overlapRows = await query(
    db,
    `SELECT overlap_type, overlap_key, source_provider_count, source_providers, campaign_count, overall_contact_span_days, closest_cross_provider_window_days, contact_window_days, within_unsafe_window, overlap_risk_level
     FROM sendlens.provider_overlap_risk
     WHERE workspace_id = '${workspaceId}'
       AND overlap_type = 'contact_email'
       AND overlap_key = 'shared@example.com'`,
  );
  assert.equal(overlapRows.length, 1);
  assert.equal(Number(overlapRows[0].source_provider_count), 2);
  assert.match(String(overlapRows[0].source_providers), /instantly/);
  assert.match(String(overlapRows[0].source_providers), /smartlead/);
  assert.equal(Number(overlapRows[0].campaign_count), 3);
  assert.equal(Number(overlapRows[0].overall_contact_span_days) > 30, true);
  assert.equal(Number(overlapRows[0].closest_cross_provider_window_days), 5);
  assert.equal(Number(overlapRows[0].contact_window_days), 5);
  assert.equal(Boolean(overlapRows[0].within_unsafe_window), true);
  assert.equal(overlapRows[0].overlap_risk_level, "high");

  const companyOverlapRows = await query(
    db,
    `SELECT overlap_type, overlap_key
     FROM sendlens.provider_overlap_risk
     WHERE workspace_id = '${workspaceId}'
       AND overlap_type = 'company_domain'
       AND overlap_key = 'acme.example'`,
  );
  assert.equal(companyOverlapRows.length, 1);

  const overlapDetailRows = await query(
    db,
    `SELECT source_provider, campaign_source_id, provider_lead_id, normalized_email
     FROM sendlens.provider_overlap_risk_details
     WHERE workspace_id = '${workspaceId}'
       AND overlap_type = 'contact_email'
       AND overlap_key = 'shared@example.com'
     ORDER BY source_provider, campaign_source_id`,
  );
  assert.deepEqual(
    overlapDetailRows.map((row) => ({
      source_provider: row.source_provider,
      campaign_source_id: row.campaign_source_id,
      provider_lead_id: row.provider_lead_id,
      normalized_email: row.normalized_email,
    })),
    [
      {
        source_provider: "instantly",
        campaign_source_id: "instantly:inst-1",
        provider_lead_id: "inst-lead-1",
        normalized_email: "shared@example.com",
      },
      {
        source_provider: "instantly",
        campaign_source_id: "instantly:inst-old",
        provider_lead_id: "inst-lead-old",
        normalized_email: "shared@example.com",
      },
      {
        source_provider: "smartlead",
        campaign_source_id: "smartlead:101",
        provider_lead_id: "1001",
        normalized_email: "shared@example.com",
      },
    ],
  );
} finally {
  closeDb(db);
  await resetDbConnectionForTests();
}

console.log("provider workspace view tests passed");
