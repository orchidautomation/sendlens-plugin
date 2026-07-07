export const CAMPAIGN_ANALYSIS_REPLY_PREVIEW_MAX_CHARS = 240;

type ReplyContextRow = Record<string, unknown>;

const SENSITIVE_REPLY_DETAIL_FIELDS = [
  "lead_email",
  "normalized_email",
  "reply_from_email",
  "reply_to_email",
  "reply_subject",
  "reply_body_text",
  "reply_content_preview",
];

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function redactEmailAddresses(value: string) {
  return value.replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    "[redacted-email]",
  );
}

function stripQuotedThreadContent(value: string) {
  const quoteMarkers = [
    "\nOn ",
    "\nFrom:",
    "\nSent:",
    "\n-----Original Message-----",
    "\n>",
  ];
  let end = value.length;
  for (const marker of quoteMarkers) {
    const markerIndex = value.indexOf(marker);
    if (markerIndex >= 0) {
      end = Math.min(end, markerIndex);
    }
  }
  return value.slice(0, end);
}

export function buildSafeReplyPreview(row: ReplyContextRow) {
  const bodyText = stringValue(row.reply_body_text);
  const contentPreview = stringValue(row.reply_content_preview);
  const sourceText = bodyText || contentPreview;
  const normalized = compactWhitespace(
    redactEmailAddresses(stripQuotedThreadContent(sourceText)),
  );

  if (!normalized) return null;
  if (normalized.length <= CAMPAIGN_ANALYSIS_REPLY_PREVIEW_MAX_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, CAMPAIGN_ANALYSIS_REPLY_PREVIEW_MAX_CHARS - 3).trimEnd()}...`;
}

export function redactCampaignAnalysisReplySample(rows: ReplyContextRow[]) {
  return rows.map((row) => {
    const safeRow: ReplyContextRow = { ...row };
    for (const field of SENSITIVE_REPLY_DETAIL_FIELDS) {
      delete safeRow[field];
    }

    const replyPreview = buildSafeReplyPreview(row);
    if (replyPreview) {
      safeRow.reply_body_preview = replyPreview;
    }
    const replySubjectPreview = compactWhitespace(
      redactEmailAddresses(stringValue(row.reply_subject)),
    );
    if (replySubjectPreview) {
      safeRow.reply_subject_preview =
        replySubjectPreview.length <= CAMPAIGN_ANALYSIS_REPLY_PREVIEW_MAX_CHARS
          ? replySubjectPreview
          : `${replySubjectPreview.slice(0, CAMPAIGN_ANALYSIS_REPLY_PREVIEW_MAX_CHARS - 3).trimEnd()}...`;
    }
    safeRow.reply_body_text_available = Boolean(stringValue(row.reply_body_text).trim());
    safeRow.reply_content_preview_available = Boolean(
      stringValue(row.reply_content_preview).trim(),
    );
    safeRow.reply_email_addresses_redacted = true;
    return safeRow;
  });
}
