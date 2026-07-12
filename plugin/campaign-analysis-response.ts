export const CAMPAIGN_ANALYSIS_REPLY_PREVIEW_MAX_CHARS = 240;

type ReplyContextRow = Record<string, unknown>;

type CampaignReplyCoverageSummaryInput = {
  aggregateReplyCount: number | null;
  selectedStatuses: number[];
  latestOfThread: boolean;
  fetchByStatus: ReplyContextRow[];
  storedContextByStatus: ReplyContextRow[];
  hydrationState: ReplyContextRow[];
};

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

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusValue(row: ReplyContextRow, key: string) {
  return Number(row[key]);
}

function findStatusRow(
  rows: ReplyContextRow[],
  key: string,
  status: number,
) {
  return rows.find((row) => statusValue(row, key) === status);
}

export function buildCampaignReplyCoverageSummary({
  aggregateReplyCount,
  selectedStatuses,
  latestOfThread,
  fetchByStatus,
  storedContextByStatus,
  hydrationState,
}: CampaignReplyCoverageSummaryInput) {
  const byStatus = selectedStatuses.map((status) => {
    const fetchRow = findStatusRow(fetchByStatus, "i_status", status) ?? {};
    const contextRow = findStatusRow(
      storedContextByStatus,
      "reply_email_i_status",
      status,
    ) ?? {};
    const stateRow = hydrationState.find((row) =>
      statusValue(row, "i_status") === status
      && row.latest_of_thread === latestOfThread
    ) ?? {};
    const exhausted = stateRow.exhausted === true || fetchRow.exhausted === true;

    return {
      i_status: status,
      i_status_label: stringValue(contextRow.reply_email_i_status_label) || null,
      fetched_reply_count: numberValue(fetchRow.rows_fetched),
      stored_reply_count: numberValue(contextRow.fetched_reply_rows),
      hydrated_reply_count: numberValue(contextRow.hydrated_reply_body_rows),
      coverage_status: stringValue(fetchRow.coverage_status) || null,
      exhausted,
    };
  });

  const fetchedReplyCount = byStatus.reduce(
    (sum, row) => sum + row.fetched_reply_count,
    0,
  );
  const storedReplyCount = byStatus.reduce(
    (sum, row) => sum + row.stored_reply_count,
    0,
  );
  const hydratedReplyCount = byStatus.reduce(
    (sum, row) => sum + row.hydrated_reply_count,
    0,
  );
  const normalizedAggregateReplyCount = aggregateReplyCount == null
    ? null
    : Math.max(0, numberValue(aggregateReplyCount));
  const coverageGapCount = normalizedAggregateReplyCount == null
    ? null
    : Math.max(normalizedAggregateReplyCount - hydratedReplyCount, 0);
  const allSelectedStatusBucketsExhausted = byStatus.length > 0
    && byStatus.every((row) => row.exhausted);
  const hasAggregateGap = coverageGapCount != null && coverageGapCount > 0;
  const coverageState = normalizedAggregateReplyCount == null
    ? allSelectedStatusBucketsExhausted
      ? "selected_status_buckets_exhausted_aggregate_unavailable"
      : "selected_status_buckets_partial_aggregate_unavailable"
    : allSelectedStatusBucketsExhausted
      ? hasAggregateGap
        ? "selected_status_buckets_exhausted_with_aggregate_gap"
        : "selected_status_buckets_exhausted_without_numeric_gap"
      : hasAggregateGap
        ? "selected_status_buckets_partial_with_aggregate_gap"
        : "selected_status_buckets_partial_without_numeric_gap";

  const comparison = normalizedAggregateReplyCount == null
    ? `The campaign aggregate reply count is unavailable; ${hydratedReplyCount} stored reply-email rows have hydrated bodies within the selected List Email surface.`
    : `The campaign aggregate reports ${normalizedAggregateReplyCount} unique human replies; ${hydratedReplyCount} stored reply-email rows have hydrated bodies within the selected List Email surface, leaving an aggregate-to-hydrated numeric gap of ${coverageGapCount}.`;
  const exhaustionExplanation = normalizedAggregateReplyCount == null
    ? allSelectedStatusBucketsExhausted
      ? "The selected status buckets are exhausted for this List Email surface. Increasing to maximum depth does not guarantee additional selected-surface rows once those buckets are exhausted."
      : "One or more selected status buckets are not exhausted. Additional depth may expose more rows within those buckets."
    : allSelectedStatusBucketsExhausted
      ? "The selected status buckets are exhausted. Increasing to maximum depth does not guarantee recovery of this gap once those buckets are exhausted."
      : "One or more selected status buckets are not exhausted. Additional depth may expose more rows within those buckets, but it does not guarantee that the aggregate-to-hydrated gap will close.";
  const semanticsExplanation =
    "The campaign aggregate and selected List Email surface are different evidence scopes. A numeric gap can reflect unselected or unclassified provider statuses, latest-of-thread behavior, historical or provider-retention differences, or campaign-aggregate versus List Email semantics; this response does not establish which cause applies.";

  return {
    aggregate_reply_count: normalizedAggregateReplyCount,
    aggregate_reply_count_basis: "campaign_overview.reply_count_unique",
    fetched_reply_count: fetchedReplyCount,
    stored_reply_count: storedReplyCount,
    hydrated_reply_count: hydratedReplyCount,
    hydrated_reply_count_basis:
      "stored reply_email_context rows with hydrated_reply_body=true for the selected statuses; reply_email_context does not track latest_of_thread, so this count is not proof of latest-thread-only coverage",
    coverage_gap_count: coverageGapCount,
    coverage_gap_count_basis:
      "max(aggregate_reply_count - hydrated_reply_count, 0); this is a cross-surface numeric comparison, not proof of missing reply bodies or latest-thread-only coverage",
    coverage_scope: {
      surface: "provider_list_email_selected_statuses",
      selected_statuses: selectedStatuses,
      ooo_status_excluded: !selectedStatuses.includes(0),
      fetch_latest_of_thread: latestOfThread,
      stored_context_latest_of_thread: null,
      stored_context_latest_of_thread_basis:
        "unknown: reply_email_context is keyed by reply row/status and does not store the List Email latest_of_thread request mode",
    },
    by_status: byStatus,
    all_selected_status_buckets_exhausted: allSelectedStatusBucketsExhausted,
    coverage_state: coverageState,
    coverage_explanation:
      `${comparison} ${exhaustionExplanation} ${semanticsExplanation}`,
  };
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
  const lines = value.split(/\r?\n/);
  const keptLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (
      /^On .+\bwrote:/i.test(trimmed)
      || /^From:/i.test(trimmed)
      || /^Sent:/i.test(trimmed)
      || /^-----Original Message-----/i.test(trimmed)
      || /^>/.test(trimmed)
    ) {
      break;
    }
    keptLines.push(line);
  }

  return keptLines.join("\n");
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
