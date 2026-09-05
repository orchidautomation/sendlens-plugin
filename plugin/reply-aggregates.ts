// Provider aggregates describe reply signals, independently of cached reply bodies.
const replyTotals = {
  reply_count: "total_replies",
  reply_count_unique: "total_unique_replies",
  reply_count_automatic: "total_auto_replies",
  reply_count_automatic_unique: "total_unique_auto_replies",
} as const;

export function nullableCount(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// A partial sum is not an exact total. Empty scopes have confirmed zero counts.
// Callers pass only internal SQL aliases, never user input.
export function replyAggregateSql(alias: string) {
  return Object.entries(replyTotals).map(([field, total]) =>
    `CASE WHEN COUNT(*) = COUNT(${alias}.${field}) THEN COALESCE(SUM(${alias}.${field}), 0) ELSE NULL END AS ${total}`
  ).join(",\n       ");
}

export function replyAggregateMetrics(row: Record<string, unknown>) {
  return {
    total_replies: nullableCount(row.total_replies),
    total_unique_replies: nullableCount(row.total_unique_replies),
    total_auto_replies: nullableCount(row.total_auto_replies),
    total_unique_auto_replies: nullableCount(row.total_unique_auto_replies),
  };
}

export function replyAggregateSummary(row: Record<string, unknown>) {
  const count = (field: string) => nullableCount(row[field]) ?? "unavailable";
  return `${count("total_replies")} non-automatic reply events, ${count("total_unique_replies")} unique human replies, ${count("total_auto_replies")} automatic reply events, ${count("total_unique_auto_replies")} unique automatic replies`;
}

export function campaignReplySummary(row: Record<string, unknown>) {
  const totals = Object.fromEntries(Object.entries(replyTotals).map(([field, total]) => [total, row[field]]));
  const automaticOnly = nullableCount(row.reply_count_unique) === 0
    && (nullableCount(row.reply_count_automatic) ?? 0) > 0;
  return `Provider aggregates: ${replyAggregateSummary(totals)}.${automaticOnly
    ? " 0 unique human replies; automatic replies are present. These aggregates do not indicate human replies requiring hydration."
    : ""} Reply-body coverage is tracked separately.`;
}

export function nullableReplyRate(replies: number | null, sent: number) {
  return replies == null ? null : sent === 0 ? 0 : Number((100 * replies / sent).toFixed(2));
}

export function formatReplyRate(rate: unknown) {
  const value = nullableCount(rate);
  return value == null ? "unavailable" : `${value.toFixed(2)}%`;
}
