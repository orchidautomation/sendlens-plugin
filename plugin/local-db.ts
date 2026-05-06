import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import {
  DEFAULT_DB_DIRECTORY,
  DEFAULT_DB_FILENAME,
  PUBLIC_TABLES,
} from "./constants";

const DEFAULT_DB_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_DB_CONNECT_RETRY_MS = 250;
const LOCK_ERROR_PATTERNS = [
  /database is locked/i,
  /could not set lock/i,
  /conflicting lock/i,
  /lock.*held/i,
  /resource temporarily unavailable/i,
  /io error.*lock/i,
  /failure while replaying WAL/i,
  /replaying WAL file/i,
  /WAL replay/i,
];
const connectionInstances = new WeakMap<DuckDBConnection, DuckDBInstance>();

export type GetDbOptions = {
  timeoutMs?: number;
  retryMs?: number;
};

export class LocalDbUnavailableError extends Error {
  code = "duckdb_unavailable" as const;
  cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "LocalDbUnavailableError";
    this.cause = cause;
  }
}

export function resolveDbPath() {
  const configured = process.env.SENDLENS_DB_PATH?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
  }
  return path.join(os.homedir(), DEFAULT_DB_DIRECTORY, DEFAULT_DB_FILENAME);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNonNegativeInteger(value: string | undefined, fallback: number) {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeRetryMs(retryMs: number) {
  if (!Number.isFinite(retryMs)) return DEFAULT_DB_CONNECT_RETRY_MS;
  return Math.max(1, Math.floor(retryMs));
}

function errorMessages(error: unknown) {
  const messages: string[] = [];
  let current: unknown = error;

  for (let depth = 0; current != null && depth < 5; depth += 1) {
    if (current instanceof Error) {
      messages.push(`${current.name}: ${current.message}`);
      current = (current as Error & { cause?: unknown }).cause;
      continue;
    }

    if (typeof current === "object" && "message" in current) {
      messages.push(String((current as { message?: unknown }).message));
      current = (current as { cause?: unknown }).cause;
      continue;
    }

    messages.push(String(current));
    break;
  }

  return messages;
}

export function isDuckDbLockError(error: unknown) {
  const combined = errorMessages(error).join("\n");
  return LOCK_ERROR_PATTERNS.some((pattern) => pattern.test(combined));
}

async function initConnection() {
  const dbPath = resolveDbPath();
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  let instance: DuckDBInstance | null = null;
  let conn: DuckDBConnection | null = null;

  try {
    instance = await DuckDBInstance.create(dbPath);
    conn = await instance.connect();
    await ensureSchema(conn);
    connectionInstances.set(conn, instance);
    return conn;
  } catch (error) {
    if (conn) {
      try {
        conn.closeSync();
      } catch {
        // Best effort cleanup before retrying a transient DuckDB lock.
      }
    }
    if (instance) {
      try {
        instance.closeSync();
      } catch {
        // Best effort cleanup before retrying a transient DuckDB lock.
      }
    }
    throw error;
  }
}

export async function getDb(
  options: GetDbOptions = {},
): Promise<DuckDBConnection> {
  const timeoutMs = Math.max(
    0,
    Math.floor(
      options.timeoutMs ??
        parseNonNegativeInteger(
          process.env.SENDLENS_DB_CONNECT_TIMEOUT_MS,
          DEFAULT_DB_CONNECT_TIMEOUT_MS,
        ),
    ),
  );
  const retryMs = normalizeRetryMs(
    options.retryMs ??
      parseNonNegativeInteger(
        process.env.SENDLENS_DB_CONNECT_RETRY_MS,
        DEFAULT_DB_CONNECT_RETRY_MS,
      ),
  );
  const startedAt = Date.now();
  let lastError: unknown;

  for (;;) {
    try {
      return await initConnection();
    } catch (error) {
      if (!isDuckDbLockError(error)) throw error;
      lastError = error;

      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= timeoutMs) {
        throw new LocalDbUnavailableError(
          "The local SendLens DuckDB cache is temporarily unavailable, likely because a refresh is still finishing or DuckDB is replaying a stale WAL. Check refresh_status once; if refresh_status is succeeded, reload or restart the host/plugin session before retrying.",
          lastError,
        );
      }

      await sleep(Math.min(retryMs, Math.max(1, timeoutMs - elapsedMs)));
    }
  }
}

export async function resetDbConnectionForTests() {
  return;
}

export function closeDb(conn: DuckDBConnection) {
  const instance = connectionInstances.get(conn);
  connectionInstances.delete(conn);
  let closeError: unknown;

  try {
    conn.closeSync();
  } catch (error) {
    closeError = error;
  }

  if (instance) {
    try {
      instance.closeSync();
    } catch (error) {
      closeError ??= error;
    }
  }

  if (closeError) {
    throw closeError;
  }
}

export async function query(
  conn: DuckDBConnection,
  sql: string,
): Promise<Record<string, unknown>[]> {
  const result = await conn.run(sql);
  return (await result.getRowObjectsJson()) as Record<string, unknown>[];
}

export async function run(conn: DuckDBConnection, sql: string) {
  await conn.run(sql);
}

async function ensureSchema(conn: DuckDBConnection) {
  const statements = [
    "CREATE SCHEMA IF NOT EXISTS sendlens",
    `CREATE TABLE IF NOT EXISTS sendlens.plugin_state (
      key VARCHAR PRIMARY KEY,
      value VARCHAR,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS sendlens.campaigns (
      id VARCHAR,
      workspace_id VARCHAR NOT NULL,
      organization_id VARCHAR,
      name VARCHAR,
      status VARCHAR,
      daily_limit INTEGER,
      text_only BOOLEAN,
      first_email_text_only BOOLEAN,
      open_tracking BOOLEAN,
      link_tracking BOOLEAN,
      stop_on_reply BOOLEAN,
      stop_on_auto_reply BOOLEAN,
      match_lead_esp BOOLEAN,
      allow_risky_contacts BOOLEAN,
      disable_bounce_protect BOOLEAN,
      insert_unsubscribe_header BOOLEAN,
      schedule_timezone VARCHAR,
      sequence_count INTEGER,
      step_count INTEGER,
      timestamp_created TIMESTAMP,
      timestamp_updated TIMESTAMP,
      synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, id)
    )`,
    `CREATE TABLE IF NOT EXISTS sendlens.campaign_analytics (
      workspace_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      campaign_name VARCHAR,
      leads_count INTEGER,
      contacted_count INTEGER,
      emails_sent_count INTEGER,
      new_leads_contacted_count INTEGER,
      open_count INTEGER,
      open_count_unique INTEGER,
      reply_count INTEGER,
      reply_count_unique INTEGER,
      reply_count_automatic INTEGER,
      link_click_count INTEGER,
      bounced_count INTEGER,
      unsubscribed_count INTEGER,
      completed_count INTEGER,
      total_opportunities INTEGER,
      total_opportunity_value DOUBLE,
      total_interested INTEGER,
      total_meeting_booked INTEGER,
      total_meeting_completed INTEGER,
      total_closed INTEGER,
      synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, campaign_id)
    )`,
    `CREATE TABLE IF NOT EXISTS sendlens.campaign_daily_metrics (
      workspace_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      date DATE NOT NULL,
      sent INTEGER,
      contacted INTEGER,
      new_leads_contacted INTEGER,
      opened INTEGER,
      unique_opened INTEGER,
      replies INTEGER,
      unique_replies INTEGER,
      replies_automatic INTEGER,
      unique_replies_automatic INTEGER,
      clicks INTEGER,
      unique_clicks INTEGER,
      opportunities INTEGER,
      unique_opportunities INTEGER,
      synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, campaign_id, date)
    )`,
    `CREATE TABLE IF NOT EXISTS sendlens.step_analytics (
      workspace_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      step INTEGER,
      variant INTEGER,
      sent INTEGER,
      opens INTEGER,
      replies INTEGER,
      replies_automatic INTEGER,
      unique_replies INTEGER,
      clicks INTEGER,
      bounces INTEGER,
      opportunities INTEGER,
      synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, campaign_id, step, variant)
    )`,
    `CREATE TABLE IF NOT EXISTS sendlens.campaign_variants (
      workspace_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      sequence_index INTEGER,
      step INTEGER,
      variant INTEGER,
      step_type VARCHAR,
      delay_value INTEGER,
      delay_unit VARCHAR,
      subject VARCHAR,
      body_text VARCHAR,
      synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, campaign_id, sequence_index, step, variant)
    )`,
    `CREATE TABLE IF NOT EXISTS sendlens.campaign_account_assignments (
      workspace_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      assignment_type VARCHAR NOT NULL,
      assignment_key VARCHAR NOT NULL,
      account_email VARCHAR,
      tag_id VARCHAR,
      synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, campaign_id, assignment_type, assignment_key)
    )`,
    `CREATE TABLE IF NOT EXISTS sendlens.accounts (
      workspace_id VARCHAR NOT NULL,
      email VARCHAR NOT NULL,
      organization_id VARCHAR,
      status VARCHAR,
      warmup_status VARCHAR,
      warmup_score DOUBLE,
      provider VARCHAR,
      daily_limit INTEGER,
      sending_gap INTEGER,
      first_name VARCHAR,
      last_name VARCHAR,
      total_sent_30d INTEGER,
      total_replies_30d INTEGER,
      total_bounces_30d INTEGER,
      synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, email)
    )`,
    `CREATE TABLE IF NOT EXISTS sendlens.account_daily_metrics (
      workspace_id VARCHAR NOT NULL,
      email VARCHAR NOT NULL,
      date DATE NOT NULL,
      sent INTEGER,
      bounced INTEGER,
      contacted INTEGER,
      new_leads_contacted INTEGER,
      opened INTEGER,
      unique_opened INTEGER,
      replies INTEGER,
      unique_replies INTEGER,
      replies_automatic INTEGER,
      unique_replies_automatic INTEGER,
      clicks INTEGER,
      unique_clicks INTEGER,
      synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, email, date)
    )`,
    `CREATE TABLE IF NOT EXISTS sendlens.custom_tags (
      workspace_id VARCHAR NOT NULL,
      id VARCHAR NOT NULL,
      organization_id VARCHAR,
      name VARCHAR,
      label VARCHAR,
      color VARCHAR,
      description VARCHAR,
      timestamp_created TIMESTAMP,
      timestamp_updated TIMESTAMP,
      synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, id)
    )`,
    `CREATE TABLE IF NOT EXISTS sendlens.custom_tag_mappings (
      workspace_id VARCHAR NOT NULL,
      tag_id VARCHAR NOT NULL,
      resource_type VARCHAR NOT NULL,
      resource_id VARCHAR NOT NULL,
      timestamp_created TIMESTAMP,
      synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, tag_id, resource_type, resource_id)
    )`,
    `CREATE TABLE IF NOT EXISTS sendlens.inbox_placement_tests (
      workspace_id VARCHAR NOT NULL,
      id VARCHAR NOT NULL,
      organization_id VARCHAR,
      name VARCHAR,
      delivery_mode INTEGER,
      description VARCHAR,
      type INTEGER,
      sending_method INTEGER,
      campaign_id VARCHAR,
      email_subject VARCHAR,
      email_body VARCHAR,
      emails_json VARCHAR,
      test_code VARCHAR,
      tags_json VARCHAR,
      text_only BOOLEAN,
      recipients_json VARCHAR,
      recipients_labels_json VARCHAR,
      timestamp_created TIMESTAMP,
      timestamp_next_run TIMESTAMP,
      status INTEGER,
      not_sending_status VARCHAR,
      metadata_json VARCHAR,
      raw_json VARCHAR,
      synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, id)
    )`,
    `CREATE TABLE IF NOT EXISTS sendlens.inbox_placement_analytics (
      workspace_id VARCHAR NOT NULL,
      id VARCHAR NOT NULL,
      organization_id VARCHAR,
      test_id VARCHAR NOT NULL,
      timestamp_created TIMESTAMP,
      timestamp_created_date DATE,
      is_spam BOOLEAN,
      has_category BOOLEAN,
      sender_email VARCHAR,
      sender_esp INTEGER,
      recipient_email VARCHAR,
      recipient_esp INTEGER,
      recipient_geo INTEGER,
      recipient_type INTEGER,
      spf_pass BOOLEAN,
      dkim_pass BOOLEAN,
      dmarc_pass BOOLEAN,
      smtp_ip_blacklist_report_json VARCHAR,
      authentication_failure_results_json VARCHAR,
      record_type INTEGER,
      raw_json VARCHAR,
      synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, id)
    )`,
    `CREATE TABLE IF NOT EXISTS sendlens.reply_emails (
      workspace_id VARCHAR NOT NULL,
      id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      thread_id VARCHAR,
      lead_email VARCHAR,
      message_id VARCHAR,
      eaccount VARCHAR,
      from_email VARCHAR,
      to_email VARCHAR,
      subject VARCHAR,
      body_text VARCHAR,
      body_html VARCHAR,
      sent_at TIMESTAMP,
      is_auto_reply BOOLEAN,
      ai_interest_value DOUBLE,
      i_status INTEGER,
      content_preview VARCHAR,
      direction VARCHAR,
      step_resolved VARCHAR,
      variant_resolved VARCHAR,
      hydrated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, id)
    )`,
    `CREATE TABLE IF NOT EXISTS sendlens.reply_email_hydration_state (
      workspace_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      i_status INTEGER NOT NULL,
      latest_of_thread BOOLEAN NOT NULL,
      email_type VARCHAR NOT NULL,
      next_starting_after VARCHAR,
      pages_hydrated INTEGER,
      emails_hydrated INTEGER,
      exhausted BOOLEAN,
      last_hydrated_at TIMESTAMP,
      synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, campaign_id, i_status, latest_of_thread, email_type)
    )`,
    `CREATE TABLE IF NOT EXISTS sendlens.sampled_leads (
      workspace_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      id VARCHAR,
      email VARCHAR NOT NULL,
      first_name VARCHAR,
      last_name VARCHAR,
      company_name VARCHAR,
      company_domain VARCHAR,
      status VARCHAR,
      email_open_count INTEGER,
      email_reply_count INTEGER,
      email_click_count INTEGER,
      lt_interest_status INTEGER,
      email_opened_step INTEGER,
      email_opened_variant INTEGER,
      email_replied_step INTEGER,
      email_replied_variant INTEGER,
      email_clicked_step INTEGER,
      email_clicked_variant INTEGER,
      esp_code INTEGER,
      verification_status INTEGER,
      enrichment_status INTEGER,
      timestamp_last_contact TIMESTAMP,
      timestamp_last_reply TIMESTAMP,
      job_title VARCHAR,
      website VARCHAR,
      phone VARCHAR,
      personalization VARCHAR,
      status_summary VARCHAR,
      subsequence_id VARCHAR,
      list_id VARCHAR,
      custom_payload VARCHAR,
      sample_source VARCHAR,
      sampled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, campaign_id, email)
    )`,
    `CREATE TABLE IF NOT EXISTS sendlens.sampled_outbound_emails (
      workspace_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      id VARCHAR NOT NULL,
      to_email VARCHAR,
      from_email VARCHAR,
      subject VARCHAR,
      body_text VARCHAR,
      sent_at TIMESTAMP,
      step_resolved VARCHAR,
      variant_resolved VARCHAR,
      content_preview VARCHAR,
      sample_source VARCHAR,
      sampled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, id)
    )`,
    `CREATE TABLE IF NOT EXISTS sendlens.sampling_runs (
      workspace_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      ingest_mode VARCHAR,
      total_leads INTEGER,
      total_sent INTEGER,
      reply_rows INTEGER,
      reply_lead_rows INTEGER,
      nonreply_sample_target INTEGER,
      nonreply_rows_sampled INTEGER,
      outbound_sample_target INTEGER,
      outbound_rows_sampled INTEGER,
      reply_outbound_rows INTEGER,
      filtered_lead_rows INTEGER,
      coverage_note VARCHAR,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, campaign_id)
    )`,
    `CREATE TABLE IF NOT EXISTS sendlens.sync_log (
      id VARCHAR PRIMARY KEY,
      workspace_id VARCHAR,
      source VARCHAR NOT NULL,
      mode VARCHAR NOT NULL,
      status VARCHAR NOT NULL,
      scoped_campaign_ids VARCHAR,
      campaigns_total INTEGER,
      campaigns_processed INTEGER,
      started_at TIMESTAMP,
      ended_at TIMESTAMP,
      duration_ms BIGINT,
      message VARCHAR,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    "ALTER TABLE sendlens.sampled_leads ADD COLUMN IF NOT EXISTS email_opened_step INTEGER",
    "ALTER TABLE sendlens.sampled_leads ADD COLUMN IF NOT EXISTS email_opened_variant INTEGER",
    "ALTER TABLE sendlens.sampled_leads ADD COLUMN IF NOT EXISTS email_replied_step INTEGER",
    "ALTER TABLE sendlens.sampled_leads ADD COLUMN IF NOT EXISTS email_replied_variant INTEGER",
    "ALTER TABLE sendlens.sampled_leads ADD COLUMN IF NOT EXISTS email_clicked_step INTEGER",
    "ALTER TABLE sendlens.sampled_leads ADD COLUMN IF NOT EXISTS email_clicked_variant INTEGER",
    "ALTER TABLE sendlens.sampled_leads ADD COLUMN IF NOT EXISTS esp_code INTEGER",
    "ALTER TABLE sendlens.sampled_leads ADD COLUMN IF NOT EXISTS verification_status INTEGER",
    "ALTER TABLE sendlens.sampled_leads ADD COLUMN IF NOT EXISTS enrichment_status INTEGER",
    "ALTER TABLE sendlens.sampled_leads ADD COLUMN IF NOT EXISTS job_title VARCHAR",
    "ALTER TABLE sendlens.sampled_leads ADD COLUMN IF NOT EXISTS website VARCHAR",
    "ALTER TABLE sendlens.sampled_leads ADD COLUMN IF NOT EXISTS phone VARCHAR",
    "ALTER TABLE sendlens.sampled_leads ADD COLUMN IF NOT EXISTS personalization VARCHAR",
    "ALTER TABLE sendlens.sampled_leads ADD COLUMN IF NOT EXISTS status_summary VARCHAR",
    "ALTER TABLE sendlens.sampled_leads ADD COLUMN IF NOT EXISTS subsequence_id VARCHAR",
    "ALTER TABLE sendlens.sampled_leads ADD COLUMN IF NOT EXISTS list_id VARCHAR",
    "ALTER TABLE sendlens.campaigns ADD COLUMN IF NOT EXISTS first_email_text_only BOOLEAN",
    "ALTER TABLE sendlens.campaigns ADD COLUMN IF NOT EXISTS stop_on_reply BOOLEAN",
    "ALTER TABLE sendlens.campaigns ADD COLUMN IF NOT EXISTS stop_on_auto_reply BOOLEAN",
    "ALTER TABLE sendlens.campaigns ADD COLUMN IF NOT EXISTS match_lead_esp BOOLEAN",
    "ALTER TABLE sendlens.campaigns ADD COLUMN IF NOT EXISTS allow_risky_contacts BOOLEAN",
    "ALTER TABLE sendlens.campaigns ADD COLUMN IF NOT EXISTS disable_bounce_protect BOOLEAN",
    "ALTER TABLE sendlens.campaigns ADD COLUMN IF NOT EXISTS insert_unsubscribe_header BOOLEAN",
    "ALTER TABLE sendlens.reply_emails ADD COLUMN IF NOT EXISTS lead_email VARCHAR",
    "ALTER TABLE sendlens.reply_emails ADD COLUMN IF NOT EXISTS message_id VARCHAR",
    "ALTER TABLE sendlens.reply_emails ADD COLUMN IF NOT EXISTS eaccount VARCHAR",
    "ALTER TABLE sendlens.reply_emails ADD COLUMN IF NOT EXISTS body_html VARCHAR",
    "ALTER TABLE sendlens.reply_emails ADD COLUMN IF NOT EXISTS hydrated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    "ALTER TABLE sendlens.sampling_runs ADD COLUMN IF NOT EXISTS reply_lead_rows INTEGER",
    "ALTER TABLE sendlens.sampling_runs ADD COLUMN IF NOT EXISTS reply_outbound_rows INTEGER",
    "ALTER TABLE sendlens.sampling_runs ADD COLUMN IF NOT EXISTS filtered_lead_rows INTEGER",
    "ALTER TABLE sendlens.campaign_daily_metrics ADD COLUMN IF NOT EXISTS opportunities INTEGER",
    "ALTER TABLE sendlens.campaign_daily_metrics ADD COLUMN IF NOT EXISTS unique_opportunities INTEGER",
    `CREATE OR REPLACE VIEW sendlens.campaign_tags AS
      SELECT
        m.workspace_id,
        m.resource_id AS campaign_id,
        c.name AS campaign_name,
        m.tag_id,
        COALESCE(t.label, t.name) AS tag_label,
        t.color,
        t.description
      FROM sendlens.custom_tag_mappings m
      JOIN sendlens.custom_tags t
        ON m.workspace_id = t.workspace_id
       AND m.tag_id = t.id
      LEFT JOIN sendlens.campaigns c
        ON m.workspace_id = c.workspace_id
       AND m.resource_id = c.id
      WHERE TRY_CAST(m.resource_type AS INTEGER) = 2`,
    `CREATE OR REPLACE VIEW sendlens.account_tags AS
      SELECT
        m.workspace_id,
        m.resource_id AS account_email,
        m.tag_id,
        COALESCE(t.label, t.name) AS tag_label,
        t.color,
        t.description
      FROM sendlens.custom_tag_mappings m
      JOIN sendlens.custom_tags t
        ON m.workspace_id = t.workspace_id
       AND m.tag_id = t.id
      WHERE TRY_CAST(m.resource_type AS INTEGER) = 1`,
    `CREATE OR REPLACE VIEW sendlens.campaign_accounts AS
      SELECT
        ca.workspace_id,
        ca.campaign_id,
        c.name AS campaign_name,
        ca.account_email,
        'direct' AS assignment_source,
        NULL::VARCHAR AS tag_id,
        NULL::VARCHAR AS tag_label,
        a.status,
        a.warmup_status,
        a.warmup_score,
        a.provider,
        a.daily_limit,
        a.total_sent_30d,
        a.total_replies_30d,
        a.total_bounces_30d,
        ROUND(100.0 * a.total_bounces_30d / NULLIF(a.total_sent_30d, 0), 2) AS bounce_rate_30d_pct
      FROM sendlens.campaign_account_assignments ca
      LEFT JOIN sendlens.campaigns c
        ON ca.workspace_id = c.workspace_id
       AND ca.campaign_id = c.id
      LEFT JOIN sendlens.accounts a
        ON ca.workspace_id = a.workspace_id
       AND lower(ca.account_email) = lower(a.email)
      WHERE ca.assignment_type = 'email'
        AND ca.account_email IS NOT NULL
      UNION ALL
      SELECT
        ca.workspace_id,
        ca.campaign_id,
        c.name AS campaign_name,
        acct_tag.account_email,
        'tag' AS assignment_source,
        ca.tag_id,
        acct_tag.tag_label,
        a.status,
        a.warmup_status,
        a.warmup_score,
        a.provider,
        a.daily_limit,
        a.total_sent_30d,
        a.total_replies_30d,
        a.total_bounces_30d,
        ROUND(100.0 * a.total_bounces_30d / NULLIF(a.total_sent_30d, 0), 2) AS bounce_rate_30d_pct
      FROM sendlens.campaign_account_assignments ca
      JOIN sendlens.account_tags acct_tag
        ON ca.workspace_id = acct_tag.workspace_id
       AND ca.tag_id = acct_tag.tag_id
      LEFT JOIN sendlens.campaigns c
        ON ca.workspace_id = c.workspace_id
       AND ca.campaign_id = c.id
      LEFT JOIN sendlens.accounts a
        ON ca.workspace_id = a.workspace_id
       AND lower(acct_tag.account_email) = lower(a.email)
      WHERE ca.assignment_type = 'tag'
        AND ca.tag_id IS NOT NULL`,
    `CREATE OR REPLACE VIEW sendlens.inbox_placement_test_overview AS
      SELECT
        t.workspace_id,
        t.id AS test_id,
        t.name AS test_name,
        t.campaign_id,
        c.name AS campaign_name,
        t.status,
        t.not_sending_status,
        t.sending_method,
        t.type AS test_type,
        t.timestamp_created,
        t.timestamp_next_run,
        COUNT(a.id) AS analytics_rows,
        SUM(CASE WHEN a.record_type = 1 THEN 1 ELSE 0 END) AS sent_records,
        SUM(CASE WHEN a.record_type = 2 THEN 1 ELSE 0 END) AS received_records,
        SUM(CASE WHEN a.record_type = 2 AND a.is_spam = TRUE THEN 1 ELSE 0 END) AS spam_records,
        SUM(CASE WHEN a.record_type = 2 AND a.has_category = TRUE THEN 1 ELSE 0 END) AS category_records,
        SUM(CASE WHEN a.record_type = 2 AND COALESCE(a.is_spam, FALSE) = FALSE AND COALESCE(a.has_category, FALSE) = FALSE THEN 1 ELSE 0 END) AS primary_inbox_records,
        SUM(CASE WHEN a.record_type = 2 AND COALESCE(a.spf_pass, TRUE) = FALSE THEN 1 ELSE 0 END) AS spf_failures,
        SUM(CASE WHEN a.record_type = 2 AND COALESCE(a.dkim_pass, TRUE) = FALSE THEN 1 ELSE 0 END) AS dkim_failures,
        SUM(CASE WHEN a.record_type = 2 AND COALESCE(a.dmarc_pass, TRUE) = FALSE THEN 1 ELSE 0 END) AS dmarc_failures,
        ROUND(100.0 * SUM(CASE WHEN a.record_type = 2 AND COALESCE(a.is_spam, FALSE) = FALSE THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN a.record_type = 2 THEN 1 ELSE 0 END), 0), 2) AS non_spam_rate_pct,
        ROUND(100.0 * SUM(CASE WHEN a.record_type = 2 AND COALESCE(a.is_spam, FALSE) = FALSE AND COALESCE(a.has_category, FALSE) = FALSE THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN a.record_type = 2 THEN 1 ELSE 0 END), 0), 2) AS primary_inbox_rate_pct,
        ROUND(100.0 * SUM(CASE WHEN a.record_type = 2 AND a.has_category = TRUE THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN a.record_type = 2 THEN 1 ELSE 0 END), 0), 2) AS category_rate_pct,
        ROUND(100.0 * SUM(CASE WHEN a.record_type = 2 AND a.is_spam = TRUE THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN a.record_type = 2 THEN 1 ELSE 0 END), 0), 2) AS spam_rate_pct
      FROM sendlens.inbox_placement_tests t
      LEFT JOIN sendlens.inbox_placement_analytics a
        ON t.workspace_id = a.workspace_id
       AND t.id = a.test_id
      LEFT JOIN sendlens.campaigns c
        ON t.workspace_id = c.workspace_id
       AND t.campaign_id = c.id
      GROUP BY
        t.workspace_id,
        t.id,
        t.name,
        t.campaign_id,
        c.name,
        t.status,
        t.not_sending_status,
        t.sending_method,
        t.type,
        t.timestamp_created,
        t.timestamp_next_run`,
    `CREATE OR REPLACE VIEW sendlens.inbox_placement_analytics_labeled AS
      SELECT
        a.*,
        CASE a.sender_esp
          WHEN 1 THEN 'Google'
          WHEN 2 THEN 'Microsoft'
          WHEN 12 THEN 'Web.de'
          WHEN 13 THEN 'Libero.it'
          ELSE NULL
        END AS sender_esp_label,
        CASE a.recipient_esp
          WHEN 1 THEN 'Google'
          WHEN 2 THEN 'Microsoft'
          WHEN 12 THEN 'Web.de'
          WHEN 13 THEN 'Libero.it'
          ELSE NULL
        END AS recipient_esp_label,
        CASE a.recipient_geo
          WHEN 1 THEN 'United States'
          WHEN 2 THEN 'Italy'
          WHEN 3 THEN 'Germany'
          WHEN 4 THEN 'France'
          ELSE NULL
        END AS recipient_geo_label,
        CASE a.recipient_type
          WHEN 1 THEN 'Professional'
          WHEN 2 THEN 'Personal'
          ELSE NULL
        END AS recipient_type_label
      FROM sendlens.inbox_placement_analytics a`,
    `CREATE OR REPLACE VIEW sendlens.sender_deliverability_health AS
      SELECT
        a.workspace_id,
        a.sender_email,
        COUNT(DISTINCT a.test_id) AS inbox_placement_tests,
        COUNT(*) AS received_records,
        SUM(CASE WHEN a.is_spam = TRUE THEN 1 ELSE 0 END) AS spam_records,
        SUM(CASE WHEN a.has_category = TRUE THEN 1 ELSE 0 END) AS category_records,
        SUM(CASE WHEN COALESCE(a.is_spam, FALSE) = FALSE AND COALESCE(a.has_category, FALSE) = FALSE THEN 1 ELSE 0 END) AS primary_inbox_records,
        SUM(CASE WHEN COALESCE(a.spf_pass, TRUE) = FALSE THEN 1 ELSE 0 END) AS spf_failures,
        SUM(CASE WHEN COALESCE(a.dkim_pass, TRUE) = FALSE THEN 1 ELSE 0 END) AS dkim_failures,
        SUM(CASE WHEN COALESCE(a.dmarc_pass, TRUE) = FALSE THEN 1 ELSE 0 END) AS dmarc_failures,
        ROUND(100.0 * SUM(CASE WHEN COALESCE(a.is_spam, FALSE) = FALSE THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) AS non_spam_rate_pct,
        ROUND(100.0 * SUM(CASE WHEN COALESCE(a.is_spam, FALSE) = FALSE AND COALESCE(a.has_category, FALSE) = FALSE THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) AS primary_inbox_rate_pct,
        ROUND(100.0 * SUM(CASE WHEN a.has_category = TRUE THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) AS category_rate_pct,
        ROUND(100.0 * SUM(CASE WHEN a.is_spam = TRUE THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) AS spam_rate_pct,
        MIN(a.timestamp_created) AS first_seen_at,
        MAX(a.timestamp_created) AS last_seen_at
      FROM sendlens.inbox_placement_analytics a
      WHERE a.record_type = 2
        AND a.sender_email IS NOT NULL
      GROUP BY a.workspace_id, a.sender_email`,
    `CREATE OR REPLACE VIEW sendlens.campaign_overview AS
      SELECT
        c.workspace_id,
        c.id AS campaign_id,
        c.name AS campaign_name,
        c.status,
        c.daily_limit,
        c.open_tracking,
        c.link_tracking,
        c.text_only,
        c.first_email_text_only,
        c.stop_on_reply,
        c.stop_on_auto_reply,
        c.match_lead_esp,
        c.allow_risky_contacts,
        c.disable_bounce_protect,
        c.insert_unsubscribe_header,
        CASE
          WHEN c.open_tracking = TRUE AND c.link_tracking = TRUE THEN 'open_and_link_tracking_on'
          WHEN c.open_tracking = TRUE THEN 'open_tracking_on'
          WHEN c.link_tracking = TRUE THEN 'link_tracking_on'
          ELSE 'tracking_off'
        END AS tracking_status,
        CASE
          WHEN c.disable_bounce_protect = TRUE OR c.allow_risky_contacts = TRUE THEN 'deliverability_guardrails_relaxed'
          WHEN c.match_lead_esp = TRUE THEN 'esp_matching_enabled'
          ELSE 'standard_deliverability_guardrails'
        END AS deliverability_settings_status,
        COALESCE(ca.leads_count, 0) AS leads_count,
        COALESCE(ca.new_leads_contacted_count, 0) AS contacted_count,
        COALESCE(ca.emails_sent_count, 0) AS emails_sent_count,
        COALESCE(ca.reply_count_unique, 0) AS reply_count_unique,
        COALESCE(ca.reply_count_automatic, 0) AS reply_count_automatic,
        COALESCE(ca.bounced_count, 0) AS bounced_count,
        COALESCE(ca.total_opportunities, 0) AS total_opportunities,
        COALESCE(ca.total_opportunity_value, 0) AS total_opportunity_value,
        COALESCE(sr.ingest_mode, 'missing') AS ingest_mode,
        COALESCE(sr.reply_rows, 0) AS reply_rows,
        COALESCE(sr.reply_lead_rows, 0) AS reply_lead_rows,
        COALESCE(sr.nonreply_rows_sampled, 0) AS nonreply_rows_sampled,
        COALESCE(sr.outbound_rows_sampled, 0) AS outbound_rows_sampled,
        COALESCE(sr.reply_outbound_rows, 0) AS reply_outbound_rows,
        COALESCE(sr.filtered_lead_rows, 0) AS filtered_lead_rows,
        CASE
          WHEN COALESCE(ca.emails_sent_count, 0) = 0 THEN 0
          ELSE ROUND(100.0 * COALESCE(ca.reply_count_unique, 0) / ca.emails_sent_count, 2)
        END AS unique_reply_rate_pct,
        CASE
          WHEN COALESCE(ca.emails_sent_count, 0) = 0 THEN 0
          ELSE ROUND(100.0 * COALESCE(ca.bounced_count, 0) / ca.emails_sent_count, 2)
        END AS bounce_rate_pct
      FROM sendlens.campaigns c
      LEFT JOIN sendlens.campaign_analytics ca
        ON c.workspace_id = ca.workspace_id
       AND c.id = ca.campaign_id
      LEFT JOIN sendlens.sampling_runs sr
        ON c.workspace_id = sr.workspace_id
       AND c.id = sr.campaign_id`,
    `CREATE OR REPLACE VIEW sendlens.tag_scope_audit AS
      SELECT
        t.workspace_id,
        t.id AS tag_id,
        COALESCE(t.label, t.name) AS tag_label,
        lower(trim(COALESCE(t.label, t.name))) AS normalized_tag_label,
        m.resource_type,
        CASE m.resource_type
          WHEN '1' THEN 'account'
          WHEN '2' THEN 'campaign'
          ELSE 'other_or_unknown'
        END AS inferred_resource_scope,
        COUNT(DISTINCT m.resource_id) AS tagged_resources,
        MIN(m.synced_at) AS first_mapping_synced_at,
        MAX(m.synced_at) AS last_mapping_synced_at
      FROM sendlens.custom_tags t
      LEFT JOIN sendlens.custom_tag_mappings m
        ON t.workspace_id = m.workspace_id
       AND t.id = m.tag_id
      GROUP BY
        t.workspace_id,
        t.id,
        COALESCE(t.label, t.name),
        lower(trim(COALESCE(t.label, t.name))),
        m.resource_type`,
    `CREATE OR REPLACE VIEW sendlens.campaign_tag_sender_coverage AS
      WITH tagged_campaigns AS (
        SELECT
          ct.workspace_id,
          ct.tag_id,
          ct.tag_label,
          lower(trim(ct.tag_label)) AS normalized_tag_label,
          co.campaign_id,
          co.campaign_name,
          co.status,
          co.daily_limit AS campaign_daily_limit,
          co.emails_sent_count
        FROM sendlens.campaign_tags ct
        JOIN sendlens.campaign_overview co
          ON ct.workspace_id = co.workspace_id
         AND ct.campaign_id = co.campaign_id
        WHERE co.status = 'active'
      ),
      sender_coverage AS (
        SELECT
          tc.workspace_id,
          tc.tag_id,
          tc.campaign_id,
          COUNT(DISTINCT ca.account_email) AS resolved_sender_accounts,
          COUNT(DISTINCT CASE WHEN adm.email IS NOT NULL THEN ca.account_email END) AS sender_accounts_with_daily_metrics,
          MIN(adm.date) AS first_metric_date,
          MAX(adm.date) AS last_metric_date
        FROM tagged_campaigns tc
        LEFT JOIN sendlens.campaign_accounts ca
          ON tc.workspace_id = ca.workspace_id
         AND tc.campaign_id = ca.campaign_id
        LEFT JOIN sendlens.account_daily_metrics adm
          ON ca.workspace_id = adm.workspace_id
         AND lower(ca.account_email) = lower(adm.email)
        GROUP BY 1, 2, 3
      )
      SELECT
        tc.workspace_id,
        tc.tag_id,
        tc.tag_label,
        tc.normalized_tag_label,
        tc.campaign_id,
        tc.campaign_name,
        tc.status,
        tc.campaign_daily_limit,
        tc.emails_sent_count AS campaign_total_sent,
        COALESCE(sc.resolved_sender_accounts, 0) AS resolved_sender_accounts,
        COALESCE(sc.sender_accounts_with_daily_metrics, 0) AS sender_accounts_with_daily_metrics,
        sc.first_metric_date,
        sc.last_metric_date,
        CASE
          WHEN COALESCE(sc.resolved_sender_accounts, 0) = 0 THEN 'missing_sender_inventory'
          WHEN COALESCE(sc.sender_accounts_with_daily_metrics, 0) = 0 THEN 'missing_account_daily_metrics'
          WHEN sc.sender_accounts_with_daily_metrics < sc.resolved_sender_accounts THEN 'partial_account_daily_metrics'
          ELSE 'covered'
        END AS coverage_status
      FROM tagged_campaigns tc
      LEFT JOIN sender_coverage sc
        ON tc.workspace_id = sc.workspace_id
       AND tc.tag_id = sc.tag_id
       AND tc.campaign_id = sc.campaign_id`,
    `CREATE OR REPLACE VIEW sendlens.campaign_tag_daily_volume_by_campaign AS
      SELECT
        ct.workspace_id,
        ct.tag_id,
        ct.tag_label,
        lower(trim(ct.tag_label)) AS normalized_tag_label,
        co.campaign_id,
        co.campaign_name,
        adm.date,
        co.daily_limit AS campaign_daily_limit,
        co.emails_sent_count AS campaign_total_sent,
        COUNT(DISTINCT ca.account_email) AS assigned_accounts_with_metrics,
        SUM(COALESCE(adm.sent, 0)) AS sender_scoped_sent,
        SUM(COALESCE(adm.unique_replies, 0)) AS sender_scoped_unique_replies,
        SUM(COALESCE(adm.bounced, 0)) AS sender_scoped_bounces
      FROM sendlens.campaign_tags ct
      JOIN sendlens.campaign_overview co
        ON ct.workspace_id = co.workspace_id
       AND ct.campaign_id = co.campaign_id
      JOIN sendlens.campaign_accounts ca
        ON co.workspace_id = ca.workspace_id
       AND co.campaign_id = ca.campaign_id
      JOIN sendlens.account_daily_metrics adm
        ON ca.workspace_id = adm.workspace_id
       AND lower(ca.account_email) = lower(adm.email)
      WHERE co.status = 'active'
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9`,
    `CREATE OR REPLACE VIEW sendlens.campaign_tag_daily_volume_deduped AS
      WITH assigned_accounts AS (
        SELECT DISTINCT
          ct.workspace_id,
          ct.tag_id,
          ct.tag_label,
          lower(trim(ct.tag_label)) AS normalized_tag_label,
          ca.account_email
        FROM sendlens.campaign_tags ct
        JOIN sendlens.campaign_overview co
          ON ct.workspace_id = co.workspace_id
         AND ct.campaign_id = co.campaign_id
        JOIN sendlens.campaign_accounts ca
          ON co.workspace_id = ca.workspace_id
         AND co.campaign_id = ca.campaign_id
        WHERE co.status = 'active'
          AND ca.account_email IS NOT NULL
      ),
      capacity AS (
        SELECT
          ct.workspace_id,
          ct.tag_id,
          COUNT(DISTINCT co.campaign_id) AS active_campaigns,
          COALESCE(SUM(co.daily_limit), 0) AS configured_campaign_daily_limit_total,
          COALESCE(SUM(co.emails_sent_count), 0) AS campaign_total_sent
        FROM sendlens.campaign_tags ct
        JOIN sendlens.campaign_overview co
          ON ct.workspace_id = co.workspace_id
         AND ct.campaign_id = co.campaign_id
        WHERE co.status = 'active'
        GROUP BY 1, 2
      )
      SELECT
        aa.workspace_id,
        aa.tag_id,
        aa.tag_label,
        aa.normalized_tag_label,
        adm.date,
        c.active_campaigns,
        c.configured_campaign_daily_limit_total,
        c.campaign_total_sent,
        COUNT(DISTINCT adm.email) AS assigned_accounts_with_metrics,
        SUM(COALESCE(adm.sent, 0)) AS deduped_sender_sent,
        SUM(COALESCE(adm.unique_replies, 0)) AS deduped_sender_unique_replies,
        SUM(COALESCE(adm.bounced, 0)) AS deduped_sender_bounces
      FROM assigned_accounts aa
      JOIN sendlens.account_daily_metrics adm
        ON aa.workspace_id = adm.workspace_id
       AND lower(aa.account_email) = lower(adm.email)
      JOIN capacity c
        ON aa.workspace_id = c.workspace_id
       AND aa.tag_id = c.tag_id
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8`,
    `CREATE OR REPLACE VIEW sendlens.campaign_tag_daily_volume_utilization AS
      WITH assigned_accounts AS (
        SELECT DISTINCT
          ct.workspace_id,
          ct.tag_id,
          ca.account_email,
          ca.daily_limit AS account_daily_limit
        FROM sendlens.campaign_tags ct
        JOIN sendlens.campaign_overview co
          ON ct.workspace_id = co.workspace_id
         AND ct.campaign_id = co.campaign_id
        JOIN sendlens.campaign_accounts ca
          ON co.workspace_id = ca.workspace_id
         AND co.campaign_id = ca.campaign_id
        WHERE co.status = 'active'
          AND ca.account_email IS NOT NULL
      ),
      sender_capacity AS (
        SELECT
          workspace_id,
          tag_id,
          COUNT(DISTINCT account_email) AS resolved_sender_accounts,
          COALESCE(SUM(account_daily_limit), 0) AS resolved_account_daily_limit_total
        FROM assigned_accounts
        GROUP BY 1, 2
      )
      SELECT
        dv.workspace_id,
        dv.tag_id,
        dv.tag_label,
        dv.normalized_tag_label,
        dv.date,
        dv.active_campaigns,
        COALESCE(sc.resolved_sender_accounts, 0) AS resolved_sender_accounts,
        dv.assigned_accounts_with_metrics,
        dv.configured_campaign_daily_limit_total,
        COALESCE(sc.resolved_account_daily_limit_total, 0) AS resolved_account_daily_limit_total,
        dv.deduped_sender_sent,
        ROUND(100.0 * dv.deduped_sender_sent / NULLIF(dv.configured_campaign_daily_limit_total, 0), 2) AS campaign_limit_utilization_pct,
        ROUND(100.0 * dv.deduped_sender_sent / NULLIF(sc.resolved_account_daily_limit_total, 0), 2) AS account_limit_utilization_pct,
        dv.deduped_sender_unique_replies,
        dv.deduped_sender_bounces,
        dv.campaign_total_sent
      FROM sendlens.campaign_tag_daily_volume_deduped dv
      LEFT JOIN sender_capacity sc
        ON dv.workspace_id = sc.workspace_id
       AND dv.tag_id = sc.tag_id`,
    `CREATE OR REPLACE VIEW sendlens.campaign_tag_daily_volume_trend AS
      SELECT
        workspace_id,
        tag_id,
        tag_label,
        normalized_tag_label,
        date,
        strftime(date, '%w') AS weekday_number,
        strftime(date, '%A') AS weekday_name,
        deduped_sender_sent,
        ROUND(AVG(deduped_sender_sent) OVER (PARTITION BY workspace_id, tag_id ORDER BY date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 2) AS rolling_7_day_avg_sent,
        MAX(deduped_sender_sent) OVER (PARTITION BY workspace_id, tag_id) AS peak_daily_sent,
        ROUND(AVG(deduped_sender_sent) OVER (PARTITION BY workspace_id, tag_id), 2) AS avg_daily_sent_all_cached_days,
        COUNT(*) OVER (PARTITION BY workspace_id, tag_id) AS cached_sending_days,
        MIN(date) OVER (PARTITION BY workspace_id, tag_id) AS first_cached_send_date,
        MAX(date) OVER (PARTITION BY workspace_id, tag_id) AS last_cached_send_date,
        deduped_sender_unique_replies,
        deduped_sender_bounces
      FROM sendlens.campaign_tag_daily_volume_deduped`,
    `CREATE OR REPLACE VIEW sendlens.campaign_tag_true_daily_volume AS
      SELECT
        ct.workspace_id,
        ct.tag_id,
        ct.tag_label,
        lower(trim(ct.tag_label)) AS normalized_tag_label,
        cdm.date,
        COUNT(DISTINCT co.campaign_id) AS active_campaigns_with_daily_metrics,
        COALESCE(SUM(co.daily_limit), 0) AS configured_campaign_daily_limit_total,
        COALESCE(SUM(co.emails_sent_count), 0) AS campaign_total_sent,
        SUM(COALESCE(cdm.sent, 0)) AS campaign_attributed_sent,
        SUM(COALESCE(cdm.contacted, 0)) AS campaign_attributed_contacted,
        SUM(COALESCE(cdm.new_leads_contacted, 0)) AS campaign_attributed_new_leads_contacted,
        SUM(COALESCE(cdm.opened, 0)) AS campaign_attributed_opened,
        SUM(COALESCE(cdm.unique_opened, 0)) AS campaign_attributed_unique_opened,
        SUM(COALESCE(cdm.replies, 0)) AS campaign_attributed_replies,
        SUM(COALESCE(cdm.unique_replies, 0)) AS campaign_attributed_unique_replies,
        SUM(COALESCE(cdm.replies_automatic, 0)) AS campaign_attributed_replies_automatic,
        SUM(COALESCE(cdm.unique_replies_automatic, 0)) AS campaign_attributed_unique_replies_automatic,
        SUM(COALESCE(cdm.clicks, 0)) AS campaign_attributed_clicks,
        SUM(COALESCE(cdm.unique_clicks, 0)) AS campaign_attributed_unique_clicks,
        SUM(COALESCE(cdm.opportunities, 0)) AS campaign_attributed_opportunities,
        SUM(COALESCE(cdm.unique_opportunities, 0)) AS campaign_attributed_unique_opportunities,
        ROUND(100.0 * SUM(COALESCE(cdm.sent, 0)) / NULLIF(SUM(co.daily_limit), 0), 2) AS campaign_limit_utilization_pct
      FROM sendlens.campaign_tags ct
      JOIN sendlens.campaign_overview co
        ON ct.workspace_id = co.workspace_id
       AND ct.campaign_id = co.campaign_id
      JOIN sendlens.campaign_daily_metrics cdm
        ON co.workspace_id = cdm.workspace_id
       AND co.campaign_id = cdm.campaign_id
      WHERE co.status = 'active'
      GROUP BY 1, 2, 3, 4, 5`,
    `CREATE OR REPLACE VIEW sendlens.campaign_tag_true_daily_volume_trend AS
      SELECT
        workspace_id,
        tag_id,
        tag_label,
        normalized_tag_label,
        date,
        strftime(date, '%w') AS weekday_number,
        strftime(date, '%A') AS weekday_name,
        campaign_attributed_sent,
        ROUND(AVG(campaign_attributed_sent) OVER (PARTITION BY workspace_id, tag_id ORDER BY date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 2) AS rolling_7_day_avg_sent,
        MAX(campaign_attributed_sent) OVER (PARTITION BY workspace_id, tag_id) AS peak_daily_sent,
        ROUND(AVG(campaign_attributed_sent) OVER (PARTITION BY workspace_id, tag_id), 2) AS avg_daily_sent_all_cached_days,
        COUNT(*) OVER (PARTITION BY workspace_id, tag_id) AS cached_sending_days,
        MIN(date) OVER (PARTITION BY workspace_id, tag_id) AS first_cached_send_date,
        MAX(date) OVER (PARTITION BY workspace_id, tag_id) AS last_cached_send_date,
        campaign_attributed_unique_replies,
        campaign_attributed_replies,
        campaign_attributed_opportunities
      FROM sendlens.campaign_tag_true_daily_volume`,
    `CREATE OR REPLACE VIEW sendlens.lead_evidence AS
      SELECT
        sl.workspace_id,
        sl.campaign_id,
        c.name AS campaign_name,
        sl.id,
        sl.email,
        sl.first_name,
        sl.last_name,
        sl.company_name,
        sl.company_domain,
        sl.status,
        COALESCE(sl.email_open_count, 0) AS email_open_count,
        COALESCE(sl.email_reply_count, 0) AS email_reply_count,
        COALESCE(sl.email_click_count, 0) AS email_click_count,
        sl.lt_interest_status,
        CASE sl.lt_interest_status
          WHEN 4 THEN 'won'
          WHEN 3 THEN 'meeting_completed'
          WHEN 2 THEN 'meeting_booked'
          WHEN 1 THEN 'interested'
          WHEN 0 THEN 'out_of_office'
          WHEN -1 THEN 'not_interested'
          WHEN -2 THEN 'wrong_person'
          WHEN -3 THEN 'lost'
          WHEN -4 THEN 'no_show'
          ELSE 'unclassified'
        END AS lt_interest_label,
        CASE
          WHEN COALESCE(sl.email_reply_count, 0) <= 0 AND sl.timestamp_last_reply IS NULL THEN 'no_reply'
          WHEN sl.lt_interest_status IN (1, 2, 3, 4) THEN 'positive'
          WHEN sl.lt_interest_status IN (-1, -2, -3, -4) THEN 'negative'
          WHEN sl.lt_interest_status = 0 THEN 'out_of_office'
          ELSE 'neutral'
        END AS reply_outcome_label,
        sl.email_replied_step,
        sl.email_replied_variant,
        sl.job_title,
        sl.website,
        sl.phone,
        sl.personalization,
        sl.status_summary,
        sl.subsequence_id,
        sl.list_id,
        sl.esp_code,
        sl.verification_status,
        sl.enrichment_status,
        sl.timestamp_last_contact,
        sl.timestamp_last_reply,
        sl.custom_payload,
        sl.sample_source,
        CASE
          WHEN (
            COALESCE(sl.email_reply_count, 0) > 0
            OR sl.timestamp_last_reply IS NOT NULL
            OR sl.email_replied_step IS NOT NULL
          ) AND (sl.lt_interest_status IS NULL OR sl.lt_interest_status <> 0) THEN TRUE
          ELSE FALSE
        END AS has_reply_signal
      FROM sendlens.sampled_leads sl
      LEFT JOIN sendlens.campaigns c
        ON sl.workspace_id = c.workspace_id
       AND sl.campaign_id = c.id`,
    `CREATE OR REPLACE VIEW sendlens.lead_payload_kv AS
      SELECT
        le.workspace_id,
        le.campaign_id,
        le.campaign_name,
        le.email,
        le.job_title,
        le.company_name,
        le.company_domain,
        le.lt_interest_status,
        le.lt_interest_label,
        le.reply_outcome_label,
        le.has_reply_signal,
        kv.key AS payload_key,
        json_extract_string(kv.value, '$') AS payload_value,
        CAST(kv.value AS VARCHAR) AS payload_value_json
      FROM sendlens.lead_evidence le,
           json_each(le.custom_payload) AS kv
      WHERE le.custom_payload IS NOT NULL
        AND le.custom_payload <> ''
        AND json_valid(le.custom_payload)`,
    `CREATE OR REPLACE VIEW sendlens.reply_context AS
      SELECT
        le.workspace_id,
        le.campaign_id,
        le.campaign_name,
        le.email AS lead_email,
        le.first_name,
        le.last_name,
        le.company_name,
        le.company_domain,
        le.job_title,
        le.email_reply_count,
        le.lt_interest_status,
        le.lt_interest_label,
        le.reply_outcome_label,
        le.email_replied_step AS step_resolved,
        le.email_replied_variant AS variant_resolved,
        le.timestamp_last_reply AS reply_at,
        re.id AS reply_email_id,
        re.thread_id AS reply_thread_id,
        re.subject AS reply_subject,
        re.body_text AS reply_body_text,
        re.body_html AS reply_body_html,
        re.from_email AS reply_from_email,
        re.to_email AS reply_to_email,
        re.sent_at AS reply_received_at,
        re.i_status AS reply_email_i_status,
        re.is_auto_reply AS reply_is_auto_reply,
        re.content_preview AS reply_content_preview,
        re.hydrated_at AS reply_hydrated_at,
        so.subject AS rendered_subject,
        so.body_text AS rendered_body_text,
        so.sample_source,
        cv.subject AS template_subject,
        cv.body_text AS template_body_text
      FROM sendlens.lead_evidence le
      LEFT JOIN sendlens.reply_emails re
        ON le.workspace_id = re.workspace_id
       AND le.campaign_id = re.campaign_id
       AND lower(le.email) = lower(
         CASE
           WHEN re.lead_email LIKE '%@%' THEN re.lead_email
           ELSE re.from_email
         END
       )
       AND re.direction = 'inbound'
      LEFT JOIN sendlens.sampled_outbound_emails so
        ON le.workspace_id = so.workspace_id
       AND le.campaign_id = so.campaign_id
       AND le.email = so.to_email
       AND CAST(le.email_replied_step AS VARCHAR) = so.step_resolved
       AND CAST(COALESCE(le.email_replied_variant, 0) AS VARCHAR) = so.variant_resolved
      LEFT JOIN sendlens.campaign_variants cv
        ON le.workspace_id = cv.workspace_id
       AND le.campaign_id = cv.campaign_id
       AND le.email_replied_step = cv.step
       AND COALESCE(le.email_replied_variant, 0) = cv.variant
      WHERE le.has_reply_signal = TRUE`,
    `CREATE OR REPLACE VIEW sendlens.rendered_outbound_context AS
      SELECT
        so.workspace_id,
        so.campaign_id,
        c.name AS campaign_name,
        so.id,
        so.to_email,
        so.from_email,
        so.subject AS rendered_subject,
        so.body_text AS rendered_body_text,
        so.sent_at,
        so.step_resolved,
        so.variant_resolved,
        so.sample_source,
        cv.subject AS template_subject,
        cv.body_text AS template_body_text
      FROM sendlens.sampled_outbound_emails so
      LEFT JOIN sendlens.campaigns c
        ON so.workspace_id = c.workspace_id
       AND so.campaign_id = c.id
      LEFT JOIN sendlens.campaign_variants cv
        ON so.workspace_id = cv.workspace_id
       AND so.campaign_id = cv.campaign_id
       AND CAST(cv.step AS VARCHAR) = so.step_resolved
       AND CAST(cv.variant AS VARCHAR) = so.variant_resolved`,
  ];

  for (const statement of statements) {
    await run(conn, statement);
  }
}

function esc(value: string) {
  return value.replace(/'/g, "''");
}

export async function setPluginState(
  conn: DuckDBConnection,
  key: string,
  value: string,
) {
  await run(
    conn,
    `INSERT OR REPLACE INTO sendlens.plugin_state (key, value, updated_at)
     VALUES ('${esc(key)}', '${esc(value)}', CURRENT_TIMESTAMP)`,
  );
}

export async function getPluginState(
  conn: DuckDBConnection,
  key: string,
): Promise<string | null> {
  const rows = await query(
    conn,
    `SELECT value FROM sendlens.plugin_state WHERE key = '${esc(key)}' LIMIT 1`,
  );
  const value = rows[0]?.value;
  return typeof value === "string" ? value : null;
}

export async function clearWorkspaceData(
  conn: DuckDBConnection,
  workspaceId: string,
  campaignIds?: string[],
) {
  const workspace = esc(workspaceId);
  const writableTables = [
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
    "inbox_placement_tests",
    "inbox_placement_analytics",
    "reply_emails",
    "reply_email_hydration_state",
    "sampled_leads",
    "sampled_outbound_emails",
    "sampling_runs",
  ];
  const scopedTables = [
    "campaigns",
    "campaign_analytics",
    "campaign_daily_metrics",
    "step_analytics",
    "campaign_variants",
    "campaign_account_assignments",
    "reply_emails",
    "reply_email_hydration_state",
    "sampled_leads",
    "sampled_outbound_emails",
    "sampling_runs",
  ];

  if (!campaignIds || campaignIds.length === 0) {
    for (const table of writableTables) {
      await run(
        conn,
        `DELETE FROM sendlens.${table} WHERE workspace_id = '${workspace}'`,
      );
    }
    return;
  }

  const ids = campaignIds.map((id) => `'${esc(id)}'`).join(", ");
  for (const table of scopedTables) {
    await run(
      conn,
      `DELETE FROM sendlens.${table}
       WHERE workspace_id = '${workspace}' AND campaign_id IN (${ids})`,
    ).catch(async () => {
      await run(
        conn,
        `DELETE FROM sendlens.${table}
         WHERE workspace_id = '${workspace}' AND id IN (${ids})`,
      );
    });
  }
}

export async function clearWorkspaceMetadata(
  conn: DuckDBConnection,
  workspaceId: string,
) {
  const workspace = esc(workspaceId);
  for (const table of [
    "accounts",
    "account_daily_metrics",
    "custom_tags",
    "custom_tag_mappings",
    "inbox_placement_tests",
    "inbox_placement_analytics",
  ]) {
    await run(
      conn,
      `DELETE FROM sendlens.${table} WHERE workspace_id = '${workspace}'`,
    );
  }
}

export async function getActiveWorkspaceId(
  conn: DuckDBConnection,
): Promise<string | null> {
  return getPluginState(conn, "active_workspace_id");
}

export async function setActiveWorkspaceId(
  conn: DuckDBConnection,
  workspaceId: string,
  mode?: "fast" | "full",
) {
  const refreshedAt = new Date().toISOString();
  await setPluginState(conn, "active_workspace_id", workspaceId);
  await setPluginState(conn, "last_refresh_at", refreshedAt);
  await setPluginState(conn, `workspace:${workspaceId}:last_refresh_at`, refreshedAt);
  if (mode) {
    await setPluginState(conn, `workspace:${workspaceId}:last_${mode}_refresh_at`, refreshedAt);
  }
}

export async function getWorkspaceLastRefreshAt(
  conn: DuckDBConnection,
  workspaceId: string,
): Promise<string | null> {
  const workspaceValue = await getPluginState(
    conn,
    `workspace:${workspaceId}:last_refresh_at`,
  );
  if (workspaceValue) return workspaceValue;
  return getPluginState(conn, "last_refresh_at");
}

export type SyncLogRecord = {
  id: string;
  workspaceId?: string | null;
  source: "session_start" | "manual";
  mode: "fast" | "full";
  status: "succeeded" | "failed" | "skipped";
  scopedCampaignIds?: string[] | null;
  campaignsTotal?: number | null;
  campaignsProcessed?: number | null;
  startedAt?: string | null;
  endedAt?: string | null;
  durationMs?: number | null;
  message?: string | null;
};

export async function appendSyncLog(
  conn: DuckDBConnection,
  record: SyncLogRecord,
) {
  await run(
    conn,
    `INSERT OR REPLACE INTO sendlens.sync_log (
      id,
      workspace_id,
      source,
      mode,
      status,
      scoped_campaign_ids,
      campaigns_total,
      campaigns_processed,
      started_at,
      ended_at,
      duration_ms,
      message,
      created_at
    ) VALUES (
      '${esc(record.id)}',
      ${sqlString(record.workspaceId)},
      '${esc(record.source)}',
      '${esc(record.mode)}',
      '${esc(record.status)}',
      ${sqlString(record.scopedCampaignIds?.join(","))},
      ${sqlNumber(record.campaignsTotal)},
      ${sqlNumber(record.campaignsProcessed)},
      ${sqlTimestamp(record.startedAt)},
      ${sqlTimestamp(record.endedAt)},
      ${sqlNumber(record.durationMs)},
      ${sqlString(record.message)},
      CURRENT_TIMESTAMP
    )`,
  );
}

export async function getLatestSuccessfulSync(
  conn: DuckDBConnection,
  workspaceId: string,
  source?: "session_start" | "manual",
  mode?: "fast" | "full",
): Promise<Record<string, unknown> | null> {
  const filters = [
    `workspace_id = '${esc(workspaceId)}'`,
    `status = 'succeeded'`,
  ];
  if (source) filters.push(`source = '${esc(source)}'`);
  if (mode) filters.push(`mode = '${esc(mode)}'`);
  const rows = await query(
    conn,
    `SELECT *
     FROM sendlens.sync_log
     WHERE ${filters.join(" AND ")}
     ORDER BY COALESCE(ended_at, created_at) DESC
     LIMIT 1`,
  );
  return (rows[0] ?? null) as Record<string, unknown> | null;
}

function sqlString(value: string | null | undefined) {
  if (value == null) return "NULL";
  return `'${esc(value)}'`;
}

function sqlNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "NULL";
  return String(Math.trunc(value));
}

function sqlTimestamp(value: string | null | undefined) {
  if (!value) return "NULL";
  return `${sqlString(value)}::TIMESTAMP`;
}
