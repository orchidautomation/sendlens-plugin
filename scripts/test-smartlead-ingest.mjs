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
      message_per_day: 40,
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
  async getCampaignAnalyticsByDate(campaignId) {
    assert.equal(String(campaignId), "101");
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
  async listAllCampaignMailboxStatistics(campaignId) {
    assert.equal(String(campaignId), "101");
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
};

const summary = await refreshSmartleadWorkspace({
  client: fakeClient,
  source: "manual",
});

assert.equal(summary.workspaceId, "501");
assert.equal(summary.exact_metrics.active_campaign_count, 1);
assert.equal(summary.exact_metrics.total_sent, 90);
assert.equal(summary.exact_metrics.total_unique_replies, 7);
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
assert.equal(Number(overview[0].reply_count_unique), 7);
assert.equal(Number(overview[0].bounced_count), 3);
assert.equal(Number(overview[0].unique_reply_rate_pct), 7.78);
assert.equal(Number(overview[0].bounce_rate_pct), 3.33);
assert.equal(Boolean(overview[0].open_tracking), true);
assert.equal(Boolean(overview[0].link_tracking), false);

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
  `SELECT step, sent, opens, replies, clicks, bounces
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
    clicks: Number(row.clicks),
    bounces: Number(row.bounces),
  })),
  [
    { step: 0, sent: 50, opens: 20, replies: 5, clicks: 3, bounces: 2 },
    { step: 1, sent: 40, opens: 12, replies: 2, clicks: 1, bounces: 1 },
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
assert.equal(Number(dailyRows[0].unique_replies), 5);
assert.equal(Number(dailyRows[0].unique_clicks), 3);
assert.equal(Number(dailyRows[0].unique_opportunities), 1);

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
assert.match(String(accounts[0].source_raw_json), /\[REDACTED\]/);

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
assert.equal(Number(accountDaily[0].unique_replies), 3);
assert.equal(Number(accountDaily[0].unique_clicks), 2);

const leadEvidence = await query(
  db,
  `SELECT source_provider, provider_lead_id, normalized_email, normalized_domain,
          company_domain, email_reply_count, lt_interest_status, custom_payload, has_reply_signal
   FROM sendlens.lead_evidence
   WHERE workspace_id = '501' AND email = 'lead-1002@example.com'`,
);
assert.equal(leadEvidence.length, 1);
assert.equal(leadEvidence[0].source_provider, "smartlead");
assert.equal(leadEvidence[0].provider_lead_id, "1002");
assert.equal(leadEvidence[0].normalized_email, "lead-1002@example.com");
assert.equal(leadEvidence[0].normalized_domain, "example.com");
assert.equal(leadEvidence[0].company_domain, "example.org");
assert.equal(Number(leadEvidence[0].email_reply_count), 1);
assert.equal(leadEvidence[0].lt_interest_status, null);
assert.equal(Boolean(leadEvidence[0].has_reply_signal), true);
assert.match(String(leadEvidence[0].custom_payload), /company_domain/);

const payloadKv = await query(
  db,
  `SELECT source_provider, normalized_email, normalized_domain, payload_key, payload_value
   FROM sendlens.lead_payload_kv
   WHERE workspace_id = '501'
     AND email = 'lead-1001@example.com'
     AND payload_key = 'company_domain'`,
);
assert.equal(payloadKv.length, 1);
assert.equal(payloadKv[0].source_provider, "smartlead");
assert.equal(payloadKv[0].normalized_email, "lead-1001@example.com");
assert.equal(payloadKv[0].payload_value, "example.com");

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
assert.equal(capabilities[0].support_status, "unsupported");
assert.equal(capabilities[0].confidence, "high");

const coverage = await query(
  db,
  `SELECT source_provider, provider_campaign_id, campaign_source_id, total_leads, total_sent, reply_rows, reply_lead_rows, coverage_note
   FROM sendlens.sampling_runs
   WHERE workspace_id = '501' AND campaign_id = 'smartlead:101'`,
);
assert.equal(coverage.length, 1);
assert.equal(coverage[0].source_provider, "smartlead");
assert.equal(coverage[0].provider_campaign_id, "101");
assert.equal(coverage[0].campaign_source_id, "smartlead:101");
assert.equal(Number(coverage[0].total_leads), 5);
assert.equal(Number(coverage[0].total_sent), 90);
assert.equal(Number(coverage[0].reply_rows), 7);
assert.equal(Number(coverage[0].reply_lead_rows), 2);
assert.match(String(coverage[0].coverage_note), /Smartlead read-only ingest/);
} finally {
  closeDb(db);
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
  assert.equal(Number(accountDailyBeforeScoped[0].unique_replies), 6);

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
  assert.equal(Number(accountDailyAfterScoped[0].unique_replies), 6);

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
await resetDbConnectionForTests();
