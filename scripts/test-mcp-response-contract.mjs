#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const failures = [];

const files = {
  server: "plugin/server.ts",
  setupDoctor: "plugin/setup-doctor.ts",
  activeDataState: "plugin/active-data-state.ts",
  refreshStatus: "plugin/refresh-status.ts",
  summary: "plugin/summary.ts",
  localDb: "plugin/local-db.ts",
  recipes: "plugin/query-recipes.ts",
  catalog: "plugin/catalog.ts",
  analysisSafety: "plugin/analysis-safety.ts",
  analyzeDataDiagnostics: "plugin/analyze-data-diagnostics.ts",
  constants: "plugin/constants.ts",
  replyTextContract: "plugin/reply-text-contract.ts",
  campaignAnalysisResponse: "plugin/campaign-analysis-response.ts",
  replyFetchTest: "scripts/test-reply-fetch-contract.mjs",
  campaignAnalysisResponseTest: "scripts/test-campaign-analysis-response.mjs",
  docs: "docs/MCP_RESPONSE_CONTRACT.md",
};

function fail(message) {
  failures.push(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

function assertIncludes(text, needle, label) {
  assert(text.includes(needle), `${label}: missing "${needle}"`);
}

function assertPattern(text, pattern, label) {
  assert(pattern.test(text), `${label}: missing pattern ${pattern}`);
}

function assertRegisteredTool(serverSource, toolName) {
  assertPattern(
    serverSource,
    new RegExp(String.raw`server\.registerTool\(\s*["']${toolName}["']`),
    `plugin/server.ts ${toolName}`,
  );
}

const source = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, relativePath]) => [
      key,
      await read(relativePath),
    ]),
  ),
);

for (const toolName of [
  "refresh_data",
  "workspace_snapshot",
  "load_campaign_data",
  "analysis_starters",
  "analyze_data",
  "fetch_reply_text",
  "prepare_campaign_analysis",
]) {
  assertRegisteredTool(source.server, toolName);
  assertIncludes(source.docs, `\`${toolName}\``, "docs/MCP_RESPONSE_CONTRACT.md");
}

assertPattern(
  source.server,
  /server\.registerTool\(\s*["']refresh_data["'][\s\S]*?catch \(error\) \{[\s\S]*?error instanceof CacheReadinessError[\s\S]*?return cacheReadinessResponse\(error\);/,
  "refresh_data formats cache readiness failures",
);

for (const term of [
  "`refresh_certificate`",
  "`requested_provider_scope`",
  "`overall_status`",
  "`not_configured`",
  "explicit `provider=instantly` or `provider=smartlead` preserves that provider scope",
]) {
  assertIncludes(source.docs, term, "refresh_data provider freshness docs");
}
for (const term of [
  'schema_version: "sendlens_refresh_certificate.v1"',
  "requested_provider_scope",
  "overall_status",
  "not_configured",
  "workspace_freshness",
]) {
  assertIncludes(source.refreshStatus, term, "refresh certificate runtime");
}

for (const term of [
  'schema_version: "workspace_snapshot.v1"',
  "`active_data_state`",
  "exact workspace/campaign/account metrics",
  "optional `provider` input",
  "optional `campaign_scope` input",
  "`source_provider_scope`, `provider_breakdown`, and `provider_capabilities`",
  "`campaign_inventory_scope` and `inventory_metrics`",
  "`detail_selection_reason`",
  "`rate_caveats`",
  "bounded `campaigns` rows",
  "bounded campaign coverage rows",
  "warnings when scoped output is capped",
]) {
  assertIncludes(source.docs, term, "workspace_snapshot docs");
}
for (const term of [
  'schema_version: "workspace_snapshot.v1"',
  "active_data_state",
  "exact_metrics",
  "source_provider_scope",
  "campaign_inventory_scope",
  "inventory_metrics",
  "detail_selection_reason",
  "provider_breakdown",
  "provider_capabilities",
  "rate_caveats",
  "output_limits",
  "campaigns",
  "coverage",
  "warnings",
  "last_refreshed_at",
]) {
  assertIncludes(source.summary, term, "workspace_snapshot runtime summary");
}
for (const term of [
  "readiness: readinessPayload(readiness)",
  "active_data_state: activeDataState",
  "provider: z",
  "campaign_scope: z",
  "buildWorkspaceSummary(db, undefined, provider, campaign_scope)",
  "provider_breakdown: []",
  "provider_breakdown: providerBreakdown.map",
  "providerBreakdown.filter",
  "campaign_limit",
  "coverage_limit",
  "Campaign rows were truncated",
  "Coverage rows were truncated",
]) {
  assertIncludes(
    `${source.server}\n${source.summary}`,
    term,
    "workspace_snapshot runtime delivery",
  );
}

for (const term of [
  'schema_version: "sendlens_setup_doctor.v1"',
  "active_data_state",
  "sendlens_active_data_state.v1",
]) {
  assertIncludes(
    `${source.docs}\n${source.setupDoctor}\n${source.activeDataState}`,
    term,
    "setup_doctor active data state contract",
  );
}

for (const term of [
  "provider-qualified or native campaign ID",
  "SENDLENS_PROVIDER=all` requires a provider-qualified campaign ID",
  'schema_version: "campaign_selector_error.v1"',
  "`selector`, `workspace_id`, and `suggested_lookup_path`",
  "scoped refresh metadata for the requested campaign",
  "broad refresh result is only returned when `include_refresh_metadata=true`",
  "exact `campaign_overview`",
  "`human_reply_sample` grouped into positive, negative, and neutral buckets",
  "compact `rendered_outbound_summary`",
  "optional raw `rendered_outbound_sample` only when `include_rendered_outbound=true`",
  "the default response must not include recipient-level fields such as `to_email`, `from_email`, or raw rendered body rows",
  "output caps and reconstruction warnings",
]) {
  assertIncludes(source.docs, term, "load_campaign_data docs");
}
for (const term of [
  "`load_campaign_data` provider-qualified/native campaign handling",
  "the `SENDLENS_PROVIDER=all` provider-qualified ID requirement",
]) {
  assertIncludes(source.docs, term, "load_campaign_data runtime coverage docs");
}
for (const term of [
  "loadCampaignScope",
  "refreshProvider",
  "CampaignIdScopeError",
  'schema_version: "campaign_selector_error.v1"',
  "suggested_lookup_path",
  "resolveCampaignSelector(db, workspaceId",
  "load_campaign_data requires a provider-qualified campaign_id when SENDLENS_PROVIDER=all",
  "load_campaign_data requires a non-empty campaign_id",
  "campaignIdFilterSql",
  "Provider-qualified or native campaign ID to load.",
  "include_rendered_outbound = false",
  "include_refresh_metadata = false",
  "full_refresh_result_included",
  'refresh_certificate: "refresh_certificate" in refreshed',
  "campaign_overview",
  "human_reply_sample",
  "rendered_outbound_summary",
  "rendered_outbound_sample",
  "renderedPreviewRows",
  "rendered_outbound_redacted_preview_limit",
  "Raw rendered outbound rows are omitted by default",
  "to_email",
  "from_email",
  "reply_context_scan_limit",
  "rendered_outbound_sample_limit",
  "Reply context scan was truncated",
  "Rendered outbound evidence is locally reconstructed sample evidence",
]) {
  assertIncludes(source.server, term, "load_campaign_data runtime");
}

assertPattern(
  source.server,
  /rendered_outbound_sample:\s*include_rendered_outbound\s*\?\s*renderedRows\s*:\s*undefined/,
  "load_campaign_data omits raw rendered outbound sample by default",
);
assertPattern(
  source.server,
  /const renderedPreviewRows = include_rendered_outbound[\s\S]*?SELECT\s+campaign_id,[\s\S]*?LIMIT \$\{RENDERED_OUTBOUND_REDACTED_PREVIEW_LIMIT\}/,
  "load_campaign_data uses a bounded redacted preview query by default",
);
assertPattern(
  source.server,
  /redacted_preview:\s*renderedOutboundRedactedPreview\(renderedPreviewRows\)/,
  "load_campaign_data summary preview is independent from raw rendered outbound inclusion",
);
assertPattern(
  source.server,
  /refreshed:\s*include_refresh_metadata\s*\?\s*refreshed\s*:\s*undefined/,
  "load_campaign_data omits broad refresh result by default",
);
assertPattern(
  source.server,
  /redacted_fields:\s*\[\s*["']to_email["'],\s*["']from_email["']\s*\]/,
  "load_campaign_data redacts private rendered outbound row fields in summary",
);

for (const term of [
  "Campaign selector matched multiple provider-qualified campaigns",
  "campaign_source_id",
  "provider_campaign_id",
  "campaignSelectorAmbiguityPayload",
  "formatCampaignMatch",
]) {
  assertIncludes(source.server, term, "provider-aware campaign selector runtime");
}

for (const term of [
  "ambiguous provider-qualified campaign selectors return",
  "writes exact inbound reply rows from supported provider reply surfaces",
  "campaign selector ambiguity responses with provider-qualified matches",
]) {
  assertIncludes(source.docs, term, "provider-aware campaign selector docs");
}

for (const term of [
  "provider-aware campaign IDs",
  "provider-qualified Instantly/Smartlead campaigns",
  "duplicate campaign names for ambiguity handling",
  "synthetic Smart Delivery placement/diagnostic evidence",
]) {
  assertIncludes(source.docs, term, "provider-aware demo seed docs");
}

for (const term of [
  "provider_overlap_risk",
  "provider_overlap_risk_details",
  "within_unsafe_window",
  "overlap_risk_level",
  "closest_cross_provider_window_days",
  "overall_contact_span_days",
  "source_provider_count",
]) {
  assertIncludes(
    `${source.localDb}\n${source.constants}\n${source.docs}`,
    term,
    "provider overlap risk catalog/docs",
  );
}

for (const term of [
  "recipe metadata",
  "recipe `exactness`: `exact`, `sampled`, or `hybrid`",
  "optional `route_card` metadata",
  "preferred intent, grain, time basis, attribution, provider/population scope, tag role, prerequisites, cost, privacy, safe adaptations, and forbidden adaptations",
  "compact recipe index by default",
  "`recipe_id` exact lookup",
  "`mode=\"full\"` bounded pages with SQL",
  "notes the agent must preserve",
]) {
  assertIncludes(source.docs, term, "analysis_starters docs");
}
for (const term of [
  "topic",
  "recipe_id",
  "mode",
  "recipe_count",
  "returned_count",
  "output_shape",
  "page_size",
  "has_more",
  "recipes",
  "sql_available",
  "route_card",
  "rankRecipesForResponse",
  "preferred_intent",
  "forbidden_adaptations",
  'exactness: "exact" | "sampled" | "hybrid"',
  "notes: string[]",
]) {
  assertIncludes(
    `${source.server}\n${source.recipes}`,
    term,
    "analysis_starters runtime",
  );
}

for (const term of [
  "partial matches for broad multi-token queries",
  "`safe_to_select`, `safe_to_group_by`",
  "`contains_pii`, `raw_json`, `high_cardinality`",
  "`prefer_derived_field` and `recommended_cohort_field`",
  "`search_terms` and `suggested_narrower_terms`",
  "`analysis_starter_suggestions`",
  "workflow concepts such as runway, scale, refill, deliverability, sender accounts, rendered outbound, reply body, payload, and tags",
  "hydrates public columns in one bounded pass and reuses warm public-column context",
  "`guidance` that points to relevant `analysis_starters` topics",
]) {
  assertIncludes(source.docs, term, "search_catalog docs");
}
for (const term of [
  "buildCatalogSearchGuidance",
  "CatalogPublicTableError",
  "columnSafetyMetadata",
  "invalidateCatalogColumnCache",
  "publicColumnsForConnection",
  "hydratePublicColumns",
  "public_column_hydrations",
  "suggested_narrower_terms",
  "analysis_starter_suggestions",
  "campaign-tag-runway-inputs",
  "rendered_outbound_context",
  "reply_email_context",
]) {
  assertIncludes(
    `${source.server}\n${source.catalog}`,
    term,
    "search_catalog runtime",
  );
}

for (const term of [
  "caller rationale",
  "privacy_guard",
  "redacts email-like identifiers inside arbitrary string/JSON result cells",
  "singleton-heavy grouped outputs",
  "`row_count`, `result_truncated`, and output limits",
  "warnings when caps are hit",
  "failure responses include a stable `error`, sanitized `code`, and safe `hint`",
  '`diagnostics` with `schema_version: "analyze_data_diagnostics.v1"`',
  "`status` (`ok`, `zero_rows`, `guard_rejected`, `query_error`, `cache_unavailable`, or `unknown`)",
  "never echo submitted SQL, rewritten SQL, private literals, row previews, or engine detail",
]) {
  assertIncludes(source.docs, term, "analyze_data docs");
}
for (const term of [
  "rationale",
  "row_count",
  "result_truncated",
  "row_limit",
  "response_max_chars",
  "Result set was truncated",
  "rows: redactedRows",
  "ANALYZE_DATA_SAFE_ERROR",
  "analyzeDataFailurePayload",
  "enforceAnalyzeDataPrivacy",
  "redactAnalyzeDataRows",
  "highCardinalityResultPrivacyReport",
  "buildAnalyzeDataDiagnostics",
  "AnalyzeDataDiagnostics",
  "workspace_isolation",
]) {
  assertIncludes(source.server, term, "analyze_data runtime");
}
for (const term of [
  "AnalyzeDataPrivacyGuardError",
  "columnSafetyMetadata",
  "safe_to_select",
  "safe_to_group_by",
  "contains_pii",
  "raw_json",
  "high_cardinality",
  "recommended_cohort_field",
  "prefer_derived_field",
  "status_summary",
  "highCardinalityResultPrivacyReport",
  "redactAnalyzeDataRows",
]) {
  assertIncludes(source.analysisSafety, term, "analyze_data privacy safety runtime");
}
for (const term of [
  "ANALYZE_DATA_DIAGNOSTICS_SCHEMA_VERSION",
  "buildAnalyzeDataDiagnostics",
  "referencedPublicSurfaces",
  "elapsed_ms",
  "referenced_surfaces",
  "cache_generation",
]) {
  assertIncludes(
    `${source.server}\n${source.analyzeDataDiagnostics}`,
    term,
    "analyze_data diagnostics runtime",
  );
}
assertPattern(
  source.server,
  /err instanceof LocalSqlGuardError[\s\S]*?analyzeDataFailurePayload\([\s\S]*?err\.code,[\s\S]*?status: "guard_rejected"/,
  "analyze_data guard errors use sanitized diagnostic payloads",
);
assertPattern(
  source.server,
  /analyzeDataFailurePayload\([\s\S]*?"query_error"[\s\S]*?status: "query_error"/,
  "analyze_data runtime errors use sanitized diagnostic payloads",
);
assertPattern(
  source.server,
  /server\.registerTool\(\s*"analyze_data"[\s\S]*?err instanceof CacheReadinessError[\s\S]*?analyzeDataFailurePayload\(\s*"cache_unavailable"[\s\S]*?status: "cache_unavailable"/,
  "analyze_data cache-readiness errors use sanitized diagnostic payloads",
);
assertPattern(
  source.server,
  /server\.registerTool\(\s*"analyze_data"[\s\S]*?err instanceof LocalDbUnavailableError[\s\S]*?analyzeDataFailurePayload\(\s*"cache_unavailable"[\s\S]*?status: "cache_unavailable"/,
  "analyze_data database-unavailable errors use sanitized diagnostic payloads",
);
assertPattern(
  source.server,
  /status: redactedRows\.length === 0 \? "zero_rows" : "ok"/,
  "analyze_data success diagnostics distinguish zero-row results",
);
assert(
  !/sql:\s*rewritten\s*\?\?\s*sql/.test(source.server),
  "analyze_data failures must not echo submitted or rewritten SQL",
);

for (const term of [
  "resolves exactly one campaign",
  "returns `fetch_result` counts",
  "new-vs-updated row counts",
  "readiness metadata",
  "bounded `fetched_reply_sample`",
]) {
  assertIncludes(source.docs, term, "fetch_reply_text docs");
}
for (const term of [
  'schema_version: "reply_text_fetch.v1"',
  "fetch_result",
  "fetched_reply_sample",
  "fetched_reply_sample_limit",
  "statuses",
  "total_fetched",
  "total_stored",
  "total_inserted_new",
  "total_updated_existing",
  "total_skipped_auto_replies",
]) {
  assertIncludes(
    `${source.server}\n${source.replyTextContract}\n${source.replyFetchTest}`,
    term,
    "fetch_reply_text runtime/test",
  );
}

for (const term of [
  'schema_version: "campaign_analysis_preparation.v1"',
  "default `analysis_depth` is balanced",
  "`lead_context_backfill`",
  "`hydration_coverage`",
  "`reply_coverage_summary`",
  "`context_gap_counts`",
  "`aggregate_reply_count`",
  "`hydrated_reply_count`",
  "`coverage_gap_count`",
  "`coverage_scope`",
  "fetch_latest_of_thread=true",
  "stored `reply_email_context` counts do not track `latest_of_thread`",
  "maximum depth does not guarantee recovery",
  "`reply_email_context_sample`",
  "`reply_evidence_detail`",
  "redacted by default",
  "full reply bodies and raw email addresses require explicit opt-in",
  "recommended next recipes",
  "warnings, and output limits",
]) {
  assertIncludes(source.docs, term, "prepare_campaign_analysis docs");
}
for (const term of [
  "prepare_campaign_analysis",
  "campaign_analysis_preparation.v1",
  "analysis_depth",
  "hydration_budget",
  "fetch_result",
  "lead_context_backfill",
  "hydration_coverage",
  "reply_coverage_summary",
  "aggregate_reply_count",
  "hydrated_reply_count",
  "coverage_gap_count",
  "coverage_scope",
  "all_selected_status_buckets_exhausted",
  "coverage_explanation",
  "context_gap_counts",
  "reply_email_context_sample",
  "reply_evidence_detail",
  "full_reply_bodies",
  "redacted_preview",
  "redactCampaignAnalysisReplySample",
  "reply_body_preview_max_chars",
  "reply_email_context_sample_limit",
  "recommendedNextAnalysisRecipes",
  "reply-hydration-coverage",
  "reply-email-context-feed",
]) {
  assertIncludes(
    `${source.server}\n${source.recipes}\n${source.campaignAnalysisResponse}\n${source.campaignAnalysisResponseTest}`,
    term,
    "prepare_campaign_analysis runtime/recipes",
  );
}
assertPattern(
  source.server,
  /const recommendedNextAnalysisRecipes =\s*reply_evidence_detail === "full_reply_bodies"[\s\S]*?\?\s*\[[\s\S]*?"reply-email-context-feed"[\s\S]*?\][\s\S]*?:\s*\[[\s\S]*?"reply-hydration-coverage"[\s\S]*?"campaign-evidence-coverage-audit"[\s\S]*?\]/,
  "prepare_campaign_analysis only recommends raw reply feed in full evidence mode",
);
assertIncludes(
  source.docs,
  'reply-email-context-feed` is recommended only when `reply_evidence_detail="full_reply_bodies"`',
  "prepare_campaign_analysis raw recipe recommendation docs",
);

for (const term of [
  "readiness",
  "output_limits",
  "warnings",
  "row_count",
  "result_truncated",
  "campaign_overview",
  "coverage",
  "rows",
]) {
  assertIncludes(source.docs, term, "common response fields docs");
}

for (const term of [
  "response_truncated",
  "original_char_count",
  "max_char_count",
  "preview",
  "MCP text output cap",
]) {
  assertIncludes(source.server, term, "global text cap fallback");
}

assertPattern(
  source.docs,
  /Do not change key names casually; if a key changes, update this document and the runtime tests in the same PR\./,
  "MCP response contract drift rule",
);
assertPattern(
  source.docs,
  /npm run test:mcp-response-contract/,
  "MCP response contract test command",
);

if (failures.length > 0) {
  console.error("MCP response contract failures:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("MCP response contract tests passed.");
