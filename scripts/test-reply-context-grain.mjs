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

process.env.SENDLENS_DB_PATH = path.join(
  os.tmpdir(),
  `sendlens-reply-context-grain-${Date.now()}.duckdb`,
);
delete process.env.SENDLENS_DEMO_MODE;

await resetDbConnectionForTests();

const db = await getDb();
try {
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.campaigns
     (workspace_id, id, source_provider, provider_campaign_id, campaign_source_id, name, status, synced_at)
     VALUES
     ('ws_reply_grain', 'inst-campaign', 'instantly', 'inst-campaign', 'instantly:inst-campaign', 'Instantly Reply Grain', 'active', CURRENT_TIMESTAMP),
     ('ws_reply_grain', 'smartlead:42', 'smartlead', '42', 'smartlead:42', 'Smartlead Reply Grain', 'active', CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.sampled_leads
     (workspace_id, campaign_id, source_provider, provider_campaign_id, campaign_source_id, id, provider_lead_id, email, normalized_email, normalized_domain, first_name, last_name, company_name, company_domain, status, email_reply_count, lt_interest_status, email_replied_step, email_replied_variant, timestamp_last_reply, job_title, custom_payload, sample_source, sampled_at)
     VALUES
     ('ws_reply_grain', 'inst-campaign', 'instantly', 'inst-campaign', 'instantly:inst-campaign', 'lead-inst', 'lead-inst', 'reply@example.com', 'reply@example.com', 'example.com', 'Riley', 'Reply', 'Reply Co', 'reply.example', 'active', 1, 1, 1, 0, TIMESTAMP '2026-07-16 12:00:00', 'Director', '{}', 'reply_full', CURRENT_TIMESTAMP),
     ('ws_reply_grain', 'smartlead:42', 'smartlead', '42', 'smartlead:42', 'lead-smart', 'lead-smart', 'smart@example.com', 'smart@example.com', 'example.com', 'Sam', 'Smart', 'Smart Co', 'smart.example', 'active', 1, 1, 1, 0, TIMESTAMP '2026-07-16 12:05:00', 'VP', '{}', 'reply_full', CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.reply_emails
     (workspace_id, id, campaign_id, thread_id, lead_email, from_email, to_email, subject, body_text, sent_at, is_auto_reply, i_status, content_preview, direction, step_resolved, variant_resolved, synced_at)
     VALUES
     ('ws_reply_grain', 'reply-inst-1', 'inst-campaign', 'thread-inst', 'reply@example.com', 'reply@example.com', 'sender@example.com', 'Re: Hello', 'Interested.', TIMESTAMP '2026-07-16 12:00:00', FALSE, 1, 'Interested.', 'inbound', '1', '0', CURRENT_TIMESTAMP),
     ('ws_reply_grain', 'reply-smart-1', 'smartlead:42', 'thread-smart', 'smart@example.com', 'smart@example.com', 'sender@example.com', 'Re: Smart', 'Smart interested.', TIMESTAMP '2026-07-16 12:05:00', FALSE, 1, 'Smart interested.', 'inbound', '1', '0', CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.campaign_variants
     (workspace_id, campaign_id, source_provider, provider_campaign_id, campaign_source_id, sequence_index, step, variant, step_type, subject, body_text, synced_at)
     VALUES
     ('ws_reply_grain', 'inst-campaign', 'instantly', 'inst-campaign', 'instantly:inst-campaign', 0, 1, 0, 'email', 'Ambiguous A', 'Template A', CURRENT_TIMESTAMP),
     ('ws_reply_grain', 'inst-campaign', 'instantly', 'inst-campaign', 'instantly:inst-campaign', 1, 1, 0, 'email', 'Ambiguous B', 'Template B', CURRENT_TIMESTAMP),
     ('ws_reply_grain', 'smartlead:42', 'smartlead', '42', 'smartlead:42', 0, 1, 0, 'email', 'Smartlead single', 'Smartlead template', CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.sampled_outbound_emails
     (workspace_id, campaign_id, source_provider, provider_campaign_id, campaign_source_id, id, to_email, from_email, subject, body_text, sent_at, step_resolved, variant_resolved, content_preview, sample_source, sampled_at)
     VALUES
     ('ws_reply_grain', 'inst-campaign', 'instantly', 'inst-campaign', 'instantly:inst-campaign', 'outbound-old', 'reply@example.com', 'sender@example.com', 'Older rendered', 'Older body', TIMESTAMP '2026-07-15 12:00:00', '1', '0', 'Older body', 'reply_outbound', CURRENT_TIMESTAMP),
     ('ws_reply_grain', 'inst-campaign', 'instantly', 'inst-campaign', 'instantly:inst-campaign', 'outbound-new', 'reply@example.com', 'sender@example.com', 'Newer rendered', 'Newer body', TIMESTAMP '2026-07-16 11:00:00', '1', '0', 'Newer body', 'reply_outbound', CURRENT_TIMESTAMP)`,
  );

  const leadAnchoredRows = await query(
    db,
    `SELECT lead_email, reply_email_id, rendered_subject, template_subject
     FROM sendlens.reply_context
     WHERE workspace_id = 'ws_reply_grain'
       AND campaign_id = 'inst-campaign'
     ORDER BY lead_email, template_subject`,
  );
  assert.equal(leadAnchoredRows.length, 1);
  assert.equal(leadAnchoredRows[0].reply_email_id, "reply-inst-1");
  assert.equal(leadAnchoredRows[0].rendered_subject, "Newer rendered");
  assert.equal(leadAnchoredRows[0].template_subject, null);

  const emailAnchoredRows = await query(
    db,
    `SELECT reply_email_id, rendered_subject, has_template_context, context_gap_reason, template_subject
     FROM sendlens.reply_email_context
     WHERE workspace_id = 'ws_reply_grain'
       AND campaign_id = 'inst-campaign'
     ORDER BY reply_email_id, template_subject`,
  );
  assert.equal(emailAnchoredRows.length, 1);
  assert.equal(emailAnchoredRows[0].reply_email_id, "reply-inst-1");
  assert.equal(emailAnchoredRows[0].rendered_subject, "Newer rendered");
  assert.equal(Boolean(emailAnchoredRows[0].has_template_context), false);
  assert.equal(emailAnchoredRows[0].context_gap_reason, "ambiguous_template_context");
  assert.equal(emailAnchoredRows[0].template_subject, null);

  const smartleadRows = await query(
    db,
    `SELECT reply_email_id, has_template_context, context_gap_reason, template_subject
     FROM sendlens.reply_email_context
     WHERE workspace_id = 'ws_reply_grain'
       AND campaign_id = 'smartlead:42'`,
  );
  assert.equal(smartleadRows.length, 1);
  assert.equal(Boolean(smartleadRows[0].has_template_context), true);
  assert.equal(smartleadRows[0].context_gap_reason, "covered");
  assert.equal(smartleadRows[0].template_subject, "Smartlead single");
} finally {
  closeDb(db);
  await resetDbConnectionForTests();
}

console.log("reply context grain tests passed");
