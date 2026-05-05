import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { toReplyTextFetchResult } = require("../build/plugin/reply-text-contract.js");

const fetchResult = toReplyTextFetchResult({
  schema_version: "reply_text_hydration.v1",
  workspace_id: "ws_test",
  campaign_id: "c1",
  campaign_name: "Alpha",
  mode: "sync_newest",
  statuses: [1, -1, -2],
  latest_of_thread: true,
  max_pages_per_status: 1,
  total_fetched: 3,
  total_stored: 3,
  total_inserted_new: 2,
  total_updated_existing: 1,
  total_skipped_auto_replies: 0,
  status_results: [],
});

assert.equal(fetchResult.schema_version, "reply_text_fetch.v1");
assert.equal(fetchResult.campaign_id, "c1");
assert.equal(fetchResult.total_fetched, 3);
assert.equal(fetchResult.total_stored, 3);
assert.equal(fetchResult.total_inserted_new, 2);
assert.equal(fetchResult.total_updated_existing, 1);
assert.equal(fetchResult.total_skipped_auto_replies, 0);
assert.deepEqual(fetchResult.statuses, [1, -1, -2]);

console.log("reply fetch contract tests passed");
