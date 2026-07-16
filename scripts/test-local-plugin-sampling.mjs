import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  allocateVariantEmailCaps,
  calculateAdaptiveNonReplyLeadSampleSize,
  calculateAdaptiveSignalReplyTarget,
  buildSamplingProvenance,
  calculateNonReplyLeadSampleSize,
  deterministicSample,
  inferSamplingMode,
  populationFingerprint,
  shouldUseFullRawIngest,
} = require("../build/plugin/sampling.js");

assert.equal(shouldUseFullRawIngest(500, 5000), true);
assert.equal(shouldUseFullRawIngest(5000, 1000), false);
assert.equal(shouldUseFullRawIngest(5000, 0), false);
assert.equal(shouldUseFullRawIngest(5001, 1001), false);

assert.equal(calculateNonReplyLeadSampleSize(200, 20), 100);
assert.equal(calculateNonReplyLeadSampleSize(10000, 10), 100);
assert.equal(calculateNonReplyLeadSampleSize(20, 25), 0);
assert.equal(calculateNonReplyLeadSampleSize(200, 20, 25), 25);
assert.equal(calculateNonReplyLeadSampleSize(30, 10, 25), 20);
assert.equal(calculateAdaptiveNonReplyLeadSampleSize(200, 20), 40);
assert.equal(calculateAdaptiveNonReplyLeadSampleSize(10000, 10), 100);
assert.equal(calculateAdaptiveNonReplyLeadSampleSize(30, 10), 20);
assert.equal(calculateAdaptiveSignalReplyTarget(200), 12);
assert.equal(calculateAdaptiveSignalReplyTarget(2500), 17);
assert.equal(calculateAdaptiveSignalReplyTarget(40000), 40);

assert.equal(inferSamplingMode(200, 4000), "full");
assert.equal(inferSamplingMode(2000, 4000), "hybrid");

const caps = allocateVariantEmailCaps(["0:0", "0:1", "1:0"], 100);
assert.equal(Object.values(caps).reduce((sum, count) => sum + count, 0), 100);
assert.equal(caps["0:0"], 34);
assert.equal(caps["0:1"], 33);
assert.equal(caps["1:0"], 33);

const population = Array.from({ length: 25 }, (_, index) => ({ id: `lead-${index}` }));
const provenance = buildSamplingProvenance({
  workspaceId: "ws_deterministic",
  campaignId: "campaign_a",
  sourceProvider: "instantly",
  ingestMode: "hybrid",
  sampleSource: "bounded_reply_signal_plus_nonreply_sample",
  recordIds: population.map((row) => row.id),
  selectedRecordIds: [],
  requestedWindowStartAt: "2026-06-01 00:00:00",
  requestedWindowEndAt: "2026-06-30 23:59:59",
});
const selectedIds = deterministicSample(population, 7, {
  seed: provenance.seed,
  identity: (row) => row.id,
}).map((row) => row.id);
const reorderedSelectedIds = deterministicSample([...population].reverse(), 7, {
  seed: provenance.seed,
  identity: (row) => row.id,
}).map((row) => row.id);
assert.deepEqual(reorderedSelectedIds, selectedIds);

const expandedPopulation = [...population, { id: "lead-25" }];
const expandedProvenance = buildSamplingProvenance({
  workspaceId: "ws_deterministic",
  campaignId: "campaign_a",
  sourceProvider: "instantly",
  ingestMode: "hybrid",
  sampleSource: "bounded_reply_signal_plus_nonreply_sample",
  recordIds: expandedPopulation.map((row) => row.id),
  selectedRecordIds: [],
  requestedWindowStartAt: "2026-06-01 00:00:00",
  requestedWindowEndAt: "2026-06-30 23:59:59",
});
assert.notEqual(expandedProvenance.populationFingerprint, provenance.populationFingerprint);
assert.equal(populationFingerprint([...population.map((row) => row.id)].reverse()), provenance.populationFingerprint);

console.log("plugin sampling tests passed");
