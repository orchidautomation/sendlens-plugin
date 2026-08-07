// SENDOSS-168 — inference eligibility + evidence-debt pressure tests.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  assessEligibility,
  maxClaimClassForFrame,
  statisticalClaimsAllowed,
} = require("../build/plugin/analysis-eligibility.js");

// Sampled frame cannot support a population_fact claim (no upgrading sampled evidence).
const sampled = assessEligibility({ frame: "sampled", cursorExhausted: false, completeness: "sampled", claim: "population_fact", questionFamily: "reply_rate", sourceProvider: "instantly" });
assert.equal(sampled.eligible, false, "sampled frame must not permit population_fact");
assert.equal(sampled.maxClaimClass, "observed_pattern");
assert.equal(sampled.statisticalClaimsAllowed, false);
assert.ok(sampled.evidenceDebt, "blocked claim must produce evidence debt");
assert.equal(sampled.evidenceDebt.blocked_claim, "population_fact");
assert.ok(sampled.evidenceDebt.missing_surface.length > 0);
assert.ok(sampled.evidenceDebt.decision_impact.length > 0);
assert.ok(sampled.evidenceDebt.bounded_evidence_action.length > 0);

// Complete + exhausted cursor permits population_fact and statistical claims.
const complete = assessEligibility({ frame: "complete", cursorExhausted: true, completeness: "complete", claim: "population_fact" });
assert.equal(complete.eligible, true, "complete exhausted frame permits population_fact");
assert.equal(complete.statisticalClaimsAllowed, true);
assert.equal(complete.evidenceDebt, null);

// Partial cursor scan blocks population percentage claims even on a complete frame.
const partial = assessEligibility({ frame: "complete", cursorExhausted: false, completeness: "partial", claim: "population_fact" });
assert.equal(partial.eligible, false, "partial cursor must block population_fact");
assert.equal(partial.statisticalClaimsAllowed, false);
assert.ok(partial.evidenceDebt);

// Observed frame permits observed_pattern but not finite_frame_estimate.
const observed = assessEligibility({ frame: "observed", cursorExhausted: false, completeness: "observed", claim: "observed_pattern" });
assert.equal(observed.eligible, true);
const observedOverclaim = assessEligibility({ frame: "observed", cursorExhausted: false, completeness: "observed", claim: "finite_frame_estimate" });
assert.equal(observedOverclaim.eligible, false);

// Unsupported frame is never eligible and names the missing surface.
const unsupported = assessEligibility({ frame: "unsupported", cursorExhausted: false, completeness: "unsupported", claim: "observed_pattern", questionFamily: "smartlead_inbox_placement", sourceProvider: "smartlead" });
assert.equal(unsupported.eligible, false);
assert.ok(unsupported.evidenceDebt);
assert.equal(unsupported.evidenceDebt.source_provider, "smartlead");

// Enriched-tail observations cannot contaminate prevalence (no observed_pattern upgrade).
const tail = assessEligibility({ frame: "enriched_tail", cursorExhausted: false, completeness: "partial", claim: "observed_pattern" });
assert.equal(tail.eligible, false, "enriched tail must not upgrade to observed_pattern");
assert.equal(tail.maxClaimClass, "enriched_tail");

// statisticalClaimsAllowed is exercised directly.
assert.equal(statisticalClaimsAllowed({ frame: "complete", cursorExhausted: true, completeness: "complete", claim: "population_fact" }), true);
assert.equal(statisticalClaimsAllowed({ frame: "complete", cursorExhausted: false, completeness: "partial", claim: "population_fact" }), false);

// finite_frame_estimate also requires a complete, cursor-exhausted frame.
const finiteComplete = assessEligibility({ frame: "complete", cursorExhausted: true, completeness: "complete", claim: "finite_frame_estimate" });
assert.equal(finiteComplete.eligible, true);
const finitePartial = assessEligibility({ frame: "complete", cursorExhausted: false, completeness: "partial", claim: "finite_frame_estimate" });
assert.equal(finitePartial.eligible, false, "finite_frame_estimate must require a complete exhausted frame");

// Per-family sufficiency: reply-to-copy requires an observed frame; sampled is insufficient.
const replySampled = assessEligibility({ frame: "sampled", cursorExhausted: false, completeness: "sampled", claim: "observed_pattern", questionFamily: "reply_to_copy" });
assert.equal(replySampled.eligible, false, "reply_to_copy requires an observed frame");
const replyObserved = assessEligibility({ frame: "observed", cursorExhausted: false, completeness: "observed", claim: "observed_pattern", questionFamily: "reply_to_copy" });
assert.equal(replyObserved.eligible, true);

// maxClaimClassForFrame sanity
assert.equal(maxClaimClassForFrame("complete"), "population_fact");
assert.equal(maxClaimClassForFrame("sampled"), "observed_pattern");

console.log("analysis-eligibility + evidence-debt tests passed");
