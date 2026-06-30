import type { DuckDBConnection } from "@duckdb/node-api";
import { appendTraceLog } from "./debug-log";
import {
  appendSyncLog,
  closeDb,
  getDb,
  run,
  setActiveWorkspaceId,
  stampCacheOwner,
  withCacheProviderMode,
} from "./local-db";
import { writeRefreshStatus } from "./refresh-status";
import {
  createSmartleadClient,
  type SmartleadClient,
} from "./smartlead-client";
import { buildWorkspaceSummary } from "./summary";

const SOURCE_PROVIDER = "smartlead";
const DEFAULT_LOOKBACK_DAYS = 30;
const SENSITIVE_RAW_KEYS = new Set([
  "api_key",
  "apikey",
  "access_token",
  "refresh_token",
  "password",
  "smtp_password",
  "imap_password",
  "secret",
  "token",
]);

type RefreshSource = "session_start" | "manual";
type RefreshMode = "fast" | "full";
type SmartleadRow = Record<string, unknown>;
type SmartleadIngestClient = Pick<
  SmartleadClient,
  | "listCampaigns"
  | "getCampaign"
  | "getCampaignSequences"
  | "getCampaignAnalytics"
  | "getCampaignAnalyticsByDate"
  | "listAllCampaignStatistics"
  | "listAllCampaignMailboxStatistics"
  | "listCampaignEmailAccounts"
  | "listAllEmailAccounts"
  | "getEmailAccountWarmupStats"
  | "listAllCampaignLeads"
>;

export type SmartleadRefreshOptions = {
  campaignIds?: string[];
  source?: RefreshSource;
  client?: SmartleadIngestClient;
};

type CampaignBundle = {
  directory: SmartleadRow;
  detail: SmartleadRow;
  sequences: SmartleadRow[];
  analytics: SmartleadRow;
  dailyRows: SmartleadRow[];
  statisticsRows: SmartleadRow[];
  leads: SmartleadRow[];
  campaignAccounts: SmartleadRow[];
  mailboxStats: SmartleadRow[];
};

type CampaignVariantTemplate = {
  sequenceIndex: number;
  step: number;
  variant: number;
  stepType: string | null;
  delayValue: number | null;
  delayUnit: string | null;
  subject: string | null;
  bodyText: string | null;
};

function esc(value: string) {
  return value.replace(/'/g, "''");
}

function sqlString(value: unknown) {
  if (value == null) return "NULL";
  const text = String(value);
  return text.trim() ? `'${esc(text)}'` : "NULL";
}

function sqlInt(value: unknown) {
  const parsed = parseInteger(value);
  return parsed == null ? "NULL" : String(parsed);
}

function sqlFloat(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : "NULL";
}

function sqlBool(value: unknown) {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "enabled", "active"].includes(normalized)) return "TRUE";
    if (["false", "0", "no", "disabled", "inactive"].includes(normalized)) return "FALSE";
  }
  return "NULL";
}

function sqlTimestamp(value: unknown) {
  if (!value) return "NULL";
  const text = String(value).trim();
  return text ? `'${esc(text)}'::TIMESTAMP` : "NULL";
}

function sqlDate(value: unknown) {
  if (!value) return "NULL";
  const text = String(value).trim();
  return text ? `'${esc(text.slice(0, 10))}'::DATE` : "NULL";
}

function sqlJson(value: unknown) {
  if (value == null) return "NULL";
  return `'${esc(JSON.stringify(value))}'`;
}

function sanitizeRaw(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRaw(item, depth + 1));
  }
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (SENSITIVE_RAW_KEYS.has(normalizedKey) || SENSITIVE_RAW_KEYS.has(key.toLowerCase())) {
      out[key] = "[REDACTED]";
      continue;
    }
    out[key] = sanitizeRaw(item, depth + 1);
  }
  return out;
}

function sqlRawJson(value: unknown) {
  return sqlJson(sanitizeRaw(value));
}

function asRecord(value: unknown): SmartleadRow {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as SmartleadRow
    : {};
}

function arrayFrom(value: unknown): SmartleadRow[] {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .map((item) => item as SmartleadRow);
  }
  return [];
}

function arraysFromPayload(payload: unknown, keys: string[]): SmartleadRow[] {
  if (Array.isArray(payload)) return arrayFrom(payload);
  const record = asRecord(payload);
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return arrayFrom(value);
    if (value && typeof value === "object") {
      const nested: SmartleadRow[] = arraysFromPayload(value, keys);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

function parseInteger(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
    const match = trimmed.match(/-?\d+/);
    if (match) return Math.trunc(Number(match[0]));
  }
  return null;
}

function pickString(record: SmartleadRow, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickNumber(record: SmartleadRow, keys: string[]) {
  for (const key of keys) {
    const parsed = parseInteger(record[key]);
    if (parsed != null) return parsed;
  }
  return null;
}

function pickFloat(record: SmartleadRow, keys: string[]) {
  for (const key of keys) {
    const parsed = Number(record[key]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeEmail(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase();
  return email.includes("@") ? email : null;
}

function pickEmail(record: SmartleadRow, keys: string[]) {
  for (const key of keys) {
    const email = normalizeEmail(record[key]);
    if (email) return email;
  }
  return null;
}

function domainFromEmail(email: string | null) {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : null;
}

function providerCampaignId(campaign: SmartleadRow) {
  return pickString(campaign, ["id", "campaign_id", "campaignId"]);
}

function campaignSourceId(providerId: string) {
  return `${SOURCE_PROVIDER}:${providerId}`;
}

function accountSourceId(providerId: string) {
  return `${SOURCE_PROVIDER}:${providerId}`;
}

function providerAccountId(account: SmartleadRow) {
  return pickString(account, ["id", "email_account_id", "account_id"]);
}

function accountEmail(account: SmartleadRow) {
  return pickEmail(account, ["from_email", "email", "email_account_email", "email_account"]);
}

function tagSourceId(providerId: string) {
  return `${SOURCE_PROVIDER}:tag:${providerId}`;
}

function deriveWorkspaceId(sources: Array<SmartleadRow | undefined>) {
  const configuredClient = process.env.SENDLENS_CLIENT?.trim();
  if (configuredClient) return configuredClient;

  for (const source of sources) {
    if (!source) continue;
    const value = pickString(source, [
      "client_id",
      "clientId",
      "user_id",
      "userId",
      "team_id",
      "workspace_id",
      "organization_id",
      "organization",
    ]);
    if (value) return value;
  }
  return SOURCE_PROVIDER;
}

function mapCampaignStatus(value: unknown) {
  const normalized = String(value ?? "unknown").trim().toLowerCase();
  switch (normalized) {
    case "active":
    case "started":
    case "running":
      return "active";
    case "paused":
    case "pause":
      return "paused";
    case "stopped":
    case "stop":
      return "stopped";
    case "draft":
    case "drafted":
      return "draft";
    case "completed":
    case "complete":
      return "completed";
    case "archived":
      return "archived";
    default:
      return normalized || "unknown";
  }
}

function isCampaignActivelySending(campaign: SmartleadRow) {
  return mapCampaignStatus(campaign.status) === "active";
}

function extractTextContent(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map(extractTextContent).filter(Boolean).join(" ");
  }
  if (typeof value === "object") {
    const record = value as SmartleadRow;
    const preferred = ["text", "plain_text", "body_text", "content", "html", "body", "value", "children"];
    const values = preferred
      .flatMap((key) => key in record ? [record[key]] : [])
      .map(extractTextContent)
      .filter(Boolean);
    if (values.length > 0) return values.join(" ");
    return Object.values(record).map(extractTextContent).filter(Boolean).join(" ");
  }
  return "";
}

export function toSmartleadPlainText(value: unknown) {
  return extractTextContent(value)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trackSettingDisabled(record: SmartleadRow, token: string) {
  const settings = Array.isArray(record.track_settings) ? record.track_settings : [];
  return settings.some((setting) => String(setting).toUpperCase() === token);
}

function trackingBool(record: SmartleadRow, token: string, fallbackKeys: string[]) {
  if (Array.isArray(record.track_settings)) return !trackSettingDisabled(record, token);
  for (const key of fallbackKeys) {
    if (record[key] != null) return record[key];
  }
  return null;
}

function splitName(fullName: unknown) {
  const text = String(fullName ?? "").trim();
  if (!text) return { firstName: null, lastName: null };
  const [firstName, ...rest] = text.split(/\s+/);
  return { firstName, lastName: rest.join(" ") || null };
}

function startDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - DEFAULT_LOOKBACK_DAYS);
  return date.toISOString().slice(0, 10);
}

function endDate() {
  return new Date().toISOString().slice(0, 10);
}

function uniqueBy<T>(rows: T[], keyFor: (row: T) => string | null) {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const row of rows) {
    const key = keyFor(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

async function insertRows(
  conn: DuckDBConnection,
  table: string,
  columns: string[],
  rows: string[],
) {
  if (rows.length === 0) return;
  await run(
    conn,
    `INSERT OR REPLACE INTO sendlens.${table} (${columns.join(", ")})
     VALUES ${rows.join(",\n")}`,
  );
}

async function clearSmartleadData(
  conn: DuckDBConnection,
  workspaceId: string,
  campaignIds?: string[],
) {
  const workspace = esc(workspaceId);
  if (!campaignIds || campaignIds.length === 0) {
    for (const table of [
      "campaigns",
      "campaign_analytics",
      "campaign_daily_metrics",
      "step_analytics",
      "campaign_variants",
      "campaign_account_assignments",
      "accounts",
      "account_daily_metrics",
      "custom_tags",
      "custom_tag_mappings",
      "sampled_leads",
      "sampled_outbound_emails",
      "sampling_runs",
    ]) {
      await run(
        conn,
        `DELETE FROM sendlens.${table}
         WHERE workspace_id = '${workspace}'
           AND COALESCE(source_provider, 'instantly') = '${SOURCE_PROVIDER}'`,
      );
    }
    await run(
      conn,
      `DELETE FROM sendlens.provider_capabilities
       WHERE workspace_id = '${workspace}'
         AND source_provider = '${SOURCE_PROVIDER}'`,
    );
    return;
  }

  const ids = campaignIds.map((id) => `'${esc(id)}'`).join(", ");
  for (const { table, idColumn } of [
    { table: "campaigns", idColumn: "id" },
    { table: "campaign_analytics", idColumn: "campaign_id" },
    { table: "campaign_daily_metrics", idColumn: "campaign_id" },
    { table: "step_analytics", idColumn: "campaign_id" },
    { table: "campaign_variants", idColumn: "campaign_id" },
    { table: "campaign_account_assignments", idColumn: "campaign_id" },
    { table: "sampled_leads", idColumn: "campaign_id" },
    { table: "sampled_outbound_emails", idColumn: "campaign_id" },
    { table: "sampling_runs", idColumn: "campaign_id" },
  ]) {
    await run(
      conn,
      `DELETE FROM sendlens.${table}
       WHERE workspace_id = '${workspace}'
         AND COALESCE(source_provider, 'instantly') = '${SOURCE_PROVIDER}'
         AND ${idColumn} IN (${ids})`,
    );
  }
}

function extractSequences(sequences: SmartleadRow[]) {
  const templates: CampaignVariantTemplate[] = [];
  sequences.forEach((sequence, sequenceIndex) => {
    const sequenceNumber = parseInteger(sequence.seq_number ?? sequence.sequence_number ?? sequence.step_number);
    const step = sequenceNumber == null ? sequenceIndex : Math.max(0, sequenceNumber - 1);
    const stepType = pickString(sequence, ["type", "sequence_type", "email_type"]);
    const delayValue = parseInteger(sequence.delay_days ?? sequence.delay ?? sequence.wait_days);
    const delayUnit = pickString(sequence, ["delay_unit", "wait_unit"]) ?? (delayValue == null ? null : "days");
    const baseSubject = pickString(sequence, ["subject", "email_subject"]);
    const baseBody = toSmartleadPlainText(sequence.email_body ?? sequence.body ?? sequence.email_text ?? sequence.content);

    templates.push({
      sequenceIndex,
      step,
      variant: 0,
      stepType,
      delayValue,
      delayUnit,
      subject: baseSubject,
      bodyText: baseBody || null,
    });

    const variants = arrayFrom(sequence.sequence_variants ?? sequence.variants);
    variants.forEach((variant, variantIndex) => {
      templates.push({
        sequenceIndex,
        step,
        variant: variantIndex + 1,
        stepType,
        delayValue,
        delayUnit,
        subject: pickString(variant, ["subject", "email_subject"]) ?? baseSubject,
        bodyText:
          toSmartleadPlainText(
            variant.email_body ?? variant.body ?? variant.email_text ?? variant.content ?? baseBody,
          ) || null,
      });
    });
  });
  return templates;
}

function aggregateStatistics(statisticsRows: SmartleadRow[]) {
  const byStep = new Map<number, {
    sent: number;
    opens: number;
    replies: number;
    clicks: number;
    bounces: number;
    opportunities: number;
  }>();

  for (const row of statisticsRows) {
    const stepRaw = row.sequence_number ?? row.email_sequence_number ?? row.seq_number ?? row.step;
    const stepNumber = parseInteger(stepRaw);
    if (stepNumber == null) continue;
    const step = Math.max(0, stepNumber - 1);
    const current = byStep.get(step) ?? {
      sent: 0,
      opens: 0,
      replies: 0,
      clicks: 0,
      bounces: 0,
      opportunities: 0,
    };

    const hasBooleanDetail =
      row.is_opened != null || row.is_clicked != null || row.is_replied != null || row.is_bounced != null;
    if (hasBooleanDetail) {
      current.sent += 1;
      current.opens += row.is_opened === true ? 1 : 0;
      current.clicks += row.is_clicked === true ? 1 : 0;
      current.replies += row.is_replied === true ? 1 : 0;
      current.bounces += row.is_bounced === true ? 1 : 0;
    } else {
      current.sent += pickNumber(row, ["sent", "sent_count", "total_sent"]) ?? 0;
      current.opens += pickNumber(row, ["opened", "opens", "open_count", "total_opened"]) ?? 0;
      current.clicks += pickNumber(row, ["clicked", "clicks", "click_count", "total_clicked"]) ?? 0;
      current.replies += pickNumber(row, ["replied", "replies", "reply_count", "total_replied"]) ?? 0;
      current.bounces += pickNumber(row, ["bounced", "bounces", "bounce_count", "total_bounced"]) ?? 0;
      current.opportunities += pickNumber(row, ["opportunities", "positive_replies", "total_positive_replies"]) ?? 0;
    }
    byStep.set(step, current);
  }

  return [...byStep.entries()].map(([step, row]) => ({ step, variant: 0, ...row }));
}

function normalizeDailyRows(payload: unknown): SmartleadRow[] {
  return arraysFromPayload(payload, ["daily", "days", "data", "analytics", "rows", "metrics"])
    .filter((row: SmartleadRow) => pickString(row, ["date", "sent_date", "report_date", "day"]));
}

function customPayloadForLead(lead: SmartleadRow) {
  const customFields = asRecord(lead.custom_fields ?? lead.customFields);
  const payload = {
    ...customFields,
    smartlead_status: lead.status ?? null,
    smartlead_category_id: lead.lead_category_id ?? lead.category_id ?? null,
    smartlead_category_name: lead.lead_category_name ?? lead.category_name ?? null,
  };
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value != null && value !== ""),
  );
}

function leadCompanyDomain(lead: SmartleadRow, email: string | null) {
  const customFields = asRecord(lead.custom_fields ?? lead.customFields);
  return pickString(lead, ["company_domain", "domain"])
    ?? pickString(customFields, ["company_domain", "domain", "website"])
    ?? domainFromEmail(email);
}

function leadEmailStats(lead: SmartleadRow) {
  return asRecord(lead.email_stats ?? lead.emailStats);
}

function countFromBooleanOrNumber(value: unknown) {
  if (typeof value === "boolean") return value ? 1 : 0;
  const parsed = parseInteger(value);
  return parsed ?? null;
}

function campaignAnalytics(analytics: SmartleadRow, campaign: SmartleadRow, leads: SmartleadRow[]) {
  const opened = pickNumber(analytics, ["open_count", "opened", "total_opened", "opens"]);
  const replied = pickNumber(analytics, ["reply_count", "replied", "total_replied", "replies"]);
  const clicked = pickNumber(analytics, ["click_count", "clicked", "total_clicked", "clicks"]);
  const bounced = pickNumber(analytics, ["bounce_count", "bounced_count", "bounced", "total_bounced"]);
  return {
    leadsCount: pickNumber(analytics, ["leads_count", "lead_count", "total_leads"]) ?? leads.length,
    contactedCount: pickNumber(analytics, ["contacted_count", "contacted"]),
    sentCount: pickNumber(analytics, ["sent_count", "emails_sent_count", "total_sent", "sent"]),
    newLeadsContacted: pickNumber(analytics, ["new_leads_contacted_count", "new_leads_contacted"]),
    openCount: opened,
    uniqueOpenCount: pickNumber(analytics, ["unique_open_count", "unique_opened", "unique_opens"]) ?? opened,
    replyCount: replied,
    uniqueReplyCount: pickNumber(analytics, ["unique_reply_count", "unique_replies"]) ?? replied,
    automaticReplies: pickNumber(analytics, ["auto_reply_count", "reply_count_automatic", "automatic_replies"]),
    clickCount: clicked,
    bouncedCount: bounced,
    unsubscribedCount: pickNumber(analytics, ["unsubscribe_count", "unsubscribed_count", "unsubscribed"]),
    completedCount: pickNumber(analytics, ["completed_count", "completed"]),
    opportunities: pickNumber(analytics, ["opportunities", "positive_replies", "interested_count"]),
    opportunityValue: pickFloat(analytics, ["opportunity_value", "total_opportunity_value"]),
    totalInterested: pickNumber(analytics, ["interested_count", "total_interested"]),
    campaignName: pickString(analytics, ["campaign_name", "name"]) ?? pickString(campaign, ["name"]),
  };
}

async function storeProviderCapabilities(conn: DuckDBConnection, workspaceId: string) {
  const capabilities = [
    ["campaign_directory", "supported", "high", "Smartlead campaigns endpoint normalizes into campaigns."],
    ["campaign_detail", "supported", "high", "Smartlead campaign detail normalizes into source_raw_json and campaign settings where available."],
    ["campaign_sequences", "supported", "high", "Smartlead sequences normalize into campaign_variants."],
    ["campaign_analytics", "supported", "medium", "Smartlead aggregate analytics normalize from provider counts; rates are recomputed in views."],
    ["campaign_daily_metrics", "partial", "medium", "Smartlead daily analytics normalize only when date-grained rows are returned."],
    ["step_analytics", "partial", "medium", "Smartlead statistics can be sequence aggregate or email-detail rows; email detail rows are aggregated by sequence."],
    ["sender_accounts", "supported", "high", "Smartlead email accounts normalize into accounts."],
    ["account_campaign_assignments", "supported", "high", "Smartlead campaign email account membership normalizes into campaign_account_assignments."],
    ["account_daily_campaign_metrics", "partial", "medium", "Smartlead mailbox statistics normalize only when date-grained rows include sender email."],
    ["lead_evidence", "supported", "high", "Smartlead campaign leads normalize into sampled_leads."],
    ["custom_tags", "partial", "medium", "Smartlead tags are preserved when present on campaign/account payloads."],
    ["inbox_placement", "unsupported", "high", "Smartlead inbox placement parity is not exposed in the read-only client foundation."],
  ];
  await insertRows(
    conn,
    "provider_capabilities",
    ["workspace_id", "source_provider", "capability", "support_status", "confidence", "coverage_note", "synced_at"],
    capabilities.map(([capability, support, confidence, note]) => `(
      '${esc(workspaceId)}',
      '${SOURCE_PROVIDER}',
      '${capability}',
      '${support}',
      '${confidence}',
      ${sqlString(note)},
      CURRENT_TIMESTAMP
    )`),
  );
}

async function cleanupSmartleadTagMappings(
  conn: DuckDBConnection,
  workspaceId: string,
  campaigns: SmartleadRow[],
  accounts: SmartleadRow[],
) {
  const workspace = esc(workspaceId);
  const campaignResourceIds = [
    ...new Set(
      campaigns
        .map(providerCampaignId)
        .filter((id): id is string => Boolean(id))
        .map(campaignSourceId),
    ),
  ];
  const accountResourceIds = [
    ...new Set(
      accounts
        .map(accountEmail)
        .filter((email): email is string => Boolean(email)),
    ),
  ];
  const accountProviderResourceIds = [
    ...new Set(
      accounts
        .map(providerAccountId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (campaignResourceIds.length > 0) {
    await run(
      conn,
      `DELETE FROM sendlens.custom_tag_mappings
       WHERE workspace_id = '${workspace}'
         AND COALESCE(source_provider, 'instantly') = '${SOURCE_PROVIDER}'
         AND TRY_CAST(resource_type AS INTEGER) = 2
         AND resource_id IN (${campaignResourceIds.map((id) => `'${esc(id)}'`).join(", ")})`,
    );
  }

  if (accountResourceIds.length > 0 || accountProviderResourceIds.length > 0) {
    const predicates = [];
    if (accountResourceIds.length > 0) {
      predicates.push(`resource_id IN (${accountResourceIds.map((id) => `'${esc(id)}'`).join(", ")})`);
    }
    if (accountProviderResourceIds.length > 0) {
      predicates.push(`provider_resource_id IN (${accountProviderResourceIds.map((id) => `'${esc(id)}'`).join(", ")})`);
    }
    await run(
      conn,
      `DELETE FROM sendlens.custom_tag_mappings
       WHERE workspace_id = '${workspace}'
         AND COALESCE(source_provider, 'instantly') = '${SOURCE_PROVIDER}'
         AND TRY_CAST(resource_type AS INTEGER) = 1
         AND (${predicates.join(" OR ")})`,
    );
  }

  await run(
    conn,
    `DELETE FROM sendlens.custom_tags
     WHERE workspace_id = '${workspace}'
       AND COALESCE(source_provider, 'instantly') = '${SOURCE_PROVIDER}'
       AND id NOT IN (
         SELECT tag_id
         FROM sendlens.custom_tag_mappings
         WHERE workspace_id = '${workspace}'
           AND COALESCE(source_provider, 'instantly') = '${SOURCE_PROVIDER}'
       )`,
  );
}

async function storeTags(
  conn: DuckDBConnection,
  workspaceId: string,
  campaigns: SmartleadRow[],
  accounts: SmartleadRow[],
  cleanupAccounts = accounts,
) {
  const tagMap = new Map<string, SmartleadRow>();
  const mappings: Array<{ tagId: string; resourceType: "1" | "2"; resourceId: string; providerResourceId: string | null }> = [];

  const collectTag = (
    rawTag: SmartleadRow,
    resourceType: "1" | "2",
    resourceId: string,
    providerResourceId: string | null,
  ) => {
    const nativeTagId = pickString(rawTag, ["tag_id", "id"]);
    if (!nativeTagId) return;
    const tagId = tagSourceId(nativeTagId);
    tagMap.set(tagId, {
      ...rawTag,
      __sendlens_tag_id: tagId,
      __sendlens_provider_tag_id: nativeTagId,
    });
    mappings.push({ tagId, resourceType, resourceId, providerResourceId });
  };

  for (const campaign of campaigns) {
    const nativeCampaignId = providerCampaignId(campaign);
    if (!nativeCampaignId) continue;
    for (const tag of arrayFrom(campaign.tags)) {
      collectTag(tag, "2", campaignSourceId(nativeCampaignId), nativeCampaignId);
    }
  }

  for (const account of accounts) {
    const email = accountEmail(account);
    const nativeAccountId = providerAccountId(account);
    if (!email) continue;
    for (const tag of arrayFrom(account.tags)) {
      collectTag(tag, "1", email, nativeAccountId);
    }
  }

  await cleanupSmartleadTagMappings(conn, workspaceId, campaigns, cleanupAccounts);

  await insertRows(
    conn,
    "custom_tags",
    [
      "workspace_id",
      "id",
      "source_provider",
      "provider_tag_id",
      "organization_id",
      "name",
      "label",
      "color",
      "description",
      "timestamp_created",
      "timestamp_updated",
      "synced_at",
    ],
    [...tagMap.values()].map((tag) => `(
      '${esc(workspaceId)}',
      ${sqlString(tag.__sendlens_tag_id)},
      '${SOURCE_PROVIDER}',
      ${sqlString(tag.__sendlens_provider_tag_id)},
      ${sqlString(tag.client_id ?? tag.organization_id)},
      ${sqlString(tag.tag_name ?? tag.name ?? tag.label)},
      ${sqlString(tag.tag_name ?? tag.label ?? tag.name)},
      ${sqlString(tag.tag_color ?? tag.color)},
      ${sqlString(tag.description)},
      ${sqlTimestamp(tag.created_at ?? tag.timestamp_created)},
      ${sqlTimestamp(tag.updated_at ?? tag.timestamp_updated)},
      CURRENT_TIMESTAMP
    )`),
  );

  await insertRows(
    conn,
    "custom_tag_mappings",
    [
      "workspace_id",
      "tag_id",
      "source_provider",
      "provider_resource_id",
      "resource_type",
      "resource_id",
      "timestamp_created",
      "synced_at",
    ],
    mappings.map((mapping) => `(
      '${esc(workspaceId)}',
      '${esc(mapping.tagId)}',
      '${SOURCE_PROVIDER}',
      ${sqlString(mapping.providerResourceId)},
      '${mapping.resourceType}',
      '${esc(mapping.resourceId)}',
      NULL,
      CURRENT_TIMESTAMP
    )`),
  );
}

async function storeEmailAccounts(
  conn: DuckDBConnection,
  workspaceId: string,
  accounts: SmartleadRow[],
  warmupByAccountId: Map<string, SmartleadRow>,
  rollupsByEmail: Map<string, { sent: number; replies: number; bounces: number }>,
) {
  await insertRows(
    conn,
    "accounts",
    [
      "workspace_id",
      "email",
      "source_provider",
      "provider_account_id",
      "account_source_id",
      "organization_id",
      "status",
      "warmup_status",
      "warmup_score",
      "provider",
      "daily_limit",
      "sending_gap",
      "first_name",
      "last_name",
      "total_sent_30d",
      "total_replies_30d",
      "total_bounces_30d",
      "source_raw_json",
      "synced_at",
    ],
    accounts
      .map((account) => {
        const email = accountEmail(account);
        const providerId = providerAccountId(account);
        if (!email || !providerId) return null;
        const warmup = warmupByAccountId.get(providerId) ?? {};
        const name = splitName(account.from_name ?? account.name);
        const rollup = rollupsByEmail.get(email) ?? { sent: 0, replies: 0, bounces: 0 };
        return `(
          '${esc(workspaceId)}',
          '${esc(email)}',
          '${SOURCE_PROVIDER}',
          '${esc(providerId)}',
          '${esc(accountSourceId(providerId))}',
          ${sqlString(account.client_id ?? account.user_id ?? account.organization_id)},
          ${sqlString(account.status ?? account.account_status)},
          ${sqlString(warmup.status ?? warmup.warmup_status ?? account.warmup_status)},
          ${sqlFloat(warmup.score ?? warmup.warmup_score ?? warmup.health_score ?? account.warmup_score)},
          ${sqlString(account.type ?? account.provider)},
          ${sqlInt(account.message_per_day ?? account.daily_limit)},
          ${sqlInt(account.min_time_to_wait_in_mins ?? account.minTimeToWaitInMins ?? account.sending_gap)},
          ${sqlString(account.first_name ?? name.firstName)},
          ${sqlString(account.last_name ?? name.lastName)},
          ${sqlInt(rollup.sent)},
          ${sqlInt(rollup.replies)},
          ${sqlInt(rollup.bounces)},
          ${sqlRawJson(account)},
          CURRENT_TIMESTAMP
        )`;
      })
      .filter((row): row is string => row != null),
  );
}

async function storeCampaignDirectory(
  conn: DuckDBConnection,
  workspaceId: string,
  bundles: CampaignBundle[],
) {
  const campaignRows: string[] = [];
  const analyticsRows: string[] = [];
  for (const bundle of bundles) {
    const nativeId = providerCampaignId(bundle.detail) ?? providerCampaignId(bundle.directory);
    if (!nativeId) continue;
    const id = campaignSourceId(nativeId);
    const merged = { ...bundle.directory, ...bundle.detail };
    const templates = extractSequences(bundle.sequences);
    const analytics = campaignAnalytics(bundle.analytics, merged, bundle.leads);
    campaignRows.push(`(
      '${esc(id)}',
      '${esc(workspaceId)}',
      '${SOURCE_PROVIDER}',
      '${esc(nativeId)}',
      '${esc(id)}',
      ${sqlString(merged.client_id ?? merged.user_id ?? merged.organization_id)},
      ${sqlString(merged.name ?? merged.campaign_name)},
      ${sqlString(mapCampaignStatus(merged.status))},
      ${sqlInt(merged.message_per_day ?? merged.daily_limit)},
      ${sqlBool(merged.text_only)},
      ${sqlBool(merged.first_email_text_only)},
      ${sqlBool(trackingBool(merged, "DONT_EMAIL_OPEN", ["open_tracking", "track_open", "track_opens"]))},
      ${sqlBool(trackingBool(merged, "DONT_LINK_CLICK", ["link_tracking", "track_click", "track_clicks"]))},
      ${sqlBool(merged.stop_on_reply)},
      ${sqlBool(merged.stop_on_auto_reply)},
      ${sqlBool(merged.match_lead_esp)},
      ${sqlBool(merged.allow_risky_contacts)},
      ${sqlBool(merged.disable_bounce_protect)},
      ${sqlBool(merged.insert_unsubscribe_header)},
      ${sqlString(merged.timezone ?? asRecord(merged.campaign_schedule).timezone)},
      ${sqlInt(bundle.sequences.length)},
      ${sqlInt(templates.length)},
      ${sqlTimestamp(merged.created_at ?? merged.timestamp_created)},
      ${sqlTimestamp(merged.updated_at ?? merged.timestamp_updated)},
      ${sqlRawJson(merged)},
      CURRENT_TIMESTAMP
    )`);

    analyticsRows.push(`(
      '${esc(workspaceId)}',
      '${esc(id)}',
      '${SOURCE_PROVIDER}',
      '${esc(nativeId)}',
      '${esc(id)}',
      ${sqlString(analytics.campaignName)},
      ${sqlInt(analytics.leadsCount)},
      ${sqlInt(analytics.contactedCount)},
      ${sqlInt(analytics.sentCount)},
      ${sqlInt(analytics.newLeadsContacted)},
      ${sqlInt(analytics.openCount)},
      ${sqlInt(analytics.uniqueOpenCount)},
      ${sqlInt(analytics.replyCount)},
      ${sqlInt(analytics.uniqueReplyCount)},
      ${sqlInt(analytics.automaticReplies)},
      ${sqlInt(analytics.clickCount)},
      ${sqlInt(analytics.bouncedCount)},
      ${sqlInt(analytics.unsubscribedCount)},
      ${sqlInt(analytics.completedCount)},
      ${sqlInt(analytics.opportunities)},
      ${sqlFloat(analytics.opportunityValue)},
      ${sqlInt(analytics.totalInterested)},
      NULL,
      NULL,
      NULL,
      CURRENT_TIMESTAMP
    )`);
  }

  await insertRows(
    conn,
    "campaigns",
    [
      "id",
      "workspace_id",
      "source_provider",
      "provider_campaign_id",
      "campaign_source_id",
      "organization_id",
      "name",
      "status",
      "daily_limit",
      "text_only",
      "first_email_text_only",
      "open_tracking",
      "link_tracking",
      "stop_on_reply",
      "stop_on_auto_reply",
      "match_lead_esp",
      "allow_risky_contacts",
      "disable_bounce_protect",
      "insert_unsubscribe_header",
      "schedule_timezone",
      "sequence_count",
      "step_count",
      "timestamp_created",
      "timestamp_updated",
      "source_raw_json",
      "synced_at",
    ],
    campaignRows,
  );

  await insertRows(
    conn,
    "campaign_analytics",
    [
      "workspace_id",
      "campaign_id",
      "source_provider",
      "provider_campaign_id",
      "campaign_source_id",
      "campaign_name",
      "leads_count",
      "contacted_count",
      "emails_sent_count",
      "new_leads_contacted_count",
      "open_count",
      "open_count_unique",
      "reply_count",
      "reply_count_unique",
      "reply_count_automatic",
      "link_click_count",
      "bounced_count",
      "unsubscribed_count",
      "completed_count",
      "total_opportunities",
      "total_opportunity_value",
      "total_interested",
      "total_meeting_booked",
      "total_meeting_completed",
      "total_closed",
      "synced_at",
    ],
    analyticsRows,
  );
}

async function storeCampaignFacts(
  conn: DuckDBConnection,
  workspaceId: string,
  bundle: CampaignBundle,
) {
  const nativeId = providerCampaignId(bundle.detail) ?? providerCampaignId(bundle.directory);
  if (!nativeId) return;
  const id = campaignSourceId(nativeId);
  const analytics = campaignAnalytics(bundle.analytics, bundle.detail, bundle.leads);
  const templates = extractSequences(bundle.sequences);
  const stepRows = aggregateStatistics(bundle.statisticsRows);

  await insertRows(
    conn,
    "campaign_variants",
    [
      "workspace_id",
      "campaign_id",
      "source_provider",
      "provider_campaign_id",
      "campaign_source_id",
      "sequence_index",
      "step",
      "variant",
      "step_type",
      "delay_value",
      "delay_unit",
      "subject",
      "body_text",
      "synced_at",
    ],
    templates.map((template) => `(
      '${esc(workspaceId)}',
      '${esc(id)}',
      '${SOURCE_PROVIDER}',
      '${esc(nativeId)}',
      '${esc(id)}',
      ${sqlInt(template.sequenceIndex)},
      ${sqlInt(template.step)},
      ${sqlInt(template.variant)},
      ${sqlString(template.stepType)},
      ${sqlInt(template.delayValue)},
      ${sqlString(template.delayUnit)},
      ${sqlString(template.subject)},
      ${sqlString(template.bodyText)},
      CURRENT_TIMESTAMP
    )`),
  );

  await insertRows(
    conn,
    "step_analytics",
    [
      "workspace_id",
      "campaign_id",
      "source_provider",
      "provider_campaign_id",
      "campaign_source_id",
      "step",
      "variant",
      "sent",
      "opens",
      "replies",
      "replies_automatic",
      "unique_replies",
      "clicks",
      "bounces",
      "opportunities",
      "synced_at",
    ],
    stepRows.map((row) => `(
      '${esc(workspaceId)}',
      '${esc(id)}',
      '${SOURCE_PROVIDER}',
      '${esc(nativeId)}',
      '${esc(id)}',
      ${sqlInt(row.step)},
      ${sqlInt(row.variant)},
      ${sqlInt(row.sent)},
      ${sqlInt(row.opens)},
      ${sqlInt(row.replies)},
      NULL,
      ${sqlInt(row.replies)},
      ${sqlInt(row.clicks)},
      ${sqlInt(row.bounces)},
      ${sqlInt(row.opportunities)},
      CURRENT_TIMESTAMP
    )`),
  );

  await insertRows(
    conn,
    "campaign_daily_metrics",
    [
      "workspace_id",
      "campaign_id",
      "source_provider",
      "provider_campaign_id",
      "campaign_source_id",
      "date",
      "sent",
      "contacted",
      "new_leads_contacted",
      "opened",
      "unique_opened",
      "replies",
      "unique_replies",
      "replies_automatic",
      "unique_replies_automatic",
      "clicks",
      "unique_clicks",
      "opportunities",
      "unique_opportunities",
      "synced_at",
    ],
    bundle.dailyRows.map((row) => `(
      '${esc(workspaceId)}',
      '${esc(id)}',
      '${SOURCE_PROVIDER}',
      '${esc(nativeId)}',
      '${esc(id)}',
      ${sqlDate(row.date ?? row.sent_date ?? row.report_date ?? row.day)},
      ${sqlInt(row.sent ?? row.sent_count ?? row.total_sent)},
      ${sqlInt(row.contacted ?? row.contacted_count)},
      ${sqlInt(row.new_leads_contacted ?? row.new_leads_contacted_count)},
      ${sqlInt(row.opened ?? row.open_count ?? row.opens)},
      ${sqlInt(row.unique_opened ?? row.unique_open_count ?? row.unique_opens ?? row.opened)},
      ${sqlInt(row.replies ?? row.reply_count ?? row.replied)},
      ${sqlInt(row.unique_replies ?? row.unique_reply_count ?? row.replies ?? row.replied)},
      ${sqlInt(row.replies_automatic ?? row.auto_reply_count)},
      ${sqlInt(row.unique_replies_automatic)},
      ${sqlInt(row.clicks ?? row.click_count ?? row.clicked)},
      ${sqlInt(row.unique_clicks ?? row.unique_click_count ?? row.clicks ?? row.clicked)},
      ${sqlInt(row.opportunities ?? row.positive_replies)},
      ${sqlInt(row.unique_opportunities ?? row.opportunities ?? row.positive_replies)},
      CURRENT_TIMESTAMP
    )`),
  );

  await insertRows(
    conn,
    "campaign_account_assignments",
    [
      "workspace_id",
      "campaign_id",
      "source_provider",
      "provider_campaign_id",
      "campaign_source_id",
      "assignment_type",
      "assignment_key",
      "account_email",
      "provider_account_id",
      "tag_id",
      "synced_at",
    ],
    bundle.campaignAccounts
      .map((account) => {
        const email = accountEmail(account);
        const nativeAccountId = providerAccountId(account);
        if (!email && !nativeAccountId) return null;
        const key = nativeAccountId ? accountSourceId(nativeAccountId) : email ?? "";
        return `(
          '${esc(workspaceId)}',
          '${esc(id)}',
          '${SOURCE_PROVIDER}',
          '${esc(nativeId)}',
          '${esc(id)}',
          'email',
          '${esc(key)}',
          ${sqlString(email)},
          ${sqlString(nativeAccountId)},
          NULL,
          CURRENT_TIMESTAMP
        )`;
      })
      .filter((row): row is string => row != null),
  );

  await insertRows(
    conn,
    "sampled_leads",
    [
      "workspace_id",
      "campaign_id",
      "source_provider",
      "provider_campaign_id",
      "campaign_source_id",
      "id",
      "provider_lead_id",
      "email",
      "normalized_email",
      "normalized_domain",
      "first_name",
      "last_name",
      "company_name",
      "company_domain",
      "status",
      "email_open_count",
      "email_reply_count",
      "email_click_count",
      "lt_interest_status",
      "email_opened_step",
      "email_opened_variant",
      "email_replied_step",
      "email_replied_variant",
      "email_clicked_step",
      "email_clicked_variant",
      "esp_code",
      "verification_status",
      "enrichment_status",
      "timestamp_last_contact",
      "timestamp_last_reply",
      "job_title",
      "website",
      "phone",
      "personalization",
      "status_summary",
      "subsequence_id",
      "list_id",
      "custom_payload",
      "source_raw_json",
      "sample_source",
      "sampled_at",
    ],
    bundle.leads
      .map((lead) => {
        const email = normalizeEmail(lead.email ?? lead.lead_email);
        const providerLeadId = pickString(lead, ["id", "lead_id", "leadId"]);
        if (!email) return null;
        const emailStats = leadEmailStats(lead);
        const payload = customPayloadForLead(lead);
        const opened = countFromBooleanOrNumber(emailStats.is_opened ?? emailStats.opened ?? lead.is_opened);
        const replied = countFromBooleanOrNumber(emailStats.is_replied ?? emailStats.replied ?? lead.is_replied);
        const clicked = countFromBooleanOrNumber(emailStats.is_clicked ?? emailStats.clicked ?? lead.is_clicked);
        return `(
          '${esc(workspaceId)}',
          '${esc(id)}',
          '${SOURCE_PROVIDER}',
          '${esc(nativeId)}',
          '${esc(id)}',
          ${sqlString(providerLeadId ? `${SOURCE_PROVIDER}:lead:${providerLeadId}` : email)},
          ${sqlString(providerLeadId)},
          '${esc(email)}',
          '${esc(email)}',
          ${sqlString(domainFromEmail(email))},
          ${sqlString(lead.first_name ?? lead.firstName)},
          ${sqlString(lead.last_name ?? lead.lastName)},
          ${sqlString(lead.company_name ?? lead.companyName ?? payload.company_name)},
          ${sqlString(leadCompanyDomain(lead, email))},
          ${sqlString(lead.status)},
          ${sqlInt(opened)},
          ${sqlInt(replied)},
          ${sqlInt(clicked)},
          NULL,
          ${sqlInt(emailStats.opened_step ?? lead.email_opened_step)},
          ${sqlInt(emailStats.opened_variant ?? lead.email_opened_variant)},
          ${sqlInt(emailStats.replied_step ?? lead.email_replied_step)},
          ${sqlInt(emailStats.replied_variant ?? lead.email_replied_variant)},
          ${sqlInt(emailStats.clicked_step ?? lead.email_clicked_step)},
          ${sqlInt(emailStats.clicked_variant ?? lead.email_clicked_variant)},
          ${sqlInt(lead.esp_code)},
          ${sqlInt(lead.verification_status)},
          ${sqlInt(lead.enrichment_status)},
          ${sqlTimestamp(lead.last_contacted_at ?? lead.timestamp_last_contact)},
          ${sqlTimestamp(emailStats.replied_at ?? lead.last_replied_at ?? lead.timestamp_last_reply)},
          ${sqlString(lead.job_title ?? lead.jobTitle ?? payload.job_title)},
          ${sqlString(lead.website ?? payload.website)},
          ${sqlString(lead.phone ?? payload.phone)},
          ${sqlString(lead.personalization ?? payload.personalization)},
          ${sqlJson({
            smartlead_status: lead.status ?? null,
            smartlead_category_id: lead.lead_category_id ?? lead.category_id ?? null,
            smartlead_category_name: lead.lead_category_name ?? lead.category_name ?? null,
          })},
          ${sqlString(lead.subsequence_id)},
          ${sqlString(lead.list_id)},
          ${sqlJson(payload)},
          ${sqlRawJson(lead)},
          'smartlead_campaign_leads',
          CURRENT_TIMESTAMP
        )`;
      })
      .filter((row): row is string => row != null),
  );

  await insertRows(
    conn,
    "sampling_runs",
    [
      "workspace_id",
      "campaign_id",
      "source_provider",
      "provider_campaign_id",
      "campaign_source_id",
      "ingest_mode",
      "total_leads",
      "total_sent",
      "reply_rows",
      "reply_lead_rows",
      "nonreply_sample_target",
      "nonreply_rows_sampled",
      "outbound_sample_target",
      "outbound_rows_sampled",
      "reply_outbound_rows",
      "filtered_lead_rows",
      "coverage_note",
      "created_at",
    ],
    [`(
      '${esc(workspaceId)}',
      '${esc(id)}',
      '${SOURCE_PROVIDER}',
      '${esc(nativeId)}',
      '${esc(id)}',
      'smartlead_read_only',
      ${sqlInt(analytics.leadsCount)},
      ${sqlInt(analytics.sentCount)},
      ${sqlInt(analytics.uniqueReplyCount)},
      ${sqlInt(bundle.leads.filter((lead) => (leadEmailStats(lead).is_replied ?? lead.is_replied) === true).length)},
      ${sqlInt(bundle.leads.length)},
      ${sqlInt(bundle.leads.length)},
      0,
      0,
      0,
      0,
      ${sqlString(`Smartlead read-only ingest: ${bundle.leads.length} lead rows, ${templates.length} sequence variants, ${stepRows.length} step rows, ${bundle.dailyRows.length} date-grained campaign rows.`)},
      CURRENT_TIMESTAMP
    )`],
  );
}

function aggregateMailboxStats(stats: SmartleadRow[]) {
  const byEmailDate = new Map<string, {
    email: string;
    providerAccountId: string | null;
    accountSourceId: string | null;
    date: string;
    sent: number;
    bounced: number;
    replies: number;
    opened: number;
    clicks: number;
  }>();

  for (const row of stats) {
    const email = pickEmail(row, ["email", "from_email", "email_account", "email_account_email"]);
    const date = pickString(row, ["date", "sent_date", "report_date", "day"]);
    if (!email || !date) continue;
    const providerAccountId = pickString(row, ["email_account_id", "account_id", "id"]);
    const key = `${email}:${date.slice(0, 10)}`;
    const current = byEmailDate.get(key) ?? {
      email,
      providerAccountId,
      accountSourceId: providerAccountId ? accountSourceId(providerAccountId) : null,
      date: date.slice(0, 10),
      sent: 0,
      bounced: 0,
      replies: 0,
      opened: 0,
      clicks: 0,
    };
    current.sent += pickNumber(row, ["sent", "sent_count", "total_sent"]) ?? 0;
    current.bounced += pickNumber(row, ["bounced", "bounces", "bounce_count"]) ?? 0;
    current.replies += pickNumber(row, ["replies", "reply_count", "replied"]) ?? 0;
    current.opened += pickNumber(row, ["opened", "open_count", "opens"]) ?? 0;
    current.clicks += pickNumber(row, ["clicks", "click_count", "clicked"]) ?? 0;
    byEmailDate.set(key, current);
  }

  return [...byEmailDate.values()];
}

async function storeAccountDailyMetrics(
  conn: DuckDBConnection,
  workspaceId: string,
  mailboxStats: SmartleadRow[],
) {
  const rows = aggregateMailboxStats(mailboxStats);
  await insertRows(
    conn,
    "account_daily_metrics",
    [
      "workspace_id",
      "email",
      "source_provider",
      "provider_account_id",
      "account_source_id",
      "date",
      "sent",
      "bounced",
      "contacted",
      "new_leads_contacted",
      "opened",
      "unique_opened",
      "replies",
      "unique_replies",
      "replies_automatic",
      "unique_replies_automatic",
      "clicks",
      "unique_clicks",
      "synced_at",
    ],
    rows.map((row) => `(
      '${esc(workspaceId)}',
      '${esc(row.email)}',
      '${SOURCE_PROVIDER}',
      ${sqlString(row.providerAccountId)},
      ${sqlString(row.accountSourceId)},
      ${sqlDate(row.date)},
      ${sqlInt(row.sent)},
      ${sqlInt(row.bounced)},
      ${sqlInt(row.sent)},
      ${sqlInt(row.sent)},
      ${sqlInt(row.opened)},
      ${sqlInt(row.opened)},
      ${sqlInt(row.replies)},
      ${sqlInt(row.replies)},
      NULL,
      NULL,
      ${sqlInt(row.clicks)},
      ${sqlInt(row.clicks)},
      CURRENT_TIMESTAMP
    )`),
  );
}

function rollupsFromMailboxStats(mailboxStats: SmartleadRow[]) {
  const rollups = new Map<string, { sent: number; replies: number; bounces: number }>();
  for (const row of aggregateMailboxStats(mailboxStats)) {
    const current = rollups.get(row.email) ?? { sent: 0, replies: 0, bounces: 0 };
    current.sent += row.sent;
    current.replies += row.replies;
    current.bounces += row.bounced;
    rollups.set(row.email, current);
  }
  return rollups;
}

async function fetchCampaignBundle(
  client: SmartleadIngestClient,
  campaign: SmartleadRow,
) {
  const nativeId = providerCampaignId(campaign);
  if (!nativeId) throw new Error("Smartlead campaign row is missing id.");
  const [detail, sequences, analytics, dailyPayload, statisticsRows, campaignAccounts, leads, mailboxStats] =
    await Promise.all([
      client.getCampaign(nativeId),
      client.getCampaignSequences(nativeId),
      client.getCampaignAnalytics(nativeId),
      client.getCampaignAnalyticsByDate(nativeId, { startDate: startDate(), endDate: endDate() }),
      client.listAllCampaignStatistics(nativeId, { limit: 1000, maxPages: 20 }),
      client.listCampaignEmailAccounts(nativeId),
      client.listAllCampaignLeads(nativeId, { limit: 100, maxPages: 50 }),
      client.listAllCampaignMailboxStatistics(nativeId, {
        limit: 100,
        maxPages: 20,
        startDate: startDate(),
        endDate: endDate(),
      }),
    ]);

  return {
    directory: campaign,
    detail: { ...campaign, ...asRecord(detail) },
    sequences: arrayFrom(sequences),
    analytics: asRecord(analytics),
    dailyRows: normalizeDailyRows(dailyPayload),
    statisticsRows: arrayFrom(statisticsRows),
    campaignAccounts: arrayFrom(campaignAccounts),
    leads: arrayFrom(leads),
    mailboxStats: arrayFrom(mailboxStats),
  };
}

async function fetchWarmups(client: SmartleadIngestClient, accounts: SmartleadRow[]) {
  const warmups = new Map<string, SmartleadRow>();
  for (const account of accounts) {
    const providerId = providerAccountId(account);
    if (!providerId) continue;
    try {
      warmups.set(providerId, asRecord(await client.getEmailAccountWarmupStats(providerId)));
    } catch (error) {
      await appendTraceLog("smartlead.refresh.warmup_skipped", {
        providerAccountId: providerId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return warmups;
}

function buildSyncLogId(source: RefreshSource, mode: RefreshMode) {
  return `${SOURCE_PROVIDER}:${source}:${mode}:${process.pid}:${Date.now()}`;
}

async function refreshSmartleadWorkspaceWithProviderMode(options: SmartleadRefreshOptions = {}) {
  const accessValue = process.env.SENDLENS_SMARTLEAD_API_KEY?.trim();
  const client = options.client ?? (accessValue ? createSmartleadClient(accessValue) : null);
  if (!client) {
    throw new Error("Missing SENDLENS_SMARTLEAD_API_KEY.");
  }

  const db = await getDb();
  const source: RefreshSource = options.source ?? (options.campaignIds?.length ? "manual" : "session_start");
  const mode: RefreshMode = "fast";
  const startedAt = new Date().toISOString();
  const refreshStartedAt = Date.now();
  const syncLogId = buildSyncLogId(source, mode);

  try {
    await appendTraceLog("smartlead.refresh.start", {
      source,
      scopedCampaignIds: options.campaignIds?.length ?? 0,
    });
    await writeRefreshStatus({
      status: "running",
      source,
      pid: process.pid,
      workspaceId: null,
      startedAt,
      endedAt: null,
      campaignsTotal: 0,
      campaignsProcessed: 0,
      currentCampaignId: null,
      currentCampaignName: null,
      message: "Loading campaign list from Smartlead.",
    });

    const campaigns = await client.listCampaigns({ includeTags: true });
    const selectedIds = new Set(options.campaignIds ?? []);
    const scopedRefresh = selectedIds.size > 0;
    const activeCampaigns = campaigns.filter(isCampaignActivelySending);
    const selectedCampaigns = scopedRefresh
      ? campaigns.filter((campaign) => {
        const nativeId = providerCampaignId(campaign);
        return nativeId ? selectedIds.has(nativeId) || selectedIds.has(campaignSourceId(nativeId)) : false;
      })
      : activeCampaigns;

    if (selectedCampaigns.length === 0) {
      throw new Error("No Smartlead campaigns matched the requested refresh scope.");
    }

    const accounts = await client.listAllEmailAccounts({ limit: 100, maxPages: 50, fetchCampaigns: true });
    const workspaceId = deriveWorkspaceId([
      selectedCampaigns[0],
      accounts[0],
    ]);

    await writeRefreshStatus({
      workspaceId,
      campaignsTotal: selectedCampaigns.length,
      campaignsProcessed: 0,
      message: "Refreshing Smartlead campaign details and analytics.",
    });

    const selectedCampaignSourceIds = selectedCampaigns
      .map(providerCampaignId)
      .filter((id): id is string => Boolean(id))
      .map(campaignSourceId);
    await clearSmartleadData(db, workspaceId, scopedRefresh ? selectedCampaignSourceIds : undefined);

    const bundles: CampaignBundle[] = [];
    for (const campaign of selectedCampaigns) {
      const nativeId = providerCampaignId(campaign) ?? "unknown";
      await writeRefreshStatus({
        workspaceId,
        campaignsProcessed: bundles.length,
        currentCampaignId: campaignSourceId(nativeId),
        currentCampaignName: pickString(campaign, ["name", "campaign_name"]),
        message: `Refreshing Smartlead campaign ${pickString(campaign, ["name", "campaign_name"]) ?? nativeId}.`,
      });
      bundles.push(await fetchCampaignBundle(client, campaign));
    }

    const allMailboxStats = bundles.flatMap((bundle) => bundle.mailboxStats);
    await storeProviderCapabilities(db, workspaceId);
    const tagCampaigns = scopedRefresh
      ? bundles.map((bundle) => bundle.detail)
      : [...campaigns, ...bundles.map((bundle) => bundle.detail)];
    const tagAccounts = scopedRefresh
      ? (() => {
        const scopedAccountEmails = new Set<string>();
        const scopedAccountIds = new Set<string>();
        for (const account of bundles.flatMap((bundle) => bundle.campaignAccounts)) {
          const email = accountEmail(account);
          const nativeAccountId = providerAccountId(account);
          if (email) scopedAccountEmails.add(email);
          if (nativeAccountId) scopedAccountIds.add(nativeAccountId);
        }
        return accounts.filter((account) => {
          const email = accountEmail(account);
          const nativeAccountId = providerAccountId(account);
          return Boolean(
            (email && scopedAccountEmails.has(email)) ||
            (nativeAccountId && scopedAccountIds.has(nativeAccountId)),
          );
        });
      })()
      : accounts;
    const tagCleanupAccounts = scopedRefresh
      ? uniqueBy(
        bundles.flatMap((bundle) => bundle.campaignAccounts),
        (account) => accountEmail(account) ?? providerAccountId(account),
      )
      : tagAccounts;
    await storeTags(db, workspaceId, tagCampaigns, tagAccounts, tagCleanupAccounts);
    if (!scopedRefresh) {
      const warmups = await fetchWarmups(client, accounts);
      await storeEmailAccounts(db, workspaceId, accounts, warmups, rollupsFromMailboxStats(allMailboxStats));
      await storeAccountDailyMetrics(db, workspaceId, allMailboxStats);
    }
    await storeCampaignDirectory(db, workspaceId, bundles);
    for (const bundle of bundles) {
      await storeCampaignFacts(db, workspaceId, bundle);
    }

    await setActiveWorkspaceId(db, workspaceId, mode);
    await stampCacheOwner(db, workspaceId);
    const endedAt = new Date().toISOString();
    await appendSyncLog(db, {
      id: syncLogId,
      workspaceId,
      source,
      mode,
      status: "succeeded",
      scopedCampaignIds: selectedCampaignSourceIds,
      campaignsTotal: selectedCampaigns.length,
      campaignsProcessed: selectedCampaigns.length,
      startedAt,
      endedAt,
      durationMs: Date.now() - refreshStartedAt,
      message: "Smartlead read-only ingest completed.",
    });
    await writeRefreshStatus({
      status: "succeeded",
      source,
      workspaceId,
      startedAt,
      endedAt,
      campaignsTotal: selectedCampaigns.length,
      campaignsProcessed: selectedCampaigns.length,
      currentCampaignId: null,
      currentCampaignName: null,
      message: "Smartlead refresh completed.",
    });
    return await buildWorkspaceSummary(db, workspaceId);
  } catch (error) {
    await appendSyncLog(db, {
      id: syncLogId,
      source,
      mode,
      status: "failed",
      scopedCampaignIds: options.campaignIds,
      campaignsTotal: null,
      campaignsProcessed: null,
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - refreshStartedAt,
      message: error instanceof Error ? error.message : String(error),
    });
    await writeRefreshStatus({
      status: "failed",
      source,
      startedAt,
      endedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    closeDb(db);
  }
}

export async function refreshSmartleadWorkspace(options: SmartleadRefreshOptions = {}) {
  return withCacheProviderMode(SOURCE_PROVIDER, () =>
    refreshSmartleadWorkspaceWithProviderMode(options),
  );
}
