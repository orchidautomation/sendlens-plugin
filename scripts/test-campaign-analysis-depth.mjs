import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  classifyHydrationCoverage,
  normalizeCampaignAnalysisStatuses,
  resolveCampaignAnalysisDepth,
} = require("../build/plugin/campaign-analysis-depth.js");
const {
  buildReplyLeadBackfillBatches,
} = require("../build/plugin/instantly-ingest.js");

const balanced = resolveCampaignAnalysisDepth();
assert.equal(balanced.depth, "balanced");
assert.equal(balanced.maxPagesPerStatus, 3);
assert.equal(balanced.targetStoredRowsPerStatus, 30);
assert.equal(balanced.contextSampleLimit, 75);

const fast = resolveCampaignAnalysisDepth("fast");
assert.equal(fast.maxPagesPerStatus, 1);
assert.equal(fast.targetStoredRowsPerStatus, 10);

const maximum = resolveCampaignAnalysisDepth("maximum");
assert.equal(maximum.maxPagesPerStatus, 5);
assert.equal(maximum.targetStoredRowsPerStatus, 50);

assert.deepEqual(normalizeCampaignAnalysisStatuses(), [1, -1, -2]);
assert.deepEqual(normalizeCampaignAnalysisStatuses(undefined, true), [1, -1, -2, 0]);
assert.deepEqual(normalizeCampaignAnalysisStatuses([1, 1, -2], true), [1, -2, 0]);

assert.equal(classifyHydrationCoverage(30, 30, false), "target_met");
assert.equal(classifyHydrationCoverage(12, 30, true), "exhausted_below_target");
assert.equal(classifyHydrationCoverage(12, 30, false), "partial_cap_reached");

const batches = buildReplyLeadBackfillBatches(
  [
    {
      lead_id: "lead-1",
      lead_email: "Reply@Example.com",
      from_email: "reply@example.com",
    },
    {
      lead_id: "lead-2",
      lead_email: "not-an-email",
      from_email: "second@example.com",
      reply_from_email: "second@example.com",
    },
    {
      lead_id: "lead-1",
      lead_email: "third@example.com",
    },
  ],
  2,
);

assert.deepEqual(batches.ids, ["lead-1", "lead-2"]);
assert.deepEqual(batches.idBatches, [["lead-1", "lead-2"]]);
assert.deepEqual(batches.contacts, [
  "reply@example.com",
  "second@example.com",
  "third@example.com",
]);
assert.deepEqual(batches.contactBatches, [
  ["reply@example.com", "second@example.com"],
  ["third@example.com"],
]);

console.log("campaign analysis depth tests passed");
