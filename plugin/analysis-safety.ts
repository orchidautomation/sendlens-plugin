import { Parser } from "node-sql-parser";
import { PUBLIC_TABLES, type PublicTableName } from "./constants";

const DIALECT = { database: "postgresql" } as const;
const PUBLIC_TABLE_SET = new Set(PUBLIC_TABLES as readonly string[]);

export type ColumnSafetyMetadata = {
  safe_to_select: boolean;
  safe_to_group_by: boolean;
  contains_pii: boolean;
  raw_json: boolean;
  high_cardinality: boolean;
  recommended_cohort_field: boolean;
  prefer_derived_field?: string;
  guidance?: string;
};

export type AnalyzeDataPrivacyColumnUsage = {
  table: string;
  column: string;
  usage: "select" | "group_by";
  reason: string;
  safe_alternatives: string[];
};

export type AnalyzeDataPrivacyGuardReport = {
  reason: "unsafe_column" | "high_cardinality_result";
  guidance: string;
  blocked_columns?: AnalyzeDataPrivacyColumnUsage[];
  safe_alternatives: string[];
};

export class AnalyzeDataPrivacyGuardError extends Error {
  readonly code = "privacy_guard" as const;

  constructor(public readonly report: AnalyzeDataPrivacyGuardReport) {
    super(report.guidance);
    this.name = "AnalyzeDataPrivacyGuardError";
  }
}

type SelectNode = {
  type: "select";
  with?: CteNode[] | null;
  from?: FromNode[] | null;
  columns?: unknown[] | null;
  groupby?: { columns?: unknown[] | null } | unknown[] | null;
  [key: string]: unknown;
};

type CteNode = {
  name?: { value?: string } | null;
  stmt?: SelectNode | { ast?: SelectNode } | null;
};

type FromNode = {
  db?: string | null;
  table?: string | null;
  as?: string | null;
  expr?: { ast?: SelectNode; type?: string | null };
};

type ColumnRef = {
  type: "column_ref";
  table?: string | null;
  column?: unknown;
};

type SourceScope = {
  aliasToPublicTable: Map<string, PublicTableName>;
  publicTables: PublicTableName[];
};

const SAFE_COHORT_COLUMNS = new Set([
  "source_provider",
  "status",
  "lead_status",
  "tracking_status",
  "deliverability_settings_status",
  "warmup_status",
  "sample_source",
  "ingest_mode",
  "reply_outcome_label",
  "lt_interest_label",
  "lt_interest_status",
  "email_opened_step",
  "email_opened_variant",
  "email_replied_step",
  "email_replied_variant",
  "email_clicked_step",
  "email_clicked_variant",
  "step",
  "variant",
  "sequence_index",
  "payload_key",
  "payload_value_type",
  "payload_is_scalar",
  "payload_semantic_family",
  "provider_capability",
  "capability",
  "support_status",
  "resource_type",
  "assignment_type",
  "tag_label",
  "campaign_tag_label",
  "assignment_account_tag_label",
  "account_tag_label",
  "weekday",
  "date",
]);

const HARD_UNSAFE_COLUMN_GUIDANCE = new Map<string, {
  reason: string;
  prefer: string;
  alternatives: string[];
  rawJson?: boolean;
}>([
  ["status_summary", {
    reason: "raw provider execution metadata may contain sender, step, timestamp, or JSON-like identifiers and is high-cardinality.",
    prefer: "status",
    alternatives: [
      "status",
      "email_reply_count",
      "timestamp_last_contact IS NOT NULL",
      "email_replied_step",
      "email_replied_variant",
      "sendlens.lead_evidence.reply_outcome_label",
      "analysis_starters(recipe_id=\"campaign-lead-state-sample-by-step\")",
    ],
    rawJson: true,
  }],
  ["custom_payload", {
    reason: "raw campaign-scoped provider/user payload JSON may contain arbitrary personal or customer-defined fields.",
    prefer: "lead_payload_kv",
    alternatives: [
      "sendlens.lead_payload_kv.payload_key",
      "sendlens.lead_payload_kv.payload_value_normalized",
      "sendlens.lead_payload_kv.payload_is_scalar",
      "analysis_starters(recipe_id=\"campaign-metadata-coverage\")",
      "analysis_starters(recipe_id=\"campaign-payload-key-signals\")",
    ],
    rawJson: true,
  }],
  ["source_raw_json", {
    reason: "raw provider payload JSON may contain fields outside the public semantic contract.",
    prefer: "public semantic columns",
    alternatives: [
      "search_catalog for a semantic public column",
      "list_columns for the target public table",
      "analysis_starters for curated public views",
    ],
    rawJson: true,
  }],
  ["raw_json", {
    reason: "raw provider payload JSON may contain fields outside the public semantic contract.",
    prefer: "public semantic columns",
    alternatives: [
      "search_catalog for a semantic public column",
      "list_columns for the target public table",
      "analysis_starters for curated public views",
    ],
    rawJson: true,
  }],
  ["metadata_json", {
    reason: "raw provider metadata JSON may contain arbitrary execution details.",
    prefer: "public semantic columns",
    alternatives: [
      "search_catalog for a semantic public column",
      "list_columns for the target public table",
    ],
    rawJson: true,
  }],
  ["diagnostic_json", {
    reason: "raw diagnostic JSON may contain provider-specific details not intended as a cohort dimension.",
    prefer: "diagnostic rollup columns",
    alternatives: [
      "smartlead_delivery_authentication_health",
      "smartlead_sender_delivery_health",
      "smartlead_delivery_test_overview",
    ],
    rawJson: true,
  }],
  ["smtp_ip_blacklist_report_json", {
    reason: "raw blacklist JSON is provider diagnostic detail and may be high-cardinality.",
    prefer: "blacklist rollup columns",
    alternatives: [
      "domain_blacklisted",
      "ip_blacklisted",
      "blacklist_count",
      "smartlead_delivery_authentication_health",
    ],
    rawJson: true,
  }],
  ["authentication_failure_results_json", {
    reason: "raw authentication-failure JSON is provider diagnostic detail and may be high-cardinality.",
    prefer: "authentication rollup columns",
    alternatives: ["spf_pass", "dkim_pass", "dmarc_pass", "smartlead_delivery_authentication_health"],
    rawJson: true,
  }],
  ["recipients_json", {
    reason: "raw recipient JSON can expose seed inbox identifiers.",
    prefer: "recipient rollup columns",
    alternatives: ["inbox_placement_test_overview", "inbox_placement_analytics_labeled"],
    rawJson: true,
  }],
  ["recipients_labels_json", {
    reason: "raw recipient label JSON can expose seed inbox identifiers.",
    prefer: "recipient rollup columns",
    alternatives: ["inbox_placement_test_overview", "inbox_placement_analytics_labeled"],
    rawJson: true,
  }],
  ["emails_json", {
    reason: "raw email-list JSON can expose seed inbox identifiers.",
    prefer: "sender or recipient rollup columns",
    alternatives: ["inbox_placement_test_overview", "sender_deliverability_health"],
    rawJson: true,
  }],
  ["tags_json", {
    reason: "raw tag JSON may contain provider-specific details; public tag views expose the safe shape.",
    prefer: "custom_tags or tag views",
    alternatives: ["custom_tags", "campaign_tags", "account_tags", "tag_scope_audit"],
    rawJson: true,
  }],
  ["personalization", {
    reason: "raw lead-level personalization text can contain arbitrary customer or person-specific context.",
    prefer: "lead_payload_kv",
    alternatives: [
      "sendlens.lead_payload_kv",
      "rendered_outbound_context.content_preview",
      "analysis_starters(recipe_id=\"personalization-leak-audit\")",
    ],
  }],
  ["body_html", {
    reason: "raw HTML bodies can contain full private message content.",
    prefer: "redacted previews or explicit reply tooling",
    alternatives: ["content_preview", "prepare_campaign_analysis", "fetch_reply_text"],
  }],
  ["body_text", {
    reason: "raw message bodies can contain full private message content.",
    prefer: "redacted previews or explicit reply tooling",
    alternatives: ["content_preview", "prepare_campaign_analysis", "fetch_reply_text"],
  }],
  ["email_body", {
    reason: "raw inbox-placement email bodies can contain full private message content.",
    prefer: "placement rollups or redacted previews",
    alternatives: ["inbox_placement_test_overview", "sender_deliverability_health"],
  }],
  ["reply_body_text", {
    reason: "raw reply bodies require an explicit reply-evidence opt-in path, not ad hoc SQL output.",
    prefer: "redacted reply previews",
    alternatives: ["reply_body_preview", "prepare_campaign_analysis(reply_evidence_detail=\"redacted_preview\")"],
  }],
  ["reply_body_html", {
    reason: "raw reply HTML requires an explicit reply-evidence opt-in path, not ad hoc SQL output.",
    prefer: "redacted reply previews",
    alternatives: ["reply_body_preview", "prepare_campaign_analysis(reply_evidence_detail=\"redacted_preview\")"],
  }],
  ["rendered_body_text", {
    reason: "reconstructed outbound bodies can contain lead-level personalization and recipient context.",
    prefer: "redacted rendered previews",
    alternatives: ["content_preview", "load_campaign_data include_rendered_outbound=false", "personalization-leak-audit"],
  }],
  ["template_body_text", {
    reason: "template bodies are copy evidence, not a cohort key, and can be long/high-cardinality.",
    prefer: "template metadata or previews",
    alternatives: ["campaign_variants.step", "campaign_variants.variant", "copy-template-review"],
  }],
]);

const TABLE_HARD_UNSAFE_COLUMNS = new Map<PublicTableName, Set<string>>([
  ["campaigns", new Set(["source_raw_json"])],
  ["campaign_variants", new Set(["body_text"])],
  ["accounts", new Set(["source_raw_json"])],
  ["inbox_placement_tests", new Set([
    "email_body",
    "emails_json",
    "tags_json",
    "recipients_json",
    "recipients_labels_json",
    "metadata_json",
    "raw_json",
  ])],
  ["inbox_placement_analytics", new Set([
    "smtp_ip_blacklist_report_json",
    "authentication_failure_results_json",
    "raw_json",
  ])],
  ["smartlead_delivery_tests", new Set(["raw_json"])],
  ["smartlead_delivery_evidence", new Set(["diagnostic_json", "raw_json"])],
  ["reply_emails", new Set(["body_text", "body_html"])],
  ["sampled_leads", new Set(["personalization", "status_summary", "custom_payload", "source_raw_json"])],
  ["sampled_outbound_emails", new Set(["body_text"])],
  ["lead_evidence", new Set(["personalization", "status_summary", "custom_payload"])],
  ["reply_context", new Set(["custom_payload", "reply_body_text", "reply_body_html", "template_body_text", "rendered_body_text"])],
  ["reply_email_context", new Set(["reply_body_text", "reply_body_html", "template_body_text"])],
  ["rendered_outbound_context", new Set(["rendered_body_text", "template_body_text"])],
]);

const EMAIL_OR_PHONE_COLUMN_PATTERN = /(^|_)(email|eaccount|phone)$/i;
const PERSON_NAME_COLUMN_PATTERN = /^(first_name|last_name|full_name)$/i;
const DOMAIN_COLUMN_PATTERN = /(^|_)(domain|website)$/i;
const ID_COLUMN_PATTERN = /(^|_)(id|message_id|thread_id|provider_lead_id|provider_campaign_id|provider_account_id)$/i;

export function columnSafetyMetadata(
  table: string,
  column: string,
  type = "",
): ColumnSafetyMetadata {
  const normalizedColumn = normalizeIdentifier(column);
  const unsafe = HARD_UNSAFE_COLUMN_GUIDANCE.get(normalizedColumn);
  if (unsafe) {
    return {
      safe_to_select: false,
      safe_to_group_by: false,
      contains_pii: true,
      raw_json: unsafe.rawJson ?? /json/i.test(type),
      high_cardinality: true,
      recommended_cohort_field: false,
      prefer_derived_field: unsafe.prefer,
      guidance: `${unsafe.reason} Prefer ${unsafe.prefer}.`,
    };
  }

  const recommended = SAFE_COHORT_COLUMNS.has(normalizedColumn);
  const isPersonalIdentifier =
    EMAIL_OR_PHONE_COLUMN_PATTERN.test(normalizedColumn)
    || PERSON_NAME_COLUMN_PATTERN.test(normalizedColumn);
  const isDomainIdentifier = DOMAIN_COLUMN_PATTERN.test(normalizedColumn);
  const isContactIdentifier = isPersonalIdentifier || isDomainIdentifier;
  const isOperationalId = ID_COLUMN_PATTERN.test(normalizedColumn);
  const highCardinality = isContactIdentifier || isOperationalId || (/VARCHAR|TEXT|JSON/i.test(type) && !recommended);

  return {
    safe_to_select: !isPersonalIdentifier,
    safe_to_group_by: recommended || !highCardinality,
    contains_pii: isPersonalIdentifier,
    raw_json: /json/i.test(normalizedColumn) || /JSON/i.test(type),
    high_cardinality: highCardinality,
    recommended_cohort_field: recommended,
    ...(isPersonalIdentifier
      ? {
          guidance:
            "Direct identifiers are redacted from analyze_data output; avoid selecting or grouping by them unless the user explicitly needs local row-level QA.",
        }
      : {}),
    ...(isDomainIdentifier
      ? {
          guidance:
            "Domain-like columns are high-cardinality; prefer aggregate labels or semantic rollups for cohorts.",
        }
      : {}),
    ...(isOperationalId && !recommended
      ? {
          guidance:
            "Identifier-like columns are high-cardinality; prefer aggregate labels or semantic rollups for cohorts.",
        }
      : {}),
  };
}

export function enforceAnalyzeDataPrivacy(sql: string) {
  const violations = unsafeColumnUsages(sql);
  if (violations.length === 0) return;
  throw new AnalyzeDataPrivacyGuardError({
    reason: "unsafe_column",
    guidance:
      "This query references raw or high-cardinality provider text that is unsafe for direct analyze_data output. Use the suggested derived cohort field or recipe instead.",
    blocked_columns: violations,
    safe_alternatives: unique(violations.flatMap((violation) => violation.safe_alternatives)),
  });
}

export function highCardinalityResultPrivacyReport(
  rows: Array<Record<string, unknown>>,
): AnalyzeDataPrivacyGuardReport | null {
  if (rows.length < 6) return null;
  const countFields = countLikeFields(rows);
  if (countFields.length === 0) return null;

  const singletonRows = rows.filter((row) =>
    countFields.some((field) => Number(row[field] ?? 0) === 1),
  ).length;
  if (singletonRows / rows.length < 0.75) return null;

  const textFields = Object.keys(rows[0] ?? {}).filter((field) =>
    rows.some((row) => typeof row[field] === "string" && String(row[field]).trim().length > 0),
  );
  const rowLevelField = textFields.find((field) => {
    const values = rows
      .map((row) => String(row[field] ?? "").trim().toLowerCase())
      .filter(Boolean);
    if (values.length < 6) return false;
    return new Set(values).size / values.length >= 0.75;
  });
  if (!rowLevelField) return null;

  return {
    reason: "high_cardinality_result",
    guidance:
      "This result looks like a row-level or high-cardinality aggregate because most groups have count 1. Use safe cohort fields or curated recipes instead.",
    safe_alternatives: [
      "status",
      "reply_outcome_label",
      "sample_source",
      "email_replied_step",
      "email_replied_variant",
      "lead_payload_kv.payload_key with scalar payload values",
      "analysis_starters(recipe_id=\"campaign-lead-state-sample-by-step\")",
    ],
  };
}

export function redactAnalyzeDataRows(rows: Array<Record<string, unknown>>) {
  return rows.map((row) => {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      redacted[key] = redactAnalyzeDataValue(value);
    }
    return redacted;
  });
}

export function redactAnalyzeDataValue(value: unknown): unknown {
  if (typeof value === "string") return redactAnalyzeDataText(value);
  if (Array.isArray(value)) return value.map(redactAnalyzeDataValue);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const redacted: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      redacted[key] = redactAnalyzeDataValue(nested);
    }
    return redacted;
  }
  return value;
}

export function redactAnalyzeDataText(input: string) {
  return input
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b(?:instly|sk|sl)_[A-Za-z0-9_-]{8,}\b/g, "[redacted-secret]")
    .replace(/(api[_-]?key|authorization|bearer|access[_-]?token)(\s*[:=]\s*|\s+)[^\s"',;{}]+/gi, "$1$2[redacted-secret]");
}

function unsafeColumnUsages(sql: string): AnalyzeDataPrivacyColumnUsage[] {
  let ast: unknown;
  try {
    ast = new Parser().astify(stripTrailingSemicolon(sql), DIALECT);
  } catch (error) {
    void error;
    return [];
  }
  const statements = Array.isArray(ast) ? ast : [ast];
  const violations: AnalyzeDataPrivacyColumnUsage[] = [];
  for (const statement of statements) {
    if (isSelectNode(statement)) {
      inspectSelectForUnsafeColumns(statement, violations);
    }
  }
  return dedupeViolations(violations);
}

function inspectSelectForUnsafeColumns(
  node: SelectNode,
  violations: AnalyzeDataPrivacyColumnUsage[],
  inheritedCtes = new Set<string>(),
) {
  const visibleCtes = new Set(inheritedCtes);
  if (Array.isArray(node.with)) {
    for (const cte of node.with) {
      const name = cte?.name?.value;
      if (name) visibleCtes.add(normalizeIdentifier(name));
    }
    for (const cte of node.with) {
      const cteSelect = unwrapSelect(cte?.stmt);
      if (cteSelect) inspectSelectForUnsafeColumns(cteSelect, violations, visibleCtes);
    }
  }

  const scope = sourceScope(node, visibleCtes);
  for (const columnNode of Array.isArray(node.columns) ? node.columns : []) {
    inspectExpressionForUnsafeColumns(columnNode, scope, "select", violations);
  }
  for (const groupNode of groupByColumns(node.groupby)) {
    inspectExpressionForUnsafeColumns(groupNode, scope, "group_by", violations);
  }
  for (const fromEntry of Array.isArray(node.from) ? node.from : []) {
    if (fromEntry?.expr?.ast) {
      inspectSelectForUnsafeColumns(fromEntry.expr.ast, violations, visibleCtes);
    }
  }
}

function sourceScope(node: SelectNode, cteNames: Set<string>): SourceScope {
  const aliasToPublicTable = new Map<string, PublicTableName>();
  const publicTables: PublicTableName[] = [];
  for (const entry of Array.isArray(node.from) ? node.from : []) {
    const table = normalizeIdentifier(entry?.table ?? "");
    if (!table || cteNames.has(table)) continue;
    if (entry?.db && normalizeIdentifier(entry.db) !== "sendlens") continue;
    if (!isPublicTableName(table)) continue;
    publicTables.push(table);
    aliasToPublicTable.set(table, table);
    if (entry?.as) aliasToPublicTable.set(normalizeIdentifier(entry.as), table);
  }
  return { aliasToPublicTable, publicTables };
}

function inspectExpressionForUnsafeColumns(
  expr: unknown,
  scope: SourceScope,
  usage: AnalyzeDataPrivacyColumnUsage["usage"],
  violations: AnalyzeDataPrivacyColumnUsage[],
  seen = new Set<object>(),
) {
  if (!expr || typeof expr !== "object") return;
  if (seen.has(expr)) return;
  seen.add(expr);
  const node = expr as Record<string, unknown>;

  if (isSelectNode(node)) {
    inspectSelectForUnsafeColumns(node, violations);
    return;
  }
  if (node.type === "column_ref") {
    const columnRef = node as ColumnRef;
    const column = normalizeIdentifier(columnName(columnRef.column));
    const tables = resolveColumnTables(scope, columnRef.table);
    if (column === "*") {
      for (const table of tables) addStarViolations(table, usage, violations);
    } else {
      for (const table of tables) addColumnViolation(table, column, usage, violations);
    }
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        inspectExpressionForUnsafeColumns(item, scope, usage, violations, seen);
      }
      continue;
    }
    inspectExpressionForUnsafeColumns(value, scope, usage, violations, seen);
  }
}

function addStarViolations(
  table: PublicTableName,
  usage: AnalyzeDataPrivacyColumnUsage["usage"],
  violations: AnalyzeDataPrivacyColumnUsage[],
) {
  for (const column of TABLE_HARD_UNSAFE_COLUMNS.get(table) ?? []) {
    addColumnViolation(table, column, usage, violations);
  }
}

function addColumnViolation(
  table: string,
  column: string,
  usage: AnalyzeDataPrivacyColumnUsage["usage"],
  violations: AnalyzeDataPrivacyColumnUsage[],
) {
  const unsafe = HARD_UNSAFE_COLUMN_GUIDANCE.get(column);
  if (!unsafe) return;
  if (isPublicTableName(table) && !(TABLE_HARD_UNSAFE_COLUMNS.get(table)?.has(column))) {
    return;
  }
  violations.push({
    table,
    column,
    usage,
    reason: unsafe.reason,
    safe_alternatives: unsafe.alternatives,
  });
}

function resolveColumnTables(scope: SourceScope, rawTable: string | null | undefined): PublicTableName[] {
  const table = normalizeIdentifier(rawTable ?? "");
  if (table) {
    const resolved = scope.aliasToPublicTable.get(table);
    return resolved ? [resolved] : [];
  }
  return scope.publicTables.length === 1 ? [scope.publicTables[0]] : [];
}

function countLikeFields(rows: Array<Record<string, unknown>>) {
  const fields = new Set<string>();
  for (const row of rows) {
    for (const [field, value] of Object.entries(row)) {
      if (!/(^|_)(count|total|sampled_leads|lead_count|sampled_count|row_count)(_|$)/i.test(field)) {
        continue;
      }
      const parsed = Number(value);
      if (Number.isFinite(parsed)) fields.add(field);
    }
  }
  return [...fields];
}

function groupByColumns(groupby: SelectNode["groupby"]): unknown[] {
  if (!groupby) return [];
  if (Array.isArray(groupby)) return groupby;
  if (typeof groupby === "object" && Array.isArray((groupby as { columns?: unknown[] }).columns)) {
    return (groupby as { columns: unknown[] }).columns;
  }
  return [];
}

function unwrapSelect(stmt: CteNode["stmt"] | null | undefined) {
  if (!stmt) return null;
  if (isSelectNode(stmt)) return stmt;
  if ("ast" in stmt && isSelectNode(stmt.ast)) return stmt.ast;
  return null;
}

function isSelectNode(value: unknown): value is SelectNode {
  return Boolean(value && typeof value === "object" && (value as { type?: unknown }).type === "select");
}

function isPublicTableName(tableName: string): tableName is PublicTableName {
  return PUBLIC_TABLE_SET.has(tableName);
}

function columnName(column: unknown) {
  if (typeof column === "string") return column;
  if (column && typeof column === "object") {
    const expr = (column as { expr?: { value?: unknown } }).expr;
    if (typeof expr?.value === "string") return expr.value;
  }
  return "";
}

function stripTrailingSemicolon(sql: string) {
  return sql.trim().replace(/;+\s*$/, "");
}

function normalizeIdentifier(value: string) {
  return value.replace(/^"|"$/g, "").trim().toLowerCase();
}

function dedupeViolations(violations: AnalyzeDataPrivacyColumnUsage[]) {
  const seen = new Set<string>();
  return violations.filter((violation) => {
    const key = `${violation.table}:${violation.column}:${violation.usage}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
