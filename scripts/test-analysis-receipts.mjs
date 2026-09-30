#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const {
  closeDb,
  getDb,
  query,
  resetDbConnectionForTests,
} = require("../build/plugin/local-db.js");
const {
  persistAnalysisReceipt,
  recordAggregateHydratedReplyReconciliation,
  recordMetricReconciliation,
} = require("../build/plugin/analysis-receipts.js");
const { enforceLocalWorkspaceScope } = require("../build/plugin/sql-guard.js");
const { getQueryRecipes } = require("../build/plugin/query-recipes.js");

const workspaceId = "receipt_contract_workspace";
process.env.SENDLENS_DB_PATH = path.join(
  os.tmpdir(),
  `sendlens-analysis-receipts-${Date.now()}.duckdb`,
);
delete process.env.SENDLENS_DEMO_MODE;
delete process.env.SENDLENS_INSTANTLY_API_KEY;
delete process.env.SENDLENS_SMARTLEAD_API_KEY;
delete process.env.SENDLENS_PROVIDER;

await resetDbConnectionForTests();
const db = await getDb();

try {
  const receiptOptions = {
    db,
    workspaceId,
    question: "Which private contact should never be stored in a receipt?",
    rationale: "Check whether the observed campaign aggregate changed between report runs.",
    questionFamily: "reporting",
    recipeId: "workspace-overview",
    sql: "SELECT campaign_id, email FROM sendlens.campaign_overview WHERE email = 'private@example.invalid'",
    resultRows: [{
      campaign_id: "private-campaign-id",
      contact_email: "private@example.invalid",
      reply_count: 4,
      body_text: "private reply body",
    }],
    resultRowCount: 1,
    resultTruncated: false,
    status: "ok",
    sourceProvider: "instantly",
    cacheGeneration: "2026-08-08T12:00:00.000Z",
    analysisEligibility: {
      question_family: "reporting",
      requested_claim: "observed_pattern",
      evidence_frame: "observed",
      source_provider: "instantly",
      max_claim_class: "observed_pattern",
      statistical_claims_allowed: false,
      referenced_surfaces: ["campaign_overview"],
    },
  };

  const before = await persistAnalysisReceipt(receiptOptions);
  const after = await persistAnalysisReceipt({
    ...receiptOptions,
    resultRows: [{
      ...receiptOptions.resultRows[0],
      reply_count: 5,
    }],
  });
  const untrustedRecipe = await persistAnalysisReceipt({
    ...receiptOptions,
    recipeId: "private@example.invalid",
  });

  assert.match(before.receipt_id, /^ar_/);
  assert.equal(before.recipe_id, "workspace-overview");
  assert.match(before.recipe_hash, /^[a-f0-9]{64}$/);
  assert.equal(before.result_row_count, 1);
  assert.equal(before.statistical_claims_allowed, false);
  assert.equal(untrustedRecipe.recipe_id, null);
  assert.match(untrustedRecipe.recipe_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(before.result_hash, after.result_hash, "material result changes must change the result hash");
  assert.equal(before.metric_contract_hash, after.metric_contract_hash);

  const storedReceipts = await query(
    db,
    `SELECT receipt_id, question_hash, rationale_hash, recipe_id, recipe_hash, sql_hash,
            metric_contract_json, provider_capability_snapshot_json,
            source_freshness_json, sampling_fingerprint_json, result_hash
     FROM sendlens.analysis_receipts
     WHERE workspace_id = '${workspaceId}'
     ORDER BY created_at, receipt_id`,
  );
  assert.equal(storedReceipts.length, 3);
  const storedText = JSON.stringify(storedReceipts);
  assert.equal(storedText.includes("private@example.invalid"), false, "receipts must not store contact values");
  assert.equal(storedText.includes("private reply body"), false, "receipts must not store message bodies");
  assert.equal(storedText.includes("SELECT campaign_id"), false, "receipts must not store SQL text");
  assert.ok(storedReceipts.every((row) => row.sql_hash && !row.sql_hash.includes("SELECT")));
  assert.ok(storedReceipts.every((row) => row.recipe_hash && !row.recipe_hash.includes("workspace-overview")));

  const dependencies = await query(
    db,
    `SELECT receipt_id, dependency_key, dependency_type, dependency_hash, evidence_frame, source_provider
     FROM sendlens.report_dependencies
     WHERE workspace_id = '${workspaceId}'
     ORDER BY receipt_id, dependency_key`,
  );
  assert.equal(dependencies.length, 3);
  assert.ok(dependencies.every((row) => row.dependency_key === "campaign_overview"));
  assert.ok(dependencies.every((row) => row.dependency_type === "public_surface"));

  const scopeReconciliation = await recordAggregateHydratedReplyReconciliation({
    db,
    receiptId: after.receipt_id,
    workspaceId,
    aggregateReplyCount: 10,
    hydratedReplyCount: 4,
    coverageState: "selected_status_buckets_partial_with_aggregate_gap",
  });
  assert.equal(scopeReconciliation.status, "expected_scope_difference");
  assert.equal(scopeReconciliation.residual, 6);

  const unsupportedReconciliation = await recordMetricReconciliation({
    db,
    receiptId: after.receipt_id,
    workspaceId,
    metricKey: "provider_reply_rate",
    authoritativeSurface: "campaign_overview",
    decompositionSurface: "sampled_leads",
    compatibilityContract: { compatible: false, reason: "different denominator" },
    authoritativeValue: null,
    decomposedValue: null,
    status: "unsupported",
    severity: "high",
    expectedSemanticCauses: ["provider denominator semantics are not compatible"],
    unsupportedReason: "No approved compatibility contract exists.",
  });
  assert.equal(unsupportedReconciliation.status, "unsupported");
  assert.equal(unsupportedReconciliation.residual, null);

  const diffRecipe = getQueryRecipes().find((recipe) => recipe.id === "analysis-receipt-semantic-diff");
  assert.ok(diffRecipe, "semantic diff recipe must be registered");
  const diffSql = diffRecipe.sql
    .replaceAll("{{before_receipt_id}}", before.receipt_id)
    .replaceAll("{{after_receipt_id}}", after.receipt_id);
  const diffRows = await query(db, enforceLocalWorkspaceScope(diffSql, workspaceId));
  assert.equal(diffRows.length, 1);
  assert.equal(diffRows[0].semantic_diff_status, "material_result_change");
  assert.equal(diffRows[0].metric_contract_compatible, true);
  assert.equal(diffRows[0].result_hash_changed, true);
  assert.equal(diffRows[0].replay_contract_compatible, true);
  assert.equal(diffRows[0].question_changed, false);
  assert.equal(diffRows[0].recipe_changed, false);

  const changedQuestion = await persistAnalysisReceipt({
    ...receiptOptions,
    question: "Which other bounded report should be compared?",
    resultRows: receiptOptions.resultRows,
  });
  const changedQuestionSql = diffRecipe.sql
    .replaceAll("{{before_receipt_id}}", before.receipt_id)
    .replaceAll("{{after_receipt_id}}", changedQuestion.receipt_id);
  const changedQuestionRows = await query(db, enforceLocalWorkspaceScope(changedQuestionSql, workspaceId));
  assert.equal(changedQuestionRows[0].semantic_diff_status, "question_changed");
  assert.equal(changedQuestionRows[0].replay_contract_compatible, false);

  const reconciliationRecipe = getQueryRecipes().find((recipe) => recipe.id === "metric-reconciliation-audit");
  assert.ok(reconciliationRecipe, "metric reconciliation recipe must be registered");
  const reconciliationRows = await query(
    db,
    enforceLocalWorkspaceScope(reconciliationRecipe.sql, workspaceId),
  );
  assert.equal(reconciliationRows.length, 2);
  assert.ok(reconciliationRows.some((row) => row.status === "expected_scope_difference" && Number(row.residual) === 6));
  assert.ok(reconciliationRows.some((row) => row.status === "unsupported" && row.unsupported_reason));
} finally {
  closeDb(db);
  await resetDbConnectionForTests();
}

console.log("analysis receipt tests passed");
