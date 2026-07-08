#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  CAMPAIGN_ANALYSIS_REPLY_PREVIEW_MAX_CHARS,
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

console.log("campaign analysis response tests passed");
