#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  CAMPAIGN_ANALYSIS_REPLY_PREVIEW_MAX_CHARS,
  buildCampaignReplyCoverageSummary,
  buildSafeReplyPreview,
  redactCampaignAnalysisReplySample,
} = require("../build/plugin/campaign-analysis-response.js");

const rawRow = {
  campaign_id: "campaign-1",
  reply_email_id: "reply-1",
  lead_email: "buyer@example.com",
  normalized_email: "buyer@example.com",
  normalized_domain: "example.com",
  reply_from_email: "buyer@example.com",
  reply_to_email: "seller@example.net",
  reply_subject: "Interested from buyer@example.com",
  reply_body_text:
    "This looks relevant. Please send options to buyer@example.com.\nOn Tuesday, Seller <seller@example.net> wrote:\nquoted thread that should not be exposed",
  reply_content_preview: "This looks relevant",
  reply_outcome_label: "positive",
  hydrated_reply_body: true,
};

const [redacted] = redactCampaignAnalysisReplySample([rawRow]);

assert.equal(redacted.lead_email, undefined);
assert.equal(redacted.normalized_email, undefined);
assert.equal(redacted.reply_from_email, undefined);
assert.equal(redacted.reply_to_email, undefined);
assert.equal(redacted.reply_subject, undefined);
assert.equal(redacted.reply_body_text, undefined);
assert.equal(redacted.reply_content_preview, undefined);
assert.equal(redacted.reply_body_text_available, true);
assert.equal(redacted.reply_content_preview_available, true);
assert.equal(redacted.reply_email_addresses_redacted, true);
assert.equal(redacted.normalized_domain, "example.com");
assert.equal(redacted.reply_outcome_label, "positive");
assert.equal(redacted.reply_subject_preview, "Interested from [redacted-email]");
assert.equal(
  redacted.reply_body_preview,
  "This looks relevant. Please send options to [redacted-email].",
);

const quotedPreview = buildSafeReplyPreview({
  reply_body_text: "Fresh sentence.\n> quoted thread",
});
assert.equal(quotedPreview, "Fresh sentence.");

const leadingOnQuotePreview = buildSafeReplyPreview({
  reply_body_text:
    "On Tuesday, Seller <seller@example.net> wrote:\nquoted thread that should not be exposed",
});
assert.equal(leadingOnQuotePreview, null);

const leadingFromQuotePreview = buildSafeReplyPreview({
  reply_body_text: "From: Seller <seller@example.net>\nquoted thread",
});
assert.equal(leadingFromQuotePreview, null);

const longPreview = buildSafeReplyPreview({
  reply_body_text: "x".repeat(CAMPAIGN_ANALYSIS_REPLY_PREVIEW_MAX_CHARS + 50),
});
assert.equal(longPreview.length, CAMPAIGN_ANALYSIS_REPLY_PREVIEW_MAX_CHARS);
assert.ok(longPreview.endsWith("..."));

const coverageSummary = buildCampaignReplyCoverageSummary({
  aggregateReplyCount: 33,
  selectedStatuses: [1, -1, -2],
  latestOfThread: true,
  fetchByStatus: [
    {
      i_status: 1,
      rows_fetched: 5,
      stored_rows_after: 5,
      exhausted: true,
      coverage_status: "exhausted_below_target",
    },
    {
      i_status: -1,
      rows_fetched: 16,
      stored_rows_after: 16,
      exhausted: true,
      coverage_status: "exhausted_below_target",
    },
    {
      i_status: -2,
      rows_fetched: 6,
      stored_rows_after: 6,
      exhausted: true,
      coverage_status: "exhausted_below_target",
    },
  ],
  storedContextByStatus: [
    {
      reply_email_i_status: 1,
      reply_email_i_status_label: "interested",
      fetched_reply_rows: 5,
      hydrated_reply_body_rows: 5,
    },
    {
      reply_email_i_status: -1,
      reply_email_i_status_label: "not_interested",
      fetched_reply_rows: 16,
      hydrated_reply_body_rows: 16,
    },
    {
      reply_email_i_status: -2,
      reply_email_i_status_label: "wrong_person",
      fetched_reply_rows: 6,
      hydrated_reply_body_rows: 6,
    },
  ],
  hydrationState: [
    { i_status: 1, latest_of_thread: true, exhausted: true },
    { i_status: -1, latest_of_thread: true, exhausted: true },
    { i_status: -2, latest_of_thread: true, exhausted: true },
  ],
});

assert.equal(coverageSummary.aggregate_reply_count, 33);
assert.equal(coverageSummary.hydrated_reply_count, 27);
assert.equal(coverageSummary.fetched_reply_count, 27);
assert.equal(coverageSummary.coverage_gap_count, 6);
assert.deepEqual(coverageSummary.coverage_scope.selected_statuses, [1, -1, -2]);
assert.equal(coverageSummary.coverage_scope.ooo_status_excluded, true);
assert.equal(coverageSummary.coverage_scope.fetch_latest_of_thread, true);
assert.equal(coverageSummary.coverage_scope.stored_context_latest_of_thread, null);
assert.match(
  coverageSummary.coverage_scope.stored_context_latest_of_thread_basis,
  /reply_email_context.*does not store.*latest_of_thread/i,
);
assert.match(
  coverageSummary.hydrated_reply_count_basis,
  /not proof of latest-thread-only coverage/i,
);
assert.match(
  coverageSummary.coverage_gap_count_basis,
  /not proof of missing reply bodies or latest-thread-only coverage/i,
);
assert.equal(coverageSummary.all_selected_status_buckets_exhausted, true);
assert.equal(
  coverageSummary.coverage_state,
  "selected_status_buckets_exhausted_with_aggregate_gap",
);
assert.deepEqual(
  coverageSummary.by_status.map((row) => ({
    status: row.i_status,
    fetched: row.fetched_reply_count,
    hydrated: row.hydrated_reply_count,
    exhausted: row.exhausted,
  })),
  [
    { status: 1, fetched: 5, hydrated: 5, exhausted: true },
    { status: -1, fetched: 16, hydrated: 16, exhausted: true },
    { status: -2, fetched: 6, hydrated: 6, exhausted: true },
  ],
);
assert.match(
  coverageSummary.coverage_explanation,
  /campaign aggregate reports 33 unique human replies/i,
);
assert.match(
  coverageSummary.coverage_explanation,
  /27 stored reply-email rows have hydrated bodies/i,
);
assert.match(
  coverageSummary.coverage_explanation,
  /maximum depth does not guarantee recovery/i,
);
assert.match(
  coverageSummary.coverage_explanation,
  /does not establish which cause applies/i,
);
assert.doesNotMatch(
  coverageSummary.coverage_explanation,
  /(?:hydrated|fetched) all replies/i,
);
assert.doesNotMatch(
  coverageSummary.coverage_explanation,
  /maximum depth (?:will|can) recover/i,
);

const mismatchedHydrationStateSummary = buildCampaignReplyCoverageSummary({
  aggregateReplyCount: 1,
  selectedStatuses: [1],
  latestOfThread: true,
  fetchByStatus: [],
  storedContextByStatus: [
    {
      reply_email_i_status: 1,
      reply_email_i_status_label: "interested",
      fetched_reply_rows: 1,
      hydrated_reply_body_rows: 1,
    },
  ],
  hydrationState: [
    { i_status: 1, latest_of_thread: false, exhausted: true },
  ],
});

assert.equal(
  mismatchedHydrationStateSummary.by_status[0].exhausted,
  false,
);
assert.equal(
  mismatchedHydrationStateSummary.all_selected_status_buckets_exhausted,
  false,
);

const unavailableAggregateSummary = buildCampaignReplyCoverageSummary({
  aggregateReplyCount: null,
  selectedStatuses: [1],
  latestOfThread: true,
  fetchByStatus: [
    {
      i_status: 1,
      rows_fetched: 1,
      exhausted: true,
    },
  ],
  storedContextByStatus: [
    {
      reply_email_i_status: 1,
      reply_email_i_status_label: "interested",
      fetched_reply_rows: 1,
      hydrated_reply_body_rows: 1,
    },
  ],
  hydrationState: [
    { i_status: 1, latest_of_thread: true, exhausted: true },
  ],
});

assert.equal(unavailableAggregateSummary.coverage_gap_count, null);
assert.doesNotMatch(
  unavailableAggregateSummary.coverage_explanation,
  /this gap|aggregate-to-hydrated gap will close/i,
);
assert.match(
  unavailableAggregateSummary.coverage_explanation,
  /selected status buckets are exhausted for this List Email surface/i,
);

console.log("campaign analysis response tests passed");
