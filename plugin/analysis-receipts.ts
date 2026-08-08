import { createHash, randomUUID } from "node:crypto";
import type { DuckDBConnection } from "@duckdb/node-api";
import { getQueryRecipeById, type QueryRecipe } from "./query-recipes";
import { query, run } from "./local-db";

export const ANALYSIS_RECEIPT_SCHEMA_VERSION = "analysis_receipt.v1";
export const METRIC_RECONCILIATION_SCHEMA_VERSION = "metric_reconciliation.v1";

const MAX_RECEIPT_RESULT_ROWS = 256;
const MAX_RECEIPT_SNAPSHOT_ROWS = 256;

type JsonRecord = Record<string, unknown>;

export type PublicAnalysisReceipt = {
  schema_version: typeof ANALYSIS_RECEIPT_SCHEMA_VERSION;
  receipt_id: string;
  status: string;
  created_at: string;
  question_family: string | null;
  recipe_id: string | null;
  recipe_hash: string | null;
  question_hash: string;
  rationale_hash: string | null;
  sql_hash: string | null;
  metric_contract_hash: string;
  provider_capability_snapshot_hash: string;
  source_freshness_hash: string;
  sampling_fingerprint_hash: string;
  dependency_set_hash: string;
  result_hash: string;
  result_row_count: number;
  result_truncated: boolean;
  evidence_frame: string;
  source_provider: string;
  max_claim_class: string;
  statistical_claims_allowed: boolean;
};

export type PersistAnalysisReceiptOptions = {
  db: DuckDBConnection;
  workspaceId: string;
  question?: string | null;
  rationale?: string | null;
  questionFamily?: string | null;
  recipeId?: string | null;
  sql?: string | null;
  resultRows?: JsonRecord[];
  resultRowCount?: number;
  resultTruncated?: boolean;
  status: string;
  sourceProvider?: string | null;
  cacheGeneration?: string | null;
  analysisEligibility?: JsonRecord | null;
};

export type MetricReconciliationStatus =
  | "reconciled"
  | "expected_scope_difference"
  | "non_comparable"
  | "unsupported"
  | "retrieval_defect";

export type RecordMetricReconciliationOptions = {
  db: DuckDBConnection;
  receiptId: string;
  workspaceId: string;
  metricKey: string;
  authoritativeSurface: string;
  decompositionSurface: string;
  compatibilityContract: JsonRecord;
  authoritativeValue?: number | null;
  decomposedValue?: number | null;
  status: MetricReconciliationStatus;
  severity: "low" | "medium" | "high";
  expectedSemanticCauses: string[];
  unsupportedReason?: string | null;
};

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : JSON.stringify(String(value));
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return JSON.stringify(`${value.toString()}n`);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export function hashReceiptValue(value: unknown) {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function sqlLiteral(value: unknown) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumber(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "NULL" : String(value);
}

function sqlBoolean(value: boolean) {
  return value ? "TRUE" : "FALSE";
}

function normalizedString(value: unknown, fallback = "unknown") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeResultRow(row: JsonRecord) {
  const safe: JsonRecord = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
      continue;
    }
    const text = String(value);
    if (
      /(^|_)(email|phone|body|html|subject|payload|personalization|path|token|secret|cookie|header|raw|json)(_|$)/i.test(key)
      || /@/.test(text)
      || text.length > 160
      || /(^|_)(id|key|domain|name)(_|$)/i.test(key)
    ) {
      safe[key] = `hash:${hashReceiptValue(text)}`;
    } else {
      safe[key] = text;
    }
  }
  return safe;
}

function safeResultHash(rows: JsonRecord[], resultTruncated: boolean, resultRowCount: number) {
  const boundedRows = rows.slice(0, MAX_RECEIPT_RESULT_ROWS);
  return hashReceiptValue({
    schema_version: ANALYSIS_RECEIPT_SCHEMA_VERSION,
    rows: boundedRows.map(safeResultRow),
    captured_row_count: boundedRows.length,
    result_row_count: resultRowCount,
    result_truncated: resultTruncated || rows.length > MAX_RECEIPT_RESULT_ROWS,
  });
}

function safeSnapshotJson(value: unknown) {
  return JSON.stringify(value);
}

function frameFromSampling(row: JsonRecord) {
  const provenance = normalizedString(row.provenance_status, "unknown").toLowerCase();
  const ingestMode = normalizedString(row.ingest_mode, "").toLowerCase();
  if (row.lead_cursor_exhausted === true && ["complete", "exact"].includes(provenance)) return "complete";
  if (row.lead_cursor_exhausted === false) return "partial";
  if (["sampled", "enriched_tail"].includes(provenance) || ingestMode.includes("sample")) return "sampled";
  return "observed";
}

async function readProviderCapabilitySnapshot(db: DuckDBConnection, workspaceId: string) {
  try {
    const rows = await query(
      db,
      `SELECT
         source_provider,
         capability,
         support_status,
         confidence,
         synced_at
       FROM sendlens.provider_capabilities
       WHERE workspace_id = ${sqlLiteral(workspaceId)}
       ORDER BY source_provider, capability
       LIMIT ${MAX_RECEIPT_SNAPSHOT_ROWS}`,
    );
    return rows.map((row) => ({
      source_provider: normalizedString(row.source_provider),
      capability: normalizedString(row.capability),
      support_status: normalizedString(row.support_status),
      confidence: row.confidence == null ? null : String(row.confidence),
      synced_at: row.synced_at == null ? null : String(row.synced_at),
    }));
  } catch {
    return [];
  }
}

async function readSourceFreshnessSnapshot(db: DuckDBConnection, workspaceId: string) {
  try {
    const rows = await query(
      db,
      `SELECT
         COALESCE(source_provider, 'instantly') AS source_provider,
         MAX(synced_at) AS freshest_at,
         COUNT(*) AS row_count
       FROM sendlens.campaigns
       WHERE workspace_id = ${sqlLiteral(workspaceId)}
       GROUP BY 1
       UNION ALL
       SELECT
         COALESCE(source_provider, 'instantly') AS source_provider,
         MAX(created_at) AS freshest_at,
         COUNT(*) AS row_count
       FROM sendlens.sampling_runs
       WHERE workspace_id = ${sqlLiteral(workspaceId)}
       GROUP BY 1
       UNION ALL
       SELECT
         COALESCE(source_provider, 'unknown') AS source_provider,
         MAX(COALESCE(completed_at, created_at)) AS freshest_at,
         COUNT(*) AS row_count
       FROM sendlens.sync_runs
       WHERE workspace_id = ${sqlLiteral(workspaceId)}
       GROUP BY 1
       ORDER BY source_provider, freshest_at DESC NULLS LAST
       LIMIT ${MAX_RECEIPT_SNAPSHOT_ROWS}`,
    );
    return rows.map((row) => ({
      source_provider: normalizedString(row.source_provider),
      freshest_at: row.freshest_at == null ? null : String(row.freshest_at),
      row_count: numberOrNull(row.row_count) ?? 0,
    }));
  } catch {
    return [];
  }
}

async function readSamplingFingerprintSnapshot(db: DuckDBConnection, workspaceId: string) {
  try {
    const rows = await query(
      db,
      `SELECT
         source_provider,
         campaign_id,
         campaign_source_id,
         ingest_mode,
         lead_cursor_exhausted,
         provenance_status,
         effective_population_size,
         selected_record_count,
         population_fingerprint,
         sampling_seed,
         created_at
       FROM sendlens.sampling_runs
       WHERE workspace_id = ${sqlLiteral(workspaceId)}
       ORDER BY source_provider, campaign_id
       LIMIT ${MAX_RECEIPT_SNAPSHOT_ROWS}`,
    );
    return rows.map((row) => ({
      source_provider: normalizedString(row.source_provider),
      campaign_key_hash: hashReceiptValue(row.campaign_id),
      campaign_source_key_hash: hashReceiptValue(row.campaign_source_id),
      ingest_mode: normalizedString(row.ingest_mode),
      frame: frameFromSampling(row),
      lead_cursor_exhausted: row.lead_cursor_exhausted === true,
      provenance_status: normalizedString(row.provenance_status),
      effective_population_size: numberOrNull(row.effective_population_size),
      selected_record_count: numberOrNull(row.selected_record_count),
      population_fingerprint_hash: row.population_fingerprint == null ? null : hashReceiptValue(row.population_fingerprint),
      sampling_seed_hash: row.sampling_seed == null ? null : hashReceiptValue(row.sampling_seed),
      created_at: row.created_at == null ? null : String(row.created_at),
    }));
  } catch {
    return [];
  }
}

function metricContractFor(
  recipe: QueryRecipe | undefined,
  recipeId: string | null,
  questionFamily: string | null,
  surfaces: string[],
  claimClass: string,
) {
  const route = recipe?.route_card;
  const exactness = recipe?.exactness ?? "custom";
  const denominator = surfaces.some((surface) => ["lead_evidence", "sampled_leads", "lead_payload_kv", "reply_context", "reply_email_context"].includes(surface))
    ? "sampled_or_observed_surface_specific"
    : surfaces.some((surface) => ["campaign_overview", "campaign_analytics", "campaign_daily_metrics", "step_analytics", "campaign_variants"].includes(surface))
      ? "provider_aggregate_or_configured_surface"
      : "declared_by_query";
  return {
    schema_version: "metric_contract.v1",
    question_family: questionFamily,
    recipe_id: recipeId,
    exactness,
    surfaces,
    grain: route?.grain ?? "query-declared",
    denominator,
    time_basis: route?.time_basis ?? "query-declared",
    attribution: route?.attribution ?? "query-declared",
    provider_scope: route?.provider_scope ?? "provider-qualified when present",
    population_scope: route?.population_scope ?? "query-result scope",
    evidence_class: exactness === "exact" ? "exact-fact" : exactness === "sampled" ? "hydrated-sample" : "coverage-summary",
    requested_claim_class: claimClass,
  };
}

function evidenceFrameFromEligibility(analysisEligibility: JsonRecord | null | undefined) {
  const value = String(analysisEligibility?.evidence_frame ?? "observed").trim().toLowerCase();
  return value || "observed";
}

function sourceProviderFromEligibility(analysisEligibility: JsonRecord | null | undefined, fallback?: string | null) {
  return normalizedString(analysisEligibility?.source_provider ?? fallback, "unknown");
}

export async function persistAnalysisReceipt(
  options: PersistAnalysisReceiptOptions,
): Promise<PublicAnalysisReceipt> {
  const receiptId = `ar_${randomUUID()}`;
  const surfaces = [...new Set((options.analysisEligibility?.referenced_surfaces as string[] | undefined) ?? [])].sort();
  const requestedRecipeId = options.recipeId?.trim() || null;
  const recipe = requestedRecipeId ? getQueryRecipeById(requestedRecipeId) : undefined;
  const recipeId = requestedRecipeId && (
    recipe
    || requestedRecipeId === "custom_sql"
    || requestedRecipeId === "prepare_campaign_analysis"
  )
    ? requestedRecipeId
    : null;
  const recipeHash = requestedRecipeId
    ? hashReceiptValue({
      recipe_id: requestedRecipeId,
      recipe_sql: recipe?.sql ?? null,
      recipe_rationale: recipe?.rationale ?? null,
      route_card: recipe?.route_card ?? null,
    })
    : null;
  const questionHash = hashReceiptValue(options.question ?? options.rationale ?? "unspecified_question");
  const rationaleHash = options.rationale ? hashReceiptValue(options.rationale) : null;
  const sqlHash = options.sql ? hashReceiptValue(options.sql) : null;
  const claimClass = normalizedString(options.analysisEligibility?.requested_claim, "observed_pattern");
  const metricContract = metricContractFor(recipe, recipeId, options.questionFamily ?? null, surfaces, claimClass);
  const capabilitySnapshot = await readProviderCapabilitySnapshot(options.db, options.workspaceId);
  const sourceFreshnessSnapshot = await readSourceFreshnessSnapshot(options.db, options.workspaceId);
  const samplingFingerprintSnapshot = await readSamplingFingerprintSnapshot(options.db, options.workspaceId);
  const providerCapabilitySnapshotHash = hashReceiptValue(capabilitySnapshot);
  const sourceFreshnessHash = hashReceiptValue(sourceFreshnessSnapshot);
  const samplingFingerprintHash = hashReceiptValue(samplingFingerprintSnapshot);
  const dependencies = surfaces.slice(0, 64).map((surface) => {
    const freshness = sourceFreshnessSnapshot.find((row) => row.source_provider === options.sourceProvider)
      ?? sourceFreshnessSnapshot[0]
      ?? null;
    return {
      dependency_key: surface,
      dependency_type: "public_surface",
      dependency_hash: hashReceiptValue({
        surface,
        metric_contract_hash: hashReceiptValue(metricContract),
        provider_capability_snapshot_hash: providerCapabilitySnapshotHash,
        source_freshness_hash: sourceFreshnessHash,
        sampling_fingerprint_hash: samplingFingerprintHash,
      }),
      source_freshness_at: freshness?.freshest_at ?? null,
      evidence_frame: evidenceFrameFromEligibility(options.analysisEligibility),
      source_provider: sourceProviderFromEligibility(options.analysisEligibility, options.sourceProvider),
    };
  });
  const dependencySetHash = hashReceiptValue(dependencies.map((dependency) => ({
    dependency_key: dependency.dependency_key,
    dependency_hash: dependency.dependency_hash,
  })));
  const resultRows = options.resultRows ?? [];
  const resultRowCount = Math.max(0, Math.trunc(numberOrNull(options.resultRowCount) ?? resultRows.length));
  const resultTruncated = options.resultTruncated === true || resultRows.length > MAX_RECEIPT_RESULT_ROWS;
  const resultHash = safeResultHash(resultRows, resultTruncated, resultRowCount);
  const metricContractHash = hashReceiptValue(metricContract);
  const evidenceFrame = evidenceFrameFromEligibility(options.analysisEligibility);
  const sourceProvider = sourceProviderFromEligibility(options.analysisEligibility, options.sourceProvider);
  const maxClaimClass = normalizedString(options.analysisEligibility?.max_claim_class, "observed_pattern");
  const statisticalClaimsAllowed = options.analysisEligibility?.statistical_claims_allowed === true;

  await run(options.db, "BEGIN TRANSACTION");
  try {
    await run(
      options.db,
      `INSERT INTO sendlens.analysis_receipts (
         receipt_id, workspace_id, schema_version, status, question_hash, rationale_hash,
         question_family, recipe_id, recipe_hash, sql_hash, metric_contract_hash, metric_contract_json,
         provider_capability_snapshot_hash, provider_capability_snapshot_json,
         source_freshness_hash, source_freshness_json, sampling_fingerprint_hash,
         sampling_fingerprint_json, dependency_set_hash, result_hash, result_row_count,
         result_truncated, evidence_frame, source_provider, max_claim_class,
         statistical_claims_allowed, cache_generation
       ) VALUES (
         ${sqlLiteral(receiptId)}, ${sqlLiteral(options.workspaceId)}, ${sqlLiteral(ANALYSIS_RECEIPT_SCHEMA_VERSION)},
         ${sqlLiteral(options.status)}, ${sqlLiteral(questionHash)}, ${sqlLiteral(rationaleHash)},
         ${sqlLiteral(options.questionFamily ?? null)}, ${sqlLiteral(recipeId)}, ${sqlLiteral(recipeHash)}, ${sqlLiteral(sqlHash)},
         ${sqlLiteral(metricContractHash)}, ${sqlLiteral(safeSnapshotJson(metricContract))},
         ${sqlLiteral(providerCapabilitySnapshotHash)}, ${sqlLiteral(safeSnapshotJson(capabilitySnapshot))},
         ${sqlLiteral(sourceFreshnessHash)}, ${sqlLiteral(safeSnapshotJson(sourceFreshnessSnapshot))},
         ${sqlLiteral(samplingFingerprintHash)}, ${sqlLiteral(safeSnapshotJson(samplingFingerprintSnapshot))},
         ${sqlLiteral(dependencySetHash)}, ${sqlLiteral(resultHash)}, ${resultRowCount},
         ${sqlBoolean(resultTruncated)}, ${sqlLiteral(evidenceFrame)}, ${sqlLiteral(sourceProvider)},
         ${sqlLiteral(maxClaimClass)}, ${sqlBoolean(statisticalClaimsAllowed)}, ${sqlLiteral(options.cacheGeneration ?? null)}
       )`,
    );
    for (const dependency of dependencies) {
      await run(
        options.db,
        `INSERT INTO sendlens.report_dependencies (
           receipt_id, workspace_id, dependency_key, dependency_type, dependency_hash,
           source_freshness_at, evidence_frame, source_provider
         ) VALUES (
           ${sqlLiteral(receiptId)}, ${sqlLiteral(options.workspaceId)}, ${sqlLiteral(dependency.dependency_key)},
           ${sqlLiteral(dependency.dependency_type)}, ${sqlLiteral(dependency.dependency_hash)},
           ${dependency.source_freshness_at == null ? "NULL" : `CAST(${sqlLiteral(dependency.source_freshness_at)} AS TIMESTAMP)`},
           ${sqlLiteral(dependency.evidence_frame)}, ${sqlLiteral(dependency.source_provider)}
         )`,
      );
    }
    await run(options.db, "COMMIT");
  } catch (error) {
    try {
      await run(options.db, "ROLLBACK");
    } catch {
      // Preserve the original receipt error.
    }
    throw error;
  }

  return {
    schema_version: ANALYSIS_RECEIPT_SCHEMA_VERSION,
    receipt_id: receiptId,
    status: options.status,
    created_at: new Date().toISOString(),
    question_family: options.questionFamily ?? null,
    recipe_id: recipeId,
    recipe_hash: recipeHash,
    question_hash: questionHash,
    rationale_hash: rationaleHash,
    sql_hash: sqlHash,
    metric_contract_hash: metricContractHash,
    provider_capability_snapshot_hash: providerCapabilitySnapshotHash,
    source_freshness_hash: sourceFreshnessHash,
    sampling_fingerprint_hash: samplingFingerprintHash,
    dependency_set_hash: dependencySetHash,
    result_hash: resultHash,
    result_row_count: resultRowCount,
    result_truncated: resultTruncated,
    evidence_frame: evidenceFrame,
    source_provider: sourceProvider,
    max_claim_class: maxClaimClass,
    statistical_claims_allowed: statisticalClaimsAllowed,
  };
}

export async function recordMetricReconciliation(
  options: RecordMetricReconciliationOptions,
) {
  const reconciliationId = `mr_${randomUUID()}`;
  const authoritativeValue = numberOrNull(options.authoritativeValue);
  const decomposedValue = numberOrNull(options.decomposedValue);
  const residual = authoritativeValue == null || decomposedValue == null
    ? null
    : authoritativeValue - decomposedValue;
  const causes = options.expectedSemanticCauses
    .map((cause) => cause.trim())
    .filter(Boolean)
    .slice(0, 6)
    .join("; ");
  await run(
    options.db,
    `INSERT INTO sendlens.metric_reconciliations (
       reconciliation_id, receipt_id, workspace_id, metric_key, authoritative_surface,
       decomposition_surface, compatibility_contract_hash, authoritative_value,
       decomposed_value, residual, status, severity, expected_semantic_causes,
       unsupported_reason
     ) VALUES (
       ${sqlLiteral(reconciliationId)}, ${sqlLiteral(options.receiptId)}, ${sqlLiteral(options.workspaceId)},
       ${sqlLiteral(options.metricKey)}, ${sqlLiteral(options.authoritativeSurface)},
       ${sqlLiteral(options.decompositionSurface)}, ${sqlLiteral(hashReceiptValue(options.compatibilityContract))},
       ${sqlNumber(authoritativeValue)}, ${sqlNumber(decomposedValue)}, ${sqlNumber(residual)},
       ${sqlLiteral(options.status)}, ${sqlLiteral(options.severity)}, ${sqlLiteral(causes)},
       ${sqlLiteral(options.unsupportedReason ?? null)}
     )`,
  );
  return {
    schema_version: METRIC_RECONCILIATION_SCHEMA_VERSION,
    reconciliation_id: reconciliationId,
    receipt_id: options.receiptId,
    metric_key: options.metricKey,
    status: options.status,
    severity: options.severity,
    residual,
  };
}

export async function recordAggregateHydratedReplyReconciliation(options: {
  db: DuckDBConnection;
  receiptId: string;
  workspaceId: string;
  aggregateReplyCount: number | null;
  hydratedReplyCount: number;
  coverageState: string;
  retrievalDefect?: boolean;
}) {
  const retrievalDefect = options.retrievalDefect === true;
  const hasAggregate = options.aggregateReplyCount != null && Number.isFinite(options.aggregateReplyCount);
  const status: MetricReconciliationStatus = retrievalDefect
    ? "retrieval_defect"
    : !hasAggregate
      ? "unsupported"
      : "expected_scope_difference";
  return recordMetricReconciliation({
    db: options.db,
    receiptId: options.receiptId,
    workspaceId: options.workspaceId,
    metricKey: "aggregate_to_hydrated_reply_count",
    authoritativeSurface: "campaign_overview.reply_count_unique",
    decompositionSurface: "reply_email_context.hydrated_reply_body_rows",
    compatibilityContract: {
      schema_version: "reply_coverage_contract.v1",
      authoritative_scope: "campaign aggregate unique human replies",
      decomposition_scope: "selected List Email statuses with stored hydrated bodies",
      compatible: false,
      latest_of_thread_persisted_on_decomposition: false,
    },
    authoritativeValue: options.aggregateReplyCount,
    decomposedValue: options.hydratedReplyCount,
    status,
    severity: retrievalDefect || (hasAggregate && Math.abs((options.aggregateReplyCount ?? 0) - options.hydratedReplyCount) > 0)
      ? "medium"
      : "low",
    expectedSemanticCauses: [
      "campaign aggregate and selected List Email rows have different evidence scopes",
      "selected statuses and OOO inclusion are request-scoped",
      "reply_email_context does not persist the latest_of_thread request mode",
      `coverage_state=${normalizedString(options.coverageState)}`,
    ],
    unsupportedReason: retrievalDefect
      ? "reply hydration reported a retrieval failure; do not treat the residual as a semantic gap"
      : !hasAggregate
        ? "authoritative campaign aggregate reply count is unavailable"
        : null,
  });
}
