import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sendlens-scoped-miss-"));
const liveDbPath = path.join(testRoot, "cache.duckdb");
const shadowDbPath = path.join(testRoot, ".cache.duckdb.refreshing");

process.env.SENDLENS_DB_PATH = liveDbPath;
process.env.SENDLENS_STATE_DIR = testRoot;
process.env.SENDLENS_INSTANTLY_API_KEY = "test-key";
process.env.SENDLENS_PROVIDER = "instantly";

const instantlyClient = require("../build/plugin/instantly-client.js");
instantlyClient.listCampaigns = async () => [
  { id: "real-campaign", name: "Real Campaign", status: 1 },
];

const {
  resetDbConnectionForTests,
} = require("../build/plugin/local-db.js");
const {
  readRefreshStatus,
  writeRefreshStatus,
} = require("../build/plugin/refresh-status.js");
const {
  refreshWorkspaceAtomically,
} = require("../build/plugin/instantly-ingest.js");

await resetDbConnectionForTests();

const previousStatus = await writeRefreshStatus({
  status: "succeeded",
  source: "manual",
  workspaceId: "ws_previous",
  startedAt: "2026-07-07T10:00:00.000Z",
  endedAt: "2026-07-07T10:01:00.000Z",
  lastSuccessAt: "2026-07-07T10:01:00.000Z",
  campaignsTotal: 12,
  campaignsProcessed: 12,
  currentCampaignId: null,
  currentCampaignName: null,
  message: "Previous refresh succeeded.",
});

await assert.rejects(
  refreshWorkspaceAtomically({
    campaignIds: ["not-a-real-campaign-id"],
    source: "manual",
    provider: "instantly",
  }),
  /No campaigns matched the requested refresh scope\./,
);

const status = await readRefreshStatus();
assert.equal(status.status, previousStatus.status);
assert.equal(status.workspaceId, previousStatus.workspaceId);
assert.equal(status.lastSuccessAt, previousStatus.lastSuccessAt);
assert.equal(status.campaignsTotal, previousStatus.campaignsTotal);
assert.equal(status.campaignsProcessed, previousStatus.campaignsProcessed);
assert.equal(status.message, previousStatus.message);

await assert.rejects(fs.stat(shadowDbPath), /ENOENT/);
await assert.rejects(fs.stat(`${shadowDbPath}.wal`), /ENOENT/);

await resetDbConnectionForTests();
await fs.rm(testRoot, { recursive: true, force: true });

console.log("Scoped refresh miss status regression passed.");
