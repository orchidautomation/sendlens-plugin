#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const matrixPath = path.join(root, ".pluxx/behavioral-routing-matrix.json");

const args = new Set(process.argv.slice(2));
const ciMode = args.has("--ci");
const jsonOut = valueForArg("--json-out");
const artifactPath = jsonOut === false ? null : jsonOut;

const tempRoot = path.join(os.tmpdir(), `sendlens-agentic-proof-${process.pid}-${Date.now()}`);
const stateDir = path.join(tempRoot, "state");
await mkdir(stateDir, { recursive: true });

process.env.SENDLENS_DEMO_MODE = "1";
process.env.SENDLENS_PROVIDER = "all";
process.env.SENDLENS_DB_PATH = path.join(tempRoot, "sendlens-proof-cache.duckdb");
process.env.SENDLENS_STATE_DIR = stateDir;
process.env.SENDLENS_CONTEXT_ROOT = path.join(tempRoot, "context-root-canary");

const matrix = await readProofMatrix();

const require = createRequire(import.meta.url);
const { seedDemoWorkspace } = require("../build/plugin/demo-workspace.js");
const {
  closeDb,
  getActiveWorkspaceId,
  getDb,
  query,
  resetDbConnectionForTests,
} = require("../build/plugin/local-db.js");
const {
  buildCatalogSearchGuidance,
  searchCatalog,
} = require("../build/plugin/catalog.js");
const {
  buildQueryRecipeResponse,
  getQueryRecipes,
} = require("../build/plugin/query-recipes.js");
const {
  buildAnalyzeDataDiagnostics,
} = require("../build/plugin/analyze-data-diagnostics.js");
const {
  enforceLocalWorkspaceScope,
  LocalSqlGuardError,
} = require("../build/plugin/sql-guard.js");
const { readRefreshStatus } = require("../build/plugin/refresh-status.js");
const { buildWorkspaceSummary } = require("../build/plugin/summary.js");

const ANALYZE_DATA_ROW_LIMIT = 1_000;
const ANALYZE_DATA_SAFE_ERROR = "Query could not be executed safely.";
const REVIEWED_BASELINE_RECIPE_IDS = Object.freeze([
  "account-health",
  "account-manager-client-brief",
  "campaign-daily-health-trend",
  "campaign-evidence-coverage-audit",
  "campaign-funnel-quality",
  "campaign-launch-qa-checklist",
  "campaign-lead-state-sample-by-step",
  "campaign-payload-key-inventory",
  "campaign-payload-key-signals",
  "campaign-payload-presence-signals",
  "campaign-payload-sample",
  "campaign-sender-inventory-by-tag",
  "campaign-tag-account-tag-capacity-runway",
  "campaign-tag-daily-volume",
  "campaign-tag-daily-volume-deduped",
  "campaign-tag-daily-volume-trend",
  "campaign-tag-daily-volume-utilization",
  "campaign-tag-runway-daily-history",
  "campaign-tag-runway-inputs",
  "campaign-tag-sender-coverage",
  "campaign-tag-true-daily-volume",
  "campaign-tag-true-daily-volume-trend",
  "campaign-tracking-deliverability-settings",
  "campaign-winners",
  "campaigns-by-tag",
  "company-domain-quality",
  "copy-template-review",
  "cross-provider-overlap-risk",
  "duplicate-contact-company-exposure",
  "experiment-planner-candidates",
  "fetched-reply-text-by-campaign",
  "fetched-reply-text-raw-detail-by-campaign",
  "inbox-placement-auth-failures",
  "inbox-placement-test-overview",
  "lead-list-source-quality",
  "negative-unsubscribe-concentration",
  "personalization-leak-audit",
  "personalization-leak-raw-detail",
  "rendered-outbound-raw-detail",
  "rendered-outbound-sample",
  "reply-email-context-feed",
  "reply-email-context-raw-detail",
  "reply-feed",
  "reply-feed-raw-detail",
  "reply-hydration-coverage",
  "reply-patterns-by-variant",
  "sampled-leads-by-tag",
  "sender-deliverability-health",
  "sender-load-balance-by-campaign-tag",
  "smartlead-delivery-authentication-health",
  "smartlead-delivery-test-overview",
  "smartlead-sender-delivery-health",
  "step-fatigue-by-campaign",
  "tag-catalog",
  "tag-scope-audit",
  "variant-winners",
  "workspace-campaign-recent-movers",
  "workspace-overview",
]);

const FIXTURES = Object.freeze({
  "campaign_tag:primary": "Priority Demo",
  "campaign_tag:missing": "sendlens-proof-missing-tag-canary",
  "literal:success": "sendlens-proof-success-row-canary",
  "literal:zero": "sendlens-proof-zero-row-canary",
  "literal:guard": "sendlens-proof-guard-literal-canary",
  "literal:query_error": "sendlens-proof-query-error-literal-canary",
  "column:query_error": "sendlens_proof_query_error_column_canary",
});

const FORBIDDEN_REPORT_FRAGMENTS = [
  ...Object.values(FIXTURES),
  "sender-a@demo.invalid",
  "sender-b@demo.invalid",
  "sender-risk@demo.invalid",
  "sender-smartlead@demo.invalid",
  "\"demo_workspace\"",
  "demo-alpha",
  "demo-beta",
  "demo-risk",
  "smartlead:demo-alpha",
  "Demo Sender Pool",
  "Founder's Demo",
  "schema_migrations",
  "SELECT ",
  "WITH ",
  "sendlens.",
  root,
  os.tmpdir(),
];

const PRIVATE_TABLE_NAME_FRAGMENTS = new Set([
  "schema_migrations",
  "sync_logs",
  "cache_owner",
]);

const ALLOWED_REPORT_KEYS = new Set([
  "schema_version",
  "mode",
  "generated_at",
  "proof_status",
  "summary",
  "setup_receipts",
  "case_count",
  "analysis_call_count",
  "excluded_setup_call_count",
  "recipe_catalog_count",
  "installed_host_mode",
  "cases",
  "id",
  "prompt_handle",
  "behavioral_case_id",
  "status",
  "analysis_calls",
  "max_analysis_calls",
  "correction_checks",
  "max_correction_checks",
  "repairs",
  "max_repairs",
  "same_route_as",
  "route_signature",
  "route",
  "tool_name",
  "recipe_id",
  "public_surfaces",
  "stable_status",
  "elapsed_ms",
  "result_class",
  "forbidden_path_status",
  "privacy",
  "report_canaries_absent",
  "stdout_canaries_absent",
  "stderr_canaries_absent",
  "artifact_canaries_absent",
  "raw_sql_absent",
  "private_table_names_absent",
  "proof_limits",
  "does_prove",
  "does_not_prove",
]);

const proofConfig = matrix.agentic_proof;
assert.ok(proofConfig, "matrix must define agentic_proof");
assert.ok(Array.isArray(proofConfig.cases), "agentic_proof.cases must be an array");
assert.ok(proofConfig.cases.length > 0, "agentic proof must execute at least one case");
const recipeRegistry = assertReviewedRecipeRegistry();
assert.equal(
  proofConfig.expected_recipe_catalog_count,
  recipeRegistry.length,
  "matrix agentic_proof baseline must match the reviewed executable registry baseline",
);
assertOutputCaptureDecodesByteViews();

const setupReceipts = [];
const caseResults = [];
const outputCapture = installOutputCapture();

await resetDbConnectionForTests();

const setupSeed = await callTool("seed_demo_workspace", {});
setupReceipts.push(sanitizedToolReceipt("seed_demo_workspace", setupSeed));

const catalogSetup = await callTool("analysis_starters", {
  mode: "summary",
  page_size: 1,
});
setupReceipts.push(sanitizedToolReceipt("analysis_starters", catalogSetup, {
  recipe_id: null,
}));
const recipeCatalogCount = Number(catalogSetup.payload.recipe_count ?? 0);
assert.equal(
  recipeCatalogCount,
  recipeRegistry.length,
  "recipe catalog count must remain compatible",
);

for (const caseConfig of proofConfig.cases) {
  caseResults.push(await executeProofCase(caseConfig));
}

const privacyCase = await executeDiagnosticPrivacyCanaries();
caseResults.push(privacyCase);
const capturedOutput = outputCapture.stop();
assertNoForbiddenFragments(capturedOutput.stdout, "captured stdout before report");
assertNoForbiddenFragments(capturedOutput.stderr, "captured stderr before report");

assert.ok(caseResults.length > 0, "agentic proof executed zero cases");
assertSameRoute(caseResults, "proof-exact-campaign-tag-sender-risk", "proof-equivalent-campaign-tag-sender-risk");
assertSuccessfulResponseKeyCompatibility(caseResults);

const report = buildReport({
  setupReceipts,
  caseResults,
  recipeCatalogCount,
});
validateAllowedKeys(report);

const reportText = JSON.stringify(report, null, 2);
assertNoForbiddenFragments(reportText, "sanitized JSON report");
if (artifactPath) {
  await mkdir(path.dirname(path.resolve(root, artifactPath)), { recursive: true });
  await writeFile(path.resolve(root, artifactPath), `${reportText}\n`, "utf8");
  const artifactText = await readFile(path.resolve(root, artifactPath), "utf8");
  assertNoForbiddenFragments(artifactText, "sanitized JSON artifact");
}

printHumanSummary(report);
console.log(reportText);

async function executeProofCase(caseConfig) {
  switch (caseConfig.id) {
    case "proof-broad-workspace-health":
      return executeBroadWorkspaceHealth(caseConfig);
    case "proof-exact-campaign-tag-sender-risk":
    case "proof-equivalent-campaign-tag-sender-risk":
      return executeExactSenderRisk(caseConfig);
    case "proof-nonexistent-exact-tag-one-correction":
      return executeMissingTagCorrection(caseConfig);
    case "proof-novel-catalog-first-sql":
      return executeNovelCatalogFirstSql(caseConfig);
    default:
      throw new Error(`Unhandled proof case: ${caseConfig.id}`);
  }
}

async function executeBroadWorkspaceHealth(caseConfig) {
  const calls = [
    await callTool("workspace_snapshot", {}),
  ];
  assert.equal(calls[0].payload.schema_version, "workspace_snapshot.v1");
  assertForbiddenRoute(caseConfig, calls);
  return proofCaseResult(caseConfig, calls, {
    result_class: "nonempty",
  });
}

async function executeExactSenderRisk(caseConfig) {
  const primaryRoute = resolveBehavioralRoute(caseConfig);
  const tagValue = resolveFixtureHandle(caseConfig.fixture_handles, "campaign_tag:primary");
  const recipeLookup = await callTool("analysis_starters", {
    recipe_id: primaryRoute.recipe_id,
  });
  const recipe = onlyRecipe(recipeLookup.payload, primaryRoute.recipe_id);
  const sql = renderRecipeSql(recipe.sql, { tag_name: tagValue });
  const analyzed = await callTool("analyze_data", {
    sql,
    rationale: "agentic proof exact sender inventory route",
  });
  assert.equal(analyzed.payload.diagnostics?.status, "ok");
  assert.ok(Array.isArray(analyzed.payload.rows) && analyzed.payload.rows.length > 0);
  assertExactSenderRiskRows(analyzed.payload.rows);
  const calls = [recipeLookup, analyzed];
  assertForbiddenRoute(caseConfig, calls);
  return proofCaseResult(caseConfig, calls, {
    result_class: "nonempty",
  });
}

async function executeMissingTagCorrection(caseConfig) {
  const primaryRoute = resolveBehavioralRoute(caseConfig);
  const missingTag = resolveFixtureHandle(caseConfig.fixture_handles, "campaign_tag:missing");
  const primaryLookup = await callTool("analysis_starters", {
    recipe_id: primaryRoute.recipe_id,
  });
  const primaryRecipe = onlyRecipe(primaryLookup.payload, primaryRoute.recipe_id);
  const primarySql = renderRecipeSql(primaryRecipe.sql, { tag_name: missingTag });
  const primaryResult = await callTool("analyze_data", {
    sql: primarySql,
    rationale: "agentic proof exact sender inventory miss route",
  });
  assert.equal(primaryResult.payload.diagnostics?.status, "zero_rows");

  const correctionLookup = await callTool("analysis_starters", {
    recipe_id: caseConfig.expected_route.correction_recipe_id,
  });
  const correctionRecipe = onlyRecipe(correctionLookup.payload, caseConfig.expected_route.correction_recipe_id);
  const correctionSql = renderRecipeSql(correctionRecipe.sql, { tag_name: missingTag });
  const correctionResult = await callTool("analyze_data", {
    sql: correctionSql,
    rationale: "agentic proof one declared tag-scope correction check",
  });
  assert.equal(correctionResult.payload.diagnostics?.status, "zero_rows");

  const calls = [primaryLookup, primaryResult, correctionLookup, correctionResult];
  assertForbiddenRoute(caseConfig, calls);
  return proofCaseResult(caseConfig, calls, {
    correction_checks: 1,
    max_correction_checks: caseConfig.expected_route.max_correction_checks,
    result_class: "zero_rows_stop",
  });
}

async function executeNovelCatalogFirstSql(caseConfig) {
  const catalog = await callTool("search_catalog", {
    query: "provider opportunities by active campaign",
  });
  assert.ok(Array.isArray(catalog.payload.matches));
  const analyzed = await callTool("analyze_data", {
    sql: [
      "SELECT source_provider, COUNT(*) AS active_campaigns, SUM(total_opportunities) AS opportunity_count",
      "FROM sendlens.campaign_overview",
      "WHERE status = 'active'",
      "GROUP BY source_provider",
      "ORDER BY opportunity_count DESC NULLS LAST",
    ].join("\n"),
    rationale: "agentic proof focused public-view provider opportunity comparison",
  });
  assert.equal(analyzed.payload.diagnostics?.status, "ok");
  assert.deepEqual(analyzed.payload.diagnostics?.referenced_surfaces, ["campaign_overview"]);
  const calls = [catalog, analyzed];
  assert.equal(calls[0].toolName, caseConfig.expected_route.required_first_tool);
  assertForbiddenRoute(caseConfig, calls);
  return proofCaseResult(caseConfig, calls, {
    repairs: 0,
    max_repairs: caseConfig.expected_route.max_repairs,
    result_class: "nonempty",
  });
}

async function executeDiagnosticPrivacyCanaries() {
  const success = await callTool("analyze_data", {
    sql: `SELECT '${FIXTURES["literal:success"]}' AS sanitizer_probe FROM sendlens.campaign_overview LIMIT 1`,
    rationale: "agentic proof success sanitizer canary",
  });
  assert.equal(success.payload.diagnostics?.status, "ok");

  const zeroRows = await callTool("analyze_data", {
    sql: `SELECT campaign_id FROM sendlens.campaign_overview WHERE campaign_name = '${FIXTURES["literal:zero"]}'`,
    rationale: "agentic proof zero-row sanitizer canary",
  });
  assert.equal(zeroRows.payload.diagnostics?.status, "zero_rows");
  assertNoRawCanaries(zeroRows.payload, "zero-row diagnostic payload");

  const guardRejected = await callTool("analyze_data", {
    sql: `SELECT * FROM sendlens.schema_migrations WHERE migration_id = '${FIXTURES["literal:guard"]}'`,
    rationale: "agentic proof guard sanitizer canary",
  });
  assert.equal(guardRejected.payload.diagnostics?.status, "guard_rejected");
  assertNoRawCanaries(guardRejected.payload, "guard diagnostic payload");

  const queryError = await callTool("analyze_data", {
    sql: `SELECT ${FIXTURES["column:query_error"]} FROM sendlens.campaign_overview WHERE campaign_name = '${FIXTURES["literal:query_error"]}'`,
    rationale: "agentic proof query-error sanitizer canary",
  });
  assert.equal(queryError.payload.diagnostics?.status, "query_error");
  assertNoRawCanaries(queryError.payload, "query-error diagnostic payload");

  const calls = [success, zeroRows, guardRejected, queryError];
  return {
    id: "proof-diagnostic-privacy-canaries",
    prompt_handle: "diagnostic-privacy:success-zero-guard-query-error",
    status: "passed",
    analysis_calls: calls.length,
    max_analysis_calls: calls.length,
    correction_checks: 0,
    repairs: 0,
    route_signature: calls.map((call) => `${call.toolName}:${stableStatus(call.payload)}`).join(">"),
    route: calls.map((call) => sanitizedToolReceipt(call.toolName, call, {
      recipe_id: "custom_sql",
    })),
    result_class: "privacy_canaries_absent_from_reportable_surfaces",
    forbidden_path_status: "not_applicable",
  };
}

async function callTool(toolName, input) {
  const started = performance.now();
  const payload = await dispatchLocalTool(toolName, input);
  return {
    toolName,
    elapsedMs: Math.max(0, Math.round(performance.now() - started)),
    payload,
  };
}

async function dispatchLocalTool(toolName, input) {
  switch (toolName) {
    case "seed_demo_workspace":
      return seedDemoWorkspace();
    case "analysis_starters":
      return buildQueryRecipeResponse(input);
    case "workspace_snapshot":
      return withDb(async (db) => buildWorkspaceSummary(db, undefined, input.provider ?? "all"));
    case "search_catalog":
      return withDb(async (db) => {
        const matches = await searchCatalog(db, input.query);
        const guidance = buildCatalogSearchGuidance(input.query, matches);
        return {
          query: input.query,
          matches,
          search_terms: guidance.search_terms,
          suggested_narrower_terms: guidance.suggested_narrower_terms,
          analysis_starter_suggestions: guidance.analysis_starter_suggestions,
          guidance: guidance.message,
        };
      });
    case "analyze_data":
      return runAnalyzeDataLike(input);
    default:
      throw new Error(`Unsupported local proof tool: ${toolName}`);
  }
}

async function withDb(callback) {
  const db = await getDb();
  let callbackError = null;
  try {
    return await callback(db);
  } catch (error) {
    callbackError = error;
    throw error;
  } finally {
    try {
      closeDb(db);
    } catch (closeError) {
      if (!callbackError) throw closeError;
    }
  }
}

async function runAnalyzeDataLike({ sql, rationale }) {
  const handlerStartedAt = performance.now();
  const refreshStatus = await readRefreshStatus();
  const db = await getDb();
  try {
    const workspaceId = await getActiveWorkspaceId(db);
    if (!workspaceId) {
      return analyzeDataFailurePayload("cache_unavailable", buildAnalyzeDataDiagnostics({
        status: "cache_unavailable",
        startedAt: handlerStartedAt,
        refreshStatus,
        sql,
      }));
    }

    let rewritten;
    try {
      rewritten = enforceLocalWorkspaceScope(sql, workspaceId);
    } catch (err) {
      if (err instanceof LocalSqlGuardError) {
        return analyzeDataFailurePayload(err.code, buildAnalyzeDataDiagnostics({
          status: "guard_rejected",
          startedAt: handlerStartedAt,
          refreshStatus,
          sql,
        }));
      }
      throw err;
    }

    const cappedSql = [
      "SELECT *",
      `FROM (${stripTrailingSemicolon(rewritten)}) AS sendlens_limited_query`,
      `LIMIT ${ANALYZE_DATA_ROW_LIMIT + 1}`,
    ].join("\n");
    const rows = await query(db, cappedSql);
    const resultTruncated = rows.length > ANALYZE_DATA_ROW_LIMIT;
    const returnedRows = rows.slice(0, ANALYZE_DATA_ROW_LIMIT);
    return {
      rationale,
      row_count: returnedRows.length,
      result_truncated: resultTruncated,
      output_limits: {
        row_limit: ANALYZE_DATA_ROW_LIMIT,
      },
      diagnostics: buildAnalyzeDataDiagnostics({
        status: returnedRows.length === 0 ? "zero_rows" : "ok",
        startedAt: handlerStartedAt,
        refreshStatus,
        sql,
        rowCount: returnedRows.length,
        resultTruncated,
      }),
      rows: returnedRows,
    };
  } catch {
    return analyzeDataFailurePayload("query_error", buildAnalyzeDataDiagnostics({
      status: "query_error",
      startedAt: handlerStartedAt,
      refreshStatus,
      sql,
    }));
  } finally {
    closeDb(db);
  }
}

function analyzeDataFailurePayload(code, diagnostics) {
  return {
    error: ANALYZE_DATA_SAFE_ERROR,
    code,
    hint: "Use one focused read-only SELECT/WITH query against public views. Do not include private literals in retries.",
    diagnostics,
  };
}

function stripTrailingSemicolon(sql) {
  return sql.trim().replace(/;+\s*$/, "");
}

function assertReviewedRecipeRegistry() {
  const recipeIds = getQueryRecipes().map((recipe) => recipe.id).sort();
  assert.ok(recipeIds.length > 0, "getQueryRecipes() returned zero recipes");
  assert.equal(
    new Set(recipeIds).size,
    recipeIds.length,
    "getQueryRecipes() must not expose duplicate recipe IDs",
  );
  assert.deepEqual(
    recipeIds,
    [...REVIEWED_BASELINE_RECIPE_IDS].sort(),
    "getQueryRecipes() registry drifted from the reviewed v0.1.64 baseline; update this harness only with a reviewed recipe change",
  );
  assert.equal(recipeIds.length, 58, "reviewed v0.1.64 recipe baseline is 58");
  return recipeIds;
}

function assertSuccessfulResponseKeyCompatibility(caseResults) {
  const capturedReceipts = caseResults.flatMap((caseResult) => caseResult.route);
  assert.ok(capturedReceipts.length > 0, "proof must capture at least one successful tool receipt");

  const exactRecipeCase = caseResults.find((item) => item.id === "proof-exact-campaign-tag-sender-risk");
  assert.ok(exactRecipeCase, "exact recipe proof case must execute");
  assert.ok(
    exactRecipeCase.route.some((receipt) =>
      receipt.tool_name === "analysis_starters"
      && receipt.recipe_id === "campaign-sender-inventory-by-tag"
      && receipt.stable_status === "ok"
    ),
    "successful analysis_starters receipt must preserve recipe_id/status compatibility",
  );
  assert.ok(
    exactRecipeCase.route.some((receipt) =>
      receipt.tool_name === "analyze_data"
      && receipt.recipe_id === "campaign-sender-inventory-by-tag"
      && receipt.public_surfaces.includes("campaign_accounts")
      && receipt.stable_status === "ok"
    ),
    "successful analyze_data receipt must preserve recipe_id/public surface/status compatibility",
  );
}

function proofCaseResult(caseConfig, calls, extras = {}) {
  assert.equal(
    calls.length <= caseConfig.expected_route.max_analysis_calls,
    true,
    `${caseConfig.id} exceeded max analysis calls`,
  );
  const toolNames = calls.map((call) => call.toolName);
  assert.deepEqual(toolNames, caseConfig.expected_route.tools);
  return {
    id: caseConfig.id,
    prompt_handle: caseConfig.prompt_handle,
    behavioral_case_id: caseConfig.behavioral_case_id,
    status: "passed",
    analysis_calls: calls.length,
    max_analysis_calls: caseConfig.expected_route.max_analysis_calls,
    correction_checks: extras.correction_checks ?? 0,
    max_correction_checks: extras.max_correction_checks ?? caseConfig.expected_route.max_correction_checks ?? 0,
    repairs: extras.repairs ?? 0,
    max_repairs: extras.max_repairs ?? caseConfig.expected_route.max_repairs ?? 0,
    same_route_as: caseConfig.expected_route.same_route_as,
    route_signature: routeSignature(calls, caseConfig),
    route: calls.map((call) => sanitizedToolReceipt(call.toolName, call, {
      recipe_id: recipeIdForCall(call, caseConfig),
    })),
    result_class: extras.result_class ?? "completed",
    forbidden_path_status: "passed",
  };
}

function sanitizedToolReceipt(toolName, call, extra = {}) {
  return {
    tool_name: toolName,
    recipe_id: extra.recipe_id ?? recipeIdFromPayload(call.payload),
    public_surfaces: boundedPublicSurfaces(call.payload),
    stable_status: stableStatus(call.payload),
    elapsed_ms: ciMode ? 0 : call.elapsedMs,
  };
}

function buildReport({ setupReceipts, caseResults, recipeCatalogCount }) {
  const analysisCallCount = caseResults.reduce((sum, item) => sum + item.analysis_calls, 0);
  return {
    schema_version: "sendlens_agentic_routing_proof.v1",
    mode: ciMode ? "demo_ci" : "demo_local",
    generated_at: ciMode ? "1970-01-01T00:00:00.000Z" : new Date().toISOString(),
    proof_status: "passed",
    summary: {
      case_count: caseResults.length,
      analysis_call_count: analysisCallCount,
      excluded_setup_call_count: setupReceipts.length,
      recipe_catalog_count: recipeCatalogCount,
      installed_host_mode: "not_run_optional_local_only",
    },
    setup_receipts: setupReceipts,
    cases: caseResults,
    privacy: {
      report_canaries_absent: true,
      stdout_canaries_absent: true,
      stderr_canaries_absent: true,
      artifact_canaries_absent: Boolean(artifactPath),
      raw_sql_absent: true,
      private_table_names_absent: true,
    },
    proof_limits: {
      does_prove: [
        "demo/CI prompt handles route to the expected tool sequence",
        "setup calls are excluded from per-case user-analysis budgets",
        "exact and equivalent campaign-tag sender-risk handles use the canonical recipe before execution",
        "a missing exact tag uses one declared correction check and stops without broadening",
        "a novel supported handle uses catalog context before one focused public-view query",
        "sanitized reportable surfaces omit raw SQL, literals, rows, local paths, identifiers, and private table names",
      ],
      does_not_prove: [
        "installed-host latency or host UI behavior unless optional local installed mode is run separately",
        "runtime enforcement of natural-language route intent",
        "query interruption, compute limits, exact column lineage, or persisted telemetry",
        "provider network behavior or provider mutations",
      ],
    },
  };
}

function printHumanSummary(report) {
  console.log("SendLens agentic routing proof: PASS");
  console.log(`Mode: ${report.mode}`);
  console.log(`Cases: ${report.summary.case_count}; analysis calls: ${report.summary.analysis_call_count}; setup calls excluded: ${report.summary.excluded_setup_call_count}`);
  for (const item of report.cases) {
    console.log(`- ${item.id}: ${item.status}; calls=${item.analysis_calls}/${item.max_analysis_calls}; route=${item.route_signature}`);
  }
  console.log("Privacy: sanitized report/stdout/stderr/artifact contain only route/tool/recipe/public-surface/status/timing metadata.");
}

function onlyRecipe(payload, recipeId) {
  assert.equal(payload.output_shape, "single_recipe");
  assert.equal(payload.recipe_count, 1);
  assert.equal(payload.recipes?.[0]?.id, recipeId);
  assert.equal(typeof payload.recipes?.[0]?.sql, "string");
  return payload.recipes[0];
}

function renderRecipeSql(sql, values) {
  return sql.replaceAll(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, name) => {
    assert.ok(Object.hasOwn(values, name), `missing fixture for ${name}`);
    return sqlStringLiteralValue(values[name]);
  });
}

function assertExactSenderRiskRows(rows) {
  const rowText = JSON.stringify(rows);
  assert.match(rowText, /campaign_tag_label/);
  assert.match(rowText, /campaign_source_id/);
  assert.match(rowText, /stored_account_sent_30d/);
  assert.match(rowText, /sender_risk_signal/);
  assert.doesNotMatch(rowText, /account_daily_metrics/);
  assert.ok(
    rows.some((row) => String(row.sender_risk_signal ?? "").trim().length > 0),
    "sender inventory proof should retain sender risk evidence",
  );
}

function assertSameRoute(caseResults, firstId, secondId) {
  const first = caseResults.find((item) => item.id === firstId);
  const second = caseResults.find((item) => item.id === secondId);
  assert.ok(first && second, "same-route cases must both execute");
  assert.equal(second.same_route_as, firstId);
  assert.notEqual(second.behavioral_case_id, first.behavioral_case_id);
  assert.equal(second.route_signature, first.route_signature);
}

function assertForbiddenRoute(caseConfig, calls) {
  const usedTools = new Set(calls.map((call) => call.toolName));
  for (const toolName of caseConfig.expected_route.forbidden_tools ?? []) {
    assert.equal(usedTools.has(toolName), false, `${caseConfig.id} must not use ${toolName}`);
  }
  const surfaces = new Set(calls.flatMap((call) => boundedPublicSurfaces(call.payload)));
  for (const surface of caseConfig.expected_route.forbidden_public_surfaces ?? []) {
    assert.equal(surfaces.has(surface), false, `${caseConfig.id} must not reference ${surface}`);
  }
}

function recipeIdForCall(call, caseConfig) {
  if (call.toolName === "analysis_starters") return recipeIdFromPayload(call.payload);
  if (call.toolName === "search_catalog") return null;
  if (caseConfig.expected_route.recipe_id === "custom_sql") return "custom_sql";
  if (caseConfig.id === "proof-nonexistent-exact-tag-one-correction") {
    return call.payload.diagnostics?.referenced_surfaces?.includes("custom_tag_mappings")
      ? caseConfig.expected_route.correction_recipe_id
      : caseConfig.expected_route.recipe_id;
  }
  return caseConfig.expected_route.recipe_id ?? null;
}

function resolveBehavioralRoute(caseConfig) {
  const behavioralCaseId = caseConfig.behavioral_case_id;
  assert.equal(typeof behavioralCaseId, "string", `${caseConfig.id} must bind to a behavioral matrix case`);
  const behavioralCase = (matrix.cases ?? []).find((entry) => entry.id === behavioralCaseId);
  assert.ok(behavioralCase, `${caseConfig.id} references missing behavioral case ${behavioralCaseId}`);
  assert.equal(
    behavioralCase.expected_primary_owner,
    "sendlens-analyst",
    `${behavioralCaseId} must remain analyst-owned`,
  );
  assert.equal(
    behavioralCase.expected_should_trigger?.["sendlens-analyst"],
    true,
    `${behavioralCaseId} must trigger sendlens-analyst`,
  );
  assert.equal(
    behavioralCase.expected_route?.first_tool,
    caseConfig.expected_route.tools[0],
    `${behavioralCaseId} first tool drifted from proof route`,
  );
  assert.equal(
    behavioralCase.expected_route?.recipe_id,
    caseConfig.expected_route.recipe_id,
    `${behavioralCaseId} recipe drifted from proof route`,
  );
  const expectedBudget = caseConfig.expected_route.correction_recipe_id
    ? behavioralCase.expected_call_budget?.correction_max_calls
    : behavioralCase.expected_call_budget?.fast_path_max_calls;
  assert.equal(
    expectedBudget,
    caseConfig.expected_route.max_analysis_calls,
    `${behavioralCaseId} call budget drifted from proof route`,
  );
  return {
    recipe_id: behavioralCase.expected_route.recipe_id,
    first_tool: behavioralCase.expected_route.first_tool,
  };
}

function recipeIdFromPayload(payload) {
  if (payload.output_shape === "single_recipe") return payload.recipes?.[0]?.id ?? null;
  return payload.recipe_id ?? null;
}

function boundedPublicSurfaces(payload) {
  const surfaces = new Set();
  for (const surface of payload.diagnostics?.referenced_surfaces ?? []) {
    if (typeof surface === "string") surfaces.add(surface);
  }
  for (const match of payload.matches ?? []) {
    if (typeof match.table === "string") surfaces.add(match.table);
  }
  return [...surfaces]
    .filter((surface) => !PRIVATE_TABLE_NAME_FRAGMENTS.has(surface))
    .sort()
    .slice(0, 8);
}

function stableStatus(payload) {
  if (payload.error) return payload.diagnostics?.status ?? payload.code ?? "error";
  return payload.diagnostics?.status ?? "ok";
}

function routeSignature(calls, caseConfig) {
  return calls.map((call) => {
    const recipeId = recipeIdFromPayload(call.payload)
      ?? (call.toolName === "analyze_data" ? recipeIdForCall(call, caseConfig) : null);
    return recipeId ? `${call.toolName}:${recipeId}` : call.toolName;
  }).join(">");
}

function resolveFixtureHandle(handles, requiredHandle) {
  assert.ok(handles.includes(requiredHandle), `missing fixture handle ${requiredHandle}`);
  return FIXTURES[requiredHandle];
}

function sqlStringLiteralValue(value) {
  return String(value).replaceAll("'", "''");
}

function assertNoRawCanaries(payload, surface) {
  const text = JSON.stringify(payload);
  for (const value of Object.values(FIXTURES)) {
    assert.equal(text.includes(value), false, `${surface} must not expose ${value}`);
  }
  assert.equal(Object.hasOwn(payload, "sql"), false, `${surface} must not expose SQL field`);
}

function assertNoForbiddenFragments(text, surface) {
  for (const [index, fragment] of FORBIDDEN_REPORT_FRAGMENTS.entries()) {
    assert.equal(
      text.includes(fragment),
      false,
      `${surface} must not expose forbidden fragment category ${index}`,
    );
  }
}

function validateAllowedKeys(value, pathLabel = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateAllowedKeys(item, `${pathLabel}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    assert.ok(ALLOWED_REPORT_KEYS.has(key), `${pathLabel}: report key ${key} is not allowlisted`);
    validateAllowedKeys(nested, `${pathLabel}.${key}`);
  }
}

function valueForArg(name) {
  const argv = process.argv.slice(2);
  const exactIndex = argv.indexOf(name);
  if (exactIndex >= 0) {
    return argv[exactIndex + 1] ?? false;
  }
  const prefix = `${name}=`;
  const prefixed = argv.find((arg) => arg.startsWith(prefix));
  if (prefixed) return prefixed.slice(prefix.length);
  if (args.has("--no-artifact")) return false;
  return undefined;
}

async function readProofMatrix() {
  try {
    return JSON.parse(await readFile(matrixPath, "utf8"));
  } catch (error) {
    const reason = error instanceof SyntaxError ? "invalid_json" : "missing_or_unreadable";
    console.error(`agentic proof matrix unavailable: ${reason}`);
    process.exit(1);
  }
}

function installOutputCapture() {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const captured = {
    stdout: "",
    stderr: "",
  };
  process.stdout.write = function writeStdout(chunk, encoding, callback) {
    captured.stdout += chunkToString(chunk, encoding);
    return originalStdoutWrite(chunk, encoding, callback);
  };
  process.stderr.write = function writeStderr(chunk, encoding, callback) {
    captured.stderr += chunkToString(chunk, encoding);
    return originalStderrWrite(chunk, encoding, callback);
  };
  return {
    stop() {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
      return captured;
    },
  };
}

function chunkToString(chunk, encoding) {
  if (typeof chunk === "string") return chunk;
  if (Buffer.isBuffer(chunk)) return chunk.toString(typeof encoding === "string" ? encoding : "utf8");
  if (ArrayBuffer.isView(chunk)) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString(
      typeof encoding === "string" ? encoding : "utf8",
    );
  }
  if (chunk instanceof ArrayBuffer) {
    return Buffer.from(chunk).toString(typeof encoding === "string" ? encoding : "utf8");
  }
  return String(chunk);
}

function assertOutputCaptureDecodesByteViews() {
  const canary = FIXTURES["literal:success"];
  const framed = Buffer.from(`!${canary}!`, "utf8");
  const bytes = new Uint8Array(framed.buffer, framed.byteOffset + 1, framed.byteLength - 2);
  const dataView = new DataView(framed.buffer, framed.byteOffset + 1, framed.byteLength - 2);
  assert.equal(chunkToString(bytes, "utf8"), canary, "Uint8Array output capture must decode emitted text");
  assert.equal(chunkToString(dataView, "utf8"), canary, "DataView output capture must decode emitted text");
  assert.equal(
    chunkToString(Uint8Array.from(Buffer.from(canary, "utf8")).buffer, "utf8"),
    canary,
    "ArrayBuffer output capture must decode emitted text",
  );
}
