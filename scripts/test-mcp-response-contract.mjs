#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const failures = [];

const files = {
  server: "plugin/server.ts",
  summary: "plugin/summary.ts",
  localDb: "plugin/local-db.ts",
  recipes: "plugin/query-recipes.ts",
  constants: "plugin/constants.ts",
  replyTextContract: "plugin/reply-text-contract.ts",
  replyFetchTest: "scripts/test-reply-fetch-contract.mjs",
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
  'schema_version: "workspace_snapshot.v1"',
  "exact workspace/campaign/account metrics",
  "optional `provider` input",
  "`source_provider_scope`, `provider_breakdown`, and `provider_capabilities`",
  "`rate_caveats`",
  "bounded `campaigns` rows",
  "bounded campaign coverage rows",
  "warnings when scoped output is capped",
]) {
  assertIncludes(source.docs, term, "workspace_snapshot docs");
}
for (const term of [
  'schema_version: "workspace_snapshot.v1"',
  "exact_metrics",
  "source_provider_scope",
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
  "provider: z",
  "buildWorkspaceSummary(db, undefined, provider)",
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
  "provider-qualified or native campaign ID",
  "SENDLENS_PROVIDER=all` requires a provider-qualified campaign ID",
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
  "load_campaign_data requires a provider-qualified campaign_id when SENDLENS_PROVIDER=all",
  "load_campaign_data requires a non-empty campaign_id",
  "campaignIdFilterSql",
  "Provider-qualified or native campaign ID to load.",
  "include_rendered_outbound = false",
  "include_refresh_metadata = false",
  "full_refresh_result_included",
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
  "duplicate campaign names across providers",
  "unsupported Smartlead inbox-placement capability row",
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
  "caller rationale",
  "`row_count`, `result_truncated`, and output limits",
  "warnings when caps are hit",
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
  "rows: returnedRows",
]) {
  assertIncludes(source.server, term, "analyze_data runtime");
}

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
  "`context_gap_counts`",
  "`reply_email_context_sample`",
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
  "context_gap_counts",
  "reply_email_context_sample",
  "reply_email_context_sample_limit",
  "reply-hydration-coverage",
  "reply-email-context-feed",
]) {
  assertIncludes(
    `${source.server}\n${source.recipes}`,
    term,
    "prepare_campaign_analysis runtime/recipes",
  );
}

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
