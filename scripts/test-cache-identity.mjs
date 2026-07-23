import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const instantly = require("../build/plugin/instantly-client.js");
const { DuckDBInstance } = require("@duckdb/node-api");
const { CURRENT_CACHE_SCHEMA_VERSION } = require("../build/plugin/constants.js");
const {
  CacheReadinessError,
  assertCacheReadableForCurrentEnv,
  closeDb,
  currentApiKeyFingerprint,
  getCacheOwnerMetadata,
  getDb,
  query,
  run,
  setActiveWorkspaceId,
  setPluginState,
  stampCacheOwner,
  withCacheProviderMode,
} = require("../build/plugin/local-db.js");
const { refreshWorkspaceAtomically } = require("../build/plugin/instantly-ingest.js");
const { readRefreshStatus } = require("../build/plugin/refresh-status.js");

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sendlens-cache-identity-"));
const dbPath = path.join(tempDir, "workspace-cache.duckdb");
process.env.SENDLENS_DB_PATH = dbPath;
process.env.SENDLENS_STATE_DIR = tempDir;
delete process.env.SENDLENS_DEMO_MODE;
delete process.env.SENDLENS_CLIENT;
process.env.SENDLENS_CONTEXT_ROOT = tempDir;

const originals = {};
for (const key of [
  "listCampaigns",
  "getCampaignAnalytics",
  "listAccounts",
  "getDailyAccountAnalytics",
  "getWarmupAnalytics",
  "listAllCustomTags",
  "listAllCustomTagMappings",
  "listAllInboxPlacementTests",
  "listAllInboxPlacementAnalyticsForTest",
  "getCampaignDetails",
  "getStepAnalytics",
  "getDailyAnalytics",
  "listAllLeads",
  "listAllLeadsWithCoverage",
  "listLeadsPage",
]) {
  originals[key] = instantly[key];
}

function installFailingRefresh(message = "Instantly API 500: test failure") {
  instantly.listCampaigns = async () => {
    throw new Error(message);
  };
}

function installSuccessfulRefresh(
  workspaceId,
  campaignId,
  campaignName,
  status = 1,
  reportedLeadCount = 1,
  leadCoverage = {
    exhausted: true,
    terminationReason: "cursor_exhausted",
    pagesFetched: 1,
  },
  recentSentCount = 10,
) {
  instantly.listCampaigns = async () => [
    {
      id: campaignId,
      organization_id: workspaceId,
      name: campaignName,
      status,
      daily_limit: 25,
      timestamp_created: "2026-05-01T00:00:00Z",
      timestamp_updated: "2026-05-02T00:00:00Z",
    },
  ];
  instantly.getCampaignAnalytics = async (_apiKey, options) => {
    assert.deepEqual(options?.campaignIds, [campaignId]);
    const dateRanged = Boolean(options?.startDate || options?.endDate);
    if (dateRanged) {
      assert.match(options.startDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(options.endDate, /^\d{4}-\d{2}-\d{2}$/);
      const start = new Date(`${options.startDate}T00:00:00Z`);
      const end = new Date(`${options.endDate}T00:00:00Z`);
      assert.equal(
        Math.round((end.getTime() - start.getTime()) / 86_400_000),
        29,
        "recent campaign discovery must use an inclusive 30-day window",
      );
    }
    const emailsSentCount = dateRanged ? recentSentCount : 10;
    return [
      {
        campaign_id: campaignId,
        campaign_name: campaignName,
        leads_count: reportedLeadCount,
        contacted_count: 1,
        emails_sent_count: emailsSentCount,
        reply_count_unique: 1,
        reply_count_automatic: 0,
        bounced_count: 0,
        total_opportunities: 0,
        total_opportunity_value: 0,
      },
    ];
  };
  instantly.listAccounts = async () => [
    {
      email: `${campaignId}@example.com`,
      organization_id: workspaceId,
      status: 1,
      provider_code: 2,
      stat_warmup_score: 88,
      daily_limit: 25,
    },
  ];
  instantly.getDailyAccountAnalytics = async (_apiKey, options) => {
    assert.deepEqual(options?.emails, [`${campaignId}@example.com`]);
    return [];
  };
  instantly.getWarmupAnalytics = async () => ({ aggregate_data: {} });
  instantly.listAllCustomTags = async () => [];
  instantly.listAllCustomTagMappings = async (_apiKey, _maxPages, options) => {
    assert.equal(
      options,
      undefined,
      "workspace refresh must ingest the unfiltered custom-tag mapping collection",
    );
    return [];
  };
  instantly.listAllInboxPlacementTests = async () => [];
  instantly.listAllInboxPlacementAnalyticsForTest = async () => [];
  instantly.getCampaignDetails = async () => ({
    id: campaignId,
    name: campaignName,
    text_only: true,
    sequences: [
      {
        steps: [
          {
            type: "email",
            variants: [
              {
                subject: "Hello {{firstName}}",
                body: "Hi {{firstName}}",
              },
            ],
          },
        ],
      },
    ],
  });
  instantly.getStepAnalytics = async () => [
    {
      step: 0,
      variant: 0,
      sent: 10,
      replies: 1,
      replies_automatic: 0,
      unique_replies: 1,
      opens: 3,
      clicks: 0,
      bounces: 0,
      opportunities: 0,
    },
  ];
  instantly.getDailyAnalytics = async () => [
    {
      date: "2026-05-01",
      sent: 10,
      contacted: 1,
      new_leads_contacted: 1,
      replies: 1,
      unique_replies: 1,
      replies_automatic: 0,
      unique_replies_automatic: 0,
      clicks: 0,
      unique_clicks: 0,
      opportunities: 0,
      unique_opportunities: 0,
    },
  ];
  const leadRows = [
    {
      id: `lead-${campaignId}`,
      email: `${campaignId}-reply@example.com`,
      first_name: "Riley",
      last_name: "Reply",
      company_name: "Reply Co",
      company_domain: "reply.test",
      status: "active",
      email_reply_count: 1,
      lt_interest_status: 1,
      email_replied_step: 0,
      email_replied_variant: 0,
      timestamp_last_reply: "2026-05-03T20:00:00Z",
      payload: { campaign: campaignId, firstName: "Riley" },
    },
  ];
  instantly.listAllLeads = async () => leadRows;
  instantly.listAllLeadsWithCoverage = async () => ({
    items: leadRows,
    ...leadCoverage,
  });
  instantly.listLeadsPage = async () => ({
    items: leadRows,
    nextCursor: null,
  });
}

async function openDb() {
  return getDb({ timeoutMs: 1_000, retryMs: 25 });
}

function providerScopedFingerprint(provider, value) {
  return createHash("sha256").update(`${provider}:${value}`, "utf8").digest("hex");
}

async function pathExists(filePath) {
  return fs.stat(filePath).then(() => true).catch(() => false);
}

async function seedLegacyAccountPrimaryKeyCache(filePath) {
  const instance = await DuckDBInstance.create(filePath);
  const conn = await instance.connect();
  try {
    await conn.run("CREATE SCHEMA IF NOT EXISTS sendlens");
    await conn.run(
      `CREATE TABLE sendlens.plugin_state (
        key VARCHAR PRIMARY KEY,
        value VARCHAR,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
    );
    await conn.run(
      `CREATE TABLE sendlens.accounts (
        workspace_id VARCHAR NOT NULL,
        email VARCHAR NOT NULL,
        organization_id VARCHAR,
        status VARCHAR,
        warmup_status VARCHAR,
        warmup_score DOUBLE,
        provider VARCHAR,
        daily_limit INTEGER,
        sending_gap INTEGER,
        first_name VARCHAR,
        last_name VARCHAR,
        total_sent_30d INTEGER,
        total_replies_30d INTEGER,
        total_bounces_30d INTEGER,
        synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (workspace_id, email)
      )`,
    );
    await conn.run(
      `CREATE TABLE sendlens.account_daily_metrics (
        workspace_id VARCHAR NOT NULL,
        email VARCHAR NOT NULL,
        date DATE NOT NULL,
        sent INTEGER,
        bounced INTEGER,
        contacted INTEGER,
        new_leads_contacted INTEGER,
        opened INTEGER,
        unique_opened INTEGER,
        replies INTEGER,
        unique_replies INTEGER,
        replies_automatic INTEGER,
        unique_replies_automatic INTEGER,
        clicks INTEGER,
        unique_clicks INTEGER,
        synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (workspace_id, email, date)
      )`,
    );
    await conn.run(
      `INSERT INTO sendlens.accounts (
        workspace_id,
        email,
        organization_id,
        status,
        provider,
        total_sent_30d,
        total_replies_30d,
        total_bounces_30d
      )
      VALUES ('legacy_ws', 'shared@example.com', 'legacy_ws', 'active', 'gmail', 11, 2, 1)`,
    );
    await conn.run(
      `INSERT INTO sendlens.account_daily_metrics (
        workspace_id,
        email,
        date,
        sent,
        bounced,
        contacted,
        new_leads_contacted,
        opened,
        unique_opened,
        replies,
        unique_replies,
        clicks,
        unique_clicks
      )
      VALUES ('legacy_ws', 'shared@example.com', DATE '2026-06-01', 11, 1, 11, 11, 4, 4, 2, 2, 1, 1)`,
    );
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

try {
  process.env.SENDLENS_INSTANTLY_API_KEY = "old-key-secret";
  let db = await openDb();
  try {
    await run(
      db,
      `INSERT OR REPLACE INTO sendlens.campaigns
       (workspace_id, id, organization_id, name, status, synced_at)
       VALUES ('ws_old', 'old-campaign', 'ws_old', 'Old Campaign', 'active', CURRENT_TIMESTAMP)`,
    );
    await setActiveWorkspaceId(db, "ws_old");
    await stampCacheOwner(db, "ws_old", "2026-05-01T00:00:00.000Z");
  } finally {
    closeDb(db);
  }

  db = await openDb();
  try {
    const readiness = await assertCacheReadableForCurrentEnv(db);
    assert.equal(readiness.owner.workspaceId, "ws_old");
  } finally {
    closeDb(db);
  }

  process.env.SENDLENS_CLIENT = "sendoso";
  await fs.mkdir(path.join(tempDir, ".env.clients"), { recursive: true });
  await fs.writeFile(
    path.join(tempDir, ".env.clients", "sendoso.env"),
    "SENDLENS_INSTANTLY_API_KEY=sendoso-client-key-secret\n",
  );
  db = await openDb();
  try {
    await assert.rejects(
      assertCacheReadableForCurrentEnv(db),
      (error) =>
        error instanceof CacheReadinessError &&
        error.issue === "client_env_mismatch" &&
        error.selectedClientEnv?.client === "sendoso" &&
        !String(error.message).includes("sendoso-client-key-secret") &&
        !String(error.message).includes("old-key-secret"),
    );
  } finally {
    closeDb(db);
  }
  await assert.rejects(
    refreshWorkspaceAtomically({ source: "manual" }),
    (error) => error instanceof CacheReadinessError && error.issue === "client_env_mismatch",
  );
  delete process.env.SENDLENS_CLIENT;

  installFailingRefresh();
  await assert.rejects(
    refreshWorkspaceAtomically({ source: "manual" }),
    /Instantly API 500: test failure/,
  );
  assert.equal(
    await pathExists(path.join(tempDir, ".workspace-cache.duckdb.refreshing")),
    false,
    "failed atomic refreshes must remove the shadow DuckDB",
  );
  assert.equal(
    await pathExists(path.join(tempDir, ".workspace-cache.duckdb.refreshing.wal")),
    false,
    "failed atomic refreshes must remove the shadow DuckDB WAL",
  );
  db = await openDb();
  try {
    const readiness = await assertCacheReadableForCurrentEnv(db);
    assert.equal(readiness.owner.workspaceId, "ws_old");
  } finally {
    closeDb(db);
  }

  process.env.SENDLENS_INSTANTLY_API_KEY = "new-key-secret";
  db = await openDb();
  try {
    await assert.rejects(
      assertCacheReadableForCurrentEnv(db),
      (error) =>
        error instanceof CacheReadinessError &&
        error.issue === "api_key_mismatch" &&
        !String(error.message).includes("new-key-secret") &&
        !String(error.message).includes("old-key-secret"),
    );
  } finally {
    closeDb(db);
  }

  installFailingRefresh();
  await assert.rejects(
    refreshWorkspaceAtomically({ source: "manual" }),
    /Instantly API 500: test failure/,
  );
  db = await openDb();
  try {
    await assert.rejects(
      assertCacheReadableForCurrentEnv(db),
      (error) => error instanceof CacheReadinessError && error.issue === "api_key_mismatch",
    );
  } finally {
    closeDb(db);
  }

  await fs.writeFile(
    `${dbPath}.wal`,
    "stale WAL from a previous cache identity must not survive promotion",
  );
  db = await openDb();
  try {
    await run(
      db,
      `INSERT OR REPLACE INTO sendlens.campaigns (id, workspace_id, name, status)
       VALUES ('deleted-upstream-campaign', 'ws_new', 'Deleted upstream', 'paused')`,
    );
  } finally {
    closeDb(db);
  }
  installSuccessfulRefresh("ws_new", "new-campaign", "New Campaign");
  const refreshed = await refreshWorkspaceAtomically({ source: "manual" });
  assert.equal(refreshed.workspaceId, "ws_new");
  assert.equal(await pathExists(`${dbPath}.wal`), false);
  db = await openDb();
  try {
    const owner = await getCacheOwnerMetadata(db);
    assert.equal(owner.workspaceId, "ws_new");
    assert.equal(owner.apiKeyFingerprint, currentApiKeyFingerprint());
    assert.notEqual(owner.apiKeyFingerprint, "new-key-secret");
    const rows = await query(
      db,
      `SELECT key, value FROM sendlens.plugin_state ORDER BY key`,
    );
    const serializedState = JSON.stringify(rows);
    assert.equal(serializedState.includes("new-key-secret"), false);
    assert.equal(serializedState.includes("old-key-secret"), false);
    const status = await readRefreshStatus();
    assert.equal(JSON.stringify(status).includes("new-key-secret"), false);
    assert.equal(JSON.stringify(status).includes("old-key-secret"), false);
    const summaryRows = await query(
      db,
      `SELECT campaign_id, campaign_name
       FROM sendlens.campaign_overview
       WHERE workspace_id = 'ws_new'
       ORDER BY campaign_id`,
    );
    assert.equal(summaryRows.length, 1, "unscoped refresh must remove stale/deleted campaigns");
    assert.equal(summaryRows[0].campaign_id, "new-campaign");
    assert.equal(summaryRows[0].campaign_name, "New Campaign");
    const accountRows = await query(
      db,
      `SELECT provider, warmup_score
       FROM sendlens.accounts
       WHERE workspace_id = 'ws_new'`,
    );
    assert.equal(accountRows[0].provider, "2");
    assert.equal(Number(accountRows[0].warmup_score), 88);
  } finally {
    closeDb(db);
  }

  installSuccessfulRefresh(
    "ws_new",
    "new-campaign",
    "New Campaign",
    3,
    1,
    { exhausted: true, terminationReason: "cursor_exhausted", pagesFetched: 1 },
    0,
  );
  const inactiveOnlyRefresh = await refreshWorkspaceAtomically({ source: "manual" });
  assert.equal(inactiveOnlyRefresh.workspaceId, "ws_new");
  db = await openDb();
  try {
    const inactiveCampaigns = await query(
      db,
      `SELECT id, status FROM sendlens.campaigns WHERE workspace_id = 'ws_new'`,
    );
    assert.deepEqual(inactiveCampaigns, [{ id: "new-campaign", status: "completed" }]);
    const [{ sampled_rows: sampledRows }] = await query(
      db,
      `SELECT COUNT(*) AS sampled_rows FROM sendlens.sampled_leads WHERE workspace_id = 'ws_new'`,
    );
    assert.equal(Number(sampledRows), 0, "inactive campaign detail must not survive a full refresh");
  } finally {
    closeDb(db);
  }

  installSuccessfulRefresh(
    "ws_new",
    "new-campaign",
    "New Campaign",
    1,
    0,
    { exhausted: false, terminationReason: "max_pages", pagesFetched: 50 },
  );
  await refreshWorkspaceAtomically({ source: "manual" });
  db = await openDb();
  try {
    const [coverage] = await query(
      db,
      `SELECT ingest_mode, lead_cursor_exhausted, lead_termination_reason
       FROM sendlens.sampling_runs
       WHERE workspace_id = 'ws_new' AND campaign_id = 'new-campaign'`,
    );
    assert.equal(coverage.ingest_mode, "hybrid");
    assert.equal(coverage.lead_cursor_exhausted, false);
    assert.equal(coverage.lead_termination_reason, "max_pages");
  } finally {
    closeDb(db);
  }

  db = await openDb();
  try {
    await setPluginState(db, "cache_schema_version", "sendlens.cache.future");
    await assert.rejects(
      assertCacheReadableForCurrentEnv(db),
      (error) => error instanceof CacheReadinessError && error.issue === "schema_mismatch",
    );
  } finally {
    closeDb(db);
  }

  installSuccessfulRefresh("ws_schema", "schema-campaign", "Schema Campaign");
  const schemaRefreshed = await refreshWorkspaceAtomically({ source: "manual" });
  assert.equal(schemaRefreshed.workspaceId, "ws_schema");
  db = await openDb();
  try {
    const owner = await getCacheOwnerMetadata(db);
    assert.equal(owner.workspaceId, "ws_schema");
    assert.equal(owner.schemaVersion, CURRENT_CACHE_SCHEMA_VERSION);
    await assertCacheReadableForCurrentEnv(db);
  } finally {
    closeDb(db);
  }

  installSuccessfulRefresh("ws_qualified", "qualified-campaign", "Qualified Campaign");
  instantly.listAccounts = async () => {
    throw new Error("Campaign-scoped refresh must not load workspace account metadata.");
  };
  const qualifiedInstantlyRefresh = await refreshWorkspaceAtomically({
    provider: "instantly",
    source: "manual",
    campaignIds: ["instantly:qualified-campaign"],
  });
  assert.equal(qualifiedInstantlyRefresh.workspaceId, "ws_qualified");

  delete process.env.SENDLENS_INSTANTLY_API_KEY;
  db = await openDb();
  try {
    const readiness = await assertCacheReadableForCurrentEnv(db);
    assert.match(String(readiness.warning), /No SendLens provider API key/);
  } finally {
    closeDb(db);
  }

  process.env.SENDLENS_PROVIDER = "smartlead";
  process.env.SENDLENS_SMARTLEAD_API_KEY = "smartlead-old-secret";
  process.env.SENDLENS_DB_PATH = path.join(tempDir, "smartlead-cache-owner.duckdb");
  db = await openDb();
  try {
    await stampCacheOwner(db, "smartlead_ws", "2026-06-01T00:00:00.000Z");
    const owner = await getCacheOwnerMetadata(db);
    assert.equal(owner.apiKeyFingerprint, currentApiKeyFingerprint());
    assert.notEqual(owner.apiKeyFingerprint, "smartlead-old-secret");
  } finally {
    closeDb(db);
  }

  process.env.SENDLENS_SMARTLEAD_API_KEY = "smartlead-new-secret";
  db = await openDb();
  try {
    await assert.rejects(
      assertCacheReadableForCurrentEnv(db),
      (error) =>
        error instanceof CacheReadinessError &&
        error.issue === "api_key_mismatch" &&
        !String(error.message).includes("smartlead-old-secret") &&
        !String(error.message).includes("smartlead-new-secret"),
    );
  } finally {
    closeDb(db);
  }
  delete process.env.SENDLENS_PROVIDER;

  process.env.SENDLENS_SMARTLEAD_API_KEY = "smartlead-override-secret";
  process.env.SENDLENS_DB_PATH = path.join(tempDir, "smartlead-provider-override.duckdb");
  const smartleadProviderCalls = [];
  const smartleadRequestedCampaignIds = [];
  function recordSmartleadProviderCall(method, campaignId = null) {
    smartleadProviderCalls.push({
      method,
      campaignId: campaignId == null ? null : String(campaignId),
    });
  }
  function resetSmartleadProviderTracking() {
    smartleadProviderCalls.length = 0;
    smartleadRequestedCampaignIds.length = 0;
  }
  function assertSmartleadCampaignId(method, campaignId) {
    const normalizedCampaignId = String(campaignId);
    assert.equal(normalizedCampaignId, "901");
    recordSmartleadProviderCall(method, normalizedCampaignId);
    smartleadRequestedCampaignIds.push(normalizedCampaignId);
  }
  const smartleadProviderOverrideClient = {
    async listCampaigns() {
      recordSmartleadProviderCall("listCampaigns");
      return [
        {
          id: "901",
          name: "Provider Override Campaign",
          status: "active",
          user_id: "smartlead_override_ws",
        },
      ];
    },
    async getCampaign(campaignId) {
      assertSmartleadCampaignId("getCampaign", campaignId);
      return {
        id: "901",
        name: "Provider Override Campaign",
        status: "active",
        user_id: "smartlead_override_ws",
      };
    },
    async getCampaignSequences(campaignId) {
      assertSmartleadCampaignId("getCampaignSequences", campaignId);
      return [];
    },
    async getCampaignAnalytics(campaignId) {
      assertSmartleadCampaignId("getCampaignAnalytics", campaignId);
      return { campaign_id: "901" };
    },
    async getCampaignAnalyticsByDate(campaignId) {
      assertSmartleadCampaignId("getCampaignAnalyticsByDate", campaignId);
      return [];
    },
    async listAllCampaignStatistics(campaignId) {
      assertSmartleadCampaignId("listAllCampaignStatistics", campaignId);
      return [];
    },
    async listCampaignEmailAccounts(campaignId) {
      assertSmartleadCampaignId("listCampaignEmailAccounts", campaignId);
      return [];
    },
    async listAllCampaignLeads(campaignId) {
      assertSmartleadCampaignId("listAllCampaignLeads", campaignId);
      return [];
    },
    async listAllCampaignMailboxStatistics(campaignId) {
      assertSmartleadCampaignId("listAllCampaignMailboxStatistics", campaignId);
      return [];
    },
    async listAllEmailAccounts() {
      recordSmartleadProviderCall("listAllEmailAccounts");
      return [];
    },
    async getEmailAccountWarmupStats() {
      recordSmartleadProviderCall("getEmailAccountWarmupStats");
      return {};
    },
  };

  process.env.SENDLENS_CLIENT = "sendoso";
  process.env.SENDLENS_SMARTLEAD_API_KEY = "stale-smartlead-client-env-secret";
  process.env.SENDLENS_DB_PATH = path.join(tempDir, "smartlead-provider-override-stale-client.duckdb");
  await fs.writeFile(
    path.join(tempDir, ".env.clients", "sendoso.env"),
    "SENDLENS_SMARTLEAD_API_KEY=selected-smartlead-client-env-secret\n",
  );
  await assert.rejects(
    refreshWorkspaceAtomically({
      provider: "smartlead",
      source: "manual",
      campaignIds: ["901"],
      client: smartleadProviderOverrideClient,
    }),
    (error) =>
      error instanceof CacheReadinessError &&
      error.issue === "client_env_mismatch" &&
      error.selectedClientEnv?.apiKeyFingerprint ===
        providerScopedFingerprint("smartlead", "selected-smartlead-client-env-secret") &&
      !String(error.message).includes("stale-smartlead-client-env-secret") &&
      !String(error.message).includes("selected-smartlead-client-env-secret"),
  );
  assert.equal(smartleadProviderCalls.length, 0);
  process.env.SENDLENS_SMARTLEAD_API_KEY = "smartlead-override-secret";
  delete process.env.SENDLENS_CLIENT;
  process.env.SENDLENS_DB_PATH = path.join(tempDir, "smartlead-provider-override.duckdb");

  const smartleadOverrideRefresh = await refreshWorkspaceAtomically({
    provider: "smartlead",
    source: "manual",
    campaignIds: ["901"],
    client: smartleadProviderOverrideClient,
  });
  assert.equal(smartleadOverrideRefresh.workspaceId, "smartlead_override_ws");
  assert.deepEqual([...new Set(smartleadRequestedCampaignIds)], ["901"]);
  assert(smartleadProviderCalls.length > 0);
  resetSmartleadProviderTracking();
  db = await openDb();
  try {
    const owner = await getCacheOwnerMetadata(db);
    assert.equal(
      owner.apiKeyFingerprint,
      providerScopedFingerprint("smartlead", "smartlead-override-secret"),
    );
    assert.equal(
      currentApiKeyFingerprint(),
      providerScopedFingerprint("smartlead", "smartlead-override-secret"),
    );

    process.env.SENDLENS_SMARTLEAD_API_KEY = "smartlead-override-new-secret";
    await assert.rejects(
      withCacheProviderMode("smartlead", () => assertCacheReadableForCurrentEnv(db)),
      (error) =>
        error instanceof CacheReadinessError &&
        error.issue === "api_key_mismatch" &&
        !String(error.message).includes("smartlead-override-secret") &&
        !String(error.message).includes("smartlead-override-new-secret"),
    );
  } finally {
    closeDb(db);
  }

  process.env.SENDLENS_INSTANTLY_API_KEY = "instantly-all-secret";
  process.env.SENDLENS_SMARTLEAD_API_KEY = "smartlead-all-secret";
  process.env.SENDLENS_CLIENT = "all_scoped_ws";
  process.env.SENDLENS_DB_PATH = path.join(tempDir, "all-provider-smartlead-scope.duckdb");
  instantly.listCampaigns = async () => {
    throw new Error("Instantly scoped refresh should be skipped");
  };
  const allProviderScopedRefresh = await refreshWorkspaceAtomically({
    provider: "all",
    source: "manual",
    campaignIds: ["smartlead: 901"],
    client: smartleadProviderOverrideClient,
  });
  assert.equal(allProviderScopedRefresh.workspaceId, "all_scoped_ws");
  assert.deepEqual([...new Set(smartleadRequestedCampaignIds)], ["901"]);
  assert(smartleadProviderCalls.some((call) => call.method === "listCampaigns"));
  resetSmartleadProviderTracking();

  installSuccessfulRefresh("all_scoped_ws", "instantly-only", "Instantly Only");
  process.env.SENDLENS_DB_PATH = path.join(tempDir, "all-provider-unqualified-smartlead-scope.duckdb");
  const allProviderUnqualifiedSmartleadRefresh = await refreshWorkspaceAtomically({
    provider: "all",
    source: "manual",
    campaignIds: ["901"],
    client: smartleadProviderOverrideClient,
  });
  assert.equal(allProviderUnqualifiedSmartleadRefresh.workspaceId, "all_scoped_ws");
  assert.deepEqual([...new Set(smartleadRequestedCampaignIds)], ["901"]);
  assert(smartleadProviderCalls.some((call) => call.method === "listCampaigns"));
  resetSmartleadProviderTracking();

  process.env.SENDLENS_DB_PATH = path.join(tempDir, "all-provider-qualified-instantly-compact-scope.duckdb");
  const allProviderQualifiedInstantlyCompactRefresh = await refreshWorkspaceAtomically({
    provider: "all",
    source: "manual",
    campaignIds: ["instantly:instantly-only"],
    client: smartleadProviderOverrideClient,
  });
  assert.equal(allProviderQualifiedInstantlyCompactRefresh.workspaceId, "all_scoped_ws");
  assert.deepEqual(smartleadProviderCalls, []);
  assert.deepEqual(smartleadRequestedCampaignIds, []);
  resetSmartleadProviderTracking();

  process.env.SENDLENS_DB_PATH = path.join(tempDir, "all-provider-qualified-instantly-whitespace-scope.duckdb");
  const allProviderQualifiedInstantlyWhitespaceRefresh = await refreshWorkspaceAtomically({
    provider: "all",
    source: "manual",
    campaignIds: ["instantly: instantly-only"],
    client: smartleadProviderOverrideClient,
  });
  assert.equal(allProviderQualifiedInstantlyWhitespaceRefresh.workspaceId, "all_scoped_ws");
  assert.deepEqual(smartleadProviderCalls, []);
  assert.deepEqual(smartleadRequestedCampaignIds, []);

  process.env.SENDLENS_DB_PATH = path.join(tempDir, "all-provider-unqualified-instantly-scope.duckdb");
  const allProviderUnqualifiedInstantlyRefresh = await refreshWorkspaceAtomically({
    provider: "all",
    source: "manual",
    campaignIds: ["instantly-only"],
    client: smartleadProviderOverrideClient,
  });
  assert.equal(allProviderUnqualifiedInstantlyRefresh.workspaceId, "all_scoped_ws");
  assert.deepEqual(smartleadProviderCalls, [{ method: "listCampaigns", campaignId: null }]);
  assert.deepEqual(smartleadRequestedCampaignIds, []);
  const allProviderPartialStatus = await readRefreshStatus();
  assert.equal(allProviderPartialStatus.status, "succeeded");
  assert.equal(allProviderPartialStatus.lastRefreshScope, "campaign");
  assert.equal(allProviderPartialStatus.refreshScope.type, "campaign");
  assert.equal(allProviderPartialStatus.refreshScope.provider, "all");
  assert.equal(allProviderPartialStatus.refreshScope.workspaceFreshness, "scoped");
  assert.match(
    allProviderPartialStatus.message,
    /scoped lookup missed smartlead/,
  );
  assert.deepEqual(
    allProviderPartialStatus.partialFailures?.map((failure) => ({
      provider: failure.provider,
      type: failure.refreshScope.type,
      workspaceFreshness: failure.refreshScope.workspaceFreshness,
      message: failure.message,
    })),
    [
      {
        provider: "smartlead",
        type: "failed_scoped_lookup",
        workspaceFreshness: "unknown",
        message: "No Smartlead campaigns matched the requested refresh scope.",
      },
    ],
  );
  resetSmartleadProviderTracking();

  process.env.SENDLENS_DB_PATH = path.join(tempDir, "all-provider-explicit-smartlead-miss.duckdb");
  await assert.rejects(
    refreshWorkspaceAtomically({
      provider: "all",
      source: "manual",
      campaignIds: ["instantly:instantly-only", "smartlead:typo"],
      client: smartleadProviderOverrideClient,
    }),
    /No Smartlead campaigns matched the requested refresh scope/,
  );
  assert.deepEqual(smartleadProviderCalls, [{ method: "listCampaigns", campaignId: null }]);
  assert.deepEqual(smartleadRequestedCampaignIds, []);
  delete process.env.SENDLENS_INSTANTLY_API_KEY;
  delete process.env.SENDLENS_CLIENT;
  delete process.env.SENDLENS_SMARTLEAD_API_KEY;

  const legacyAccountPkDbPath = path.join(tempDir, "legacy-account-pk.duckdb");
  await seedLegacyAccountPrimaryKeyCache(legacyAccountPkDbPath);
  process.env.SENDLENS_DB_PATH = legacyAccountPkDbPath;
  db = await openDb();
  try {
    const accountPk = await query(
      db,
      `SELECT name
       FROM pragma_table_info('sendlens.accounts')
       WHERE pk > 0
       ORDER BY pk`,
    );
    assert.deepEqual(
      accountPk.map((row) => row.name).sort(),
      ["email", "source_provider", "workspace_id"],
    );

    const accountDailyPk = await query(
      db,
      `SELECT name
       FROM pragma_table_info('sendlens.account_daily_metrics')
       WHERE pk > 0
       ORDER BY pk`,
    );
    assert.deepEqual(
      accountDailyPk.map((row) => row.name).sort(),
      ["date", "email", "source_provider", "workspace_id"],
    );

    await run(
      db,
      `INSERT OR REPLACE INTO sendlens.accounts (
        workspace_id,
        email,
        source_provider,
        provider_account_id,
        account_source_id,
        organization_id,
        status,
        provider,
        total_sent_30d,
        total_replies_30d,
        total_bounces_30d
      )
      VALUES (
        'legacy_ws',
        'shared@example.com',
        'smartlead',
        '301',
        'smartlead:301',
        'legacy_ws',
        'active',
        'smtp',
        7,
        3,
        0
      )`,
    );
    await run(
      db,
      `INSERT OR REPLACE INTO sendlens.account_daily_metrics (
        workspace_id,
        email,
        source_provider,
        provider_account_id,
        account_source_id,
        date,
        sent,
        bounced,
        contacted,
        new_leads_contacted,
        opened,
        unique_opened,
        replies,
        unique_replies,
        clicks,
        unique_clicks
      )
      VALUES (
        'legacy_ws',
        'shared@example.com',
        'smartlead',
        '301',
        'smartlead:301',
        DATE '2026-06-01',
        7,
        0,
        7,
        7,
        3,
        3,
        3,
        3,
        1,
        1
      )`,
    );

    const accountRows = await query(
      db,
      `SELECT source_provider, total_sent_30d, total_replies_30d
       FROM sendlens.accounts
       WHERE workspace_id = 'legacy_ws' AND email = 'shared@example.com'
       ORDER BY source_provider`,
    );
    assert.deepEqual(
      accountRows.map((row) => ({
        source_provider: row.source_provider,
        total_sent_30d: Number(row.total_sent_30d),
        total_replies_30d: Number(row.total_replies_30d),
      })),
      [
        { source_provider: "instantly", total_sent_30d: 11, total_replies_30d: 2 },
        { source_provider: "smartlead", total_sent_30d: 7, total_replies_30d: 3 },
      ],
    );

    const accountDailyRows = await query(
      db,
      `SELECT source_provider, sent, unique_replies
       FROM sendlens.account_daily_metrics
       WHERE workspace_id = 'legacy_ws'
         AND email = 'shared@example.com'
         AND date = DATE '2026-06-01'
       ORDER BY source_provider`,
    );
    assert.deepEqual(
      accountDailyRows.map((row) => ({
        source_provider: row.source_provider,
        sent: Number(row.sent),
        unique_replies: Number(row.unique_replies),
      })),
      [
        { source_provider: "instantly", sent: 11, unique_replies: 2 },
        { source_provider: "smartlead", sent: 7, unique_replies: 3 },
      ],
    );
  } finally {
    closeDb(db);
  }
} finally {
  for (const [key, value] of Object.entries(originals)) {
    instantly[key] = value;
  }
  delete process.env.SENDLENS_INSTANTLY_API_KEY;
  delete process.env.SENDLENS_SMARTLEAD_API_KEY;
  delete process.env.SENDLENS_PROVIDER;
  delete process.env.SENDLENS_DB_PATH;
  delete process.env.SENDLENS_STATE_DIR;
  delete process.env.SENDLENS_CONTEXT_ROOT;
}

console.log("cache identity tests passed");
