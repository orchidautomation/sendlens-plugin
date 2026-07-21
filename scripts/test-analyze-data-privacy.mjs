#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { seedDemoWorkspace } = require("../build/plugin/demo-workspace.js");
const {
  closeDb,
  getActiveWorkspaceId,
  getDb,
  query,
  resetDbConnectionForTests,
} = require("../build/plugin/local-db.js");
const { listColumns, searchCatalog } = require("../build/plugin/catalog.js");
const {
  AnalyzeDataPrivacyGuardError,
  enforceAnalyzeDataPrivacy,
  highCardinalityResultPrivacyReport,
  redactAnalyzeDataRows,
} = require("../build/plugin/analysis-safety.js");
const { enforceLocalWorkspaceScope } = require("../build/plugin/sql-guard.js");

const tempRoot = path.join(os.tmpdir(), `sendlens-analyze-data-privacy-${process.pid}-${Date.now()}`);
const dbPath = path.join(tempRoot, "privacy-cache.duckdb");
const canaries = [
  "privacy-result-canary@example.invalid",
  "privacy-status-summary-canary@example.invalid",
];

process.env.SENDLENS_DB_PATH = dbPath;
process.env.SENDLENS_STATE_DIR = path.join(tempRoot, "demo-state");
process.env.SENDLENS_CONTEXT_ROOT = path.join(tempRoot, "demo-context");
process.env.SENDLENS_DEMO_MODE = "1";

await resetDbConnectionForTests();
await seedDemoWorkspace();

const db = await getDb();
try {
  const workspaceId = await getActiveWorkspaceId(db);
  assert.equal(workspaceId, "demo_workspace");

  const columns = await listColumns(db, "sampled_leads");
  const statusColumn = findColumn(columns, "status");
  assert.equal(statusColumn.safety?.safe_to_select, true);
  assert.equal(statusColumn.safety?.safe_to_group_by, true);
  assert.equal(statusColumn.safety?.recommended_cohort_field, true);

  const companyNameColumn = findColumn(columns, "company_name");
  assert.equal(companyNameColumn.safety?.contains_pii, false);
  assert.equal(companyNameColumn.safety?.high_cardinality, true);

  const emailColumn = findColumn(columns, "email");
  assert.equal(emailColumn.safety?.safe_to_select, false);
  assert.equal(emailColumn.safety?.safe_to_group_by, false);
  assert.equal(emailColumn.safety?.contains_pii, true);

  const statusSummaryColumn = findColumn(columns, "status_summary");
  assert.equal(statusSummaryColumn.safety?.safe_to_select, false);
  assert.equal(statusSummaryColumn.safety?.safe_to_group_by, false);
  assert.equal(statusSummaryColumn.safety?.raw_json, true);
  assert.equal(statusSummaryColumn.safety?.high_cardinality, true);
  assert.equal(statusSummaryColumn.safety?.prefer_derived_field, "status");

  const payloadColumns = await listColumns(db, "lead_payload_kv");
  const payloadValueColumn = findColumn(payloadColumns, "payload_value");
  assert.equal(payloadValueColumn.safety?.safe_to_select, false);
  assert.equal(payloadValueColumn.safety?.safe_to_group_by, false);
  assert.equal(payloadValueColumn.safety?.raw_json, true);

  const payloadValueJsonColumn = findColumn(payloadColumns, "payload_value_json");
  assert.equal(payloadValueJsonColumn.safety?.safe_to_select, false);
  assert.equal(payloadValueJsonColumn.safety?.safe_to_group_by, false);
  assert.equal(payloadValueJsonColumn.safety?.raw_json, true);

  const catalogMatches = await searchCatalog(db, "status_summary cohort");
  const statusSummaryMatch = catalogMatches.find(
    (match) => match.kind === "column" && match.table === "sampled_leads" && match.column === "status_summary",
  );
  assert.ok(statusSummaryMatch, "search_catalog should expose status_summary with safety metadata");
  assert.equal(statusSummaryMatch.safety?.safe_to_group_by, false);
  assert.equal(statusSummaryMatch.safety?.prefer_derived_field, "status");

  const safeStatusSql = "SELECT status, COUNT(*) AS sampled_count FROM sendlens.sampled_leads GROUP BY status ORDER BY sampled_count DESC";
  enforceAnalyzeDataPrivacy(safeStatusSql);
  const safeStatusRows = await query(db, enforceLocalWorkspaceScope(safeStatusSql, workspaceId));
  assert.ok(safeStatusRows.length > 0);
  assert.equal(highCardinalityResultPrivacyReport(safeStatusRows), null);
  enforceAnalyzeDataPrivacy("SELECT * FROM sendlens.campaign_overview LIMIT 1");

  const unsafeStatusSummarySql = [
    "SELECT status, status_summary, COUNT(*) AS sampled_count",
    "FROM sendlens.sampled_leads",
    `WHERE status_summary <> '${canaries[1]}' OR status_summary IS NULL`,
    "GROUP BY status, status_summary",
    "ORDER BY sampled_count DESC",
  ].join(" ");
  assert.throws(
    () => enforceAnalyzeDataPrivacy(unsafeStatusSummarySql),
    (error) => {
      assert.ok(error instanceof AnalyzeDataPrivacyGuardError);
      assert.equal(error.code, "privacy_guard");
      assert.equal(error.report.blocked_columns?.[0]?.column, "status_summary");
      assert.match(error.report.safe_alternatives.join(" "), /\bstatus\b/);
      assertNoCanaries(error.report);
      return true;
    },
  );

  assert.throws(
    () => enforceAnalyzeDataPrivacy("SELECT status_summary FROM sendlens.sampled_leads LIMIT 5"),
    (error) => {
      assert.ok(error instanceof AnalyzeDataPrivacyGuardError);
      assert.equal(error.report.blocked_columns?.[0]?.column, "status_summary");
      return true;
    },
  );
  assert.throws(
    () => enforceAnalyzeDataPrivacy([
      "SELECT status_summary, c.name, COUNT(*) AS c",
      "FROM sendlens.sampled_leads sl",
      "JOIN sendlens.campaigns c ON sl.campaign_id = c.id",
      "GROUP BY status_summary, c.name",
    ].join(" ")),
    (error) => {
      assert.ok(error instanceof AnalyzeDataPrivacyGuardError);
      assert.ok(error.report.blocked_columns?.some((column) =>
        column.table === "sampled_leads" && column.column === "status_summary"
      ));
      return true;
    },
  );
  assert.throws(
    () => enforceAnalyzeDataPrivacy([
      "WITH sampled_leads AS (SELECT status_summary FROM sendlens.sampled_leads)",
      "SELECT status_summary, COUNT(*) AS c",
      "FROM sampled_leads",
      "GROUP BY status_summary",
    ].join(" ")),
    (error) => {
      assert.ok(error instanceof AnalyzeDataPrivacyGuardError);
      assert.ok(error.report.blocked_columns?.some((column) =>
        column.table === "sampled_leads" && column.column === "status_summary"
      ));
      return true;
    },
  );
  assert.throws(
    () => enforceAnalyzeDataPrivacy("SELECT * FROM sendlens.sampled_leads LIMIT 5"),
    (error) => {
      assert.ok(error instanceof AnalyzeDataPrivacyGuardError);
      assert.ok(error.report.blocked_columns.some((column) => column.column === "status_summary"));
      return true;
    },
  );
  assert.throws(
    () => enforceAnalyzeDataPrivacy("SELECT reply_body_html FROM sendlens.reply_context LIMIT 5"),
    (error) => {
      assert.ok(error instanceof AnalyzeDataPrivacyGuardError);
      assert.equal(error.report.blocked_columns?.[0]?.column, "reply_body_html");
      return true;
    },
  );
  assert.throws(
    () => enforceAnalyzeDataPrivacy("SELECT payload_value_json FROM sendlens.lead_payload_kv LIMIT 5"),
    (error) => {
      assert.ok(error instanceof AnalyzeDataPrivacyGuardError);
      assert.equal(error.report.blocked_columns?.[0]?.column, "payload_value_json");
      return true;
    },
  );
  assert.throws(
    () => enforceAnalyzeDataPrivacy("SELECT payload_value FROM sendlens.lead_payload_kv LIMIT 5"),
    (error) => {
      assert.ok(error instanceof AnalyzeDataPrivacyGuardError);
      assert.equal(error.report.blocked_columns?.[0]?.column, "payload_value");
      return true;
    },
  );
  assert.throws(
    () => enforceAnalyzeDataPrivacy("SELECT email, phone, first_name FROM sendlens.sampled_leads LIMIT 5"),
    (error) => {
      assert.ok(error instanceof AnalyzeDataPrivacyGuardError);
      assert.ok(error.report.blocked_columns?.some((column) => column.column === "email"));
      assert.ok(error.report.blocked_columns?.some((column) => column.column === "phone"));
      assert.ok(error.report.blocked_columns?.some((column) => column.column === "first_name"));
      return true;
    },
  );
  enforceAnalyzeDataPrivacy("SELECT COUNT(DISTINCT email) AS sampled_leads FROM sendlens.sampled_leads");
  assert.throws(
    () => enforceAnalyzeDataPrivacy("SELECT MIN(phone) AS sample_phone FROM sendlens.sampled_leads"),
    (error) => {
      assert.ok(error instanceof AnalyzeDataPrivacyGuardError);
      assert.ok(error.report.blocked_columns?.some((column) => column.column === "phone"));
      return true;
    },
  );
  assert.throws(
    () => enforceAnalyzeDataPrivacy("SELECT MAX(first_name) AS name FROM sendlens.sampled_leads"),
    (error) => {
      assert.ok(error instanceof AnalyzeDataPrivacyGuardError);
      assert.ok(error.report.blocked_columns?.some((column) => column.column === "first_name"));
      return true;
    },
  );
  assert.throws(
    () => enforceAnalyzeDataPrivacy("SELECT STRING_AGG(first_name, ',') AS names FROM sendlens.sampled_leads"),
    (error) => {
      assert.ok(error instanceof AnalyzeDataPrivacyGuardError);
      assert.ok(error.report.blocked_columns?.some((column) => column.column === "first_name"));
      return true;
    },
  );

  const safeSingletonStatusRows = Array.from({ length: 6 }, (_, index) => ({
    status: `safe-status-${index}`,
    metric: 1,
  }));
  assert.equal(highCardinalityResultPrivacyReport(safeSingletonStatusRows, {
    sql: "SELECT status, COUNT(*) AS metric FROM sendlens.sampled_leads GROUP BY status",
  }), null);
  const safeSingletonStatusAliasRows = Array.from({ length: 6 }, (_, index) => ({
    lead_state: `safe-status-${index}`,
    metric: 1,
  }));
  assert.equal(highCardinalityResultPrivacyReport(safeSingletonStatusAliasRows, {
    sql: "SELECT status AS lead_state, COUNT(*) AS metric FROM sendlens.sampled_leads GROUP BY status",
  }), null);

  const unsafeProjectionInSafeGroupRows = Array.from({ length: 8 }, (_, index) => ({
    status: `safe-status-${index}`,
    sample_company: `rare-company-${index}`,
    metric: 1,
  }));
  assert.equal(highCardinalityResultPrivacyReport(unsafeProjectionInSafeGroupRows, {
    sql: "SELECT status, MIN(company_name) AS sample_company, COUNT(*) AS metric FROM sendlens.sampled_leads GROUP BY status",
  })?.reason, "high_cardinality_result");

  const unsafeProjectedRows = Array.from({ length: 6 }, (_, index) => ({
    status: "sent",
    company_name: `rare-company-${index}`,
    metric: 1,
  }));
  const unsafeProjectedReport = highCardinalityResultPrivacyReport(unsafeProjectedRows, {
    sql: "SELECT status, ANY_VALUE(company_name) AS company_name, COUNT(*) AS metric FROM sendlens.sampled_leads GROUP BY status",
  });
  assert.equal(unsafeProjectedReport?.reason, "high_cardinality_result");

  const highCardinalityRows = Array.from({ length: 8 }, (_, index) => ({
    cohort: `rare-cohort-${index}`,
    metric: 1,
  }));
  const highCardinalityReport = highCardinalityResultPrivacyReport(highCardinalityRows, {
    sql: "SELECT company_name AS cohort, COUNT(*) AS metric FROM sendlens.sampled_leads GROUP BY company_name",
  });
  assert.equal(highCardinalityReport?.reason, "high_cardinality_result");
  assert.match(highCardinalityReport?.guidance ?? "", /high-cardinality|row-level/i);
  assertNoCanaries(highCardinalityReport);

  const redactedRows = redactAnalyzeDataRows([
    {
      synthetic_note: canaries[0],
      nested_json: '{"sender":"ops@example.invalid"}',
      authorization_json: '{"authorization":"Bearer synthetic-redaction-token"}',
      bearer_header: "Bearer synthetic-redaction-token",
    },
  ]);
  assert.equal(redactedRows[0].synthetic_note, "[redacted-email]");
  assert.equal(redactedRows[0].nested_json, '{"sender":"[redacted-email]"}');
  assert.equal(redactedRows[0].authorization_json, '{"authorization":"[redacted-secret]"}');
  assert.equal(redactedRows[0].bearer_header, "Bearer [redacted-secret]");
  assertNoCanaries(redactedRows);

  console.log("analyze_data privacy tests passed");
} finally {
  closeDb(db);
}

function findColumn(columns, columnName) {
  const column = columns.find((candidate) => candidate.name === columnName);
  assert.ok(column, `expected ${columnName} in list_columns response`);
  return column;
}

function assertNoCanaries(payload) {
  const text = JSON.stringify(payload);
  for (const canary of canaries) {
    assert.equal(text.includes(canary), false, `payload must not expose ${canary}`);
  }
}
