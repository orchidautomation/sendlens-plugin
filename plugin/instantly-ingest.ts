import type { DuckDBConnection } from "@duckdb/node-api";
import * as instantly from "./instantly-client";
import {
  DEFAULT_PAGE_SIZE,
  MAX_FULL_EMAIL_PAGES,
  MAX_OUTBOUND_EMAIL_SAMPLE,
  MIN_SIGNAL_SCAN_PAGES,
  MAX_REPLY_LEAD_PAGES,
  MAX_REPLY_EMAIL_PAGES,
  REFRESH_CAMPAIGN_CONCURRENCY,
  MAX_SAMPLE_PAGES,
  SESSION_START_MAX_REPLY_LEAD_PAGES,
  SIGNAL_REPLY_INTEREST_STATUSES,
  MAX_INBOX_PLACEMENT_TEST_PAGES,
  MAX_INBOX_PLACEMENT_ANALYTICS_PAGES_PER_TEST,
} from "./constants";
import {
  appendSyncLog,
  closeDb,
  clearWorkspaceData,
  clearWorkspaceMetadata,
  getDb,
  query,
  run,
  setActiveWorkspaceId,
} from "./local-db";
import {
  allocateVariantEmailCaps,
  calculateAdaptiveNonReplyLeadSampleSize,
  calculateAdaptiveSignalReplyTarget,
  calculateNonReplyLeadSampleSize,
  inferSamplingMode,
  reservoirSample,
} from "./sampling";
import { writeRefreshStatus } from "./refresh-status";
import { buildWorkspaceSummary } from "./summary";
import { appendTraceLog } from "./debug-log";

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

type ReplyEmailRecord = {
  id: string;
  campaignId: string;
  threadId: string;
  leadEmail: string;
  messageId: string | null;
  eaccount: string | null;
  fromEmail: string;
  toEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  sentAt: unknown;
  isAutoReply: unknown;
  aiInterestValue: unknown;
  iStatus: unknown;
  contentPreview: unknown;
  direction: "inbound";
  stepResolved: string | null;
  variantResolved: string | null;
  hydratedAt?: string;
};

type RefreshOptions = {
  campaignIds?: string[];
  source?: "session_start" | "manual";
  forceHybrid?: boolean;
  nonReplyLeadLimit?: number;
  includeReplyThreadOutbound?: boolean;
  includeNonReplyOutboundSample?: boolean;
  maxReplyPages?: number;
  latestOfThread?: boolean;
  minTimestampCreated?: string | null;
  skipReplylessCampaigns?: boolean;
};
type RefreshSource = "session_start" | "manual";
type RefreshMode = "fast" | "full";
export type ReplyTextHydrationMode =
  | "auto"
  | "continue"
  | "restart"
  | "sync_newest";
type EmailFetchPlan = {
  minTimestampCreated?: string;
  latestOfThread: boolean;
  maxReplyPages: number;
  includeNonReplyOutboundSample: boolean;
  includeReplyThreadOutbound: boolean;
};

type LeadRecord = instantly.InstantlyLead;
type TagRecord = Record<string, unknown>;
type TagMappingRecord = Record<string, unknown>;
type LeadSampleResult = {
  leads: LeadRecord[];
  source: string;
  replyLeadRows: number;
  nonReplyTarget: number;
  nonReplyRowsSampled: number;
  filteredRows: number;
};
type OutboundSampleResult = {
  emails: Array<Record<string, unknown>>;
  source: string;
  replyOutboundRows: number;
  nonReplyRowsSampled: number;
};
type InboxPlacementLoadResult = {
  tests: Array<Record<string, unknown>>;
  analytics: Array<Record<string, unknown> & { __sendlens_test_id?: string }>;
  skipped: boolean;
  skipReason: string | null;
  failedAnalyticsTests: number;
};
type NormalizedStepAnalyticsRow = {
  step: number;
  variant: number;
  sent: unknown;
  opened: unknown;
  replies: unknown;
  repliesAutomatic: unknown;
  uniqueReplies: unknown;
  clicks: unknown;
  bounces: unknown;
  opportunities: unknown;
};

type CampaignRefreshBundle = {
  campaign: Record<string, unknown>;
  campaignId: string;
  analyticsRow: Record<string, unknown> | undefined;
  detail: Record<string, unknown>;
  templates: CampaignVariantTemplate[];
  rawStepAnalytics: Array<Record<string, unknown>>;
  stepAnalytics: Array<Record<string, unknown>>;
  skippedStepAnalytics: number;
  leadSample: LeadSampleResult;
  outboundSample: OutboundSampleResult;
  totalUniqueReplies: number;
  fullRaw: boolean;
  detailElapsedMs: number;
  stepElapsedMs: number;
  leadSampleElapsedMs: number;
  outboundElapsedMs: number;
  totalElapsedMs: number;
};

function esc(value: string) {
  return value.replace(/'/g, "''");
}

function sqlString(value: unknown) {
  if (value == null) return "NULL";
  return `'${esc(String(value))}'`;
}

function sqlInt(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(Math.trunc(parsed)) : "NULL";
}

function parseInteger(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const direct = Number(trimmed);
    if (Number.isFinite(direct)) {
      return Math.trunc(direct);
    }
    const match = trimmed.match(/-?\d+/);
    if (match) {
      const parsed = Number(match[0]);
      if (Number.isFinite(parsed)) {
        return Math.trunc(parsed);
      }
    }
  }
  return null;
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
    if (normalized === "true" || normalized === "1") return "TRUE";
    if (normalized === "false" || normalized === "0") return "FALSE";
  }
  return "NULL";
}

function sqlTimestamp(value: unknown) {
  if (!value) return "NULL";
  return `'${esc(String(value))}'::TIMESTAMP`;
}

function sqlDate(value: unknown) {
  if (!value) return "NULL";
  const raw = String(value).trim();
  if (!raw) return "NULL";
  return `'${esc(raw.slice(0, 10))}'::DATE`;
}

function sqlJson(value: unknown) {
  if (value == null) return "NULL";
  return `'${esc(JSON.stringify(value))}'`;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isOptionalInboxPlacementError(error: unknown) {
  const message = errorMessage(error);
  if (!/Instantly API (400|401|402|403|404):/i.test(message)) {
    return false;
  }
  return /inbox|placement|permission|scope|plan|subscription|forbidden|not found|invalid/i.test(message);
}

function isInvalidEmailCursorError(error: unknown) {
  const message = errorMessage(error);
  if (!/Instantly API 400:/i.test(message)) {
    return false;
  }
  return /starting_after|cursor|pagination|page/i.test(message);
}

function pickString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function mapCampaignStatus(value: unknown) {
  const n = Number(value);
  switch (n) {
    case -99:
      return "account_suspended";
    case -2:
      return "bounce_protection";
    case -1:
      return "accounts_unhealthy";
    case 0:
      return "draft";
    case 1:
      return "active";
    case 2:
      return "paused";
    case 3:
      return "completed";
    case 4:
      return "running_subsequences";
    default:
      return String(value ?? "unknown");
  }
}

function isCampaignActivelySending(campaign: Record<string, unknown>) {
  const mapped = mapCampaignStatus(campaign.status).toLowerCase();
  return mapped === "active" || mapped === "running_subsequences";
}

function extractTextContent(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => extractTextContent(item))
      .filter(Boolean)
      .join(" ");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferredKeys = [
      "text",
      "plain_text",
      "body_text",
      "content",
      "html",
      "body",
      "value",
      "children",
    ];
    const preferredValues = preferredKeys
      .flatMap((key) => (key in record ? [record[key]] : []))
      .map((item) => extractTextContent(item))
      .filter(Boolean);
    if (preferredValues.length > 0) {
      return preferredValues.join(" ");
    }

    const nestedValues = Object.values(record)
      .map((item) => extractTextContent(item))
      .filter(Boolean);
    if (nestedValues.length > 0) {
      return nestedValues.join(" ");
    }
  }
  return "";
}

export function toPlainText(value: unknown) {
  const raw = extractTextContent(value);
  return raw
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSubject(subject: string) {
  return subject.trim().replace(/\s+/g, " ").toLowerCase();
}

function deriveWorkspaceId(sources: Array<Record<string, unknown> | undefined>) {
  for (const source of sources) {
    if (!source) continue;
    const value =
      source.organization_id ??
      source.organization ??
      source.workspace_id ??
      source.workspace;
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "default";
}

export function extractCampaignVariants(
  campaignDetails: Record<string, unknown>,
): CampaignVariantTemplate[] {
  const sequences = Array.isArray(campaignDetails.sequences)
    ? campaignDetails.sequences
    : Array.isArray(campaignDetails.steps)
      ? [{ steps: campaignDetails.steps }]
    : [];
  const templates: CampaignVariantTemplate[] = [];

  sequences.forEach((sequenceRaw, sequenceIndex) => {
    const sequence = sequenceRaw as Record<string, unknown>;
    const steps = Array.isArray(sequence.steps) ? sequence.steps : [];

    steps.forEach((stepRaw, stepIndex) => {
      const step = stepRaw as Record<string, unknown>;
      const variants = Array.isArray(step.variants) ? step.variants : [];

      if (variants.length > 0) {
        variants.forEach((variantRaw, variantIndex) => {
          const variant = variantRaw as Record<string, unknown>;
          templates.push({
            sequenceIndex,
            step: stepIndex,
            variant: variantIndex,
            stepType: typeof step.type === "string" ? step.type : null,
            delayValue: Number.isFinite(Number(step.delay)) ? Number(step.delay) : null,
            delayUnit: typeof step.delay_unit === "string" ? step.delay_unit : null,
            subject: typeof variant.subject === "string" ? variant.subject : null,
            bodyText: toPlainText(variant.body ?? variant.text ?? ""),
          });
        });
        return;
      }

      const subjects = Array.isArray(step.subjects) ? step.subjects : [];
      const bodies = Array.isArray(step.bodies) ? step.bodies : [];
      const variantCount = Math.max(subjects.length, bodies.length);
      for (let variantIndex = 0; variantIndex < variantCount; variantIndex++) {
        templates.push({
          sequenceIndex,
          step: stepIndex,
          variant: variantIndex,
          stepType: typeof step.type === "string" ? step.type : null,
          delayValue: Number.isFinite(Number(step.delay)) ? Number(step.delay) : null,
          delayUnit: typeof step.delay_unit === "string" ? step.delay_unit : null,
          subject: subjects[variantIndex] ? String(subjects[variantIndex]) : null,
          bodyText: toPlainText(bodies[variantIndex] ?? ""),
        });
      }
    });
  });

  return templates;
}

function resolveVariantForEmail(
  subject: string,
  stepRaw: unknown,
  templates: CampaignVariantTemplate[],
) {
  const step = Number(stepRaw);
  if (!Number.isFinite(step)) return null;
  const normalized = normalizeSubject(subject);
  const match = templates.find(
    (template) =>
      template.step === step &&
      template.subject != null &&
      normalizeSubject(template.subject) === normalized,
  );
  return match ? String(match.variant) : null;
}

function buildVariantKey(step: unknown, variant: unknown) {
  if (step == null || variant == null) return "unknown";
  return `${String(step)}:${String(variant)}`;
}

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function emailOrNull(value: unknown) {
  const email = normalizeEmail(value);
  return email.includes("@") ? email : null;
}

function extractPayload(lead: LeadRecord) {
  const record = lead as Record<string, unknown>;
  const directPayload = record.payload;
  if (directPayload && typeof directPayload === "object" && !Array.isArray(directPayload)) {
    return directPayload as Record<string, unknown>;
  }

  const customPayload = record.custom_payload ?? record.customPayload;
  if (customPayload && typeof customPayload === "object" && !Array.isArray(customPayload)) {
    return customPayload as Record<string, unknown>;
  }
  if (typeof customPayload === "string" && customPayload.trim()) {
    try {
      const parsed = JSON.parse(customPayload);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }

  return {};
}

function extractLeadCampaignIds(lead: LeadRecord) {
  const payload = extractPayload(lead);
  const record = lead as Record<string, unknown>;
  const candidates = [
    record.campaign_id,
    record.campaign,
    payload.campaign,
    payload.campaign_id,
    payload.Campaign,
    payload.CampaignId,
  ];
  return new Set(
    candidates
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  );
}

function leadBelongsToCampaign(lead: LeadRecord, campaignId: string) {
  const campaignIds = extractLeadCampaignIds(lead);
  if (campaignIds.size === 0) {
    return true;
  }
  return campaignIds.has(campaignId);
}

function parseLeadInterestStatus(lead: LeadRecord) {
  const parsed = Number(lead.lt_interest_status);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function leadHasReplyMetadata(lead: LeadRecord, replyLeadEmails?: Set<string>) {
  if (replyLeadEmails?.has(normalizeEmail(lead.email))) return true;
  if ((Number(lead.email_reply_count ?? 0) || 0) > 0) return true;
  if (lead.timestamp_last_reply) return true;
  if (lead.email_replied_step != null) return true;
  return false;
}

function leadHasReplySignal(lead: LeadRecord, replyLeadEmails?: Set<string>) {
  const interestStatus = parseLeadInterestStatus(lead);
  if (interestStatus == null) return false;
  if (!SIGNAL_REPLY_INTEREST_STATUSES.includes(interestStatus as (typeof SIGNAL_REPLY_INTEREST_STATUSES)[number])) {
    return false;
  }
  return leadHasReplyMetadata(lead, replyLeadEmails);
}

function normalizeTemplateKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildLeadTemplateVariables(lead: LeadRecord) {
  const vars = new Map<string, string>();
  const payload = extractPayload(lead);
  const add = (rawKey: string, value: unknown) => {
    if (value == null) return;
    const rendered = String(value).trim();
    if (!rendered) return;
    vars.set(rawKey, rendered);
    vars.set(normalizeTemplateKey(rawKey), rendered);
  };

  for (const [key, value] of Object.entries(payload)) {
    add(key, value);
  }

  add("first_name", lead.first_name);
  add("firstName", lead.first_name);
  add("last_name", lead.last_name);
  add("lastName", lead.last_name);
  add("email", lead.email);
  add("company_name", lead.company_name);
  add("companyName", lead.company_name);
  add("company_domain", lead.company_domain);
  add("companyDomain", lead.company_domain);
  add("job_title", lead.job_title);
  add("jobTitle", lead.job_title);
  add("website", lead.website ?? payload.website);
  add("phone", lead.phone);
  add("personalization", lead.personalization ?? payload.personalization);

  return vars;
}

export function renderTemplateValue(template: string | null, lead: LeadRecord) {
  if (!template) return null;
  const vars = buildLeadTemplateVariables(lead);
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (token, rawKey) => {
    const direct = vars.get(String(rawKey).trim());
    if (direct != null) return direct;
    const normalized = vars.get(normalizeTemplateKey(String(rawKey).trim()));
    return normalized ?? token;
  });
}

export type ResolvedLeadTemplate = {
  template: CampaignVariantTemplate | null;
  stepResolved: string | null;
  variantResolved: string | null;
  resolutionSource:
    | "replied_step_variant"
    | "clicked_step_variant"
    | "opened_step_variant"
    | "default_first_variant"
    | "missing_template";
};

export function resolveLeadTemplate(
  lead: LeadRecord,
  templates: CampaignVariantTemplate[],
): ResolvedLeadTemplate {
  const firstTemplate = [...templates].sort((a, b) => {
    if (a.sequenceIndex !== b.sequenceIndex) return a.sequenceIndex - b.sequenceIndex;
    if (a.step !== b.step) return a.step - b.step;
    return a.variant - b.variant;
  })[0] ?? null;
  const attempts: Array<{
    step: unknown;
    variant: unknown;
    source: ResolvedLeadTemplate["resolutionSource"];
  }> = [
    {
      step: lead.email_replied_step,
      variant: lead.email_replied_variant ?? 0,
      source: "replied_step_variant",
    },
    {
      step: lead.email_clicked_step,
      variant: lead.email_clicked_variant ?? 0,
      source: "clicked_step_variant",
    },
    {
      step: lead.email_opened_step,
      variant: lead.email_opened_variant ?? 0,
      source: "opened_step_variant",
    },
  ];

  for (const attempt of attempts) {
    const step = parseInteger(attempt.step);
    if (step == null) continue;
    const variant = parseInteger(attempt.variant) ?? 0;
    const exact = templates.find(
      (template) => template.step === step && template.variant === variant,
    );
    if (exact) {
      return {
        template: exact,
        stepResolved: String(step),
        variantResolved: String(variant),
        resolutionSource: attempt.source,
      };
    }
    const fallbackVariant = templates.find(
      (template) => template.step === step && template.variant === 0,
    );
    if (fallbackVariant) {
      return {
        template: fallbackVariant,
        stepResolved: String(step),
        variantResolved: String(fallbackVariant.variant),
        resolutionSource: attempt.source,
      };
    }
  }

  if (firstTemplate) {
    return {
      template: firstTemplate,
      stepResolved: String(firstTemplate.step),
      variantResolved: String(firstTemplate.variant),
      resolutionSource: "default_first_variant",
    };
  }

  return {
    template: null,
    stepResolved: null,
    variantResolved: null,
    resolutionSource: "missing_template",
  };
}

export function normalizeStepAnalyticsRows(stepAnalytics: Array<Record<string, unknown>>) {
  const validRows: NormalizedStepAnalyticsRow[] = [];
  let skippedRows = 0;

  for (const row of stepAnalytics) {
    const step = parseInteger(row.step);
    if (step == null) {
      skippedRows += 1;
      continue;
    }

    const variant = parseInteger(row.variant) ?? 0;
    validRows.push({
      step,
      variant,
      sent: row.sent,
      opened: row.opened ?? row.opens,
      replies: row.replies,
      repliesAutomatic: row.replies_automatic,
      uniqueReplies: row.unique_replies,
      clicks: row.clicks,
      bounces: row.bounced ?? row.bounces,
      opportunities: row.opportunities,
    });
  }

  return { validRows, skippedRows };
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

async function storeWorkspaceAccounts(
  conn: DuckDBConnection,
  workspaceId: string,
  accounts: Array<Record<string, unknown>>,
  dailyMetrics: Array<Record<string, unknown>>,
  warmup: Awaited<ReturnType<typeof instantly.getWarmupAnalytics>>,
) {
  const dailyByEmail = new Map<
    string,
    { sent: number; replies: number; bounces: number }
  >();

  for (const row of dailyMetrics) {
    const email = String(row.email_account ?? row.email ?? "");
    if (!email) continue;
    const current = dailyByEmail.get(email) ?? { sent: 0, replies: 0, bounces: 0 };
    current.sent += Number(row.sent ?? 0) || 0;
    current.replies += Number(row.unique_replies ?? row.replies ?? 0) || 0;
    current.bounces += Number(row.bounced ?? row.bounces ?? 0) || 0;
    dailyByEmail.set(email, current);
  }

  const accountRows: string[] = [];
  for (const account of accounts) {
    const email = String(account.email ?? "");
    if (!email) continue;
    const rollup = dailyByEmail.get(email) ?? { sent: 0, replies: 0, bounces: 0 };
    const warm = warmup.aggregate_data?.[email] ?? {};
    accountRows.push(`(
      '${esc(workspaceId)}',
      '${esc(email)}',
      ${sqlString(account.organization ?? account.organization_id)},
      ${sqlString(account.status)},
      ${sqlString(account.warmup_status ?? warm.health_score_label)},
      ${sqlFloat(account.warmup_score ?? warm.health_score)},
      ${sqlString(account.provider)},
      ${sqlInt(account.daily_limit)},
      ${sqlInt(account.sending_gap)},
      ${sqlString(account.first_name)},
      ${sqlString(account.last_name)},
      ${sqlInt(rollup.sent)},
      ${sqlInt(rollup.replies)},
      ${sqlInt(rollup.bounces)},
      CURRENT_TIMESTAMP
    )`);
  }

  await insertRows(
    conn,
    "accounts",
    [
      "workspace_id",
      "email",
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
      "synced_at",
    ],
    accountRows,
  );

  const dailyRows = dailyMetrics
    .map(
      (row) => `(
        '${esc(workspaceId)}',
        '${esc(String(row.email_account ?? row.email ?? ""))}',
        ${sqlString(row.date)}::DATE,
        ${sqlInt(row.sent)},
        ${sqlInt(row.bounced ?? row.bounces)},
        ${sqlInt(row.contacted)},
        ${sqlInt(row.new_leads_contacted)},
        ${sqlInt(row.opened)},
        ${sqlInt(row.unique_opened)},
        ${sqlInt(row.replies)},
        ${sqlInt(row.unique_replies)},
        ${sqlInt(row.replies_automatic)},
        ${sqlInt(row.unique_replies_automatic)},
        ${sqlInt(row.clicks)},
        ${sqlInt(row.unique_clicks)},
        CURRENT_TIMESTAMP
      )`,
    )
    .filter((value) => !value.includes("''::DATE"));

  await insertRows(
    conn,
    "account_daily_metrics",
    [
      "workspace_id",
      "email",
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
    dailyRows,
  );
}

async function storeCustomTags(
  conn: DuckDBConnection,
  workspaceId: string,
  tags: TagRecord[],
  mappings: TagMappingRecord[],
) {
  await insertRows(
    conn,
    "custom_tags",
    [
      "workspace_id",
      "id",
      "organization_id",
      "name",
      "label",
      "color",
      "description",
      "timestamp_created",
      "timestamp_updated",
      "synced_at",
    ],
    tags
      .filter((tag) => String(tag.id ?? "").trim())
      .map(
        (tag) => `(
          '${esc(workspaceId)}',
          ${sqlString(tag.id)},
          ${sqlString(tag.organization_id ?? tag.organization)},
          ${sqlString(tag.name)},
          ${sqlString(tag.label)},
          ${sqlString(tag.color)},
          ${sqlString(tag.description)},
          ${sqlTimestamp(tag.timestamp_created)},
          ${sqlTimestamp(tag.timestamp_updated)},
          CURRENT_TIMESTAMP
        )`,
      ),
  );

  await insertRows(
    conn,
    "custom_tag_mappings",
    [
      "workspace_id",
      "tag_id",
      "resource_type",
      "resource_id",
      "timestamp_created",
      "synced_at",
    ],
    mappings
      .filter(
        (mapping) =>
          String(mapping.tag_id ?? "").trim() &&
          String(mapping.resource_type ?? "").trim() &&
          String(mapping.resource_id ?? "").trim(),
      )
      .map(
        (mapping) => `(
          '${esc(workspaceId)}',
          ${sqlString(mapping.tag_id)},
          ${sqlString(parseInteger(mapping.resource_type) ?? mapping.resource_type)},
          ${sqlString(mapping.resource_id)},
          ${sqlTimestamp(mapping.timestamp_created)},
          CURRENT_TIMESTAMP
        )`,
    ),
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
    : [];
}

async function storeCampaignAccountAssignments(
  conn: DuckDBConnection,
  workspaceId: string,
  campaignId: string,
  detail: Record<string, unknown>,
) {
  const directEmails = new Set(
    stringArray(detail.email_list)
      .map((email) => email.toLowerCase())
      .filter(Boolean),
  );
  const tagIds = new Set(stringArray(detail.email_tag_list));

  const directRows = [...directEmails].map((email) => `(
    '${esc(workspaceId)}',
    '${esc(campaignId)}',
    'email',
    '${esc(email)}',
    '${esc(email)}',
    NULL,
    CURRENT_TIMESTAMP
  )`);

  const tagRows = [...tagIds].map((tagId) => `(
    '${esc(workspaceId)}',
    '${esc(campaignId)}',
    'tag',
    '${esc(tagId)}',
    NULL,
    '${esc(tagId)}',
    CURRENT_TIMESTAMP
  )`);

  await insertRows(
    conn,
    "campaign_account_assignments",
    [
      "workspace_id",
      "campaign_id",
      "assignment_type",
      "assignment_key",
      "account_email",
      "tag_id",
      "synced_at",
    ],
    [...directRows, ...tagRows],
  );
}

async function loadInboxPlacementData(apiKey: string): Promise<InboxPlacementLoadResult> {
  const result: InboxPlacementLoadResult = {
    tests: [],
    analytics: [],
    skipped: false,
    skipReason: null,
    failedAnalyticsTests: 0,
  };

  try {
    result.tests = await instantly.listAllInboxPlacementTests(
      apiKey,
      MAX_INBOX_PLACEMENT_TEST_PAGES,
    );
  } catch (error) {
    if (isOptionalInboxPlacementError(error)) {
      result.skipped = true;
      result.skipReason = errorMessage(error);
      return result;
    }
    throw error;
  }

  const testsWithIds = result.tests
    .map((test) => ({
      test,
      testId: pickString(test, ["id", "test_id", "uuid"]),
    }))
    .filter((entry): entry is { test: Record<string, unknown>; testId: string } => Boolean(entry.testId));

  const batchSize = 4;
  for (let start = 0; start < testsWithIds.length; start += batchSize) {
    const batch = testsWithIds.slice(start, start + batchSize);
    const batches = await Promise.all(
      batch.map(async ({ testId }) => {
        try {
          const rows = await instantly.listAllInboxPlacementAnalyticsForTest(
            apiKey,
            testId,
            MAX_INBOX_PLACEMENT_ANALYTICS_PAGES_PER_TEST,
          );
          return rows.map((row) => ({ ...row, __sendlens_test_id: testId }));
        } catch (error) {
          if (isOptionalInboxPlacementError(error)) {
            result.failedAnalyticsTests += 1;
            await appendTraceLog("refresh.inbox_placement.analytics_skipped", {
              testId,
              reason: errorMessage(error),
            });
            return [];
          }
          throw error;
        }
      }),
    );
    result.analytics.push(...batches.flat());
  }

  return result;
}

async function storeInboxPlacementData(
  conn: DuckDBConnection,
  workspaceId: string,
  tests: Array<Record<string, unknown>>,
  analytics: Array<Record<string, unknown> & { __sendlens_test_id?: string }>,
) {
  await insertRows(
    conn,
    "inbox_placement_tests",
    [
      "workspace_id",
      "id",
      "organization_id",
      "name",
      "delivery_mode",
      "description",
      "type",
      "sending_method",
      "campaign_id",
      "email_subject",
      "email_body",
      "emails_json",
      "test_code",
      "tags_json",
      "text_only",
      "recipients_json",
      "recipients_labels_json",
      "timestamp_created",
      "timestamp_next_run",
      "status",
      "not_sending_status",
      "metadata_json",
      "raw_json",
      "synced_at",
    ],
    tests
      .filter((test) => pickString(test, ["id", "test_id", "uuid"]))
      .map((test) => {
        const testId = pickString(test, ["id", "test_id", "uuid"]) ?? "";
        return `(
          '${esc(workspaceId)}',
          '${esc(testId)}',
          ${sqlString(test.organization_id ?? test.organization)},
          ${sqlString(test.name)},
          ${sqlInt(test.delivery_mode)},
          ${sqlString(test.description)},
          ${sqlInt(test.type)},
          ${sqlInt(test.sending_method)},
          ${sqlString(test.campaign_id ?? test.campaign)},
          ${sqlString(test.email_subject ?? test.subject)},
          ${sqlString(test.email_body ?? test.body)},
          ${sqlJson(test.emails)},
          ${sqlString(test.test_code)},
          ${sqlJson(test.tags)},
          ${sqlBool(test.text_only)},
          ${sqlJson(test.recipients)},
          ${sqlJson(test.recipients_labels)},
          ${sqlTimestamp(test.timestamp_created ?? test.created_at)},
          ${sqlTimestamp(test.timestamp_next_run ?? test.next_run_at)},
          ${sqlInt(test.status)},
          ${sqlString(test.not_sending_status)},
          ${sqlJson(test.metadata)},
          ${sqlJson(test)},
          CURRENT_TIMESTAMP
        )`;
      }),
  );

  await insertRows(
    conn,
    "inbox_placement_analytics",
    [
      "workspace_id",
      "id",
      "organization_id",
      "test_id",
      "timestamp_created",
      "timestamp_created_date",
      "is_spam",
      "has_category",
      "sender_email",
      "sender_esp",
      "recipient_email",
      "recipient_esp",
      "recipient_geo",
      "recipient_type",
      "spf_pass",
      "dkim_pass",
      "dmarc_pass",
      "smtp_ip_blacklist_report_json",
      "authentication_failure_results_json",
      "record_type",
      "raw_json",
      "synced_at",
    ],
    analytics
      .filter((row) => pickString(row, ["test_id", "test"]) ?? row.__sendlens_test_id)
      .map((row, index) => {
        const testId = pickString(row, ["test_id", "test"]) ?? row.__sendlens_test_id ?? "";
        const timestamp = row.timestamp_created ?? row.created_at;
        const rowId =
          pickString(row, ["id", "uuid"]) ??
          `${testId}:${timestamp ?? "no_ts"}:${row.sender_email ?? row.senderEmail ?? "unknown_sender"}:${row.recipient_email ?? row.recipientEmail ?? "unknown_recipient"}:${row.record_type ?? row.recordType ?? "record"}:${index}`;
        return `(
          '${esc(workspaceId)}',
          '${esc(rowId)}',
          ${sqlString(row.organization_id ?? row.organization)},
          '${esc(testId)}',
          ${sqlTimestamp(timestamp)},
          ${sqlDate(timestamp)},
          ${sqlBool(row.is_spam ?? row.isSpam)},
          ${sqlBool(row.has_category ?? row.hasCategory)},
          ${sqlString(row.sender_email ?? row.senderEmail)},
          ${sqlInt(row.sender_esp ?? row.senderEsp)},
          ${sqlString(row.recipient_email ?? row.recipientEmail)},
          ${sqlInt(row.recipient_esp ?? row.recipientEsp)},
          ${sqlInt(row.recipient_geo ?? row.recipientGeo)},
          ${sqlInt(row.recipient_type ?? row.recipientType)},
          ${sqlBool(row.spf_pass ?? row.spfPass)},
          ${sqlBool(row.dkim_pass ?? row.dkimPass)},
          ${sqlBool(row.dmarc_pass ?? row.dmarcPass)},
          ${sqlJson(row.smtp_ip_blacklist_report ?? row.smtpIpBlacklistReport)},
          ${sqlJson(row.authentication_failure_results ?? row.authenticationFailureResults)},
          ${sqlInt(row.record_type ?? row.recordType)},
          ${sqlJson(row)},
          CURRENT_TIMESTAMP
        )`;
      }),
  );
}

async function storeCampaignDirectory(
  conn: DuckDBConnection,
  workspaceId: string,
  campaigns: Array<Record<string, unknown>>,
  analyticsByCampaign: Map<string, Record<string, unknown>>,
) {
  await insertRows(
    conn,
    "campaigns",
    [
      "id",
      "workspace_id",
      "organization_id",
      "name",
      "status",
      "daily_limit",
      "text_only",
      "open_tracking",
      "link_tracking",
      "schedule_timezone",
      "sequence_count",
      "step_count",
      "timestamp_created",
      "timestamp_updated",
      "synced_at",
    ],
    campaigns
      .filter((campaign) => String(campaign.id ?? "").trim())
      .map(
        (campaign) => `(
          '${esc(String(campaign.id ?? ""))}',
          '${esc(workspaceId)}',
          ${sqlString(campaign.organization ?? campaign.organization_id)},
          ${sqlString(campaign.name)},
          ${sqlString(mapCampaignStatus(campaign.status))},
          ${sqlInt(campaign.daily_limit)},
          ${sqlBool(campaign.text_only)},
          ${sqlBool(campaign.open_tracking)},
          ${sqlBool(campaign.link_tracking)},
          ${sqlString((campaign.campaign_schedule as Record<string, unknown> | undefined)?.timezone)},
          NULL,
          NULL,
          ${sqlTimestamp(campaign.timestamp_created)},
          ${sqlTimestamp(campaign.timestamp_updated)},
          CURRENT_TIMESTAMP
        )`,
      ),
  );

  await insertRows(
    conn,
    "campaign_analytics",
    [
      "workspace_id",
      "campaign_id",
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
    campaigns
      .map((campaign) => {
        const campaignId = String(campaign.id ?? "");
        if (!campaignId) return null;
        const analytics = analyticsByCampaign.get(campaignId);
        if (!analytics) return null;
        return `(
          '${esc(workspaceId)}',
          '${esc(campaignId)}',
          ${sqlString(analytics.campaign_name ?? campaign.name)},
          ${sqlInt(analytics.leads_count)},
          ${sqlInt(analytics.contacted_count)},
          ${sqlInt(analytics.emails_sent_count)},
          ${sqlInt(analytics.new_leads_contacted_count)},
          ${sqlInt(analytics.open_count)},
          ${sqlInt(analytics.open_count_unique)},
          ${sqlInt(analytics.reply_count)},
          ${sqlInt(analytics.reply_count_unique)},
          ${sqlInt(analytics.reply_count_automatic)},
          ${sqlInt(analytics.link_click_count)},
          ${sqlInt(analytics.bounced_count)},
          ${sqlInt(analytics.unsubscribed_count)},
          ${sqlInt(analytics.completed_count)},
          ${sqlInt(analytics.total_opportunities)},
          ${sqlFloat(analytics.total_opportunity_value)},
          ${sqlInt(analytics.total_interested)},
          ${sqlInt(analytics.total_meeting_booked)},
          ${sqlInt(analytics.total_meeting_completed)},
          ${sqlInt(analytics.total_closed)},
          CURRENT_TIMESTAMP
        )`;
      })
      .filter(Boolean) as string[],
  );
}

function buildSyncLogId(source: RefreshSource, mode: RefreshMode) {
  return `${source}:${mode}:${process.pid}:${Date.now()}`;
}

async function fetchReplyEmails(
  apiKey: string,
  campaignId: string,
  accountEmails: Set<string>,
  templates: CampaignVariantTemplate[],
  plan: EmailFetchPlan,
) {
  const emails = await instantly.listAllEmails(
    apiKey,
    campaignId,
    plan.maxReplyPages,
    {
      emailType: "received",
      latestOfThread: plan.latestOfThread,
      minTimestampCreated: plan.minTimestampCreated,
      limit: DEFAULT_PAGE_SIZE,
    },
  ).catch(() =>
    instantly.listAllEmails(apiKey, campaignId, plan.maxReplyPages, {
      minTimestampCreated: plan.minTimestampCreated,
      latestOfThread: plan.latestOfThread,
      limit: DEFAULT_PAGE_SIZE,
    }),
  );

  return emails
    .filter((email) => {
      const fromEmail = String(email.from_address_email ?? "").trim().toLowerCase();
      return !accountEmails.has(fromEmail);
    })
    .map((email): ReplyEmailRecord => ({
      id: String(email.id ?? ""),
      campaignId,
      threadId: String(email.thread_id ?? ""),
      leadEmail:
        emailOrNull(email.lead_email) ??
        emailOrNull(email.lead) ??
        emailOrNull(email.from_address_email) ??
        "",
      messageId: typeof email.message_id === "string" ? email.message_id : null,
      eaccount: typeof email.eaccount === "string" ? email.eaccount : null,
      fromEmail: String(email.from_address_email ?? ""),
      toEmail: Array.isArray(email.to_address_email_list)
        ? String(email.to_address_email_list[0] ?? "")
        : String(email.lead ?? ""),
      subject: String(email.subject ?? ""),
      bodyText: toPlainText(email.body) || toPlainText(email.content_preview),
      bodyHtml: typeof (email.body as Record<string, unknown> | undefined)?.html === "string"
        ? String((email.body as Record<string, unknown>).html)
        : null,
      sentAt: email.timestamp_email ?? email.timestamp_created ?? null,
      isAutoReply: email.is_auto_reply ?? null,
      aiInterestValue: email.ai_interest_value ?? null,
      iStatus: email.i_status ?? null,
      contentPreview: email.content_preview ?? null,
      direction: "inbound",
      stepResolved:
        email.step != null && String(email.step).trim() !== ""
          ? String(email.step).trim()
          : null,
      variantResolved: resolveVariantForEmail(
        String(email.subject ?? ""),
        email.step,
        templates,
      ),
    }))
    .filter((email) => email.id);
}

function emailRecordFromInstantly(
  campaignId: string,
  email: Record<string, unknown>,
): ReplyEmailRecord | null {
  const id = String(email.id ?? "").trim();
  if (!id) return null;
  const body = email.body as Record<string, unknown> | undefined;
  const toEmail = Array.isArray(email.to_address_email_list)
    ? String(email.to_address_email_list[0] ?? "")
    : String(email.lead ?? "");
  return {
    id,
    campaignId,
    threadId: String(email.thread_id ?? ""),
    leadEmail:
      emailOrNull(email.lead_email) ??
      emailOrNull(email.lead) ??
      emailOrNull(email.from_address_email) ??
      "",
    messageId: typeof email.message_id === "string" ? email.message_id : null,
    eaccount: typeof email.eaccount === "string" ? email.eaccount : null,
    fromEmail: String(email.from_address_email ?? ""),
    toEmail,
    subject: String(email.subject ?? ""),
    bodyText: toPlainText(body) || toPlainText(email.content_preview),
    bodyHtml: typeof body?.html === "string" ? body.html : null,
    sentAt: email.timestamp_email ?? email.timestamp_created ?? null,
    isAutoReply: email.is_auto_reply ?? null,
    aiInterestValue: email.ai_interest_value ?? null,
    iStatus: email.i_status ?? null,
    contentPreview: email.content_preview ?? null,
    direction: "inbound",
    stepResolved:
      email.step != null && String(email.step).trim() !== ""
        ? String(email.step).trim()
        : null,
    variantResolved: null,
    hydratedAt: new Date().toISOString(),
  };
}

async function storeReplyEmails(
  conn: DuckDBConnection,
  workspaceId: string,
  emails: ReplyEmailRecord[],
) {
  await insertRows(
    conn,
    "reply_emails",
    [
      "workspace_id",
      "id",
      "campaign_id",
      "thread_id",
      "lead_email",
      "message_id",
      "eaccount",
      "from_email",
      "to_email",
      "subject",
      "body_text",
      "body_html",
      "sent_at",
      "is_auto_reply",
      "ai_interest_value",
      "i_status",
      "content_preview",
      "direction",
      "step_resolved",
      "variant_resolved",
      "hydrated_at",
      "synced_at",
    ],
    emails.map(
      (email) => `(
        '${esc(workspaceId)}',
        '${esc(email.id)}',
        '${esc(email.campaignId)}',
        ${sqlString(email.threadId)},
        ${sqlString(email.leadEmail)},
        ${sqlString(email.messageId)},
        ${sqlString(email.eaccount)},
        ${sqlString(email.fromEmail)},
        ${sqlString(email.toEmail)},
        ${sqlString(email.subject)},
        ${sqlString(email.bodyText)},
        ${sqlString(email.bodyHtml)},
        ${sqlTimestamp(email.sentAt)},
        ${sqlBool(email.isAutoReply)},
        ${sqlFloat(email.aiInterestValue)},
        ${sqlInt(email.iStatus)},
        ${sqlString(email.contentPreview)},
        ${sqlString(email.direction)},
        ${sqlString(email.stepResolved)},
        ${sqlString(email.variantResolved)},
        ${sqlTimestamp(email.hydratedAt ?? new Date().toISOString())},
        CURRENT_TIMESTAMP
      )`,
    ),
  );
}

async function countExistingReplyEmailIds(
  conn: DuckDBConnection,
  workspaceId: string,
  ids: string[],
) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) return 0;
  const workspaceSafe = esc(workspaceId);
  const idList = uniqueIds.map((id) => `'${esc(id)}'`).join(", ");
  const rows = await query(
    conn,
    `SELECT COUNT(*) AS count
     FROM sendlens.reply_emails
     WHERE workspace_id = '${workspaceSafe}'
       AND id IN (${idList})`,
  );
  return Number(rows[0]?.count ?? 0) || 0;
}

type HydrateReplyTextOptions = {
  workspaceId: string;
  campaignId: string;
  statuses: number[];
  maxPagesPerStatus: number;
  latestOfThread: boolean;
  mode: ReplyTextHydrationMode;
  db?: DuckDBConnection;
};

export async function hydrateReplyText(options: HydrateReplyTextOptions) {
  const apiKey = process.env.SENDLENS_INSTANTLY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing SENDLENS_INSTANTLY_API_KEY.");
  }

  const db = options.db ?? await getDb();
  const ownsDb = options.db == null;
  const workspaceSafe = esc(options.workspaceId);
  const campaignSafe = esc(options.campaignId);
  try {
  const campaignRows = await query(
    db,
    `SELECT id, name
     FROM sendlens.campaigns
     WHERE workspace_id = '${workspaceSafe}'
       AND id = '${campaignSafe}'
     LIMIT 1`,
  );
  const campaignName = typeof campaignRows[0]?.name === "string"
    ? campaignRows[0].name
    : options.campaignId;
  const emailType = "received";
  const statuses = [...new Set(options.statuses)].filter((status) =>
    Number.isInteger(status)
  );

  const startedAt = new Date().toISOString();
  const statusResults: Array<Record<string, unknown>> = [];
  let totalFetched = 0;
  let totalStored = 0;
  let totalInsertedNew = 0;
  let totalUpdatedExisting = 0;
  let totalSkippedAutoReplies = 0;

  for (const status of statuses) {
    const existingRows = await query(
      db,
      `SELECT COUNT(*) AS count
       FROM sendlens.reply_emails
       WHERE workspace_id = '${workspaceSafe}'
         AND campaign_id = '${campaignSafe}'
         AND i_status = ${sqlInt(status)}
         AND direction = 'inbound'`,
    );
    const existingCount = Number(existingRows[0]?.count ?? 0) || 0;
    const missingBodyRows = await query(
      db,
      `SELECT COUNT(*) AS count
       FROM sendlens.reply_context
       WHERE workspace_id = '${workspaceSafe}'
         AND campaign_id = '${campaignSafe}'
         AND lt_interest_status = ${sqlInt(status)}
         AND (
           reply_email_id IS NULL
           OR reply_body_text IS NULL
           OR trim(reply_body_text) = ''
         )`,
    );
    const missingBodyCount = Number(missingBodyRows[0]?.count ?? 0) || 0;
    const stateRows = await query(
      db,
      `SELECT next_starting_after, pages_hydrated, emails_hydrated, exhausted
       FROM sendlens.reply_email_hydration_state
       WHERE workspace_id = '${workspaceSafe}'
         AND campaign_id = '${campaignSafe}'
         AND i_status = ${sqlInt(status)}
         AND latest_of_thread = ${options.latestOfThread ? "TRUE" : "FALSE"}
         AND email_type = '${emailType}'
       LIMIT 1`,
    );
    const previousState = stateRows[0] ?? null;
    const wasExhausted = previousState?.exhausted === true;

    if (options.mode === "auto" && existingCount > 0 && missingBodyCount === 0) {
      statusResults.push({
        i_status: status,
        skipped: true,
        reason: "cached_rows_exist",
        existing_rows: existingCount,
        missing_reply_body_rows: missingBodyCount,
      });
      continue;
    }
    if (options.mode === "continue" && wasExhausted) {
      statusResults.push({
        i_status: status,
        skipped: true,
        reason: "pagination_exhausted",
        existing_rows: existingCount,
      });
      continue;
    }

    let cursor = options.mode === "continue"
      ? (typeof previousState?.next_starting_after === "string"
        ? previousState.next_starting_after
        : null)
      : null;
    let pagesFetched = 0;
    let rowsFetched = 0;
    let rowsStored = 0;
    let rowsInsertedNew = 0;
    let rowsUpdatedExisting = 0;
    let skippedAutoReplies = 0;
    let exhausted = false;
    let cursorFallbackUsed = false;

    for (let page = 0; page < options.maxPagesPerStatus; page++) {
      let response;
      try {
        response = await instantly.listEmails(
          apiKey,
          options.campaignId,
          cursor || undefined,
          {
            emailType: "received",
            iStatus: status,
            latestOfThread: options.latestOfThread,
            limit: DEFAULT_PAGE_SIZE,
            sortOrder: "desc",
          },
        );
      } catch (error) {
        if (
          options.mode !== "continue" ||
          page !== 0 ||
          !cursor ||
          !isInvalidEmailCursorError(error)
        ) {
          throw error;
        }
        cursorFallbackUsed = true;
        cursor = null;
        response = await instantly.listEmails(
          apiKey,
          options.campaignId,
          undefined,
          {
            emailType: "received",
            iStatus: status,
            latestOfThread: options.latestOfThread,
            limit: DEFAULT_PAGE_SIZE,
            sortOrder: "desc",
          },
        );
      }
      pagesFetched += 1;
      rowsFetched += response.items.length;
      cursor = response.nextCursor;

      const emails = response.items
        .filter((email) => {
          const isAutoReply = Number(email.is_auto_reply ?? 0) === 1 ||
            email.is_auto_reply === true;
          if (isAutoReply) skippedAutoReplies += 1;
          return !isAutoReply;
        })
        .map((email) => emailRecordFromInstantly(options.campaignId, email))
        .filter((email): email is ReplyEmailRecord => email != null);

      const existingFetchedIds = await countExistingReplyEmailIds(
        db,
        options.workspaceId,
        emails.map((email) => email.id),
      );
      await storeReplyEmails(db, options.workspaceId, emails);
      rowsStored += emails.length;
      rowsUpdatedExisting += existingFetchedIds;
      rowsInsertedNew += Math.max(0, emails.length - existingFetchedIds);

      if (options.mode === "sync_newest") {
        break;
      }
      if (!cursor || response.items.length < DEFAULT_PAGE_SIZE) {
        exhausted = true;
        break;
      }
    }

    const previousPages = Number(previousState?.pages_hydrated ?? 0) || 0;
    const previousEmails = Number(previousState?.emails_hydrated ?? 0) || 0;
    const priorPages = options.mode === "continue"
      ? Number(previousState?.pages_hydrated ?? 0) || 0
      : 0;
    const priorEmails = options.mode === "continue"
      ? Number(previousState?.emails_hydrated ?? 0) || 0
      : 0;
    const stateNextStartingAfter = options.mode === "sync_newest"
      ? (typeof previousState?.next_starting_after === "string"
        ? previousState.next_starting_after
        : cursor)
      : cursor;
    const statePagesHydrated = options.mode === "sync_newest"
      ? (previousState ? previousPages : pagesFetched)
      : priorPages + pagesFetched;
    const stateEmailsHydrated = options.mode === "sync_newest"
      ? (previousState ? previousEmails : rowsStored)
      : priorEmails + rowsStored;
    const stateExhausted = options.mode === "sync_newest"
      ? (previousState ? previousState.exhausted === true : !stateNextStartingAfter)
      : exhausted;
    await insertRows(
      db,
      "reply_email_hydration_state",
      [
        "workspace_id",
        "campaign_id",
        "i_status",
        "latest_of_thread",
        "email_type",
        "next_starting_after",
        "pages_hydrated",
        "emails_hydrated",
        "exhausted",
        "last_hydrated_at",
        "synced_at",
      ],
      [`(
        '${workspaceSafe}',
        '${campaignSafe}',
        ${sqlInt(status)},
        ${options.latestOfThread ? "TRUE" : "FALSE"},
        '${emailType}',
        ${sqlString(stateNextStartingAfter)},
        ${sqlInt(statePagesHydrated)},
        ${sqlInt(stateEmailsHydrated)},
        ${stateExhausted ? "TRUE" : "FALSE"},
        ${sqlTimestamp(new Date().toISOString())},
        CURRENT_TIMESTAMP
      )`],
    );

    totalFetched += rowsFetched;
    totalStored += rowsStored;
    totalInsertedNew += rowsInsertedNew;
    totalUpdatedExisting += rowsUpdatedExisting;
    totalSkippedAutoReplies += skippedAutoReplies;
    statusResults.push({
      i_status: status,
      existing_rows_before: existingCount,
      missing_reply_body_rows_before: missingBodyCount,
      pages_fetched: pagesFetched,
      rows_fetched: rowsFetched,
      rows_stored: rowsStored,
      rows_inserted_new: rowsInsertedNew,
      rows_updated_existing: rowsUpdatedExisting,
      skipped_auto_replies: skippedAutoReplies,
      next_starting_after: cursor,
      saved_next_starting_after: stateNextStartingAfter,
      exhausted,
      saved_exhausted: stateExhausted,
      cursor_fallback_used: cursorFallbackUsed,
    });
  }

  await appendTraceLog("reply_text.hydrate", {
    workspaceId: options.workspaceId,
    campaignId: options.campaignId,
    statuses,
    mode: options.mode,
    maxPagesPerStatus: options.maxPagesPerStatus,
    latestOfThread: options.latestOfThread,
    totalFetched,
    totalStored,
    totalInsertedNew,
    totalUpdatedExisting,
    totalSkippedAutoReplies,
  });

  return {
    schema_version: "reply_text_hydration.v1",
    workspace_id: options.workspaceId,
    campaign_id: options.campaignId,
    campaign_name: campaignName,
    mode: options.mode,
    statuses,
    latest_of_thread: options.latestOfThread,
    max_pages_per_status: options.maxPagesPerStatus,
    total_fetched: totalFetched,
    total_stored: totalStored,
    total_inserted_new: totalInsertedNew,
    total_updated_existing: totalUpdatedExisting,
    total_skipped_auto_replies: totalSkippedAutoReplies,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    status_results: statusResults,
  };
  } finally {
    if (ownsDb) {
      closeDb(db);
    }
  }
}

async function fetchLeadSample(
  apiKey: string,
  campaignId: string,
  totalLeads: number,
  totalReplyLeads: number,
  fullRaw: boolean,
  nonReplyLimit?: number,
) : Promise<LeadSampleResult> {
  const target =
    nonReplyLimit != null
      ? calculateNonReplyLeadSampleSize(totalLeads, totalReplyLeads, nonReplyLimit)
      : calculateAdaptiveNonReplyLeadSampleSize(totalLeads, totalReplyLeads);
  const signalReplyTarget = calculateAdaptiveSignalReplyTarget(totalLeads);
  const replyLeads = new Map<string, LeadRecord>();
  const nonReplyPool: LeadRecord[] = [];
  let filteredRows = 0;

  const collectLead = (lead: LeadRecord) => {
    if (!leadBelongsToCampaign(lead, campaignId)) {
      filteredRows += 1;
      return;
    }
    const key = normalizeEmail(lead.email) || String(lead.id ?? "");
    if (!key) return;
    if (leadHasReplySignal(lead)) {
      replyLeads.set(key, lead);
      return;
    }
    nonReplyPool.push(lead);
  };

  if (fullRaw) {
    const leads = await instantly.listAllLeads(apiKey, campaignId, 50, {
      limit: DEFAULT_PAGE_SIZE,
    });
    for (const lead of leads) {
      collectLead(lead);
    }
    const nonReplyLeads = [...nonReplyPool];
    return {
      leads: [...replyLeads.values(), ...nonReplyLeads],
      source: "full_raw",
      replyLeadRows: replyLeads.size,
      nonReplyTarget: nonReplyLeads.length,
      nonReplyRowsSampled: nonReplyLeads.length,
      filteredRows,
    };
  }

  let cursor: string | null = null;
  const maxPages = Math.min(
    Math.max(MAX_SAMPLE_PAGES, MIN_SIGNAL_SCAN_PAGES),
    SESSION_START_MAX_REPLY_LEAD_PAGES,
    MAX_REPLY_LEAD_PAGES,
  );
  const minimumSignalScanPages = Math.min(MIN_SIGNAL_SCAN_PAGES, maxPages);

  for (let page = 0; page < maxPages; page++) {
    const response = await instantly.listLeadsPage(apiKey, campaignId, cursor || undefined, {
      limit: DEFAULT_PAGE_SIZE,
    });
    cursor = response.nextCursor;

    for (const lead of response.items) {
      collectLead(lead);
    }

    if (!cursor || response.items.length < DEFAULT_PAGE_SIZE) break;
    const hasEnoughNonReplyCoverage = nonReplyPool.length >= target;
    const hasEnoughSignalReplies = replyLeads.size >= signalReplyTarget;
    const scannedEnoughPagesForSignalReplies = page + 1 >= minimumSignalScanPages;
    if (
      hasEnoughNonReplyCoverage
      && hasEnoughSignalReplies
      && scannedEnoughPagesForSignalReplies
    ) {
      break;
    }
  }

  const nonReplyLeads = reservoirSample(nonReplyPool, target);
  return {
    leads: [...replyLeads.values(), ...nonReplyLeads],
    source: "replied_full_plus_recent_nonreply_sample",
    replyLeadRows: replyLeads.size,
    nonReplyTarget: target,
    nonReplyRowsSampled: nonReplyLeads.length,
    filteredRows,
  };
}

function buildReconstructedOutboundSample(
  campaignId: string,
  leadSample: LeadSampleResult,
  templates: CampaignVariantTemplate[],
): Promise<OutboundSampleResult> {
  const reconstructedRows = leadSample.leads
    .map((lead) => {
      const resolved = resolveLeadTemplate(lead, templates);
      if (!resolved.template || !lead.email) return null;
      const renderedSubject = renderTemplateValue(resolved.template.subject, lead);
      const renderedBody = renderTemplateValue(resolved.template.bodyText, lead);
      const sampleSource = leadHasReplySignal(lead)
        ? "reconstructed_reply_template"
        : resolved.resolutionSource === "default_first_variant"
          ? "reconstructed_default_template"
          : "reconstructed_sample_template";
      return {
        id: String(lead.id ?? `${campaignId}:${lead.email}:${resolved.stepResolved ?? "na"}:${resolved.variantResolved ?? "na"}`),
        campaignId,
        toEmail: String(lead.email),
        fromEmail: "",
        subject: renderedSubject ?? resolved.template.subject ?? "",
        bodyText: renderedBody ?? resolved.template.bodyText ?? "",
        sentAt:
          lead.timestamp_last_reply ??
          lead.timestamp_last_contact ??
          lead.timestamp_last_touch ??
          lead.timestamp_last_open ??
          null,
        stepResolved: resolved.stepResolved,
        variantResolved: resolved.variantResolved,
        contentPreview: (renderedBody ?? resolved.template.bodyText ?? "").slice(0, 280),
        sampleSource,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  const replyOutboundRows = reconstructedRows.filter((row) =>
    row.sampleSource === "reconstructed_reply_template"
  ).length;
  const nonReplyRowsSampled = reconstructedRows.length - replyOutboundRows;

  return Promise.resolve({
    emails: reconstructedRows,
    source: "lead_template_reconstruction",
    replyOutboundRows,
    nonReplyRowsSampled,
  });
}

async function hydrateCampaignRefreshBundle(
  apiKey: string,
  campaign: Record<string, unknown>,
  analyticsRow: Record<string, unknown> | undefined,
  options: RefreshOptions,
): Promise<CampaignRefreshBundle> {
  const campaignId = String(campaign.id ?? "");
  const campaignStartedAt = Date.now();
  const detailStartedAt = Date.now();
  const stepStartedAt = Date.now();
  const [detail, rawStepAnalytics] = await Promise.all([
    instantly.getCampaignDetails(apiKey, campaignId),
    instantly.getStepAnalytics(apiKey, campaignId, {
      includeOpportunitiesCount: true,
    }),
  ]);
  const templates = extractCampaignVariants(detail);
  const detailElapsedMs = Date.now() - detailStartedAt;
  const { validRows: stepAnalytics, skippedRows: skippedStepAnalytics } =
    normalizeStepAnalyticsRows(rawStepAnalytics);
  const stepElapsedMs = Date.now() - stepStartedAt;

  if (skippedStepAnalytics > 0) {
    console.warn(
      `[sendlens] Skipped ${skippedStepAnalytics} malformed step analytics row(s) for campaign ${campaignId}.`,
    );
  }

  const totalLeads = Number(analyticsRow?.leads_count ?? 0) || 0;
  const totalSent = Number(analyticsRow?.emails_sent_count ?? 0) || 0;
  const totalUniqueReplies = Number(analyticsRow?.reply_count_unique ?? 0) || 0;
  const fullRaw = options.forceHybrid ? false : false;

  const leadSampleStartedAt = Date.now();
  const leadSample = await fetchLeadSample(
    apiKey,
    campaignId,
    totalLeads,
    totalUniqueReplies,
    fullRaw,
    options.nonReplyLeadLimit,
  );
  const leadSampleElapsedMs = Date.now() - leadSampleStartedAt;

  const outboundStartedAt = Date.now();
  const outboundSample = await buildReconstructedOutboundSample(
    campaignId,
    leadSample,
    templates,
  );
  const outboundElapsedMs = Date.now() - outboundStartedAt;

  return {
    campaign,
    campaignId,
    analyticsRow,
    detail,
    templates,
    rawStepAnalytics,
    stepAnalytics,
    skippedStepAnalytics,
    leadSample,
    outboundSample,
    totalUniqueReplies,
    fullRaw,
    detailElapsedMs,
    stepElapsedMs,
    leadSampleElapsedMs,
    outboundElapsedMs,
    totalElapsedMs: Date.now() - campaignStartedAt,
  };
}

async function storeCampaignData(
  conn: DuckDBConnection,
  workspaceId: string,
  campaign: Record<string, unknown>,
  analytics: Record<string, unknown> | undefined,
  detail: Record<string, unknown>,
  stepAnalytics: Array<Record<string, unknown>>,
  replyEmails: ReplyEmailRecord[],
  leadSample: LeadSampleResult,
  outboundSample: OutboundSampleResult,
  templates: CampaignVariantTemplate[],
) {
  const campaignId = String(campaign.id ?? "");
  if (!campaignId) return;
  const firstSequence = Array.isArray(detail.sequences) && detail.sequences.length > 0
    ? detail.sequences[0] as Record<string, unknown>
    : null;
  const firstSequenceSteps = Array.isArray(firstSequence?.steps)
    ? firstSequence.steps as unknown[]
    : [];

  await insertRows(
    conn,
    "campaigns",
    [
      "id",
      "workspace_id",
      "organization_id",
      "name",
      "status",
      "daily_limit",
      "text_only",
      "open_tracking",
      "link_tracking",
      "schedule_timezone",
      "sequence_count",
      "step_count",
      "timestamp_created",
      "timestamp_updated",
      "synced_at",
    ],
    [
      `(
        '${esc(campaignId)}',
        '${esc(workspaceId)}',
        ${sqlString(campaign.organization ?? campaign.organization_id)},
        ${sqlString(campaign.name)},
        ${sqlString(mapCampaignStatus(campaign.status))},
        ${sqlInt(campaign.daily_limit)},
        ${sqlBool(campaign.text_only)},
        ${sqlBool(campaign.open_tracking)},
        ${sqlBool(campaign.link_tracking)},
        ${sqlString(
          (campaign.campaign_schedule as Record<string, unknown> | undefined)?.timezone ??
            (detail.campaign_schedule as Record<string, unknown> | undefined)?.timezone,
        )},
        ${sqlInt(Array.isArray(detail.sequences) ? detail.sequences.length : null)},
        ${sqlInt(firstSequenceSteps.length || null)},
        ${sqlTimestamp(campaign.timestamp_created)},
        ${sqlTimestamp(campaign.timestamp_updated)},
        CURRENT_TIMESTAMP
      )`,
    ],
  );

  await storeCampaignAccountAssignments(conn, workspaceId, campaignId, detail);

  if (analytics) {
    await insertRows(
      conn,
      "campaign_analytics",
      [
        "workspace_id",
        "campaign_id",
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
      [
        `(
          '${esc(workspaceId)}',
          '${esc(campaignId)}',
          ${sqlString(analytics.campaign_name ?? campaign.name)},
          ${sqlInt(analytics.leads_count)},
          ${sqlInt(analytics.contacted_count)},
          ${sqlInt(analytics.emails_sent_count)},
          ${sqlInt(analytics.new_leads_contacted_count)},
          ${sqlInt(analytics.open_count)},
          ${sqlInt(analytics.open_count_unique)},
          ${sqlInt(analytics.reply_count)},
          ${sqlInt(analytics.reply_count_unique)},
          ${sqlInt(analytics.reply_count_automatic)},
          ${sqlInt(analytics.link_click_count)},
          ${sqlInt(analytics.bounced_count)},
          ${sqlInt(analytics.unsubscribed_count)},
          ${sqlInt(analytics.completed_count)},
          ${sqlInt(analytics.total_opportunities)},
          ${sqlFloat(analytics.total_opportunity_value)},
          ${sqlInt(analytics.total_interested)},
          ${sqlInt(analytics.total_meeting_booked)},
          ${sqlInt(analytics.total_meeting_completed)},
          ${sqlInt(analytics.total_closed)},
          CURRENT_TIMESTAMP
        )`,
      ],
    );
  }

  await insertRows(
    conn,
    "step_analytics",
    [
      "workspace_id",
      "campaign_id",
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
    normalizeStepAnalyticsRows(stepAnalytics).validRows.map(
      (row) => `(
        '${esc(workspaceId)}',
        '${esc(campaignId)}',
        ${sqlInt(row.step)},
        ${sqlInt(row.variant)},
        ${sqlInt(row.sent)},
        ${sqlInt(row.opened)},
        ${sqlInt(row.replies)},
        ${sqlInt(row.repliesAutomatic)},
        ${sqlInt(row.uniqueReplies)},
        ${sqlInt(row.clicks)},
        ${sqlInt(row.bounces)},
        ${sqlInt(row.opportunities)},
        CURRENT_TIMESTAMP
      )`,
    ),
  );

  await insertRows(
    conn,
    "campaign_variants",
    [
      "workspace_id",
      "campaign_id",
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
    templates.map(
      (template) => `(
        '${esc(workspaceId)}',
        '${esc(campaignId)}',
        ${sqlInt(template.sequenceIndex)},
        ${sqlInt(template.step)},
        ${sqlInt(template.variant)},
        ${sqlString(template.stepType)},
        ${sqlInt(template.delayValue)},
        ${sqlString(template.delayUnit)},
        ${sqlString(template.subject)},
        ${sqlString(template.bodyText)},
        CURRENT_TIMESTAMP
      )`,
    ),
  );

  await insertRows(
    conn,
    "reply_emails",
    [
      "workspace_id",
      "id",
      "campaign_id",
      "thread_id",
      "lead_email",
      "message_id",
      "eaccount",
      "from_email",
      "to_email",
      "subject",
      "body_text",
      "body_html",
      "sent_at",
      "is_auto_reply",
      "ai_interest_value",
      "i_status",
      "content_preview",
      "direction",
      "step_resolved",
      "variant_resolved",
      "hydrated_at",
      "synced_at",
    ],
    replyEmails.map(
      (email) => `(
        '${esc(workspaceId)}',
        '${esc(email.id)}',
        '${esc(campaignId)}',
        ${sqlString(email.threadId)},
        ${sqlString(email.leadEmail)},
        ${sqlString(email.messageId)},
        ${sqlString(email.eaccount)},
        ${sqlString(email.fromEmail)},
        ${sqlString(email.toEmail)},
        ${sqlString(email.subject)},
        ${sqlString(email.bodyText)},
        ${sqlString(email.bodyHtml)},
        ${sqlTimestamp(email.sentAt)},
        ${sqlBool(email.isAutoReply)},
        ${sqlFloat(email.aiInterestValue)},
        ${sqlInt(email.iStatus)},
        ${sqlString(email.contentPreview)},
        ${sqlString(email.direction)},
        ${sqlString(email.stepResolved)},
        ${sqlString(email.variantResolved)},
        ${sqlTimestamp(email.hydratedAt ?? new Date().toISOString())},
        CURRENT_TIMESTAMP
      )`,
    ),
  );

  await insertRows(
    conn,
    "sampled_leads",
    [
      "workspace_id",
      "campaign_id",
      "id",
      "email",
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
      "sample_source",
      "sampled_at",
    ],
    leadSample.leads
      .filter((lead) => String(lead.email ?? ""))
      .map((lead) => {
        const payload = extractPayload(lead);
        return `(
          '${esc(workspaceId)}',
          '${esc(campaignId)}',
          ${sqlString(lead.id)},
          ${sqlString(lead.email)},
          ${sqlString(lead.first_name)},
          ${sqlString(lead.last_name)},
          ${sqlString(lead.company_name)},
          ${sqlString(lead.company_domain)},
          ${sqlString(lead.status)},
          ${sqlInt(lead.email_open_count)},
          ${sqlInt(lead.email_reply_count)},
          ${sqlInt(lead.email_click_count)},
          ${sqlInt(lead.lt_interest_status)},
          ${sqlInt(lead.email_opened_step)},
          ${sqlInt(lead.email_opened_variant)},
          ${sqlInt(lead.email_replied_step)},
          ${sqlInt(lead.email_replied_variant)},
          ${sqlInt(lead.email_clicked_step)},
          ${sqlInt(lead.email_clicked_variant)},
          ${sqlInt(lead.esp_code)},
          ${sqlInt(lead.verification_status)},
          ${sqlInt(lead.enrichment_status)},
          ${sqlTimestamp(lead.timestamp_last_contact)},
          ${sqlTimestamp(lead.timestamp_last_reply)},
          ${sqlString(lead.job_title)},
          ${sqlString(lead.website ?? payload.website)},
          ${sqlString(lead.phone)},
          ${sqlString(lead.personalization ?? payload.personalization)},
          ${sqlJson(lead.status_summary)},
          ${sqlString(lead.subsequence_id)},
          ${sqlString(lead.list_id)},
          ${sqlJson(payload)},
          ${sqlString(leadSample.source)},
          CURRENT_TIMESTAMP
        )`;
      }),
  );

  await insertRows(
    conn,
    "sampled_outbound_emails",
    [
      "workspace_id",
      "campaign_id",
      "id",
      "to_email",
      "from_email",
      "subject",
      "body_text",
      "sent_at",
      "step_resolved",
      "variant_resolved",
      "content_preview",
      "sample_source",
      "sampled_at",
    ],
    outboundSample.emails.map(
      (email) => `(
        '${esc(workspaceId)}',
        '${esc(campaignId)}',
        '${esc(String(email.id ?? ""))}',
        ${sqlString(email.toEmail)},
        ${sqlString(email.fromEmail)},
        ${sqlString(email.subject)},
        ${sqlString(email.bodyText)},
        ${sqlTimestamp(email.sentAt)},
        ${sqlString(email.stepResolved)},
        ${sqlString(email.variantResolved)},
        ${sqlString(email.contentPreview)},
        ${sqlString(email.sampleSource ?? outboundSample.source)},
        CURRENT_TIMESTAMP
      )`,
    ),
  );

  const analyticsRow = analytics ?? {};
  const totalLeads = Number(analyticsRow.leads_count ?? 0) || 0;
  const totalSent = Number(analyticsRow.emails_sent_count ?? 0) || 0;
  const ingestMode = inferSamplingMode(totalLeads, totalSent);
  const note =
    ingestMode === "full"
      ? "Full lead ingest because campaign volume is below the local threshold."
      : "Hybrid ingest: exact aggregates plus full reply-lead profiles and a bounded non-reply lead sample.";
  const outboundSampleTarget =
    ingestMode === "full"
      ? outboundSample.emails.length
      : leadSample.leads.length;

  await insertRows(
    conn,
    "sampling_runs",
    [
      "workspace_id",
      "campaign_id",
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
    [
      `(
        '${esc(workspaceId)}',
        '${esc(campaignId)}',
        '${ingestMode}',
        ${sqlInt(totalLeads)},
        ${sqlInt(totalSent)},
        ${sqlInt(leadSample.replyLeadRows)},
        ${sqlInt(leadSample.replyLeadRows)},
        ${sqlInt(leadSample.nonReplyTarget)},
        ${sqlInt(leadSample.nonReplyRowsSampled)},
        ${sqlInt(outboundSampleTarget)},
        ${sqlInt(outboundSample.emails.length)},
        ${sqlInt(outboundSample.replyOutboundRows)},
        ${sqlInt(leadSample.filteredRows)},
        ${sqlString(
          `${note} Outbound copy is reconstructed locally from campaign templates plus lead variables. Filtered ${leadSample.filteredRows} lead rows that belonged to other campaigns.`,
        )},
        CURRENT_TIMESTAMP
      )`,
    ],
  );
}

export async function refreshWorkspace(options: RefreshOptions = {}) {
  const apiKey = process.env.SENDLENS_INSTANTLY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing SENDLENS_INSTANTLY_API_KEY.");
  }

  const db = await getDb();
  const source: RefreshSource = options.source ?? (options.campaignIds?.length ? "manual" : "session_start");
  const mode: RefreshMode = "fast";
  const refreshStartedAt = Date.now();
  const syncLogId = buildSyncLogId(source, mode);
  try {
    await appendTraceLog("refresh.start", {
      source,
      mode,
      scopedCampaignIds: options.campaignIds?.length ?? 0,
      strategy: "leads_plus_templates_v1",
    });

    await writeRefreshStatus({
      status: "running",
      source,
      pid: process.pid,
      workspaceId: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
      campaignsTotal: 0,
      campaignsProcessed: 0,
      currentCampaignId: null,
      currentCampaignName: null,
      message: "Loading campaign list from Instantly.",
    });

    const campaignsStartedAt = Date.now();
    const campaigns = await instantly.listCampaigns(apiKey);
    const activeCampaigns = campaigns.filter((campaign) => isCampaignActivelySending(campaign));
    const selectedCampaigns = options.campaignIds?.length
      ? campaigns.filter((campaign) => options.campaignIds!.includes(String(campaign.id ?? "")))
      : activeCampaigns;
    await appendTraceLog("refresh.campaign_scope", {
      totalCampaigns: campaigns.length,
      activeCampaigns: activeCampaigns.length,
      selectedCampaigns: selectedCampaigns.length,
      elapsedMs: Date.now() - campaignsStartedAt,
    });
    if (selectedCampaigns.length === 0) {
      throw new Error("No campaigns matched the requested refresh scope.");
    }

    const metadataStartedAt = Date.now();
    const analytics = await instantly.getCampaignAnalytics(apiKey);
    const analyticsByCampaign = new Map(
      analytics.map((row) => [String(row.campaign_id ?? ""), row]),
    );
    const accounts = await instantly.listAccounts(apiKey);
    const accountEmails = new Set(
      accounts
        .map((account) => String(account.email ?? "").trim().toLowerCase())
        .filter(Boolean),
    );
    const dailyAccountMetrics = await instantly.getDailyAccountAnalytics(apiKey);
    const warmup = await instantly.getWarmupAnalytics(apiKey, [...accountEmails]);
    await appendTraceLog("refresh.workspace_metadata", {
      analyticsRows: analytics.length,
      accountCount: accounts.length,
      accountEmailCount: accountEmails.size,
      dailyMetricRows: dailyAccountMetrics.length,
      warmupAccounts: Object.keys(warmup.aggregate_data ?? {}).length,
      elapsedMs: Date.now() - metadataStartedAt,
    });
    const workspaceId = deriveWorkspaceId([
      selectedCampaigns[0],
      accounts[0],
      analytics[0],
    ]);
    await writeRefreshStatus({
      workspaceId,
      campaignsTotal: selectedCampaigns.length,
      campaignsProcessed: 0,
      message: "Refreshing workspace metadata and campaign analytics.",
    });

    const selectedCampaignIds = selectedCampaigns
      .map((campaign) => String(campaign.id ?? ""))
      .filter(Boolean);

    await clearWorkspaceData(db, workspaceId, selectedCampaignIds);
    await storeCampaignDirectory(db, workspaceId, campaigns, analyticsByCampaign);
    if (!options.campaignIds?.length) {
      await clearWorkspaceMetadata(db, workspaceId);
      const tagsStartedAt = Date.now();
      const inboxPlacementStartedAt = Date.now();
      const [customTags, customTagMappings, inboxPlacement] = await Promise.all([
        instantly.listAllCustomTags(apiKey),
        instantly.listAllCustomTagMappings(apiKey, 200, {
          resourceIds: [
            ...selectedCampaigns.map((campaign) => String(campaign.id ?? "")).filter(Boolean),
            ...accountEmails,
          ],
        }),
        loadInboxPlacementData(apiKey),
      ]);
      await appendTraceLog("refresh.tags", {
        customTags: customTags.length,
        customTagMappings: customTagMappings.length,
        elapsedMs: Date.now() - tagsStartedAt,
      });
      await appendTraceLog("refresh.inbox_placement", {
        tests: inboxPlacement.tests.length,
        analyticsRows: inboxPlacement.analytics.length,
        skipped: inboxPlacement.skipped,
        skipReason: inboxPlacement.skipReason,
        failedAnalyticsTests: inboxPlacement.failedAnalyticsTests,
        elapsedMs: Date.now() - inboxPlacementStartedAt,
      });
      await storeWorkspaceAccounts(db, workspaceId, accounts, dailyAccountMetrics, warmup);
      await storeCustomTags(db, workspaceId, customTags, customTagMappings);
      await storeInboxPlacementData(
        db,
        workspaceId,
        inboxPlacement.tests,
        inboxPlacement.analytics,
      );
    }

    let campaignsProcessed = 0;
    await writeRefreshStatus({
      workspaceId,
      campaignsTotal: selectedCampaigns.length,
      campaignsProcessed,
      currentCampaignId: null,
      currentCampaignName: null,
      message: `Refreshing ${selectedCampaigns.length} campaigns with concurrency ${Math.min(REFRESH_CAMPAIGN_CONCURRENCY, selectedCampaigns.length)}.`,
    });

    for (let start = 0; start < selectedCampaigns.length; start += REFRESH_CAMPAIGN_CONCURRENCY) {
      const batch = selectedCampaigns.slice(start, start + REFRESH_CAMPAIGN_CONCURRENCY);
      const bundles = await Promise.all(
        batch.map((campaign) =>
          hydrateCampaignRefreshBundle(
            apiKey,
            campaign,
            analyticsByCampaign.get(String(campaign.id ?? "")),
            options,
          ),
        ),
      );

      for (const bundle of bundles) {
        await storeCampaignData(
          db,
          workspaceId,
          bundle.campaign,
          bundle.analyticsRow,
          bundle.detail,
          bundle.stepAnalytics,
          [],
          bundle.leadSample,
          bundle.outboundSample,
          bundle.templates,
        );
        campaignsProcessed += 1;
        await appendTraceLog("refresh.campaign", {
          campaignId: bundle.campaignId,
          campaignName: String(bundle.campaign.name ?? bundle.campaignId),
          index: campaignsProcessed,
          total: selectedCampaigns.length,
          fullRaw: bundle.fullRaw,
          templates: bundle.templates.length,
          rawStepAnalyticsRows: bundle.rawStepAnalytics.length,
          stepAnalyticsRows: bundle.stepAnalytics.length,
          skippedStepAnalytics: bundle.skippedStepAnalytics,
          exactUniqueReplies: bundle.totalUniqueReplies,
          leadSampleRows: bundle.leadSample.leads.length,
          leadSampleSource: bundle.leadSample.source,
          replyLeadRows: bundle.leadSample.replyLeadRows,
          nonReplyRowsSampled: bundle.leadSample.nonReplyRowsSampled,
          filteredLeadRows: bundle.leadSample.filteredRows,
          outboundRows: bundle.outboundSample.emails.length,
          outboundSource: bundle.outboundSample.source,
          replyOutboundRows: bundle.outboundSample.replyOutboundRows,
          nonReplyOutboundRows: bundle.outboundSample.nonReplyRowsSampled,
          detailElapsedMs: bundle.detailElapsedMs,
          stepElapsedMs: bundle.stepElapsedMs,
          leadSampleElapsedMs: bundle.leadSampleElapsedMs,
          outboundElapsedMs: bundle.outboundElapsedMs,
          totalElapsedMs: bundle.totalElapsedMs,
        });

        await writeRefreshStatus({
          workspaceId,
          campaignsTotal: selectedCampaigns.length,
          campaignsProcessed,
          currentCampaignId: bundle.campaignId,
          currentCampaignName: String(bundle.campaign.name ?? bundle.campaignId),
          message: `Stored campaign ${campaignsProcessed} of ${selectedCampaigns.length}.`,
        });
      }
    }

    await setActiveWorkspaceId(db, workspaceId, "fast");
    const summary = await buildWorkspaceSummary(db, workspaceId);
    await appendTraceLog("refresh.complete", {
      workspaceId,
      source,
      mode,
      campaigns: selectedCampaigns.length,
      totalElapsedMs: Date.now() - refreshStartedAt,
    });
    const finishedAt = new Date().toISOString();
    await appendSyncLog(db, {
      id: syncLogId,
      workspaceId,
      source,
      mode,
      status: "succeeded",
      scopedCampaignIds: options.campaignIds ?? null,
      campaignsTotal: selectedCampaigns.length,
      campaignsProcessed: selectedCampaigns.length,
      startedAt: new Date(refreshStartedAt).toISOString(),
      endedAt: finishedAt,
      durationMs: Date.now() - refreshStartedAt,
      message: `Refresh completed for ${selectedCampaigns.length} campaigns.`,
    });
    await writeRefreshStatus({
      status: "succeeded",
      source,
      workspaceId,
      endedAt: finishedAt,
      lastSuccessAt: finishedAt,
      campaignsTotal: selectedCampaigns.length,
      campaignsProcessed: selectedCampaigns.length,
      currentCampaignId: null,
      currentCampaignName: null,
      message: `Refresh completed for ${selectedCampaigns.length} campaigns.`,
    });
    return summary;
  } catch (error) {
    await appendSyncLog(db, {
      id: syncLogId,
      workspaceId: null,
      source,
      mode,
      status: "failed",
      scopedCampaignIds: options.campaignIds ?? null,
      startedAt: new Date(refreshStartedAt).toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - refreshStartedAt,
      message: error instanceof Error ? error.message : String(error),
    });
    await appendTraceLog("refresh.failed", {
      source,
      mode,
      totalElapsedMs: Date.now() - refreshStartedAt,
      message: error instanceof Error ? error.message : String(error),
    });
    await writeRefreshStatus({
      status: "failed",
      endedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    closeDb(db);
  }
}
