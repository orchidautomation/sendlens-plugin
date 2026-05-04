import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const instantly = require("../build/plugin/instantly-client.js");
const {
  closeDb,
  getDb,
  query,
  run,
  setActiveWorkspaceId,
} = require("../build/plugin/local-db.js");
const { hydrateReplyText } = require("../build/plugin/instantly-ingest.js");

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sendlens-hydrate-"));
process.env.SENDLENS_DB_PATH = path.join(tempDir, "workspace-cache.duckdb");
process.env.SENDLENS_INSTANTLY_API_KEY = "test-key";

const originalListEmails = instantly.listEmails;
let listEmailsCalls = 0;
let nextCursorForCall = "older-cursor";
instantly.listEmails = async () => {
  listEmailsCalls += 1;
  return {
    nextCursor: nextCursorForCall,
    items: [
      {
        id: "reply-1",
        thread_id: "thread-1",
        lead: "lead-uuid-not-email",
        from_address_email: "reply@example.com",
        to_address_email_list: ["sender@example.com"],
        subject: "Re: Hello",
        body: { text: "This is the hydrated reply body." },
        timestamp_email: "2026-05-03T20:00:00Z",
        is_auto_reply: false,
        ai_interest_value: 0.9,
        i_status: 1,
        content_preview: "This is the hydrated reply body.",
      },
    ],
  };
};

const db = await getDb({ timeoutMs: 1_000, retryMs: 25 });
try {
  await setActiveWorkspaceId(db, "ws_hydrate");
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.campaigns
     (workspace_id, id, name, status, synced_at)
     VALUES ('ws_hydrate', 'c_hydrate', 'Hydrate Fixture', 'active', CURRENT_TIMESTAMP)`,
  );
  await run(
    db,
    `INSERT OR REPLACE INTO sendlens.sampled_leads
     (workspace_id, campaign_id, id, email, first_name, last_name, company_name, company_domain, status, email_reply_count, lt_interest_status, email_replied_step, email_replied_variant, timestamp_last_reply, job_title, custom_payload, sample_source, sampled_at)
     VALUES ('ws_hydrate', 'c_hydrate', 'lead-1', 'reply@example.com', 'Riley', 'Reply', 'Reply Co', 'reply.test', 'active', 1, 1, 0, 0, TIMESTAMP '2026-05-03 20:00:00', 'Director', '{}', 'reply_full', CURRENT_TIMESTAMP)`,
  );

  const hydration = await hydrateReplyText({
    workspaceId: "ws_hydrate",
    campaignId: "c_hydrate",
    statuses: [1],
    maxPagesPerStatus: 1,
    latestOfThread: true,
    mode: "restart",
    db,
  });

  assert.equal(hydration.total_stored, 1);
  assert.equal(hydration.total_inserted_new, 1);
  assert.equal(hydration.total_updated_existing, 0);
  const rows = await query(
    db,
    `SELECT reply_email_id, reply_body_text
     FROM sendlens.reply_context
     WHERE workspace_id = 'ws_hydrate'
       AND campaign_id = 'c_hydrate'
       AND lead_email = 'reply@example.com'`,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reply_email_id, "reply-1");
  assert.equal(rows[0].reply_body_text, "This is the hydrated reply body.");
  const stateAfterRestart = await query(
    db,
    `SELECT next_starting_after, pages_hydrated, emails_hydrated, exhausted
     FROM sendlens.reply_email_hydration_state
     WHERE workspace_id = 'ws_hydrate'
       AND campaign_id = 'c_hydrate'
       AND i_status = 1`,
  );
  assert.equal(stateAfterRestart.length, 1);
  assert.equal(stateAfterRestart[0].next_starting_after, "older-cursor");
  assert.equal(Number(stateAfterRestart[0].pages_hydrated), 1);
  assert.equal(Number(stateAfterRestart[0].emails_hydrated), 1);

  listEmailsCalls = 0;
  nextCursorForCall = "newest-page-cursor";
  const syncNewest = await hydrateReplyText({
    workspaceId: "ws_hydrate",
    campaignId: "c_hydrate",
    statuses: [1],
    maxPagesPerStatus: 3,
    latestOfThread: true,
    mode: "sync_newest",
    db,
  });
  assert.equal(listEmailsCalls, 1);
  assert.equal(syncNewest.total_stored, 1);
  assert.equal(syncNewest.total_inserted_new, 0);
  assert.equal(syncNewest.total_updated_existing, 1);
  assert.equal(syncNewest.status_results[0].next_starting_after, "newest-page-cursor");
  assert.equal(syncNewest.status_results[0].saved_next_starting_after, "older-cursor");
  const stateAfterSyncNewest = await query(
    db,
    `SELECT next_starting_after, pages_hydrated, emails_hydrated, exhausted
     FROM sendlens.reply_email_hydration_state
     WHERE workspace_id = 'ws_hydrate'
       AND campaign_id = 'c_hydrate'
       AND i_status = 1`,
  );
  assert.equal(stateAfterSyncNewest.length, 1);
  assert.equal(stateAfterSyncNewest[0].next_starting_after, "older-cursor");
  assert.equal(Number(stateAfterSyncNewest[0].pages_hydrated), 1);
  assert.equal(Number(stateAfterSyncNewest[0].emails_hydrated), 1);
} finally {
  instantly.listEmails = originalListEmails;
  closeDb(db);
}

console.log("reply hydration DB reuse tests passed");
