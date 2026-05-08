import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const instantly = require("../build/plugin/instantly-client.js");
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
  "listLeadsPage",
]) {
  originals[key] = instantly[key];
}

function installFailingRefresh(message = "Instantly API 500: test failure") {
  instantly.listCampaigns = async () => {
    throw new Error(message);
  };
}

function installSuccessfulRefresh(workspaceId, campaignId, campaignName) {
  instantly.listCampaigns = async () => [
    {
      id: campaignId,
      organization_id: workspaceId,
      name: campaignName,
      status: 1,
      daily_limit: 25,
      timestamp_created: "2026-05-01T00:00:00Z",
      timestamp_updated: "2026-05-02T00:00:00Z",
    },
  ];
  instantly.getCampaignAnalytics = async () => [
    {
      campaign_id: campaignId,
      campaign_name: campaignName,
      leads_count: 1,
      contacted_count: 1,
      emails_sent_count: 10,
      reply_count_unique: 1,
      reply_count_automatic: 0,
      bounced_count: 0,
      total_opportunities: 0,
      total_opportunity_value: 0,
    },
  ];
  instantly.listAccounts = async () => [
    {
      email: `${campaignId}@example.com`,
      organization_id: workspaceId,
      status: 1,
      daily_limit: 25,
    },
  ];
  instantly.getDailyAccountAnalytics = async () => [];
  instantly.getWarmupAnalytics = async () => ({ aggregate_data: {} });
  instantly.listAllCustomTags = async () => [];
  instantly.listAllCustomTagMappings = async () => [];
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
  instantly.listLeadsPage = async () => ({
    items: [
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
    ],
    nextCursor: null,
  });
}

async function openDb() {
  return getDb({ timeoutMs: 1_000, retryMs: 25 });
}

async function pathExists(filePath) {
  return fs.stat(filePath).then(() => true).catch(() => false);
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

  installFailingRefresh();
  await assert.rejects(
    refreshWorkspaceAtomically({ source: "manual" }),
    /Instantly API 500: test failure/,
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
      `SELECT campaign_name FROM sendlens.campaign_overview WHERE workspace_id = 'ws_new'`,
    );
    assert.equal(summaryRows[0].campaign_name, "New Campaign");
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
    assert.equal(owner.schemaVersion, "sendlens.cache.v1");
    await assertCacheReadableForCurrentEnv(db);
  } finally {
    closeDb(db);
  }

  delete process.env.SENDLENS_INSTANTLY_API_KEY;
  db = await openDb();
  try {
    const readiness = await assertCacheReadableForCurrentEnv(db);
    assert.match(String(readiness.warning), /No SENDLENS_INSTANTLY_API_KEY/);
  } finally {
    closeDb(db);
  }
} finally {
  for (const [key, value] of Object.entries(originals)) {
    instantly[key] = value;
  }
  delete process.env.SENDLENS_INSTANTLY_API_KEY;
  delete process.env.SENDLENS_DB_PATH;
  delete process.env.SENDLENS_STATE_DIR;
  delete process.env.SENDLENS_CONTEXT_ROOT;
}

console.log("cache identity tests passed");
