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
const { getQueryRecipes } = require("../build/plugin/query-recipes.js");

const workspaceId = "experiment_validity_workspace";
process.env.SENDLENS_DB_PATH = path.join(
  os.tmpdir(),
  `sendlens-experiment-validity-${Date.now()}.duckdb`,
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
     (id, workspace_id, source_provider, provider_campaign_id, campaign_source_id, organization_id, name, status, synced_at)
     VALUES
     ('exp-eligible', '${workspaceId}', 'instantly', 'eligible', 'instantly:eligible', 'exp-org', 'Eligible Experiment', 'active', TIMESTAMP '2026-08-01 10:00:00'),
     ('exp-shared', '${workspaceId}', 'instantly', 'shared', 'instantly:shared', 'exp-org', 'Shared Sender Experiment', 'active', TIMESTAMP '2026-08-01 10:00:00'),
     ('exp-peer', '${workspaceId}', 'instantly', 'peer', 'instantly:peer', 'exp-org', 'Shared Sender Peer', 'active', TIMESTAMP '2026-08-01 10:00:00'),
     ('exp-partial', '${workspaceId}', 'instantly', 'partial', 'instantly:partial', 'exp-org', 'Partial Frame Experiment', 'active', TIMESTAMP '2026-08-01 10:00:00'),
     ('exp-unresolved', '${workspaceId}', 'instantly', 'unresolved', 'instantly:unresolved', 'exp-org', 'Unresolved Variant Experiment', 'active', TIMESTAMP '2026-08-01 10:00:00'),
     ('exp-smartlead', '${workspaceId}', 'smartlead', 'smart', 'smartlead:smart', 'exp-org', 'Smartlead Matched Cohort', 'active', TIMESTAMP '2026-08-01 10:00:00')`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.accounts
     (workspace_id, email, source_provider, provider_account_id, account_source_id, status, daily_limit, synced_at)
     VALUES
     ('${workspaceId}', 'eligible@eligible-sender.example', 'instantly', 'eligible-account', 'instantly:eligible-account', 'active', 100, TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'shared@experiment.example', 'instantly', 'shared-account', 'instantly:shared-account', 'active', 100, TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'partial@partial-sender.example', 'instantly', 'partial-account', 'instantly:partial-account', 'active', 100, TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'unresolved@unresolved-sender.example', 'instantly', 'unresolved-account', 'instantly:unresolved-account', 'active', 100, TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'smart@smartlead-sender.example', 'smartlead', 'smart-account', 'smartlead:smart-account', 'active', 100, TIMESTAMP '2026-08-01 10:00:00')`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.campaign_account_assignments
     (workspace_id, campaign_id, source_provider, provider_campaign_id, campaign_source_id, assignment_type, assignment_key, account_email, provider_account_id, synced_at)
     VALUES
     ('${workspaceId}', 'exp-eligible', 'instantly', 'eligible', 'instantly:eligible', 'email', 'eligible@eligible-sender.example', 'eligible@eligible-sender.example', 'eligible-account', TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-shared', 'instantly', 'shared', 'instantly:shared', 'email', 'shared@experiment.example', 'shared@experiment.example', 'shared-account', TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-peer', 'instantly', 'peer', 'instantly:peer', 'email', 'shared@experiment.example', 'shared@experiment.example', 'shared-account', TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-partial', 'instantly', 'partial', 'instantly:partial', 'email', 'partial@partial-sender.example', 'partial@partial-sender.example', 'partial-account', TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-unresolved', 'instantly', 'unresolved', 'instantly:unresolved', 'email', 'unresolved@unresolved-sender.example', 'unresolved@unresolved-sender.example', 'unresolved-account', TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-smartlead', 'smartlead', 'smart', 'smartlead:smart', 'email', 'smart@smartlead-sender.example', 'smart@smartlead-sender.example', 'smart-account', TIMESTAMP '2026-08-01 10:00:00')`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.campaign_variants
     (workspace_id, campaign_id, source_provider, campaign_source_id, sequence_index, step, variant, step_type, subject, body_text, synced_at)
     VALUES
     ('${workspaceId}', 'exp-eligible', 'instantly', 'instantly:eligible', 1, 1, 0, 'email', 'A', 'A', TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-eligible', 'instantly', 'instantly:eligible', 1, 1, 1, 'email', 'B', 'B', TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-eligible', 'instantly', 'instantly:eligible', 2, 2, 0, 'email', 'Follow-up', 'Follow-up', TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-shared', 'instantly', 'instantly:shared', 1, 1, 0, 'email', 'A', 'A', TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-shared', 'instantly', 'instantly:shared', 1, 1, 1, 'email', 'B', 'B', TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-partial', 'instantly', 'instantly:partial', 1, 1, 0, 'email', 'A', 'A', TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-partial', 'instantly', 'instantly:partial', 1, 1, 1, 'email', 'B', 'B', TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-unresolved', 'instantly', 'instantly:unresolved', 1, 1, 0, 'email', 'A', 'A', TIMESTAMP '2026-08-01 10:00:00')`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.step_analytics
     (workspace_id, campaign_id, source_provider, campaign_source_id, step, variant, sent, unique_replies, replies, bounces, synced_at)
     VALUES
     ('${workspaceId}', 'exp-eligible', 'instantly', 'instantly:eligible', 1, 0, 100, 10, 10, 2, TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-eligible', 'instantly', 'instantly:eligible', 1, 1, 100, 20, 20, 2, TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-eligible', 'instantly', 'instantly:eligible', 2, 0, 60, 6, 6, 1, TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-shared', 'instantly', 'instantly:shared', 1, 0, 100, 10, 10, 2, TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-shared', 'instantly', 'instantly:shared', 1, 1, 100, 11, 11, 2, TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-partial', 'instantly', 'instantly:partial', 1, 0, 80, 5, 5, 2, TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-partial', 'instantly', 'instantly:partial', 1, 1, 80, 4, 4, 2, TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-unresolved', 'instantly', 'instantly:unresolved', 1, 0, 80, 5, 5, 2, TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-unresolved', 'instantly', 'instantly:unresolved', 1, 1, 80, 4, 4, 2, TIMESTAMP '2026-08-01 10:00:00')`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.sampling_runs
     (workspace_id, campaign_id, source_provider, campaign_source_id, ingest_mode, total_leads, total_sent, reply_rows, reply_lead_rows, reply_outbound_rows, lead_pages_fetched, lead_cursor_exhausted, lead_termination_reason, sampling_algorithm_version, sampling_seed, effective_population_size, selected_record_count, population_fingerprint, provenance_status, coverage_note, created_at)
     VALUES
     ('${workspaceId}', 'exp-eligible', 'instantly', 'instantly:eligible', 'full', 200, 200, 30, 30, 30, 2, TRUE, 'cursor_exhausted', 'v2', 'eligible-seed', 200, 200, 'eligible-fingerprint', 'complete', 'complete provider frame', TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-shared', 'instantly', 'instantly:shared', 'full', 200, 200, 21, 21, 21, 2, TRUE, 'cursor_exhausted', 'v2', 'shared-seed', 200, 200, 'shared-fingerprint', 'complete', 'complete provider frame', TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-partial', 'instantly', 'instantly:partial', 'fast', 100, 80, 9, 4, 2, 1, FALSE, 'page_limit', 'v2', 'partial-seed', 100, 40, 'partial-fingerprint', 'sampled', 'partial cursor frame', TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-unresolved', 'instantly', 'instantly:unresolved', 'full', 160, 160, 9, 9, 9, 2, TRUE, 'cursor_exhausted', 'v2', 'unresolved-seed', 160, 160, 'unresolved-fingerprint', 'complete', 'complete provider frame', TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-smartlead', 'smartlead', 'smartlead:smart', 'fast', 100, 40, 4, 2, 0, 1, FALSE, 'page_limit', 'v2', 'smart-seed', 100, 40, 'smart-fingerprint', 'sampled', 'sampled provider frame', TIMESTAMP '2026-08-01 10:00:00')`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.sampled_leads
     (workspace_id, campaign_id, source_provider, campaign_source_id, id, provider_lead_id, email, normalized_email, normalized_domain, company_name, company_domain, email_reply_count, lt_interest_status, email_replied_step, email_replied_variant, timestamp_last_contact, timestamp_last_reply, list_id, custom_payload, sample_source, sampled_at)
     VALUES
     ('${workspaceId}', 'exp-eligible', 'instantly', 'instantly:eligible', 'lead-eligible', 'lead-eligible', 'eligible@eligible.example', 'eligible@eligible.example', 'eligible.example', 'Eligible Co', 'eligible.example', 1, -1, 1, 0, TIMESTAMP '2026-07-25 09:00:00', TIMESTAMP '2026-07-26 09:00:00', 'list-a', '{"industry":"saas"}', 'reply_scan', TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-eligible', 'instantly', 'instantly:eligible', 'lead-objection', 'lead-objection', 'objection@eligible.example', 'objection@eligible.example', 'eligible.example', 'Objection Co', 'eligible.example', 1, -1, 1, 1, TIMESTAMP '2026-07-26 09:00:00', TIMESTAMP '2026-07-27 09:00:00', 'list-b', '{"industry":"services"}', 'reply_scan', TIMESTAMP '2026-08-02 10:00:00'),
     ('${workspaceId}', 'exp-partial', 'instantly', 'instantly:partial', 'lead-matched', 'lead-matched', 'matched@example.com', 'matched@example.com', 'example.com', 'Matched Co', 'example.com', 0, NULL, NULL, NULL, TIMESTAMP '2026-07-25 09:00:00', NULL, 'list-a', '{"industry":"saas"}', 'nonreply_sample', TIMESTAMP '2026-08-01 10:00:00'),
     ('${workspaceId}', 'exp-smartlead', 'smartlead', 'smartlead:smart', 'lead-smart', 'lead-smart', 'smart@smartlead.example', 'smart@smartlead.example', 'smartlead.example', 'Smart Co', 'smartlead.example', 1, 1, 1, 0, TIMESTAMP '2026-07-25 09:00:00', TIMESTAMP '2026-07-28 09:00:00', 'list-a', '{"industry":"saas"}', 'reply_scan', TIMESTAMP '2026-08-01 10:00:00')`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.reply_emails
     (workspace_id, id, campaign_id, thread_id, lead_email, from_email, to_email, subject, body_text, sent_at, i_status, direction, step_resolved, variant_resolved, hydrated_at)
     VALUES
     ('${workspaceId}', 'reply-objection', 'exp-eligible', 'thread-objection', 'objection@eligible.example', 'objection@eligible.example', 'eligible@eligible-sender.example', 'Re: timing', 'We are happy with the current vendor and cannot change now.', TIMESTAMP '2026-07-27 09:00:00', -1, 'inbound', '1', '1', TIMESTAMP '2026-08-02 10:00:00')`,
  );

  const validity = await query(
    db,
    `SELECT campaign_id, step, variant, comparison_state, frame_status,
            variant_mapping_status, shared_sender_count,
            hydration_status, minimum_detectable_effect_status
     FROM sendlens.experiment_validity_checks
     WHERE workspace_id = '${workspaceId}'
     ORDER BY campaign_id, step, variant`,
  );
  const eligible = validity.find((row) => row.campaign_id === "exp-eligible" && Number(row.step) === 1 && Number(row.variant) === 0);
  assert.equal(eligible?.comparison_state, "decision_eligible");
  assert.equal(eligible?.frame_status, "complete");
  assert.equal(eligible?.variant_mapping_status, "resolved");
  assert.equal(Number(eligible?.shared_sender_count), 0);
  assert.equal(eligible?.minimum_detectable_effect_status, "available");

  const shared = validity.find((row) => row.campaign_id === "exp-shared" && Number(row.step) === 1 && Number(row.variant) === 0);
  assert.equal(shared?.comparison_state, "spillover_risk");
  assert.ok(Number(shared?.shared_sender_count) > 0);

  const partial = validity.find((row) => row.campaign_id === "exp-partial" && Number(row.step) === 1 && Number(row.variant) === 0);
  assert.equal(partial?.comparison_state, "measurement_gap");
  assert.equal(partial?.frame_status, "partial");

  const unresolved = validity.find((row) => row.campaign_id === "exp-unresolved" && Number(row.step) === 1 && Number(row.variant) === 1);
  assert.equal(unresolved?.comparison_state, "non_comparable");
  assert.equal(unresolved?.variant_mapping_status, "unresolved");

  const recipeIds = new Set(getQueryRecipes().map((recipe) => recipe.id));
  for (const recipeId of [
    "experiment-validity-audit",
    "relative-sender-quality",
    "sequence-marginal-yield",
    "first-reply-step",
    "follow-up-yield",
    "reply-objection-cohorts",
    "list-freshness-decay",
    "matched-provider-cohort-comparison",
    "decision-risk-evidence-gaps",
  ]) {
    assert.ok(recipeIds.has(recipeId), `${recipeId} must be registered`);
  }

  const validityRecipe = getQueryRecipes().find((recipe) => recipe.id === "experiment-validity-audit");
  const validityRows = await query(db, validityRecipe.sql);
  assert.ok(validityRows.some((row) => row.comparison_state === "spillover_risk"));

  const objectionRecipe = getQueryRecipes().find((recipe) => recipe.id === "reply-objection-cohorts");
  const objectionRows = await query(db, objectionRecipe.sql);
  assert.ok(objectionRows.some((row) => row.objection_type === "status_quo"));

  const listRecipe = getQueryRecipes().find((recipe) => recipe.id === "list-freshness-decay");
  const listRows = await query(db, listRecipe.sql);
  assert.ok(listRows.some((row) => row.list_id === "list-a"));
} finally {
  closeDb(db);
  await resetDbConnectionForTests();
}

console.log("experiment validity tests passed");
