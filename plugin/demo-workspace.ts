import { randomUUID } from "node:crypto";
import {
  appendSyncLog,
  clearWorkspaceData,
  closeDb,
  getDb,
  run,
  setActiveWorkspaceId,
  stampCacheOwner,
} from "./local-db";
import { writeRefreshStatus } from "./refresh-status";

export const DEMO_WORKSPACE_ID = "demo_workspace";
export const DEMO_CAMPAIGN_ALPHA_ID = "demo-alpha";
export const DEMO_CAMPAIGN_BETA_ID = "demo-beta";
export const DEMO_CAMPAIGN_RISK_ID = "demo-risk";

export function isDemoMode() {
  const raw = process.env.SENDLENS_DEMO_MODE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export async function seedDemoWorkspace() {
  const startedAt = new Date();
  const db = await getDb();

  try {
    await clearWorkspaceData(db, DEMO_WORKSPACE_ID);
    await seedCampaigns(db);
    await seedTagsAndAccounts(db);
    await seedLeadsAndReplies(db);
    await seedInboxPlacement(db);
    await setActiveWorkspaceId(db, DEMO_WORKSPACE_ID, "fast");

    const endedAt = new Date();
    await stampCacheOwner(db, DEMO_WORKSPACE_ID, endedAt.toISOString());
    await appendSyncLog(db, {
      id: `demo-${randomUUID()}`,
      workspaceId: DEMO_WORKSPACE_ID,
      source: "manual",
      mode: "fast",
      status: "succeeded",
      campaignsTotal: 3,
      campaignsProcessed: 3,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      message: "Seeded synthetic SendLens demo workspace.",
    });

    await writeRefreshStatus({
      status: "succeeded",
      source: "manual",
      workspaceId: DEMO_WORKSPACE_ID,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      lastSuccessAt: endedAt.toISOString(),
      campaignsTotal: 3,
      campaignsProcessed: 3,
      currentCampaignId: null,
      currentCampaignName: null,
      message:
        "Synthetic SendLens demo workspace is loaded. No Instantly credentials were used.",
    });

    return {
      schema_version: "sendlens_demo_seed.v1",
      workspaceId: DEMO_WORKSPACE_ID,
      campaign_ids: [
        DEMO_CAMPAIGN_ALPHA_ID,
        DEMO_CAMPAIGN_BETA_ID,
        DEMO_CAMPAIGN_RISK_ID,
      ],
      seeded_at: endedAt.toISOString(),
      evidence_note:
        "All rows are synthetic fixtures for OSS evaluation. They are not customer data and must be described as demo evidence.",
    };
  } finally {
    closeDb(db);
  }
}

async function seedCampaigns(db: Awaited<ReturnType<typeof getDb>>) {
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.campaigns
     (id, workspace_id, organization_id, name, status, daily_limit, text_only, first_email_text_only, open_tracking, link_tracking, stop_on_reply, stop_on_auto_reply, match_lead_esp, allow_risky_contacts, disable_bounce_protect, insert_unsubscribe_header, schedule_timezone, sequence_count, step_count, timestamp_created, timestamp_updated, synced_at)
     VALUES
     ('${DEMO_CAMPAIGN_ALPHA_ID}', '${DEMO_WORKSPACE_ID}', 'demo_org', 'Demo - Healthcare Operators', 'active', 60, true, true, false, false, true, true, true, false, false, true, 'America/New_York', 1, 3, '2026-04-01 09:00:00'::TIMESTAMP, '2026-05-04 12:00:00'::TIMESTAMP, CURRENT_TIMESTAMP),
     ('${DEMO_CAMPAIGN_BETA_ID}', '${DEMO_WORKSPACE_ID}', 'demo_org', 'Demo - Finance RevOps', 'active', 45, true, true, false, false, true, true, true, false, false, true, 'America/Chicago', 1, 2, '2026-04-08 09:00:00'::TIMESTAMP, '2026-05-04 12:00:00'::TIMESTAMP, CURRENT_TIMESTAMP),
     ('${DEMO_CAMPAIGN_RISK_ID}', '${DEMO_WORKSPACE_ID}', 'demo_org', 'Demo - Broad SaaS Risk', 'active', 80, true, false, true, true, true, false, false, true, true, false, 'America/Los_Angeles', 1, 2, '2026-04-15 09:00:00'::TIMESTAMP, '2026-05-04 12:00:00'::TIMESTAMP, CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.campaign_analytics
     (workspace_id, campaign_id, campaign_name, leads_count, contacted_count, emails_sent_count, new_leads_contacted_count, open_count, open_count_unique, reply_count, reply_count_unique, reply_count_automatic, link_click_count, bounced_count, unsubscribed_count, completed_count, total_opportunities, total_opportunity_value, total_interested, total_meeting_booked, total_meeting_completed, total_closed, synced_at)
     VALUES
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_ALPHA_ID}', 'Demo - Healthcare Operators', 520, 310, 920, 310, 260, 210, 39, 32, 5, 8, 9, 1, 110, 7, 84000, 13, 5, 2, 1, CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_BETA_ID}', 'Demo - Finance RevOps', 410, 220, 560, 220, 130, 96, 12, 9, 2, 3, 8, 2, 60, 1, 12000, 4, 1, 0, 0, CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_RISK_ID}', 'Demo - Broad SaaS Risk', 900, 400, 740, 400, 310, 250, 10, 6, 3, 18, 41, 6, 90, 0, 0, 2, 0, 0, 0, CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.campaign_daily_metrics
     (workspace_id, campaign_id, date, sent, contacted, new_leads_contacted, opened, unique_opened, replies, unique_replies, replies_automatic, unique_replies_automatic, clicks, unique_clicks, opportunities, unique_opportunities, synced_at)
     VALUES
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_ALPHA_ID}', '2026-05-01'::DATE, 58, 42, 36, 18, 15, 4, 4, 0, 0, 1, 1, 1, 1, CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_ALPHA_ID}', '2026-05-02'::DATE, 62, 45, 39, 19, 16, 5, 4, 1, 1, 1, 1, 2, 1, CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_BETA_ID}', '2026-05-01'::DATE, 44, 32, 31, 10, 8, 1, 1, 0, 0, 0, 0, 0, 0, CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_RISK_ID}', '2026-05-01'::DATE, 76, 54, 50, 24, 20, 1, 1, 1, 1, 4, 3, 0, 0, CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.step_analytics
     (workspace_id, campaign_id, step, variant, sent, opens, replies, replies_automatic, unique_replies, clicks, bounces, opportunities, synced_at)
     VALUES
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_ALPHA_ID}', 0, 0, 310, 96, 21, 2, 18, 4, 3, 5, CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_ALPHA_ID}', 1, 0, 260, 70, 9, 1, 8, 2, 2, 2, CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_ALPHA_ID}', 2, 0, 190, 42, 3, 0, 3, 1, 1, 0, CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_BETA_ID}', 0, 0, 220, 54, 7, 1, 5, 1, 3, 1, CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_RISK_ID}', 0, 0, 400, 190, 5, 2, 3, 11, 30, 0, CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.campaign_variants
     (workspace_id, campaign_id, sequence_index, step, variant, step_type, delay_value, delay_unit, subject, body_text, synced_at)
     VALUES
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_ALPHA_ID}', 0, 0, 0, 'email', 0, 'days', 'Operational capacity at {{company_name}}', 'Hi {{first_name}} - noticed {{company_name}} is expanding outpatient access. Worth comparing how operations teams are reducing referral leakage this quarter?', CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_ALPHA_ID}', 0, 1, 0, 'email', 3, 'days', 'Re: outpatient access', 'Quick follow-up, {{first_name}}. The relevant pattern is usually referral handoff visibility, not another dashboard rollout.', CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_BETA_ID}', 0, 0, 0, 'email', 0, 'days', 'RevOps cleanup for {{company_name}}', 'Hi {{first_name}} - saw the finance team has a new RevOps mandate. Are duplicate handoffs slowing reporting cycles?', CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_RISK_ID}', 0, 0, 0, 'email', 0, 'days', 'Quick question', 'Hi {{first_name}}, we help SaaS teams improve growth. Open to a quick call?', CURRENT_TIMESTAMP)`,
  );
}

async function seedTagsAndAccounts(db: Awaited<ReturnType<typeof getDb>>) {
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.custom_tags
     (workspace_id, id, organization_id, name, label, color, description, synced_at)
     VALUES
     ('${DEMO_WORKSPACE_ID}', 'demo-tag-priority', 'demo_org', 'priority', 'Priority Demo', '#0F766E', 'Synthetic campaigns with enough evidence for demo reads.', CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', 'demo-tag-risk', 'demo_org', 'risk', 'Deliverability Watch', '#B45309', 'Synthetic campaigns with deliberate deliverability warnings.', CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', 'demo-tag-senders', 'demo_org', 'senders', 'Demo Sender Pool', '#2563EB', 'Synthetic sender account pool.', CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.custom_tag_mappings
     (workspace_id, tag_id, resource_type, resource_id, timestamp_created, synced_at)
     VALUES
     ('${DEMO_WORKSPACE_ID}', 'demo-tag-priority', '2', '${DEMO_CAMPAIGN_ALPHA_ID}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', 'demo-tag-priority', '2', '${DEMO_CAMPAIGN_BETA_ID}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', 'demo-tag-risk', '2', '${DEMO_CAMPAIGN_RISK_ID}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', 'demo-tag-senders', '1', 'sender-a@demo.invalid', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', 'demo-tag-senders', '1', 'sender-b@demo.invalid', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.accounts
     (workspace_id, email, organization_id, status, warmup_status, warmup_score, provider, daily_limit, sending_gap, first_name, last_name, total_sent_30d, total_replies_30d, total_bounces_30d, synced_at)
     VALUES
     ('${DEMO_WORKSPACE_ID}', 'sender-a@demo.invalid', 'demo_org', 'active', 'healthy', 98, 'google', 40, 8, 'Demo', 'Sender A', 820, 44, 8, CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', 'sender-b@demo.invalid', 'demo_org', 'active', 'healthy', 95, 'microsoft', 35, 10, 'Demo', 'Sender B', 610, 26, 11, CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', 'sender-risk@demo.invalid', 'demo_org', 'active', 'warming', 72, 'google', 25, 5, 'Demo', 'Risk', 510, 8, 33, CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.account_daily_metrics
     (workspace_id, email, date, sent, bounced, contacted, new_leads_contacted, opened, unique_opened, replies, unique_replies, replies_automatic, unique_replies_automatic, clicks, unique_clicks, synced_at)
     VALUES
     ('${DEMO_WORKSPACE_ID}', 'sender-a@demo.invalid', '2026-05-01'::DATE, 38, 0, 30, 28, 12, 10, 3, 3, 0, 0, 1, 1, CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', 'sender-b@demo.invalid', '2026-05-01'::DATE, 32, 1, 26, 23, 8, 7, 2, 2, 0, 0, 1, 1, CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', 'sender-risk@demo.invalid', '2026-05-01'::DATE, 44, 5, 36, 35, 18, 15, 1, 1, 1, 1, 4, 3, CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.campaign_account_assignments
     (workspace_id, campaign_id, assignment_type, assignment_key, account_email, tag_id, synced_at)
     VALUES
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_ALPHA_ID}', 'email', 'sender-a@demo.invalid', 'sender-a@demo.invalid', NULL, CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_ALPHA_ID}', 'tag', 'demo-tag-senders', NULL, 'demo-tag-senders', CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_BETA_ID}', 'email', 'sender-b@demo.invalid', 'sender-b@demo.invalid', NULL, CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_RISK_ID}', 'email', 'sender-risk@demo.invalid', 'sender-risk@demo.invalid', NULL, CURRENT_TIMESTAMP)`,
  );
}

async function seedLeadsAndReplies(db: Awaited<ReturnType<typeof getDb>>) {
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.sampled_leads
     (workspace_id, campaign_id, id, email, first_name, last_name, company_name, company_domain, status, email_open_count, email_reply_count, lt_interest_status, email_opened_step, email_opened_variant, email_replied_step, email_replied_variant, timestamp_last_contact, timestamp_last_reply, job_title, website, personalization, custom_payload, sample_source, sampled_at)
     VALUES
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_ALPHA_ID}', 'lead-alpha-1', 'alex.rivera@example.invalid', 'Alex', 'Rivera', 'Northstar Health', 'northstar.example', 'active', 3, 1, 1, 0, 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'VP Operations', 'https://northstar.example', 'referral handoff visibility', '{"industry":"Healthcare","segment":"Operations","employee_band":"1001-5000","region":"US","trigger":"access expansion"}', 'reply_full', CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_ALPHA_ID}', 'lead-alpha-2', 'casey.chen@example.invalid', 'Casey', 'Chen', 'Harbor Clinic Group', 'harbor.example', 'active', 2, 1, 2, 0, 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'COO', 'https://harbor.example', 'patient intake backlog', '{"industry":"Healthcare","segment":"Operations","employee_band":"501-1000","region":"US","trigger":"new clinics"}', 'reply_full', CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_ALPHA_ID}', 'lead-alpha-3', 'jordan.ops@example.invalid', 'Jordan', 'Lee', 'Metro Care', 'metrocare.example', 'active', 1, 0, NULL, 0, 0, NULL, NULL, CURRENT_TIMESTAMP, NULL, 'Director of Access', 'https://metrocare.example', 'referral leakage', '{"industry":"Healthcare","segment":"Operations","employee_band":"201-500","region":"US","trigger":"referral delays"}', 'nonreply_sample', CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_BETA_ID}', 'lead-beta-1', 'morgan.fin@example.invalid', 'Morgan', 'Patel', 'LedgerWorks', 'ledger.example', 'active', 2, 1, 1, 0, 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'VP Finance', 'https://ledger.example', 'month-end close reporting', '{"industry":"Financial Services","segment":"Finance","employee_band":"201-500","region":"US","trigger":"RevOps mandate"}', 'reply_full', CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_RISK_ID}', 'lead-risk-1', 'taylor.saas@example.invalid', 'Taylor', 'Ng', 'ScaleBright', 'scalebright.example', 'active', 4, 1, -1, 0, 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'Founder', 'https://scalebright.example', 'growth', '{"industry":"SaaS","segment":"General","employee_band":"51-200","region":"US","trigger":"generic"}', 'reply_full', CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_RISK_ID}', 'lead-risk-2', 'riley.saas@example.invalid', 'Riley', 'Stone', 'AppLayer', 'applayer.example', 'active', 1, 0, NULL, 0, 0, NULL, NULL, CURRENT_TIMESTAMP, NULL, 'Head of Growth', 'https://applayer.example', 'growth', '{"industry":"SaaS","segment":"General","employee_band":"51-200","region":"US","trigger":"generic"}', 'nonreply_sample', CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.sampled_outbound_emails
     (workspace_id, campaign_id, id, to_email, from_email, subject, body_text, sent_at, step_resolved, variant_resolved, content_preview, sample_source, sampled_at)
     VALUES
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_ALPHA_ID}', 'out-alpha-1', 'alex.rivera@example.invalid', 'sender-a@demo.invalid', 'Operational capacity at Northstar Health', 'Hi Alex - noticed Northstar Health is expanding outpatient access. Worth comparing how operations teams are reducing referral leakage this quarter?', CURRENT_TIMESTAMP, '0', '0', 'Hi Alex - noticed Northstar Health is expanding outpatient access...', 'reconstructed_reply_template', CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_ALPHA_ID}', 'out-alpha-2', 'jordan.ops@example.invalid', 'sender-b@demo.invalid', 'Operational capacity at Metro Care', 'Hi Jordan - noticed Metro Care is expanding outpatient access. Worth comparing how operations teams are reducing referral leakage this quarter?', CURRENT_TIMESTAMP, '0', '0', 'Hi Jordan - noticed Metro Care is expanding outpatient access...', 'reconstructed_nonreply_template', CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_RISK_ID}', 'out-risk-1', 'taylor.saas@example.invalid', 'sender-risk@demo.invalid', 'Quick question', 'Hi Taylor, we help SaaS teams improve growth. Open to a quick call?', CURRENT_TIMESTAMP, '0', '0', 'Hi Taylor, we help SaaS teams improve growth...', 'reconstructed_reply_template', CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.reply_emails
     (workspace_id, id, campaign_id, thread_id, lead_email, message_id, eaccount, from_email, to_email, subject, body_text, body_html, sent_at, is_auto_reply, ai_interest_value, i_status, content_preview, direction, step_resolved, variant_resolved, hydrated_at, synced_at)
     VALUES
     ('${DEMO_WORKSPACE_ID}', 'reply-alpha-1', '${DEMO_CAMPAIGN_ALPHA_ID}', 'thread-alpha-1', 'alex.rivera@example.invalid', '<demo-alpha-1@example.invalid>', 'sender-a@demo.invalid', 'alex.rivera@example.invalid', 'sender-a@demo.invalid', 'Re: Operational capacity at Northstar Health', 'This is relevant. We are trying to reduce referral leakage before the new clinic launch.', '<p>This is relevant.</p>', CURRENT_TIMESTAMP, false, 0.91, 1, 'This is relevant. We are trying to reduce referral leakage...', 'inbound', '0', '0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', 'reply-alpha-2', '${DEMO_CAMPAIGN_ALPHA_ID}', 'thread-alpha-2', 'casey.chen@example.invalid', '<demo-alpha-2@example.invalid>', 'sender-b@demo.invalid', 'casey.chen@example.invalid', 'sender-b@demo.invalid', 'Re: outpatient access', 'Loop in our access director. Intake backlog is the right topic.', '<p>Loop in our access director.</p>', CURRENT_TIMESTAMP, false, 0.84, 2, 'Loop in our access director...', 'inbound', '0', '0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', 'reply-risk-1', '${DEMO_CAMPAIGN_RISK_ID}', 'thread-risk-1', 'taylor.saas@example.invalid', '<demo-risk-1@example.invalid>', 'sender-risk@demo.invalid', 'taylor.saas@example.invalid', 'sender-risk@demo.invalid', 'Re: Quick question', 'Not interested. This is too generic for us.', '<p>Not interested.</p>', CURRENT_TIMESTAMP, false, 0.12, -1, 'Not interested. This is too generic for us.', 'inbound', '0', '0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.reply_email_hydration_state
     (workspace_id, campaign_id, i_status, latest_of_thread, email_type, next_starting_after, pages_hydrated, emails_hydrated, exhausted, last_hydrated_at, synced_at)
     VALUES
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_ALPHA_ID}', 1, true, 'received', NULL, 1, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_ALPHA_ID}', 2, true, 'received', NULL, 1, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_RISK_ID}', -1, true, 'received', NULL, 1, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.sampling_runs
     (workspace_id, campaign_id, ingest_mode, total_leads, total_sent, reply_rows, reply_lead_rows, nonreply_sample_target, nonreply_rows_sampled, outbound_sample_target, outbound_rows_sampled, reply_outbound_rows, filtered_lead_rows, coverage_note, created_at)
     VALUES
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_ALPHA_ID}', 'demo', 520, 920, 32, 2, 100, 1, 100, 2, 2, 0, 'synthetic demo fixture: exact aggregates are fabricated; lead/outbound/reply rows are bounded examples', CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_BETA_ID}', 'demo', 410, 560, 9, 1, 100, 0, 100, 0, 0, 0, 'synthetic demo fixture: exact aggregates are fabricated; lead rows are bounded examples', CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', '${DEMO_CAMPAIGN_RISK_ID}', 'demo', 900, 740, 6, 1, 100, 1, 100, 1, 1, 0, 'synthetic demo fixture: exact aggregates are fabricated; lead/outbound/reply rows are bounded examples', CURRENT_TIMESTAMP)`,
  );
}

async function seedInboxPlacement(db: Awaited<ReturnType<typeof getDb>>) {
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.inbox_placement_tests
     (workspace_id, id, organization_id, name, delivery_mode, description, type, sending_method, campaign_id, email_subject, email_body, emails_json, test_code, tags_json, text_only, recipients_json, recipients_labels_json, timestamp_created, timestamp_next_run, status, not_sending_status, metadata_json, raw_json, synced_at)
     VALUES
     ('${DEMO_WORKSPACE_ID}', 'demo-ipt-alpha', 'demo_org', 'Demo inbox placement - Healthcare', 1, 'Synthetic inbox placement proof for the demo workspace.', 1, 1, '${DEMO_CAMPAIGN_ALPHA_ID}', 'Operational capacity at Northstar Health', 'Hi Alex', '["sender-a@demo.invalid"]', 'demo-alpha', '["demo"]', true, '["seed-gmail@example.invalid","seed-outlook@example.invalid"]', '["Gmail","Outlook"]', '2026-05-01 10:00:00'::TIMESTAMP, '2026-05-08 10:00:00'::TIMESTAMP, 1, NULL, '{"source":"demo"}', '{"id":"demo-ipt-alpha"}', CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', 'demo-ipt-risk', 'demo_org', 'Demo inbox placement - Risk', 1, 'Synthetic inbox placement warnings for the risk campaign.', 1, 1, '${DEMO_CAMPAIGN_RISK_ID}', 'Quick question', 'Hi Taylor', '["sender-risk@demo.invalid"]', 'demo-risk', '["demo"]', true, '["seed-gmail@example.invalid","seed-outlook@example.invalid"]', '["Gmail","Outlook"]', '2026-05-01 10:00:00'::TIMESTAMP, '2026-05-08 10:00:00'::TIMESTAMP, 1, NULL, '{"source":"demo"}', '{"id":"demo-ipt-risk"}', CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.inbox_placement_analytics
     (workspace_id, id, organization_id, test_id, timestamp_created, timestamp_created_date, is_spam, has_category, sender_email, sender_esp, recipient_email, recipient_esp, recipient_geo, recipient_type, spf_pass, dkim_pass, dmarc_pass, smtp_ip_blacklist_report_json, authentication_failure_results_json, record_type, raw_json, synced_at)
     VALUES
     ('${DEMO_WORKSPACE_ID}', 'demo-ipa-alpha-1', 'demo_org', 'demo-ipt-alpha', '2026-05-01 10:01:00'::TIMESTAMP, '2026-05-01'::DATE, false, false, 'sender-a@demo.invalid', 1, 'seed-gmail@example.invalid', 1, 1, 1, true, true, true, NULL, NULL, 2, '{"id":"demo-ipa-alpha-1"}', CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', 'demo-ipa-alpha-2', 'demo_org', 'demo-ipt-alpha', '2026-05-01 10:02:00'::TIMESTAMP, '2026-05-01'::DATE, false, true, 'sender-b@demo.invalid', 2, 'seed-outlook@example.invalid', 2, 1, 1, true, true, true, NULL, NULL, 2, '{"id":"demo-ipa-alpha-2"}', CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', 'demo-ipa-risk-1', 'demo_org', 'demo-ipt-risk', '2026-05-01 10:03:00'::TIMESTAMP, '2026-05-01'::DATE, true, false, 'sender-risk@demo.invalid', 1, 'seed-gmail@example.invalid', 1, 1, 1, true, false, true, '{"listed":true}', '{"dkim":"failed"}', 2, '{"id":"demo-ipa-risk-1"}', CURRENT_TIMESTAMP),
     ('${DEMO_WORKSPACE_ID}', 'demo-ipa-risk-2', 'demo_org', 'demo-ipt-risk', '2026-05-01 10:04:00'::TIMESTAMP, '2026-05-01'::DATE, false, true, 'sender-risk@demo.invalid', 2, 'seed-outlook@example.invalid', 2, 1, 1, true, true, false, NULL, '{"dmarc":"failed"}', 2, '{"id":"demo-ipa-risk-2"}', CURRENT_TIMESTAMP)`,
  );
}

if (require.main === module) {
  seedDemoWorkspace()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(
        `[sendlens] Demo workspace seed failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      process.exit(1);
    });
}
