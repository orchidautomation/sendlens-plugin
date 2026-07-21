import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  closeDb,
  getDb,
  query,
  resetDbConnectionForTests,
  run,
} = require("../build/plugin/local-db.js");
const { refreshSmartleadWorkspace } = require("../build/plugin/smartlead-ingest.js");
const { SmartleadApiError } = require("../build/plugin/smartlead-client.js");

const fixtureRoot = new URL("./fixtures/smartlead-client/", import.meta.url);

async function fixture(name) {
  return JSON.parse(await fs.readFile(new URL(name, fixtureRoot), "utf8"));
}

process.env.SENDLENS_DB_PATH = path.join(
  os.tmpdir(),
  `sendlens-smartlead-ingest-${Date.now()}.duckdb`,
);
delete process.env.SENDLENS_SMARTLEAD_API_KEY;
delete process.env.SENDLENS_INSTANTLY_API_KEY;
delete process.env.SENDLENS_PROVIDER;
delete process.env.SENDLENS_CLIENT;

await resetDbConnectionForTests();

const preexistingDb = await getDb();
try {
  await run(
    preexistingDb,
    `INSERT OR REPLACE INTO sendlens.campaigns
     (id, workspace_id, source_provider, provider_campaign_id, campaign_source_id, organization_id, name, status, synced_at)
     VALUES ('instant-preserved', '501', 'instantly', 'instant-preserved', 'instant-preserved', '501', 'Preserved Instantly Campaign', 'paused', CURRENT_TIMESTAMP)`,
  );
  await run(preexistingDb, "CHECKPOINT");
} finally {
  closeDb(preexistingDb);
}

const campaigns = await fixture("campaigns.direct-array.json");
const leadPages = await Promise.all([
  fixture("campaign-leads.page-0.json"),
  fixture("campaign-leads.page-2.json"),
  fixture("campaign-leads.page-4.json"),
]);
const statistics = await fixture("statistics.sequence-aggregate.json");
const emailAccounts = [
  ...(await fixture("email-accounts.page-0.json")),
  ...(await fixture("email-accounts.page-2.json")),
].map((account) =>
  account.id === 301
    ? {
      ...account,
      smtp_password: "super-secret-password",
      smtp_host: "smtp.private.example",
      smtp_port: 587,
      smtp_username: "private-smtp-user",
      imap_password: "super-secret-imap-password",
      imap_host: "imap.private.example",
      imap_port: 993,
      imap_username: "private-imap-user",
      bcc: "archive-private@example.com",
      reply_to: "replies-private@example.com",
      signature: "private mailbox signature",
      tags: [{ tag_id: 20, tag_name: "Primary Sender", tag_color: "#16a34a" }],
    }
    : account
);

const fakeClient = {
  async listCampaigns() {
    return campaigns;
  },
  async getCampaign(campaignId) {
    assert.equal(String(campaignId), "101");
    return {
      ...campaigns[0],
      max_leads_per_day: 40,
      sending_limit: 55,
      send_as_plain_text: true,
      enable_ai_esp_matching: true,
      stop_lead_settings: "REPLY_TO_AN_EMAIL",
      scheduler_cron_value: { tz: "America/New_York" },
      track_settings: ["DONT_LINK_CLICK"],
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-02T00:00:00.000Z",
      api_key: "campaign-secret",
    };
  },
  async getCampaignSequences(campaignId) {
    assert.equal(String(campaignId), "101");
    return [
      {
        seq_number: 1,
        subject: "Fixture intro",
        email_body: "<p>Hi {{first_name}}</p>",
        delay_days: 0,
        sequence_variants: [
          {
            subject: "Fixture intro variant",
            email_body: "<p>Variant {{first_name}}</p>",
          },
        ],
      },
      {
        seq_number: 2,
        subject: "Fixture follow up",
        email_body: "Following up",
        delay_days: 3,
      },
    ];
  },
  async getCampaignAnalytics(campaignId) {
    assert.equal(String(campaignId), "101");
    return {
      total_leads: 5,
      sent_count: 90,
      open_count: 32,
      reply_count: 7,
      click_count: 4,
      bounce_count: 3,
      unsubscribed_count: 1,
      positive_replies: 2,
    };
  },
  async getCampaignAnalyticsByDate(campaignId, options) {
    assert.equal(String(campaignId), "101");
    assert.equal(options.timezone, "America/New_York");
    return {
      daily: [
        {
          date: "2026-06-01",
          sent: 50,
          opened: 20,
          replies: 5,
          clicked: 3,
          bounced: 2,
          opportunities: 1,
        },
        {
          date: "2026-06-02",
          sent: 40,
          opened: 12,
          replies: 2,
          clicked: 1,
          bounced: 1,
          opportunities: 1,
        },
      ],
    };
  },
  async listAllCampaignStatistics(campaignId) {
    assert.equal(String(campaignId), "101");
    return statistics.statistics;
  },
  async listAllCampaignMailboxStatistics(campaignId, options) {
    assert.equal(String(campaignId), "101");
    assert.equal(options.limit, 20);
    assert.equal(options.timezone, "America/New_York");
    return [
      {
        email: "sender-301@example.com",
        email_account_id: 301,
        date: "2026-06-01",
        sent: 30,
        opened: 12,
        replies: 3,
        bounced: 1,
        clicked: 2,
      },
      {
        email: "sender-302@example.com",
        email_account_id: 302,
        date: "2026-06-01",
        sent: 20,
        opened: 8,
        replies: 2,
        bounced: 1,
        clicked: 1,
      },
    ];
  },
  async listCampaignEmailAccounts(campaignId) {
    assert.equal(String(campaignId), "101");
    return emailAccounts.filter((account) => account.campaign_ids?.includes(101));
  },
  async listAllEmailAccounts() {
    return emailAccounts;
  },
  async getEmailAccountWarmupStats(emailAccountId) {
    return {
      score: Number(emailAccountId) === 301 ? 91 : 87,
      status: "healthy",
    };
  },
  async listAllCampaignLeads(campaignId) {
    assert.equal(String(campaignId), "101");
    return leadPages.flatMap((page) => page.leads);
  },
  async getBulkMessageHistory(campaignId, leadIds) {
    assert.equal(String(campaignId), "101");
    assert.deepEqual(leadIds.map(String), ["1002", "1005"]);
    return {
      data: {
        1002: [
          {
            id: "out-1002-1",
            direction: "outbound",
            email_sequence_number: 1,
            subject: "Exact delivered outbound subject should stay out of rendered context",
            body_text: "Exact delivered outbound body should not be stored as reconstructed copy.",
            sent_at: "2026-06-03T10:00:00.000Z",
            from_email: "sender-301@example.com",
            to_email: "lead-1002@example.com",
          },
          {
            id: "in-1002-1",
            direction: "inbound",
            email_sequence_number: 1,
            subject: "Re: Fixture intro",
            body_text: "Synthetic exact reply body: the timing works.",
            received_at: "2026-06-03T11:15:00.000Z",
            from_email: "lead-1002@example.com",
            to_email: "sender-301@example.com",
          },
        ],
      },
    };
  },
  async getMessageHistory(campaignId, leadId) {
    assert.equal(String(campaignId), "101");
    assert.equal(String(leadId), "1005");
    return [
      {
        id: "out-1005-1",
        email_sequence_number: 1,
        subject: "Wrong person follow-up",
        sent_at: "2026-06-04T10:00:00.000Z",
        from_email: "sender-301@example.com",
        to_email: "lead-1005@example.co",
      },
    ];
  },
};

const fakeDeliveryClient = {
  async listSmartDeliveryTests() {
    return [{
      spam_test_id: "delivery-1",
      test_name: "Synthetic inbox placement",
      test_type: "automated",
      status: "active",
      schedule_start_time: "2026-06-01T00:00:00.000Z",
      current_test_run_no: 2,
    }];
  },
  async getSmartDeliveryTest() {
    return {
      id: "delivery-1",
      campaign_id: "101",
      description: "Synthetic test",
      link_checker: true,
      test_with_sl_account: false,
      sequence_mapping_id: "sequence-map-1",
      client_id: "client-1",
      user_id: "user-1",
      spam_filters: ["synthetic-filter"],
      all_email_sent_without_time_gap: false,
      min_time_btwn_emails: 5,
      min_time_unit: "minutes",
      is_warmup: false,
      has_seed_mapping: true,
      email_track_id: "track-1",
      scheduler_cron_value: { tz: "America/New_York" },
      email_body: "forbidden test message body",
      reply_headers: { Received: "forbidden raw header" },
    };
  },
  async getSmartDeliveryScheduleHistory() {
    return [{ test_run_no: 2, status: "completed", inbox_count: 91, tab_count: 6, spam_count: 3, adjusted_total_email_count: 100 }];
  },
  async getSmartDeliveryProviderReport() {
    return {
      overallTotalCount: 100,
      status: "completed",
      result: [{ provider: "Gmail", inbox_rate: 91, spam_rate: 3, bounce_rate: 0, mailbox_count: 100, email_body: "forbidden report body" }],
    };
  },
  async getSmartDeliveryGeoReport() {
    return { overallTotalCount: 100, status: "completed", result: [{ region: "North America", inbox_rate: 91, spam_rate: 3, bounce_rate: 0, mailbox_count: 100 }] };
  },
  async getSmartDeliverySenderReport() {
    return [{ email: "sender-301@example.com", details: { tests_count: 2, avg_inbox_rate: 91, avg_spam_rate: 3, avg_bounce_rate: 0, reputation_score: 9.1, last_test_date: "2026-06-02T00:00:00.000Z" } }];
  },
  async getSmartDeliverySenderAccounts() {
    return [{ id: "sender-delivery-1", from_email: "sender-301@example.com" }];
  },
  async getSmartDeliverySeedReport(_testId, report) {
    const field = report === "spf-details" ? "spf_verified"
      : report === "dkim-details" ? "dkim_verified"
        : report === "rdns-details" ? "rdns_verified"
          : "domain_blacklisted";
    const seed = { id: `seed-${report}`, email: "seed@example.test", esp: "Gmail", [field]: report !== "domain-blacklist" };
    return [{ from_email: "sender-301@example.com", seed_accounts: report === "spf-details" ? [seed, { ...seed }] : [seed] }];
  },
  async getSmartDeliveryBlacklistReport() {
    return [{ reply_id: "reply-1", reply: { from_email: "sender-301@example.com" }, to_email: "seed@example.test", ip: "192.0.2.1", total_blacklist: 0, rdns: "mail.example.test", details: "Synthetic blacklist detail" }];
  },
  async getSmartDeliveryIpAnalytics() {
    return [{ ip: "192.0.2.1", blacklisted: false, summary: "Synthetic clean IP", whois_data: { isp: "Example ISP", location: "United States", reverse_dns: "mail.example.test", organization: "Example Org" } }];
  },
  async getSmartDeliverySpamFilterReport() {
    return [{ from_email: "sender-301@example.com", spam_filter_details: [{ filter: "Synthetic filter", triggered_count: 3, trigger_percentage: 3 }] }];
  },
  async getSmartDeliveryMailboxSummary() {
    return [{ id: "mailbox-1", from_email: "sender-301@example.com", esp: "Gmail", total_email_count: 100, inbox_count: 91, tab_count: 6, spam_count: 3, placement_score: 91 }];
  },
};

const summary = await refreshSmartleadWorkspace({
  client: fakeClient,
  deliveryClient: fakeDeliveryClient,
  source: "manual",
});

assert.equal(summary.workspaceId, "501");
assert.equal(summary.exact_metrics.active_campaign_count, 1);
assert.equal(summary.exact_metrics.total_sent, 90);
assert.equal(summary.exact_metrics.total_unique_replies, 2);
assert.equal(summary.campaigns[0].source_provider, "smartlead");
assert.equal(summary.campaigns[0].provider_campaign_id, "101");
assert.equal(summary.campaigns[0].campaign_source_id, "smartlead:101");

const db = await getDb();
try {

  const preservedInstantly = await query(
    db,
    `SELECT source_provider, name
     FROM sendlens.campaigns
     WHERE workspace_id = '501' AND id = 'instant-preserved'`,
  );
assert.equal(preservedInstantly.length, 1);
assert.equal(preservedInstantly[0].source_provider, "instantly");
assert.equal(preservedInstantly[0].name, "Preserved Instantly Campaign");

const overview = await query(
  db,
  `SELECT campaign_id, source_provider, provider_campaign_id, campaign_source_id, campaign_name,
          status, emails_sent_count, reply_count_unique, bounced_count,
          unique_reply_rate_pct, bounce_rate_pct, link_tracking, open_tracking
   FROM sendlens.campaign_overview
   WHERE workspace_id = '501' AND campaign_id = 'smartlead:101'`,
);
assert.equal(overview.length, 1);
assert.equal(overview[0].source_provider, "smartlead");
assert.equal(overview[0].provider_campaign_id, "101");
assert.equal(overview[0].campaign_source_id, "smartlead:101");
assert.equal(overview[0].campaign_name, "Fixture Campaign A");
assert.equal(overview[0].status, "active");
assert.equal(Number(overview[0].emails_sent_count), 90);
assert.equal(Number(overview[0].reply_count_unique), 2);
assert.equal(Number(overview[0].bounced_count), 3);
assert.equal(Number(overview[0].unique_reply_rate_pct), 2.22);
assert.equal(Number(overview[0].bounce_rate_pct), 3.33);
assert.equal(Boolean(overview[0].open_tracking), true);
assert.equal(Boolean(overview[0].link_tracking), false);

const campaignConfig = await query(
  db,
  `SELECT daily_limit, text_only, first_email_text_only, stop_on_reply, match_lead_esp, schedule_timezone
   FROM sendlens.campaigns
   WHERE workspace_id = '501' AND id = 'smartlead:101'`,
);
assert.equal(Number(campaignConfig[0].daily_limit), 40);
assert.equal(Boolean(campaignConfig[0].text_only), true);
assert.equal(Boolean(campaignConfig[0].first_email_text_only), true);
assert.equal(Boolean(campaignConfig[0].stop_on_reply), true);
assert.equal(Boolean(campaignConfig[0].match_lead_esp), true);
assert.equal(campaignConfig[0].schedule_timezone, "America/New_York");

const campaignRaw = await query(
  db,
  "SELECT source_raw_json FROM sendlens.campaigns WHERE workspace_id = '501' AND id = 'smartlead:101'",
);
assert.doesNotMatch(String(campaignRaw[0].source_raw_json), /campaign-secret/);
assert.match(String(campaignRaw[0].source_raw_json), /\[REDACTED\]/);

const variants = await query(
  db,
  `SELECT source_provider, provider_campaign_id, campaign_source_id, step, variant, subject, body_text
   FROM sendlens.campaign_variants
   WHERE workspace_id = '501' AND campaign_id = 'smartlead:101'
   ORDER BY step, variant`,
);
assert.equal(variants.length, 3);
assert.equal(variants[0].source_provider, "smartlead");
assert.equal(variants[0].subject, "Fixture intro");
assert.equal(variants[1].subject, "Fixture intro variant");
assert.equal(variants[2].step, 1);

const stepRows = await query(
  db,
  `SELECT step, sent, opens, replies, unique_replies, clicks, bounces
   FROM sendlens.step_analytics
   WHERE workspace_id = '501' AND campaign_id = 'smartlead:101'
   ORDER BY step`,
);
assert.deepEqual(
  stepRows.map((row) => ({
    step: Number(row.step),
    sent: Number(row.sent),
    opens: Number(row.opens),
    replies: Number(row.replies),
    uniqueReplies: row.unique_replies,
    clicks: Number(row.clicks),
    bounces: Number(row.bounces),
  })),
  [
    { step: 0, sent: 50, opens: 20, replies: 5, uniqueReplies: null, clicks: 3, bounces: 2 },
    { step: 1, sent: 40, opens: 12, replies: 2, uniqueReplies: null, clicks: 1, bounces: 1 },
  ],
);

const dailyRows = await query(
  db,
  `SELECT date, sent, unique_replies, unique_clicks, unique_opportunities
   FROM sendlens.campaign_daily_metrics
   WHERE workspace_id = '501' AND campaign_id = 'smartlead:101'
   ORDER BY date`,
);
assert.equal(dailyRows.length, 2);
assert.equal(Number(dailyRows[0].sent), 50);
assert.equal(dailyRows[0].unique_replies, null);
assert.equal(dailyRows[0].unique_clicks, null);
assert.equal(dailyRows[0].unique_opportunities, null);

const accounts = await query(
  db,
  `SELECT email, source_provider, provider_account_id, account_source_id, provider,
          daily_limit, warmup_score, total_sent_30d, total_replies_30d, total_bounces_30d, source_raw_json
   FROM sendlens.accounts
   WHERE workspace_id = '501' AND email = 'sender-301@example.com'`,
);
assert.equal(accounts.length, 1);
assert.equal(accounts[0].source_provider, "smartlead");
assert.equal(accounts[0].provider_account_id, "301");
assert.equal(accounts[0].account_source_id, "smartlead:301");
assert.equal(accounts[0].provider, "gmail");
assert.equal(Number(accounts[0].daily_limit), 30);
assert.equal(Number(accounts[0].warmup_score), 91);
assert.equal(Number(accounts[0].total_sent_30d), 30);
assert.equal(Number(accounts[0].total_replies_30d), 3);
assert.equal(Number(accounts[0].total_bounces_30d), 1);
assert.doesNotMatch(String(accounts[0].source_raw_json), /super-secret-password/);
assert.doesNotMatch(String(accounts[0].source_raw_json), /smtp\.private|imap\.private|private-smtp|private-imap|archive-private|replies-private|mailbox signature/);

const campaignAccounts = await query(
  db,
  `SELECT source_provider, campaign_source_id, account_email, provider_account_id, assignment_source
   FROM sendlens.campaign_accounts
   WHERE workspace_id = '501' AND campaign_id = 'smartlead:101'
   ORDER BY account_email`,
);
assert.equal(campaignAccounts.length, 2);
assert.equal(campaignAccounts[0].source_provider, "smartlead");
assert.equal(campaignAccounts[0].campaign_source_id, "smartlead:101");
assert.equal(campaignAccounts[0].provider_account_id, "301");
assert.equal(campaignAccounts[0].assignment_source, "direct");

const accountDaily = await query(
  db,
  `SELECT email, source_provider, provider_account_id, date, sent, unique_replies, unique_clicks
   FROM sendlens.account_daily_metrics
   WHERE workspace_id = '501' AND email = 'sender-301@example.com'`,
);
assert.equal(accountDaily.length, 1);
assert.equal(accountDaily[0].source_provider, "smartlead");
assert.equal(accountDaily[0].provider_account_id, "301");
assert.equal(Number(accountDaily[0].sent), 30);
assert.equal(accountDaily[0].unique_replies, null);
assert.equal(accountDaily[0].unique_clicks, null);

const leadEvidence = await query(
  db,
  `SELECT source_provider, provider_lead_id, normalized_email, normalized_domain,
          company_domain, phone, email_reply_count, lt_interest_status, reply_outcome_label,
          custom_payload, has_reply_signal
   FROM sendlens.lead_evidence
   WHERE workspace_id = '501' AND email = 'lead-1001@example.com'`,
);
assert.equal(leadEvidence.length, 1);
assert.equal(leadEvidence[0].source_provider, "smartlead");
assert.equal(leadEvidence[0].provider_lead_id, "1001");
assert.equal(leadEvidence[0].normalized_email, "lead-1001@example.com");
assert.equal(leadEvidence[0].normalized_domain, "example.com");
assert.equal(leadEvidence[0].company_domain, "example.com");
assert.equal(leadEvidence[0].phone, "+15551234567");
assert.equal(Number(leadEvidence[0].email_reply_count), 0);
assert.equal(leadEvidence[0].lt_interest_status, null);
assert.equal(leadEvidence[0].reply_outcome_label, "no_reply");
assert.equal(Boolean(leadEvidence[0].has_reply_signal), false);
assert.match(String(leadEvidence[0].custom_payload), /company_domain/);
assert.match(String(leadEvidence[0].custom_payload), /"persona":"VP Operations"/);
assert.match(String(leadEvidence[0].custom_payload), /"segment":"Enterprise Healthcare"/);
assert.match(String(leadEvidence[0].custom_payload), /"smartlead_native_location":"Custom reserved-looking field"/);
assert.match(String(leadEvidence[0].custom_payload), /"smartlead_native_location_2":"San Francisco, CA"/);

const replyContext = await query(
  db,
  `SELECT reply_email_id, reply_body_text, reply_outcome_label, rendered_subject,
          rendered_body_text, sample_source, template_body_text
   FROM sendlens.reply_context
   WHERE workspace_id = '501' AND campaign_id = 'smartlead:101' AND lead_email = 'lead-1002@example.com'`,
);
assert.equal(replyContext.length, 1);
assert.match(String(replyContext[0].reply_email_id), /^smartlead:reply:smartlead:101:1002:/);
assert.equal(replyContext[0].reply_body_text, "Synthetic exact reply body: the timing works.");
assert.equal(replyContext[0].reply_outcome_label, "positive");
assert.equal(replyContext[0].rendered_subject, "Fixture intro");
assert.equal(replyContext[0].rendered_body_text, "Hi Grace");
assert.equal(replyContext[0].sample_source, "smartlead_sequence_template_reconstructed");
assert.equal(replyContext[0].template_body_text, "Hi {{first_name}}");
assert.doesNotMatch(
  String(replyContext[0].rendered_body_text),
  /Exact delivered outbound body/,
);

const replyEmailContext = await query(
  db,
  `SELECT reply_body_text, hydrated_reply_body, reply_outcome_label,
          rendered_body_text, rendered_sample_source, context_gap_reason
   FROM sendlens.reply_email_context
   WHERE workspace_id = '501' AND campaign_id = 'smartlead:101' AND lead_email = 'lead-1002@example.com'`,
);
assert.equal(replyEmailContext.length, 1);
assert.equal(replyEmailContext[0].reply_body_text, "Synthetic exact reply body: the timing works.");
assert.equal(Boolean(replyEmailContext[0].hydrated_reply_body), true);
assert.equal(replyEmailContext[0].reply_outcome_label, "positive");
assert.equal(replyEmailContext[0].rendered_body_text, "Hi Grace");
assert.equal(replyEmailContext[0].rendered_sample_source, "smartlead_sequence_template_reconstructed");
assert.equal(replyEmailContext[0].context_gap_reason, "covered");

const payloadKv = await query(
  db,
  `SELECT source_provider, normalized_email, normalized_domain, payload_key, payload_value, payload_value_json
   FROM sendlens.lead_payload_kv
   WHERE workspace_id = '501'
     AND email = 'lead-1001@example.com'
   ORDER BY payload_key`,
);
const smartleadPayload = new Map(payloadKv.map((row) => [row.payload_key, row]));
assert.equal(smartleadPayload.get("company_domain").source_provider, "smartlead");
assert.equal(smartleadPayload.get("company_domain").normalized_email, "lead-1001@example.com");
assert.equal(smartleadPayload.get("company_domain").payload_value, "example.com");
for (const [key, value] of [
  ["persona", "VP Operations"],
  ["segment", "Enterprise Healthcare"],
  ["headcount", "1001-5000"],
  ["industry", "Healthcare"],
  ["tech_stack", "Epic; Salesforce"],
  ["phone_number", "+15551234567"],
  ["website", "https://example.com"],
  ["linkedin_profile", "https://linkedin.com/in/ada-example"],
  ["company_url", "https://example.com/about"],
  ["location", "West Coast territory"],
  ["smartlead_native_location", "Custom reserved-looking field"],
  ["smartlead_native_location_2", "San Francisco, CA"],
  ["smartlead_status", "Clay qualified"],
  ["smartlead_native_status", "STARTED"],
]) {
  assert.equal(smartleadPayload.get(key)?.payload_value, value, `missing Smartlead metadata ${key}`);
}
assert.match(String(smartleadPayload.get("intent_flags")?.payload_value_json), /hiring/);

const campaignTags = await query(
  db,
  `SELECT source_provider, campaign_id, campaign_source_id, tag_id, tag_label
   FROM sendlens.campaign_tags
   WHERE workspace_id = '501'`,
);
assert.equal(campaignTags.length, 1);
assert.equal(campaignTags[0].source_provider, "smartlead");
assert.equal(campaignTags[0].campaign_id, "smartlead:101");
assert.equal(campaignTags[0].tag_id, "smartlead:tag:1");
assert.equal(campaignTags[0].tag_label, "ICP A");

const accountTags = await query(
  db,
  `SELECT source_provider, account_email, provider_account_id, tag_id, tag_label
   FROM sendlens.account_tags
   WHERE workspace_id = '501'`,
);
assert.equal(accountTags.length, 1);
assert.equal(accountTags[0].source_provider, "smartlead");
assert.equal(accountTags[0].account_email, "sender-301@example.com");
assert.equal(accountTags[0].provider_account_id, "301");
assert.equal(accountTags[0].tag_id, "smartlead:tag:20");

const capabilities = await query(
  db,
  `SELECT capability, support_status, confidence
   FROM sendlens.provider_capabilities
   WHERE workspace_id = '501' AND source_provider = 'smartlead' AND capability = 'inbox_placement'`,
);
assert.equal(capabilities.length, 1);
assert.equal(capabilities[0].support_status, "supported");
assert.equal(capabilities[0].confidence, "high");

const deliveryTests = await query(
  db,
  `SELECT test_id, test_name, total_count, inbox_count, category_count, spam_count,
          primary_inbox_rate_pct, category_rate_pct, spam_rate_pct
   FROM sendlens.smartlead_delivery_test_overview
   WHERE workspace_id = '501'`,
);
assert.equal(deliveryTests.length, 1);
assert.equal(deliveryTests[0].test_id, "delivery-1");
assert.equal(Number(deliveryTests[0].primary_inbox_rate_pct), 91);
assert.equal(Number(deliveryTests[0].category_rate_pct), 6);
assert.equal(Number(deliveryTests[0].spam_rate_pct), 3);

const deliverySender = await query(
  db,
  `SELECT sender_email, inbox_rate_pct, spam_rate_pct, reputation_score
   FROM sendlens.smartlead_sender_delivery_health
   WHERE workspace_id = '501'`,
);
assert.deepEqual(deliverySender.map((row) => ({
  sender: row.sender_email,
  inbox: Number(row.inbox_rate_pct),
  spam: Number(row.spam_rate_pct),
  reputation: Number(row.reputation_score),
})), [{ sender: "sender-301@example.com", inbox: 91, spam: 3, reputation: 9.1 }]);

const deliveryAuth = await query(
  db,
  `SELECT evidence_type, spf_pass, dkim_pass, rdns_pass, domain_blacklisted
   FROM sendlens.smartlead_delivery_authentication_health
   WHERE workspace_id = '501'
   ORDER BY evidence_type`,
);
assert.ok(deliveryAuth.some((row) => row.evidence_type === "spf" && Boolean(row.spf_pass)));
assert.ok(deliveryAuth.some((row) => row.evidence_type === "dkim" && Boolean(row.dkim_pass)));
assert.ok(deliveryAuth.some((row) => row.evidence_type === "rdns" && Boolean(row.rdns_pass)));
assert.ok(deliveryAuth.some((row) => row.evidence_type === "domain_blacklist" && !Boolean(row.domain_blacklisted)));

const duplicateSeedEvidence = await query(
  db,
  `SELECT COUNT(*) AS row_count
   FROM sendlens.smartlead_delivery_evidence
   WHERE workspace_id = '501' AND evidence_type = 'spf'`,
);
assert.equal(Number(duplicateSeedEvidence[0].row_count), 2, "duplicate seed IDs for one sender must remain distinct evidence rows");

const deliveryRaw = await query(
  db,
  `SELECT raw_json FROM sendlens.smartlead_delivery_tests WHERE workspace_id = '501'
   UNION ALL
   SELECT raw_json FROM sendlens.smartlead_delivery_evidence WHERE workspace_id = '501'`,
);
for (const row of deliveryRaw) {
  assert.doesNotMatch(String(row.raw_json), /forbidden test message body|forbidden report body|forbidden raw header/i);
}
const safeDeliveryTestRawRows = await query(
  db,
  `SELECT raw_json FROM sendlens.smartlead_delivery_tests WHERE workspace_id = '501' AND id = 'delivery-1'`,
);
const safeDeliveryTestRaw = JSON.parse(String(safeDeliveryTestRawRows[0].raw_json));
assert.equal(safeDeliveryTestRaw.link_checker, true);
assert.equal(safeDeliveryTestRaw.sequence_mapping_id, "sequence-map-1");
assert.deepEqual(safeDeliveryTestRaw.spam_filters, ["synthetic-filter"]);
assert.equal(safeDeliveryTestRaw.min_time_btwn_emails, 5);
assert.equal(safeDeliveryTestRaw.has_seed_mapping, true);
assert.deepEqual(safeDeliveryTestRaw.scheduler_cron_value, { tz: "America/New_York" });
const diagnosticRaw = await query(
  db,
  `SELECT evidence_type, raw_json
   FROM sendlens.smartlead_delivery_evidence
   WHERE workspace_id = '501' AND evidence_type IN ('ip_blacklist', 'ip_analytics')
   ORDER BY evidence_type`,
);
const ipAnalyticsRaw = JSON.parse(String(diagnosticRaw.find((row) => row.evidence_type === "ip_analytics").raw_json));
const ipBlacklistRaw = JSON.parse(String(diagnosticRaw.find((row) => row.evidence_type === "ip_blacklist").raw_json));
assert.equal(ipAnalyticsRaw.whois_data.isp, "Example ISP");
assert.equal(ipBlacklistRaw.rdns, "mail.example.test");
assert.equal(ipBlacklistRaw.details, "Synthetic blacklist detail");

const coverage = await query(
  db,
  `SELECT source_provider, provider_campaign_id, campaign_source_id, total_leads, total_sent,
          reply_rows, reply_lead_rows, outbound_rows_sampled, reply_outbound_rows, coverage_note
   FROM sendlens.sampling_runs
   WHERE workspace_id = '501' AND campaign_id = 'smartlead:101'`,
);
assert.equal(coverage.length, 1);
assert.equal(coverage[0].source_provider, "smartlead");
assert.equal(coverage[0].provider_campaign_id, "101");
assert.equal(coverage[0].campaign_source_id, "smartlead:101");
assert.equal(Number(coverage[0].total_leads), 5);
assert.equal(Number(coverage[0].total_sent), 90);
assert.equal(Number(coverage[0].reply_rows), 2);
assert.equal(Number(coverage[0].reply_lead_rows), 2);
assert.equal(Number(coverage[0].outbound_rows_sampled), 2);
assert.equal(Number(coverage[0].reply_outbound_rows), 2);
assert.match(String(coverage[0].coverage_note), /Smartlead read-only ingest/);
assert.match(String(coverage[0].coverage_note), /message_history eligible_leads=2/);
assert.match(String(coverage[0].coverage_note), /fetched_leads=2/);
assert.match(String(coverage[0].coverage_note), /skipped_leads=0/);
assert.match(String(coverage[0].coverage_note), /inbound_exact_body_rows=1/);
assert.match(String(coverage[0].coverage_note), /outbound_exact_body_rows_skipped=1/);
} finally {
  closeDb(db);
}

await assert.rejects(
  refreshSmartleadWorkspace({
    client: fakeClient,
    deliveryClient: {
      ...fakeDeliveryClient,
      async getSmartDeliveryProviderReport() {
        return { status: "processing", overallTotalCount: 100, result: [{ provider: "Gmail", inbox_rate: 91 }] };
      },
    },
    source: "manual",
  }),
  /provider report.*processing|processing.*prior complete snapshot/i,
);

await assert.rejects(
  refreshSmartleadWorkspace({
    client: fakeClient,
    deliveryClient: {
      ...fakeDeliveryClient,
      async getSmartDeliverySpamFilterReport() {
        throw new SmartleadApiError(404, "https://smartdelivery.smartlead.ai/api/v1/spam-test/report/[REDACTED]", "not_found");
      },
    },
    source: "manual",
  }),
  (error) => error instanceof SmartleadApiError && error.status === 404,
);

await assert.rejects(
  refreshSmartleadWorkspace({
    client: {
      ...fakeClient,
      async getCampaign(campaignId) {
        const detail = await fakeClient.getCampaign(campaignId);
        return { ...detail, created_at: "not-a-timestamp" };
      },
    },
    deliveryClient: fakeDeliveryClient,
    source: "manual",
  }),
  /timestamp|conversion/i,
);

const atomicDb = await getDb();
try {
  const preservedSnapshot = await query(
    atomicDb,
    `SELECT campaign_name, emails_sent_count, reply_count_unique
     FROM sendlens.campaign_overview
     WHERE workspace_id = '501' AND campaign_id = 'smartlead:101'`,
  );
  assert.equal(preservedSnapshot.length, 1);
  assert.equal(preservedSnapshot[0].campaign_name, "Fixture Campaign A");
  assert.equal(Number(preservedSnapshot[0].emails_sent_count), 90);
  assert.equal(Number(preservedSnapshot[0].reply_count_unique), 2);
  const preservedDelivery = await query(
    atomicDb,
    `SELECT COUNT(*) AS count
     FROM sendlens.smartlead_delivery_tests
     WHERE workspace_id = '501' AND id = 'delivery-1'`,
  );
  assert.equal(Number(preservedDelivery[0].count), 1);
} finally {
  closeDb(atomicDb);
}

await refreshSmartleadWorkspace({
  client: {
    ...fakeClient,
    async getCampaign(campaignId) {
      const detail = await fakeClient.getCampaign(campaignId);
      return { ...detail, stop_lead_settings: "FUTURE_PROVIDER_POLICY" };
    },
    async listAllCampaignLeads(campaignId) {
      const leads = await fakeClient.listAllCampaignLeads(campaignId);
      return leads.map((lead) => lead.id === 1005
        ? { ...lead, email_stats: { is_replied: null, replied_at: "2026-06-04T10:00:00.000Z" } }
        : lead);
    },
  },
  deliveryClient: fakeDeliveryClient,
  source: "manual",
});

const partialCoverageDb = await getDb();
try {
  const partialCoverage = await query(
    partialCoverageDb,
    `SELECT a.reply_count_unique, c.stop_on_reply
     FROM sendlens.campaign_analytics a
     JOIN sendlens.campaigns c
       ON c.workspace_id = a.workspace_id AND c.id = a.campaign_id
     WHERE a.workspace_id = '501' AND a.campaign_id = 'smartlead:101'`,
  );
  assert.equal(partialCoverage.length, 1);
  assert.equal(partialCoverage[0].reply_count_unique, null);
  assert.equal(partialCoverage[0].stop_on_reply, null);
} finally {
  closeDb(partialCoverageDb);
}

const regressionMailboxStats = {
  101: [
    {
      email: "sender-301@example.com",
      email_account_id: 301,
      date: "2026-06-01",
      sent: 30,
      opened: 12,
      replies: 3,
      unique_replies: 3,
      bounced: 1,
      clicked: 2,
    },
    {
      email: "sender-302@example.com",
      email_account_id: 302,
      date: "2026-06-01",
      sent: 20,
      opened: 8,
      replies: 2,
      unique_replies: 2,
      bounced: 1,
      clicked: 1,
    },
  ],
  102: [
    {
      email: "sender-302@example.com",
      email_account_id: 302,
      date: "2026-06-01",
      sent: 40,
      opened: 16,
      replies: 4,
      bounced: 2,
      clicked: 3,
    },
    {
      email: "sender-303@example.com",
      email_account_id: 303,
      date: "2026-06-01",
      sent: 25,
      opened: 9,
      replies: 1,
      unique_replies: 1,
      bounced: 0,
      clicked: 1,
    },
  ],
};

function regressionClient({ includeTags }) {
  const regressionCampaigns = campaigns.map((campaign) => ({
    ...campaign,
    status: "ACTIVE",
    tags: includeTags
      ? [
        Number(campaign.id) === 101
          ? { tag_id: 1, tag_name: "ICP A", tag_color: "#2563eb" }
          : { tag_id: 2, tag_name: "ICP B", tag_color: "#7c3aed" },
      ]
      : [],
  }));
  const regressionAccounts = [
    ...emailAccounts,
    {
      id: 303,
      from_email: "sender-303@example.com",
      from_name: "Sender Three",
      status: "ACTIVE",
      campaign_ids: [102],
      message_per_day: 50,
    },
  ].map((account) => ({
    ...account,
    from_email: Number(account.id) === 303 ? "" : account.from_email,
    email: Number(account.id) === 303 ? undefined : account.email,
    email_account: Number(account.id) === 303 ? "account-303" : account.email_account,
    email_account_email: Number(account.id) === 303 ? "sender-303@example.com" : account.email_account_email,
    tags: includeTags
      ? [
        Number(account.id) === 301
          ? { tag_id: 20, tag_name: "Primary Sender", tag_color: "#16a34a" }
          : { tag_id: 21, tag_name: "Secondary Sender", tag_color: "#dc2626" },
      ]
      : [],
  }));

  return {
    async listCampaigns() {
      return regressionCampaigns;
    },
    async getCampaign(campaignId) {
      const campaign = regressionCampaigns.find((row) => String(row.id) === String(campaignId));
      assert.ok(campaign);
      return {
        ...campaign,
        message_per_day: Number(campaignId) === 101 ? 40 : 35,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-02T00:00:00.000Z",
      };
    },
    async getCampaignSequences(campaignId) {
      return [
        {
          seq_number: 1,
          subject: `Regression ${campaignId}`,
          email_body: "Regression body",
          delay_days: 0,
        },
      ];
    },
    async getCampaignAnalytics(campaignId) {
      const stats = regressionMailboxStats[campaignId];
      return {
        total_leads: stats.length,
        sent_count: stats.reduce((sum, row) => sum + row.sent, 0),
        open_count: stats.reduce((sum, row) => sum + row.opened, 0),
        reply_count: stats.reduce((sum, row) => sum + row.replies, 0),
        click_count: stats.reduce((sum, row) => sum + row.clicked, 0),
        bounce_count: stats.reduce((sum, row) => sum + row.bounced, 0),
      };
    },
    async getCampaignAnalyticsByDate(campaignId) {
      const totals = regressionMailboxStats[campaignId].reduce(
        (sum, row) => ({
          sent: sum.sent + row.sent,
          opened: sum.opened + row.opened,
          replies: sum.replies + row.replies,
          clicked: sum.clicked + row.clicked,
          bounced: sum.bounced + row.bounced,
        }),
        { sent: 0, opened: 0, replies: 0, clicked: 0, bounced: 0 },
      );
      return {
        daily: [
          {
            date: "2026-06-01",
            ...totals,
          },
        ],
      };
    },
    async listAllCampaignStatistics(campaignId) {
      const totals = await this.getCampaignAnalytics(campaignId);
      return [
        {
          seq_number: 1,
          sent: totals.sent_count,
          opens: totals.open_count,
          replies: totals.reply_count,
          clicks: totals.click_count,
          bounces: totals.bounce_count,
        },
      ];
    },
    async listAllCampaignMailboxStatistics(campaignId) {
      return regressionMailboxStats[campaignId];
    },
    async listCampaignEmailAccounts(campaignId) {
      return regressionAccounts
        .filter((account) => account.campaign_ids?.includes(Number(campaignId)))
        .map(({ tags: _tags, ...account }) => {
          if (!includeTags && Number(campaignId) === 101 && Number(account.id) === 301) {
            const { email: _email, email_account_email: _emailAccountEmail, ...scopedAccount } = account;
            return { ...scopedAccount, from_email: "" };
          }
          return account;
        });
    },
    async listAllEmailAccounts() {
      return regressionAccounts;
    },
    async getEmailAccountWarmupStats(emailAccountId) {
      return {
        score: Number(emailAccountId) === 301 ? 91 : 87,
        status: "healthy",
      };
    },
    async listAllCampaignLeads(campaignId) {
      return [
        {
          id: `${campaignId}001`,
          email: `regression-${campaignId}@example.com`,
          first_name: "Regression",
          last_name: String(campaignId),
          email_stats: { is_replied: Number(campaignId) === 101 },
        },
      ];
    },
  };
}

await refreshSmartleadWorkspace({
  client: regressionClient({ includeTags: true }),
  deliveryClient: fakeDeliveryClient,
  source: "manual",
});

const regressionDb = await getDb();
try {
  const accountTotalsBeforeScoped = await query(
    regressionDb,
    `SELECT total_sent_30d, total_replies_30d, total_bounces_30d
     FROM sendlens.accounts
     WHERE workspace_id = '501'
       AND source_provider = 'smartlead'
       AND email = 'sender-302@example.com'`,
  );
  assert.equal(accountTotalsBeforeScoped.length, 1);
  assert.equal(Number(accountTotalsBeforeScoped[0].total_sent_30d), 60);
  assert.equal(Number(accountTotalsBeforeScoped[0].total_replies_30d), 6);
  assert.equal(Number(accountTotalsBeforeScoped[0].total_bounces_30d), 3);

  const accountDailyBeforeScoped = await query(
    regressionDb,
    `SELECT sent, unique_replies
     FROM sendlens.account_daily_metrics
     WHERE workspace_id = '501'
       AND source_provider = 'smartlead'
       AND email = 'sender-302@example.com'
       AND date = DATE '2026-06-01'`,
  );
  assert.equal(accountDailyBeforeScoped.length, 1);
  assert.equal(Number(accountDailyBeforeScoped[0].sent), 60);
  assert.equal(accountDailyBeforeScoped[0].unique_replies, null);

  const tagsBeforeScoped = await query(
    regressionDb,
    `SELECT tag_id
     FROM sendlens.campaign_tags
     WHERE workspace_id = '501'
       AND source_provider = 'smartlead'
       AND campaign_id = 'smartlead:101'`,
  );
  assert.deepEqual(tagsBeforeScoped.map((row) => row.tag_id), ["smartlead:tag:1"]);

  const accountTagsBeforeScoped = await query(
    regressionDb,
    `SELECT tag_id
     FROM sendlens.account_tags
     WHERE workspace_id = '501'
       AND source_provider = 'smartlead'
       AND account_email = 'sender-301@example.com'`,
  );
  assert.deepEqual(accountTagsBeforeScoped.map((row) => row.tag_id), ["smartlead:tag:20"]);

  const unscopedTagsBeforeScoped = await query(
    regressionDb,
    `SELECT tag_id, tag_label, color
     FROM sendlens.campaign_tags
     WHERE workspace_id = '501'
       AND source_provider = 'smartlead'
       AND campaign_id = 'smartlead:102'
     ORDER BY tag_id`,
  );
  assert.deepEqual(unscopedTagsBeforeScoped, [
    { tag_id: "smartlead:tag:2", tag_label: "ICP B", color: "#7c3aed" },
  ]);

  const unscopedAccountTagsBeforeScoped = await query(
    regressionDb,
    `SELECT tag_id, tag_label, color
     FROM sendlens.account_tags
     WHERE workspace_id = '501'
       AND source_provider = 'smartlead'
       AND account_email = 'sender-303@example.com'
     ORDER BY tag_id`,
  );
  assert.deepEqual(unscopedAccountTagsBeforeScoped, [
    { tag_id: "smartlead:tag:21", tag_label: "Secondary Sender", color: "#dc2626" },
  ]);
} finally {
  closeDb(regressionDb);
}

await refreshSmartleadWorkspace({
  client: regressionClient({ includeTags: false }),
  source: "manual",
  campaignIds: ["101"],
});

const scopedDb = await getDb();
try {
  const deliveryAfterScoped = await query(
    scopedDb,
    `SELECT COUNT(*) AS count
     FROM sendlens.smartlead_delivery_tests
     WHERE workspace_id = '501' AND id = 'delivery-1'`,
  );
  assert.equal(Number(deliveryAfterScoped[0].count), 1);
  const deliveryCapabilityAfterScoped = await query(
    scopedDb,
    `SELECT support_status
     FROM sendlens.provider_capabilities
     WHERE workspace_id = '501'
       AND source_provider = 'smartlead'
       AND capability = 'inbox_placement'`,
  );
  assert.equal(deliveryCapabilityAfterScoped[0].support_status, "supported");
  const accountTotalsAfterScoped = await query(
    scopedDb,
    `SELECT total_sent_30d, total_replies_30d, total_bounces_30d
     FROM sendlens.accounts
     WHERE workspace_id = '501'
       AND source_provider = 'smartlead'
       AND email = 'sender-302@example.com'`,
  );
  assert.equal(accountTotalsAfterScoped.length, 1);
  assert.equal(Number(accountTotalsAfterScoped[0].total_sent_30d), 60);
  assert.equal(Number(accountTotalsAfterScoped[0].total_replies_30d), 6);
  assert.equal(Number(accountTotalsAfterScoped[0].total_bounces_30d), 3);

  const accountDailyAfterScoped = await query(
    scopedDb,
    `SELECT sent, unique_replies
     FROM sendlens.account_daily_metrics
     WHERE workspace_id = '501'
       AND source_provider = 'smartlead'
       AND email = 'sender-302@example.com'
       AND date = DATE '2026-06-01'`,
  );
  assert.equal(accountDailyAfterScoped.length, 1);
  assert.equal(Number(accountDailyAfterScoped[0].sent), 60);
  assert.equal(accountDailyAfterScoped[0].unique_replies, null);

  const campaignTagsAfterScoped = await query(
    scopedDb,
    `SELECT tag_id
     FROM sendlens.campaign_tags
     WHERE workspace_id = '501'
       AND source_provider = 'smartlead'
       AND campaign_id = 'smartlead:101'`,
  );
  assert.equal(campaignTagsAfterScoped.length, 0);

  const accountTagsAfterScoped = await query(
    scopedDb,
    `SELECT tag_id
     FROM sendlens.account_tags
     WHERE workspace_id = '501'
       AND source_provider = 'smartlead'
       AND account_email = 'sender-301@example.com'`,
  );
  assert.equal(accountTagsAfterScoped.length, 0);

  const unscopedCampaignTagsAfterScoped = await query(
    scopedDb,
    `SELECT tag_id, tag_label, color
     FROM sendlens.campaign_tags
     WHERE workspace_id = '501'
       AND source_provider = 'smartlead'
       AND campaign_id = 'smartlead:102'
     ORDER BY tag_id`,
  );
  assert.deepEqual(unscopedCampaignTagsAfterScoped, [
    { tag_id: "smartlead:tag:2", tag_label: "ICP B", color: "#7c3aed" },
  ]);

  const unscopedAccountTagsAfterScoped = await query(
    scopedDb,
    `SELECT tag_id, tag_label, color
     FROM sendlens.account_tags
     WHERE workspace_id = '501'
       AND source_provider = 'smartlead'
       AND account_email = 'sender-303@example.com'
     ORDER BY tag_id`,
  );
  assert.deepEqual(unscopedAccountTagsAfterScoped, [
    { tag_id: "smartlead:tag:21", tag_label: "Secondary Sender", color: "#dc2626" },
  ]);
} finally {
  closeDb(scopedDb);
}

const overLimitLeads = Array.from({ length: 51 }, (_, index) => {
  const leadNumber = index + 1;
  return {
    id: String(9000 + leadNumber),
    email: `over-limit-${leadNumber}@example.com`,
    first_name: `Lead ${leadNumber}`,
    email_stats: { is_replied: true },
  };
});
const overLimitHydratedIds = overLimitLeads.slice(0, 50).map((lead) => String(lead.id));

await refreshSmartleadWorkspace({
  client: {
    async listCampaigns() {
      return [
        {
          id: 201,
          name: "Over Limit Coverage",
          status: "ACTIVE",
          user_id: "501",
        },
      ];
    },
    async getCampaign(campaignId) {
      assert.equal(String(campaignId), "201");
      return {
        id: 201,
        name: "Over Limit Coverage",
        status: "ACTIVE",
        user_id: "501",
      };
    },
    async getCampaignSequences(campaignId) {
      assert.equal(String(campaignId), "201");
      return [
        {
          seq_number: 1,
          subject: "Over limit",
          email_body: "Over limit body",
          delay_days: 0,
        },
      ];
    },
    async getCampaignAnalytics(campaignId) {
      assert.equal(String(campaignId), "201");
      return {
        total_leads: overLimitLeads.length,
        sent_count: overLimitLeads.length,
        reply_count: overLimitLeads.length,
      };
    },
    async getCampaignAnalyticsByDate(campaignId) {
      assert.equal(String(campaignId), "201");
      return {
        daily: [
          {
            date: "2026-06-01",
            sent: overLimitLeads.length,
            replies: overLimitLeads.length,
          },
        ],
      };
    },
    async listAllCampaignStatistics(campaignId) {
      assert.equal(String(campaignId), "201");
      return [];
    },
    async listAllCampaignMailboxStatistics(campaignId) {
      assert.equal(String(campaignId), "201");
      return [];
    },
    async listCampaignEmailAccounts(campaignId) {
      assert.equal(String(campaignId), "201");
      return [];
    },
    async listAllEmailAccounts() {
      return [];
    },
    async getEmailAccountWarmupStats() {
      return {};
    },
    async listAllCampaignLeads(campaignId) {
      assert.equal(String(campaignId), "201");
      return overLimitLeads;
    },
    async getBulkMessageHistory(campaignId, leadIds) {
      assert.equal(String(campaignId), "201");
      assert.deepEqual(leadIds.map(String), overLimitHydratedIds);
      return {
        data: Object.fromEntries(
          overLimitHydratedIds.map((leadId, index) => [
            leadId,
            [
              {
                id: `in-${leadId}`,
                direction: "inbound",
                subject: "Re: Over limit",
                body_text: `Reply ${index + 1}`,
                received_at: "2026-06-01T12:00:00.000Z",
                from_email: `over-limit-${index + 1}@example.com`,
              },
            ],
          ]),
        ),
      };
    },
  },
  source: "manual",
  campaignIds: ["201"],
});

const overLimitDb = await getDb();
try {
  const overLimitCoverage = await query(
    overLimitDb,
    `SELECT coverage_note
     FROM sendlens.sampling_runs
     WHERE workspace_id = '501' AND campaign_id = 'smartlead:201'`,
  );
  assert.equal(overLimitCoverage.length, 1);
  assert.match(String(overLimitCoverage[0].coverage_note), /message_history eligible_leads=51/);
  assert.match(String(overLimitCoverage[0].coverage_note), /lead_limit=50/);
  assert.match(String(overLimitCoverage[0].coverage_note), /fetched_leads=50/);
  assert.match(String(overLimitCoverage[0].coverage_note), /skipped_leads=1/);
} finally {
  closeDb(overLimitDb);
}

await refreshSmartleadWorkspace({
  client: fakeClient,
  deliveryClient: {
    ...fakeDeliveryClient,
    async listSmartDeliveryTests() {
      throw new SmartleadApiError(
        403,
        "https://smartdelivery.smartlead.ai/api/v1/spam-test/report?api_key=[REDACTED]",
        "forbidden",
      );
    },
  },
  source: "manual",
});
const unsupportedDeliveryDb = await getDb();
try {
  const unsupportedRows = await query(
    unsupportedDeliveryDb,
    `SELECT support_status, coverage_note
     FROM sendlens.provider_capabilities
     WHERE workspace_id = '501'
       AND source_provider = 'smartlead'
       AND capability = 'inbox_placement'`,
  );
  assert.equal(unsupportedRows[0].support_status, "unsupported");
  assert.match(String(unsupportedRows[0].coverage_note), /support-gated.*HTTP 403/i);
  const clearedDelivery = await query(
    unsupportedDeliveryDb,
    `SELECT COUNT(*) AS count FROM sendlens.smartlead_delivery_tests WHERE workspace_id = '501'`,
  );
  assert.equal(Number(clearedDelivery[0].count), 0);
} finally {
  closeDb(unsupportedDeliveryDb);
}
await resetDbConnectionForTests();
