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
} = require("../build/plugin/local-db.js");

const workspaceId = "lineage_workspace";

process.env.SENDLENS_DB_PATH = path.join(
  os.tmpdir(),
  `sendlens-lineage-${Date.now()}.duckdb`,
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
     (id, workspace_id, source_provider, provider_campaign_id, campaign_source_id, organization_id, name, status, daily_limit, synced_at)
     VALUES
     ('lineage-c1', '${workspaceId}', 'instantly', 'c1', 'instantly:c1', 'lineage-org', 'Lineage Campaign One', 'active', 100, TIMESTAMP '2026-08-01 10:00:00'),
     ('lineage-c2', '${workspaceId}', 'instantly', 'c2', 'instantly:c2', 'lineage-org', 'Lineage Campaign Two', 'active', 100, TIMESTAMP '2026-08-01 10:00:00'),
     ('lineage-c5', '${workspaceId}', 'instantly', 'c5', 'instantly:c5', 'lineage-org', 'Lineage Paused Campaign', 'paused', 100, TIMESTAMP '2026-08-01 10:00:00'),
     ('lineage-c3', '${workspaceId}', 'smartlead', '11', 'smartlead:11', 'lineage-org', 'Smartlead Lineage Campaign', 'active', 50, TIMESTAMP '2026-08-01 10:00:00')`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.accounts
     (workspace_id, email, source_provider, provider_account_id, account_source_id, status, warmup_status, daily_limit, total_sent_30d, total_replies_30d, total_bounces_30d, synced_at)
     VALUES
     ('${workspaceId}', 'down@lineage.example', 'instantly', 'down-1', 'instantly:down-1', 'disconnected', 'paused', 80, 800, 10, 40, TIMESTAMP '2026-08-01 11:00:00'),
     ('${workspaceId}', 'healthy@lineage.example', 'instantly', 'healthy-1', 'instantly:healthy-1', 'active', 'active', 60, 600, 20, 6, TIMESTAMP '2026-08-01 11:00:00'),
     ('${workspaceId}', 'tagged@lineage.example', 'instantly', 'tagged-1', 'instantly:tagged-1', 'active', 'active', 40, 400, 10, 4, TIMESTAMP '2026-08-01 11:00:00'),
     ('${workspaceId}', 'reserve@lineage.example', 'instantly', 'reserve-1', 'instantly:reserve-1', 'active', 'active', 30, 300, 8, 3, TIMESTAMP '2026-08-01 11:00:00'),
     ('${workspaceId}', 'smart@lineage.example', 'smartlead', 'smart-1', 'smartlead:smart-1', 'active', 'active', 30, 300, 9, 3, TIMESTAMP '2026-08-01 11:00:00')`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.account_daily_metrics
     (workspace_id, email, source_provider, provider_account_id, account_source_id, date, sent, bounced, unique_replies, synced_at)
     VALUES
     ('${workspaceId}', 'healthy@lineage.example', 'instantly', 'healthy-1', 'instantly:healthy-1', DATE '2026-07-31', 100, 1, 3, TIMESTAMP '2026-08-01 11:00:00'),
     ('${workspaceId}', 'tagged@lineage.example', 'instantly', 'tagged-1', 'instantly:tagged-1', DATE '2026-07-31', 70, 1, 2, TIMESTAMP '2026-08-01 11:00:00'),
     ('${workspaceId}', 'reserve@lineage.example', 'instantly', 'reserve-1', 'instantly:reserve-1', DATE '2026-07-31', 40, 0, 2, TIMESTAMP '2026-08-01 11:00:00'),
     ('${workspaceId}', 'smart@lineage.example', 'smartlead', 'smart-1', 'smartlead:smart-1', DATE '2026-07-31', 50, 1, 2, TIMESTAMP '2026-08-01 11:00:00')`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.custom_tags
     (workspace_id, id, source_provider, provider_tag_id, name, label, synced_at)
     VALUES ('${workspaceId}', 'tag-1', 'instantly', 'tag-1', 'Lineage sender pool', 'Lineage sender pool', TIMESTAMP '2026-08-01 10:00:00')`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.custom_tag_mappings
     (workspace_id, tag_id, source_provider, provider_resource_id, resource_type, resource_id, synced_at)
     VALUES ('${workspaceId}', 'tag-1', 'instantly', 'tagged-1', '1', 'tagged@lineage.example', TIMESTAMP '2026-08-01 10:00:00')`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.campaign_account_assignments
     (workspace_id, campaign_id, source_provider, provider_campaign_id, campaign_source_id, assignment_type, assignment_key, account_email, provider_account_id, tag_id, synced_at)
     VALUES
     ('${workspaceId}', 'lineage-c1', 'instantly', 'c1', 'instantly:c1', 'email', 'down@lineage.example', 'down@lineage.example', 'down-1', NULL, TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'lineage-c1', 'instantly', 'c1', 'instantly:c1', 'email', 'healthy@lineage.example', 'healthy@lineage.example', 'healthy-1', NULL, TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'lineage-c2', 'instantly', 'c2', 'instantly:c2', 'email', 'healthy@lineage.example', 'healthy@lineage.example', 'healthy-1', NULL, TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'lineage-c2', 'instantly', 'c2', 'instantly:c2', 'email', 'reserve@lineage.example', 'reserve@lineage.example', 'reserve-1', NULL, TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'lineage-c2', 'instantly', 'c2', 'instantly:c2', 'tag', 'tag-1', NULL, NULL, 'tag-1', TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'lineage-c5', 'instantly', 'c5', 'instantly:c5', 'tag', 'missing-tag', NULL, NULL, 'missing-tag', TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'lineage-c3', 'smartlead', '11', 'smartlead:11', 'email', 'smart@lineage.example', 'smart@lineage.example', 'smart-1', NULL, TIMESTAMP '2026-08-01 10:00:00')`,
  );

  const senderAssets = await query(
    db,
    `SELECT source_provider, sender_email, sender_domain, health_status, health_evidence,
            configured_daily_capacity, measured_sent_30d, capacity_evidence
     FROM sendlens.sender_assets
     WHERE workspace_id = '${workspaceId}'
     ORDER BY source_provider, sender_email`,
  );
  assert.deepEqual(
    senderAssets.map((row) => ({
      source_provider: row.source_provider,
      sender_email: row.sender_email,
      sender_domain: row.sender_domain,
      health_status: row.health_status,
      health_evidence: row.health_evidence,
      configured_daily_capacity: Number(row.configured_daily_capacity),
      measured_sent_30d: Number(row.measured_sent_30d),
      capacity_evidence: row.capacity_evidence,
    })),
    [
      {
        source_provider: "instantly",
        sender_email: "down@lineage.example",
        sender_domain: "lineage.example",
        health_status: "disconnected",
        health_evidence: "configured",
        configured_daily_capacity: 80,
        measured_sent_30d: 0,
        capacity_evidence: "configured",
      },
      {
        source_provider: "instantly",
        sender_email: "healthy@lineage.example",
        sender_domain: "lineage.example",
        health_status: "healthy",
        health_evidence: "configured",
        configured_daily_capacity: 60,
        measured_sent_30d: 100,
        capacity_evidence: "configured",
      },
      {
        source_provider: "instantly",
        sender_email: "reserve@lineage.example",
        sender_domain: "lineage.example",
        health_status: "healthy",
        health_evidence: "configured",
        configured_daily_capacity: 30,
        measured_sent_30d: 40,
        capacity_evidence: "configured",
      },
      {
        source_provider: "instantly",
        sender_email: "tagged@lineage.example",
        sender_domain: "lineage.example",
        health_status: "healthy",
        health_evidence: "configured",
        configured_daily_capacity: 40,
        measured_sent_30d: 70,
        capacity_evidence: "configured",
      },
      {
        source_provider: "smartlead",
        sender_email: "smart@lineage.example",
        sender_domain: "lineage.example",
        health_status: "healthy",
        health_evidence: "configured",
        configured_daily_capacity: 30,
        measured_sent_30d: 50,
        capacity_evidence: "configured",
      },
    ],
  );

  const edges = await query(
    db,
    `SELECT source_provider, campaign_id, assignment_source, sender_email, edge_status,
            unknown_reason, effective_window_status, effective_from, effective_to
     FROM sendlens.campaign_asset_edges
     WHERE workspace_id = '${workspaceId}'
     ORDER BY source_provider, campaign_id, assignment_source, sender_email NULLS LAST`,
  );
  assert.equal(edges.length, 7);
  assert.ok(edges.some((row) => row.assignment_source === "tag" && row.sender_email === "tagged@lineage.example"));
  assert.ok(edges.some((row) => row.edge_status === "unknown" && row.unknown_reason === "account_tag_not_resolved"));
  assert.ok(edges.every((row) => row.effective_window_status === "current_snapshot" && row.effective_from && row.effective_to === null));
  assert.equal(new Set(edges.map((row) => row.source_provider)).size, 2);

  const lineage = await query(
    db,
    `SELECT source_provider, sender_domain, campaign_count, active_campaign_count,
            disconnected_sender_count, domain_health_status
     FROM sendlens.sender_domain_lineage
     WHERE workspace_id = '${workspaceId}'
       AND sender_domain = 'lineage.example'
     ORDER BY source_provider`,
  );
  assert.deepEqual(
    lineage.map((row) => ({
      source_provider: row.source_provider,
      campaign_count: Number(row.campaign_count),
      active_campaign_count: Number(row.active_campaign_count),
      disconnected_sender_count: Number(row.disconnected_sender_count),
      domain_health_status: row.domain_health_status,
    })),
    [
      {
        source_provider: "instantly",
        campaign_count: 2,
        active_campaign_count: 2,
        disconnected_sender_count: 1,
        domain_health_status: "degraded",
      },
      {
        source_provider: "smartlead",
        campaign_count: 1,
        active_campaign_count: 1,
        disconnected_sender_count: 0,
        domain_health_status: "healthy",
      },
    ],
  );

  const healthEvents = await query(
    db,
    `SELECT source_provider, sender_email, health_source, health_status, health_evidence,
            effective_from, effective_to
     FROM sendlens.asset_health_events
     WHERE workspace_id = '${workspaceId}'
       AND sender_email = 'down@lineage.example'`,
  );
  assert.ok(healthEvents.some((row) =>
    row.health_source === "account_snapshot"
      && row.health_status === "disconnected"
      && row.health_evidence === "configured"
      && row.effective_from
      && row.effective_to === null,
  ));

  const blastRadius = await query(
    db,
    `SELECT source_provider, asset_type, asset_key, campaign_id, quarantine_outcome,
            remaining_healthy_sender_count, configured_daily_capacity_at_risk,
            measured_sent_30d_at_risk, capacity_evidence, attribution_status
     FROM sendlens.campaign_blast_radius
     WHERE workspace_id = '${workspaceId}'
       AND campaign_id = 'lineage-c1'
     ORDER BY asset_type, asset_key`,
  );
  const senderHealthy = blastRadius.find((row) =>
    row.asset_type === "sender" && row.asset_key === "healthy@lineage.example",
  );
  assert.equal(senderHealthy?.quarantine_outcome, "stop");
  assert.equal(Number(senderHealthy?.remaining_healthy_sender_count), 0);
  assert.equal(Number(senderHealthy?.configured_daily_capacity_at_risk), 60);
  assert.equal(Number(senderHealthy?.measured_sent_30d_at_risk), 100);
  assert.equal(senderHealthy?.capacity_evidence, "configured");
  assert.equal(senderHealthy?.attribution_status, "unsupported_shared_sender");

  const domainBlastRadius = await query(
    db,
    `SELECT quarantine_outcome, remaining_healthy_sender_count, capacity_evidence
     FROM sendlens.campaign_blast_radius
     WHERE workspace_id = '${workspaceId}'
       AND source_provider = 'instantly'
       AND asset_type = 'sender'
       AND asset_key = 'healthy@lineage.example'
       AND campaign_id = 'lineage-c2'`,
  );
  assert.equal(domainBlastRadius[0]?.quarantine_outcome, "retain_redundancy");
  assert.equal(Number(domainBlastRadius[0]?.remaining_healthy_sender_count), 2);

  const effectiveOverlap = await query(
    db,
    `SELECT effective_from, effective_to, effective_window_status, evidence_frame
     FROM sendlens.cross_provider_lead_overlap_effective
     WHERE workspace_id = '${workspaceId}'`,
  );
  assert.equal(effectiveOverlap.length, 0);
} finally {
  closeDb(db);
  await resetDbConnectionForTests();
}

console.log("sender/domain lineage tests passed");
