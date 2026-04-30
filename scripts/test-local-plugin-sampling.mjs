import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  allocateVariantEmailCaps,
  calculateNonReplyLeadSampleSize,
  inferSamplingMode,
  shouldUseFullRawIngest,
} = require("../build/plugin/sampling.js");

assert.equal(shouldUseFullRawIngest(500, 5000), true);
assert.equal(shouldUseFullRawIngest(5000, 1000), true);
assert.equal(shouldUseFullRawIngest(5001, 1001), false);

assert.equal(calculateNonReplyLeadSampleSize(200, 20), 100);
assert.equal(calculateNonReplyLeadSampleSize(10000, 10), 100);
assert.equal(calculateNonReplyLeadSampleSize(20, 25), 0);
assert.equal(calculateNonReplyLeadSampleSize(200, 20, 25), 25);
assert.equal(calculateNonReplyLeadSampleSize(30, 10, 25), 20);

assert.equal(inferSamplingMode(200, 4000), "full");
assert.equal(inferSamplingMode(2000, 4000), "hybrid");

const caps = allocateVariantEmailCaps(["0:0", "0:1", "1:0"], 100);
assert.equal(Object.values(caps).reduce((sum, count) => sum + count, 0), 100);
assert.equal(caps["0:0"], 34);
assert.equal(caps["0:1"], 33);
assert.equal(caps["1:0"], 33);

console.log("plugin sampling tests passed");
