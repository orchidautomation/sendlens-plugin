import * as z from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  buildCatalogSearchGuidance,
  CatalogPublicTableError,
  invalidateCatalogColumnCache,
  listColumns,
  listTables,
  searchCatalog,
} from "./catalog";
import {
  AnalyzeDataPrivacyGuardError,
  enforceAnalyzeDataPrivacy,
  highCardinalityResultPrivacyReport,
  redactAnalyzeDataRows,
  type AnalyzeDataPrivacyGuardReport,
} from "./analysis-safety";
import { isDemoMode, seedDemoWorkspace } from "./demo-workspace";
import { assertContainerStartupReady, loadSendLensEnv } from "./env";
import {
  assertCacheReadableForCurrentEnv,
  CacheReadinessError,
  closeDb,
  getActiveWorkspaceId,
  getDb,
  LocalDbUnavailableError,
  query,
} from "./local-db";
import {
  backfillReplyLeadContext,
  hydrateReplyText,
  refreshWorkspaceAtomically,
} from "./instantly-ingest";
import {
  resolveSourceProviderMode,
  type SourceProvider,
  type SourceProviderMode,
} from "./provider-config";
import {
  classifyHydrationCoverage,
  normalizeCampaignAnalysisStatuses,
  resolveCampaignAnalysisDepth,
  type CampaignAnalysisDepth,
} from "./campaign-analysis-depth";
import {
  buildCampaignReplyCoverageSummary,
  CAMPAIGN_ANALYSIS_REPLY_PREVIEW_MAX_CHARS,
  redactCampaignAnalysisReplySample,
} from "./campaign-analysis-response";
import {
  buildAnalyzeDataDiagnostics,
  type AnalyzeDataDiagnostics,
} from "./analyze-data-diagnostics";
import { buildQueryRecipeResponse, QUERY_RECIPE_TOPICS } from "./query-recipes";
import { toReplyTextFetchResult } from "./reply-text-contract";
import { readRefreshStatus } from "./refresh-status";
import { buildSetupDoctorReport } from "./setup-doctor";
import { enforceLocalWorkspaceScope, LocalSqlGuardError } from "./sql-guard";
import { buildWorkspaceSummary, providerEvidenceWarnings } from "./summary";
import { PLUGIN_VERSION } from "./version";

loadSendLensEnv();
assertContainerStartupReady();

const SESSION_REFRESH_WAIT_TIMEOUT_MS = 15_000;
const SESSION_REFRESH_POLL_MS = 500;
const MCP_TEXT_RESPONSE_MAX_CHARS = 120_000;
const ANALYZE_DATA_ROW_LIMIT = 1_000;
const REPLY_CONTEXT_SCAN_LIMIT = 500;
const RENDERED_OUTBOUND_SAMPLE_LIMIT = 25;
const SCOPED_SNAPSHOT_CAMPAIGN_LIMIT = 100;
const RENDERED_OUTBOUND_REDACTED_PREVIEW_LIMIT = 3;
const ANALYZE_DATA_SAFE_ERROR = "Query could not be executed safely.";
const PLUXX_READINESS_FOLLOWUP = [
  "Temporary SendLens readiness gate in effect.",
  "If startup refresh is still running, this tool may wait briefly for the local snapshot before answering.",
].join(" ");

function shouldExposeDemoSeedTool() {
  return true;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSessionSnapshot() {
  const startedAt = Date.now();
  let status = await readRefreshStatus();
  let waited = false;

  while (
    status.status === "running"
    && status.source === "session_start"
    && Date.now() - startedAt < SESSION_REFRESH_WAIT_TIMEOUT_MS
  ) {
    waited = true;
    await sleep(SESSION_REFRESH_POLL_MS);
    status = await readRefreshStatus();
  }

  const timedOut =
    status.status === "running"
    && status.source === "session_start"
    && Date.now() - startedAt >= SESSION_REFRESH_WAIT_TIMEOUT_MS;

  return {
    status,
    waited,
    timedOut,
    warning: timedOut ? PLUXX_READINESS_FOLLOWUP : null,
  };
}

function jsonResponse(payload: unknown) {
  const text = JSON.stringify(payload, null, 2);
  if (text.length <= MCP_TEXT_RESPONSE_MAX_CHARS) {
    return {
      content: [
        {
          type: "text" as const,
          text,
        },
      ],
    };
  }

  const preview = text.slice(0, Math.floor(MCP_TEXT_RESPONSE_MAX_CHARS / 3));
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            response_truncated: true,
            warning:
              "SendLens response exceeded the MCP text output cap before delivery.",
            original_char_count: text.length,
            max_char_count: MCP_TEXT_RESPONSE_MAX_CHARS,
            hint:
              "Narrow the question, query fewer columns, add a tighter LIMIT, or load one campaign before deep analysis.",
            preview,
          },
          null,
          2,
        ),
      },
    ],
  };
}

function stripTrailingSemicolon(sql: string) {
  return sql.trim().replace(/;+\s*$/, "");
}

function analyzeDataFailurePayload(
  code:
    | LocalSqlGuardError["code"]
    | "cache_unavailable"
    | "query_error"
    | "workspace_isolation"
    | "privacy_guard",
  diagnostics?: AnalyzeDataDiagnostics,
  options: {
    hint?: string;
    privacyGuard?: AnalyzeDataPrivacyGuardReport;
  } = {},
) {
  return {
    error: ANALYZE_DATA_SAFE_ERROR,
    code,
    hint: options.hint ?? (
      code === "cache_unavailable"
        ? "Use refresh_status once to check local cache readiness, then refresh or reload the plugin before retrying. Do not include private literals in retries."
        : code === "privacy_guard"
          ? "Use safe cohort fields or curated analysis_starters recipes instead of raw, high-cardinality, or row-level provider fields."
        : "Use one focused read-only SELECT/WITH query against sendlens.* public views. Do not include private literals in retries."
    ),
    diagnostics,
    ...(options.privacyGuard ? { privacy_guard: options.privacyGuard } : {}),
  };
}

function sqlSafe(value: string) {
  return value.replace(/'/g, "''");
}

function sqlStringList(values: string[]) {
  return values.map((value) => `'${sqlSafe(value)}'`).join(", ");
}

function sqlNumberList(values: number[]) {
  return values.map((value) => String(Math.trunc(value))).join(", ");
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function numberFromRowValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactPreview(value: unknown, maxChars = 160) {
  if (typeof value !== "string") return null;
  const compacted = value.replace(/\s+/g, " ").trim();
  if (!compacted) return null;
  return compacted.length > maxChars
    ? `${compacted.slice(0, maxChars).trimEnd()}...`
    : compacted;
}

function renderedOutboundRedactedPreview(rows: Array<Record<string, unknown>>) {
  return rows.slice(0, RENDERED_OUTBOUND_REDACTED_PREVIEW_LIMIT).map((row) => ({
    campaign_id: row.campaign_id ?? null,
    campaign_source_id: row.campaign_source_id ?? null,
    source_provider: row.source_provider ?? null,
    step_resolved: row.step_resolved ?? null,
    variant_resolved: row.variant_resolved ?? null,
    sample_source: row.sample_source ?? null,
    sent_at: row.sent_at ?? null,
    rendered_subject_preview: compactPreview(row.rendered_subject, 120),
    rendered_body_preview: compactPreview(row.rendered_body_text),
    template_subject_preview: compactPreview(row.template_subject, 120),
    template_body_preview: compactPreview(row.template_body_text),
    recipient: "[redacted]",
    sender: "[redacted]",
  }));
}

function parseProviderQualifiedCampaignId(value: string) {
  const campaignId = value.trim();
  const separatorIndex = campaignId.indexOf(":");
  if (separatorIndex <= 0) return null;

  const provider = campaignId.slice(0, separatorIndex);
  const nativeId = campaignId.slice(separatorIndex + 1).trim();
  if ((provider === "instantly" || provider === "smartlead") && nativeId) {
    return { provider: provider as SourceProvider, nativeId };
  }
  return null;
}

function storedCampaignIdForProvider(provider: SourceProvider, nativeId: string) {
  return provider === "smartlead" ? `smartlead:${nativeId}` : nativeId;
}

class CampaignIdScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignIdScopeError";
  }
}

function loadCampaignScope(campaignId: string) {
  const requestedId = campaignId.trim();
  if (!requestedId) {
    throw new CampaignIdScopeError(
      "load_campaign_data requires a non-empty campaign_id.",
    );
  }
  const parsed = parseProviderQualifiedCampaignId(requestedId);
  const providerMode = resolveSourceProviderMode();
  if (!parsed && providerMode.valid && providerMode.mode === "all") {
    throw new CampaignIdScopeError(
      "load_campaign_data requires a provider-qualified campaign_id when SENDLENS_PROVIDER=all. Use instantly:<id> or smartlead:<id> so colliding native campaign IDs cannot load the wrong provider.",
    );
  }

  const nativeId = parsed?.nativeId ?? requestedId;
  const provider = parsed?.provider ?? (
    providerMode.valid && providerMode.mode !== "all" ? providerMode.mode : null
  );
  const queryCampaignIds = provider
    ? uniqueStrings([storedCampaignIdForProvider(provider, nativeId), requestedId])
    : uniqueStrings([requestedId, storedCampaignIdForProvider("smartlead", nativeId)]);

  return {
    refreshProvider: parsed?.provider,
    selectorProvider: provider,
    refreshCampaignIds: [requestedId],
    queryCampaignIds,
  };
}

function campaignIdFilterSql(column: string, campaignIds: string[]) {
  if (campaignIds.length === 1) {
    return `${column} = '${sqlSafe(campaignIds[0])}'`;
  }
  return `${column} IN (${sqlStringList(campaignIds)})`;
}

function campaignIdOrderSql(column: string, campaignIds: string[]) {
  const cases = campaignIds
    .map((campaignId, index) => `WHEN '${sqlSafe(campaignId)}' THEN ${index}`)
    .join(" ");
  return `CASE ${column} ${cases} ELSE ${campaignIds.length} END`;
}

type CampaignResolution =
  | {
      ok: true;
      campaign_id: string;
      campaign_name: string | null;
      source_provider: SourceProvider;
      provider_campaign_id: string;
      campaign_source_id: string;
    }
  | { ok: false; payload: Record<string, unknown> };

type CampaignMatchRow = {
  campaign_id?: unknown;
  id?: unknown;
  campaign_name?: unknown;
  name?: unknown;
  source_provider?: unknown;
  provider_campaign_id?: unknown;
  campaign_source_id?: unknown;
};

function campaignSourceIdSql(alias: string) {
  return `COALESCE(${alias}.campaign_source_id, COALESCE(${alias}.source_provider, 'instantly') || ':' || COALESCE(${alias}.provider_campaign_id, ${alias}.id))`;
}

function formatCampaignMatch(row: CampaignMatchRow) {
  const campaignId = String(row.campaign_id ?? row.id ?? "");
  const sourceProvider = (
    row.source_provider === "smartlead" ? "smartlead" : "instantly"
  ) as SourceProvider;
  const providerCampaignId = String(row.provider_campaign_id ?? campaignId);
  const campaignSourceId = String(
    row.campaign_source_id ?? `${sourceProvider}:${providerCampaignId}`,
  );
  return {
    campaign_id: campaignId,
    source_provider: sourceProvider,
    provider_campaign_id: providerCampaignId,
    campaign_source_id: campaignSourceId,
    campaign_name: typeof (row.campaign_name ?? row.name) === "string"
      ? String(row.campaign_name ?? row.name)
      : null,
  };
}

function campaignSelectorAmbiguityPayload(
  selector: Record<string, unknown>,
  matches: CampaignMatchRow[],
) {
  return {
    error:
      "Campaign selector matched multiple provider-qualified campaigns. Retry with campaign_source_id or campaign_id from one match; do not guess across providers.",
    selector,
    matches: matches.slice(0, 5).map(formatCampaignMatch),
  };
}

function campaignResolutionFilterSql(resolved: Extract<CampaignResolution, { ok: true }>) {
  return [
    `source_provider = '${sqlSafe(resolved.source_provider)}'`,
    `AND (`,
    `  campaign_source_id = '${sqlSafe(resolved.campaign_source_id)}'`,
    `  OR provider_campaign_id = '${sqlSafe(resolved.provider_campaign_id)}'`,
    `  OR campaign_id = '${sqlSafe(resolved.campaign_id)}'`,
    `)`,
  ].join("\n");
}

async function resolveCampaignSelector(
  db: Awaited<ReturnType<typeof getDb>>,
  workspaceId: string,
  selector: {
    campaign_id?: string;
    campaign_name?: string;
    source_provider?: SourceProvider | null;
  },
): Promise<CampaignResolution> {
  const hasCampaignId = Boolean(selector.campaign_id?.trim());
  const hasCampaignName = Boolean(selector.campaign_name?.trim());
  if (hasCampaignId === hasCampaignName) {
    return {
      ok: false,
      payload: {
        error: "Provide exactly one campaign selector: campaign_id or campaign_name.",
      },
    };
  }

  const workspaceSafe = sqlSafe(workspaceId);
  let campaignRows;
  if (hasCampaignId) {
    const requestedCampaignId = selector.campaign_id!.trim();
    const campaignSafe = sqlSafe(requestedCampaignId);
    const parsed = parseProviderQualifiedCampaignId(requestedCampaignId);
    const providerScope = parsed?.provider ?? selector.source_provider ?? null;
    const nativeCampaignId = parsed?.nativeId ?? requestedCampaignId;
    const whereSql = providerScope
      ? `COALESCE(c.source_provider, 'instantly') = '${sqlSafe(providerScope)}'
          AND (
            c.id = '${sqlSafe(storedCampaignIdForProvider(providerScope, nativeCampaignId))}'
            OR c.id = '${campaignSafe}'
            OR c.provider_campaign_id = '${sqlSafe(nativeCampaignId)}'
            OR c.campaign_source_id = '${campaignSafe}'
            OR ${campaignSourceIdSql("c")} = '${campaignSafe}'
          )`
      : `(
            c.id = '${campaignSafe}'
            OR c.provider_campaign_id = '${campaignSafe}'
            OR c.campaign_source_id = '${campaignSafe}'
            OR ${campaignSourceIdSql("c")} = '${campaignSafe}'
          )`;
    campaignRows = await query(
      db,
      `SELECT
         c.id AS campaign_id,
         c.name AS campaign_name,
         COALESCE(c.source_provider, 'instantly') AS source_provider,
         COALESCE(c.provider_campaign_id, c.id) AS provider_campaign_id,
         ${campaignSourceIdSql("c")} AS campaign_source_id
       FROM sendlens.campaigns c
       WHERE c.workspace_id = '${workspaceSafe}'
         AND (${whereSql})
       ORDER BY source_provider, campaign_name, campaign_id
       LIMIT 6`,
    );
  } else {
    const nameSafe = sqlSafe(selector.campaign_name!.trim());
    campaignRows = await query(
      db,
      `SELECT
         c.id AS campaign_id,
         c.name AS campaign_name,
         COALESCE(c.source_provider, 'instantly') AS source_provider,
         COALESCE(c.provider_campaign_id, c.id) AS provider_campaign_id,
         ${campaignSourceIdSql("c")} AS campaign_source_id
       FROM sendlens.campaigns c
       WHERE c.workspace_id = '${workspaceSafe}'
         AND lower(c.name) LIKE lower('%${nameSafe}%')
       ORDER BY
         CASE WHEN lower(c.name) = lower('${nameSafe}') THEN 0 ELSE 1 END,
         c.name
       LIMIT 6`,
    );
  }

  if (campaignRows.length === 0) {
    return {
      ok: false,
      payload: {
        error: "No campaign matched the provided selector in the local cache.",
        selector: hasCampaignId
          ? { campaign_id: selector.campaign_id }
          : { campaign_name: selector.campaign_name },
      },
    };
  }
  if (campaignRows.length > 1) {
    return {
      ok: false,
      payload: campaignSelectorAmbiguityPayload(
        hasCampaignId
          ? { campaign_id: selector.campaign_id }
          : { campaign_name: selector.campaign_name },
        campaignRows,
      ),
    };
  }

  const matchedCampaign = formatCampaignMatch(campaignRows[0]);
  return {
    ok: true,
    campaign_id: matchedCampaign.campaign_id,
    campaign_name: matchedCampaign.campaign_name,
    source_provider: matchedCampaign.source_provider,
    provider_campaign_id: matchedCampaign.provider_campaign_id,
    campaign_source_id: matchedCampaign.campaign_source_id,
  };
}

function numberFromRow(row: Record<string, unknown>, key: string) {
  const parsed = Number(row[key] ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildHydrationCoverage(
  fetchResult: Record<string, unknown>,
  targetStoredRows: number,
) {
  const statusResults = Array.isArray(fetchResult.status_results)
    ? fetchResult.status_results as Array<Record<string, unknown>>
    : [];

  return statusResults.map((row) => {
    const rowsStored = numberFromRow(row, "rows_stored");
    const rowsAfter = numberFromRow(row, "stored_rows_after") || rowsStored;
    const exhausted = row.exhausted === true || row.saved_exhausted === true;
    return {
      i_status: numberFromRow(row, "i_status"),
      skipped: row.skipped === true,
      reason: row.reason ?? null,
      pages_fetched: numberFromRow(row, "pages_fetched"),
      rows_fetched: numberFromRow(row, "rows_fetched"),
      rows_stored: rowsStored,
      rows_inserted_new: numberFromRow(row, "rows_inserted_new"),
      rows_updated_existing: numberFromRow(row, "rows_updated_existing"),
      skipped_auto_replies: numberFromRow(row, "skipped_auto_replies"),
      existing_rows_before: numberFromRow(row, "existing_rows_before"),
      stored_rows_after: rowsAfter,
      target_stored_rows: targetStoredRows,
      exhausted,
      coverage_status: row.reason === "target_already_cached"
        ? "target_met"
        : row.skipped === true
          ? row.reason ?? "skipped"
          : classifyHydrationCoverage(rowsAfter, targetStoredRows, exhausted),
    };
  });
}

function readinessPayload(
  readiness: Awaited<ReturnType<typeof waitForSessionSnapshot>>,
) {
  return readiness.waited || readiness.timedOut
    ? {
      waited_for_session_snapshot: readiness.waited,
      timed_out: readiness.timedOut,
      current_status: readiness.status.status,
      message: readiness.warning,
    }
    : undefined;
}

function sessionRefreshBusyResponse(
  readiness: Awaited<ReturnType<typeof waitForSessionSnapshot>>,
) {
  return jsonResponse({
    error:
      "A session-start refresh is still running. Check refresh_status once and retry this SendLens tool only after the status is no longer running. Do not wait with shell commands.",
    readiness: readinessPayload(readiness),
  });
}

async function ensureDemoWorkspaceForRead() {
  if (!isDemoMode()) return null;
  return seedDemoWorkspace();
}

function dbUnavailableResponse(error: LocalDbUnavailableError, extra?: Record<string, unknown>) {
  return jsonResponse({
    error: error.message,
    hint:
      "Use refresh_status once to check whether a refresh is still running. If refresh_status is succeeded and this persists, reload or restart the host/plugin session before retrying. Do not use Bash, sleep, local file inspection, or DuckDB shell access as a fallback.",
    ...extra,
  });
}

function cacheReadinessResponse(error: CacheReadinessError, extra?: Record<string, unknown>) {
  return jsonResponse({
    error: error.message,
    issue: error.issue,
    cache_owner: {
      workspace_id: error.cacheOwner.workspaceId,
      client: error.cacheOwner.client || null,
      owner_mode: error.cacheOwner.ownerMode,
      schema_version: error.cacheOwner.schemaVersion,
      api_key_fingerprint_prefix: error.ownerFingerprintPrefix,
      context_root: error.cacheOwner.contextRoot,
      db_path: error.cacheOwner.dbPath,
      refreshed_at: error.cacheOwner.refreshedAt,
    },
    expected_api_key_fingerprint_prefix: error.expectedFingerprintPrefix,
    selected_client_env: error.selectedClientEnv
      ? {
        client: error.selectedClientEnv.client,
        loaded_env_files: error.selectedClientEnv.loaded,
        configured_keys: error.selectedClientEnv.configuredKeys,
        api_key_fingerprint_prefix: error.clientEnvFingerprintPrefix,
      }
      : undefined,
    hint:
      error.issue === "client_env_mismatch"
        ? "Restart or reload the host so .env.clients/<client>.env replaces stale SendLens process env values, then run setup_doctor before refresh_data."
        : "Run refresh_data with the currently configured Instantly key to rebuild and stamp the local cache. If you intentionally want the old cached data, unset SENDLENS_INSTANTLY_API_KEY before starting the host.",
    ...extra,
  });
}

async function ensureCacheReadable(db: Awaited<ReturnType<typeof getDb>>) {
  if (isDemoMode()) return undefined;
  const readiness = await assertCacheReadableForCurrentEnv(db);
  return readiness.warning ? [readiness.warning] : undefined;
}

export function createSendLensServer() {
const server = new McpServer({
  name: "sendlens",
  version: PLUGIN_VERSION,
});

server.registerTool(
  "refresh_data",
  {
    description:
      [
        "Refresh the local SendLens cache from the configured source provider when the user explicitly asks for fresh data, changes client/workspace context, or refresh_status shows stale/failed data.",
        "Do not use this as the default first read in a new session; session start already runs a lean background refresh and workspace_snapshot is usually the better first tool.",
        "Returns refresh metadata, campaign coverage, and readiness information. Campaign/account aggregates are exact from provider counts where available; rates are recomputed in SendLens views, and lead/outbound evidence remains bounded or sampled where noted by the ingest coverage fields.",
      ].join(" "),
    inputSchema: {
      campaign_ids: z
        .array(z.string())
        .optional()
        .describe("Optional list of provider-qualified or native campaign IDs to refresh instead of the full workspace."),
      provider: z
        .enum(["instantly", "smartlead", "all"])
        .optional()
        .describe("Optional source provider override. Defaults to SENDLENS_PROVIDER or instantly."),
    },
  },
  async ({ campaign_ids, provider }) => {
    const readiness = await waitForSessionSnapshot();
    if (readiness.timedOut) {
      return sessionRefreshBusyResponse(readiness);
    }

    try {
      const refreshed = isDemoMode()
        ? await seedDemoWorkspace()
        : await refreshWorkspaceAtomically({
          campaignIds: campaign_ids,
          source: "manual",
          provider,
        });
      invalidateCatalogColumnCache();
      return jsonResponse({
        ...refreshed,
        demo_mode: isDemoMode() ? true : undefined,
        readiness: readinessPayload(readiness),
      });
    } catch (error) {
      if (error instanceof CacheReadinessError) {
        return cacheReadinessResponse(error);
      }
      if (error instanceof LocalDbUnavailableError) {
        return dbUnavailableResponse(error);
      }
      throw error;
    }
  },
);

server.registerTool(
  "load_campaign_data",
  {
    description:
      [
        "Load and return one campaign's analysis context when the user has chosen a campaign and wants copy, ICP, reply outcome, or next-test diagnosis.",
        "Use this after workspace_snapshot or campaign ranking, not for broad workspace comparisons.",
        "Returns campaign_overview, a stratified human_reply_sample, compact rendered outbound coverage/preview metadata, output limits, warnings, and refresh/readiness metadata.",
        "Rendered outbound raw rows and the broad refresh result are opt-in so default responses stay compact and privacy-aware.",
        "campaign_overview uses exact Instantly aggregates; human replies use lead-level reply outcome state; rendered outbound previews are locally reconstructed/sampled evidence, not exact delivered email bodies.",
      ].join(" "),
    inputSchema: {
      campaign_id: z.string().describe("Provider-qualified or native campaign ID to load."),
      include_rendered_outbound: z
        .boolean()
        .optional()
        .describe("Whether to include raw locally reconstructed outbound rows. Defaults to false; the default response includes only compact redacted coverage/previews."),
      include_refresh_metadata: z
        .boolean()
        .optional()
        .describe("Whether to include the full refresh result. Defaults to false; the default response includes scoped refresh metadata only."),
      max_nonreply_leads: z
        .number()
        .int()
        .min(0)
        .max(500)
        .optional()
        .describe("Maximum non-reply leads to retain for this campaign load."),
      reply_bucket_limit: z
        .number()
        .int()
        .min(1)
        .max(25)
        .optional()
        .describe("Target sample size per human-reply bucket: positive, negative, and neutral."),
    },
  },
  async ({
    campaign_id,
    include_rendered_outbound = false,
    include_refresh_metadata = false,
    max_nonreply_leads = 350,
    reply_bucket_limit = 10,
  }) => {
    const readiness = await waitForSessionSnapshot();
    if (readiness.timedOut) {
      return sessionRefreshBusyResponse(readiness);
    }

    let db: Awaited<ReturnType<typeof getDb>> | null = null;
    try {
      const campaignScope = loadCampaignScope(campaign_id);
      await ensureDemoWorkspaceForRead();
      db = await getDb();
      const cacheWarnings = await ensureCacheReadable(db);
      const workspaceId = await getActiveWorkspaceId(db);
      if (!workspaceId) {
        return jsonResponse({
          error: "No active workspace is loaded. Run refresh_data() first.",
        });
      }

      const resolved = await resolveCampaignSelector(db, workspaceId, {
        campaign_id,
        source_provider: campaignScope.selectorProvider,
      });
      if (!resolved.ok) {
        return jsonResponse({
          schema_version: "campaign_selector_error.v1",
          ...resolved.payload,
          workspace_id: workspaceId,
          suggested_lookup_path:
            "Call workspace_snapshot and use a returned campaign_source_id or campaign_id exactly.",
        });
      }
      closeDb(db);
      db = null;

      const refreshed = isDemoMode()
        ? await seedDemoWorkspace()
        : await refreshWorkspaceAtomically({
          campaignIds: [resolved.campaign_source_id],
          source: "manual",
          provider: campaignScope.refreshProvider ?? resolved.source_provider,
          forceHybrid: true,
          nonReplyLeadLimit: max_nonreply_leads,
        });

      const refreshedWorkspaceId = refreshed.workspaceId ?? workspaceId;
      db = await getDb();
      if (!refreshedWorkspaceId) {
        return jsonResponse({
          error: "No active workspace is loaded after campaign load.",
        });
      }

      const workspaceSafe = refreshedWorkspaceId.replace(/'/g, "''");
      const resolvedCampaignFilter = campaignResolutionFilterSql(resolved);
      const overviewRows = await query(
        db,
        `SELECT *
         FROM sendlens.campaign_overview
         WHERE workspace_id = '${workspaceSafe}'
           AND ${resolvedCampaignFilter}
         LIMIT 1`,
      );
      const loadedCampaignId = typeof overviewRows[0]?.campaign_id === "string"
        ? String(overviewRows[0].campaign_id)
        : null;
      const replyRows = await query(
        db,
        `SELECT *
         FROM sendlens.reply_context
         WHERE workspace_id = '${workspaceSafe}'
           AND ${resolvedCampaignFilter}
         ORDER BY reply_at DESC NULLS LAST, lead_email
         LIMIT ${REPLY_CONTEXT_SCAN_LIMIT + 1}`,
      );
      const renderedRows = include_rendered_outbound
        ? await query(
          db,
          `SELECT *
           FROM sendlens.rendered_outbound_context
           WHERE workspace_id = '${workspaceSafe}'
             AND ${resolvedCampaignFilter}
           ORDER BY sent_at DESC NULLS LAST
           LIMIT ${RENDERED_OUTBOUND_SAMPLE_LIMIT}`,
        )
        : [];
      const renderedPreviewRows = include_rendered_outbound
        ? renderedRows
        : await query(
          db,
          `SELECT
             campaign_id,
             campaign_source_id,
             source_provider,
             step_resolved,
             variant_resolved,
             sample_source,
             sent_at,
             rendered_subject,
             rendered_body_text,
             template_subject,
             template_body_text
           FROM sendlens.rendered_outbound_context
           WHERE workspace_id = '${workspaceSafe}'
             AND ${resolvedCampaignFilter}
           ORDER BY sent_at DESC NULLS LAST
           LIMIT ${RENDERED_OUTBOUND_REDACTED_PREVIEW_LIMIT}`,
        );
      const renderedCountRows = await query(
        db,
        `SELECT COUNT(*) AS sampled_row_count
         FROM sendlens.rendered_outbound_context
         WHERE workspace_id = '${workspaceSafe}'
           AND ${resolvedCampaignFilter}`,
      );

      const replyRowsTruncated = replyRows.length > REPLY_CONTEXT_SCAN_LIMIT;
      const replySample = stratifyHumanReplies(
        replyRows.slice(0, REPLY_CONTEXT_SCAN_LIMIT),
        reply_bucket_limit,
      );
      const renderedSampledRowCount = numberFromRowValue(
        renderedCountRows[0]?.sampled_row_count,
      );
      const warnings: string[] = [];
      if (replyRowsTruncated) {
        warnings.push(
          `Reply context scan was truncated to the ${REPLY_CONTEXT_SCAN_LIMIT} most recent rows before stratified sampling. Narrow the campaign question or use analyze_data for a tighter slice.`,
        );
      }
      warnings.push(
        "Campaign overview metrics are exact local rollups; reply samples are bounded lead-level samples.",
      );
      warnings.push(
        "Rendered outbound evidence is locally reconstructed sample evidence, not byte-for-byte delivered email text.",
      );
      if (!include_rendered_outbound && renderedSampledRowCount > 0) {
        warnings.push(
          "Raw rendered outbound rows are omitted by default. Set include_rendered_outbound=true only when authorized operator diagnosis needs recipient-level reconstructed rows.",
        );
      }
      if (cacheWarnings) warnings.push(...cacheWarnings);
      return jsonResponse({
        schema_version: "load_campaign_data.v2",
        refreshed: include_refresh_metadata ? refreshed : undefined,
        demo_mode: isDemoMode() ? true : undefined,
        readiness: readinessPayload(readiness),
        refresh_metadata: {
          workspace_id: workspaceId,
          requested_campaign_id: campaign_id,
          loaded_campaign_id: loadedCampaignId,
          refresh_campaign_ids: [resolved.campaign_source_id],
          refresh_provider: campaignScope.refreshProvider ?? resolved.source_provider,
          full_refresh_result_included: include_refresh_metadata,
        },
        output_limits: {
          reply_context_scan_limit: REPLY_CONTEXT_SCAN_LIMIT,
          rendered_outbound_sample_limit: RENDERED_OUTBOUND_SAMPLE_LIMIT,
          rendered_outbound_redacted_preview_limit: RENDERED_OUTBOUND_REDACTED_PREVIEW_LIMIT,
          response_max_chars: MCP_TEXT_RESPONSE_MAX_CHARS,
        },
        warnings: warnings.length > 0 ? warnings : undefined,
        campaign_overview: overviewRows[0] ?? null,
        human_reply_sample: replySample,
        rendered_outbound_summary: {
          sampled_row_count: renderedSampledRowCount,
          raw_rows_included: include_rendered_outbound,
          raw_row_limit: include_rendered_outbound ? RENDERED_OUTBOUND_SAMPLE_LIMIT : 0,
          redacted_preview: renderedOutboundRedactedPreview(renderedPreviewRows),
          redacted_fields: ["to_email", "from_email"],
          detail_hint:
            "Set include_rendered_outbound=true to include bounded raw reconstructed outbound rows, or use analyze_data for focused authorized queries.",
        },
        rendered_outbound_sample: include_rendered_outbound ? renderedRows : undefined,
      });
    } catch (error) {
      if (error instanceof CampaignIdScopeError) {
        return jsonResponse({
          error: error.message,
          hint:
            "Use the provider-qualified campaign_id from workspace_snapshot, for example instantly:<id> or smartlead:<id>.",
        });
      }
      if (error instanceof CacheReadinessError) {
        return cacheReadinessResponse(error);
      }
      if (error instanceof LocalDbUnavailableError) {
        return dbUnavailableResponse(error);
      }
      throw error;
    } finally {
      if (db) closeDb(db);
    }
  },
);

server.registerTool(
  "prepare_campaign_analysis",
  {
    description:
      [
        "Prepare one campaign for premium working/not-working diagnosis by hydrating enough exact inbound reply evidence before the agent makes scale, kill, copy, ICP, or reply-quality claims.",
        "Use this for questions like why a campaign is performing, what is working, what is not working, or how reply quality breaks down for one selected campaign.",
        "Default balanced depth fetches interested, not interested, and wrong-person replies with up to 3 List email pages per status, through the 3-second email lane, stopping when each status has enough stored non-auto reply bodies or pagination is exhausted.",
        "After reply fetch, it backfills lead context through Instantly /leads/list contacts/ids so reply bodies stay visible even when the bounded lead scan missed those leads.",
        "The reply_coverage_summary keeps campaign aggregate unique replies separate from hydrated List Email rows and reports selected statuses, OOO exclusion, the fetch request's latest_of_thread=true mode, the fact that stored reply_email_context counts do not track latest_of_thread, per-status fetched/hydrated counts, exhaustion, the numeric gap, and a neutral explanation. Exhausted selected buckets do not prove complete aggregate reply hydration, and maximum depth does not guarantee recovery of a gap.",
      ].join(" "),
    inputSchema: {
      campaign_id: z
        .string()
        .optional()
        .describe("Exact provider-qualified or native campaign ID. Provide either campaign_id or campaign_name, not both."),
      campaign_name: z
        .string()
        .optional()
        .describe("Case-insensitive campaign name fragment. Must resolve to exactly one campaign."),
      analysis_depth: z
        .enum(["fast", "balanced", "maximum"])
        .optional()
        .describe("Hydration depth. Defaults to balanced: 3 pages/status and target 30 stored non-auto reply rows/status."),
      statuses: z
        .array(z.number().int())
        .optional()
        .describe("Instantly i_status values to hydrate. Defaults to [1, -1, -2]: interested, not interested, wrong person."),
      include_ooo: z
        .boolean()
        .optional()
        .describe("Include out-of-office status 0 in addition to requested/default statuses. Defaults to false."),
      reply_evidence_detail: z
        .enum(["redacted_preview", "full_reply_bodies"])
        .optional()
        .describe(
          "Reply evidence detail returned in reply_email_context_sample. Defaults to redacted_preview, which omits full reply bodies and raw email addresses. Use full_reply_bodies only when private reply evidence is explicitly required.",
        ),
    },
  },
  async ({
    campaign_id,
    campaign_name,
    analysis_depth,
    statuses,
    include_ooo = false,
    reply_evidence_detail = "redacted_preview",
  }) => {
    const readiness = await waitForSessionSnapshot();
    if (readiness.timedOut) {
      return sessionRefreshBusyResponse(readiness);
    }

    let db: Awaited<ReturnType<typeof getDb>> | null = null;
    try {
      await ensureDemoWorkspaceForRead();
      db = await getDb();
      const cacheWarnings = await ensureCacheReadable(db);
      const workspaceId = await getActiveWorkspaceId(db);
      if (!workspaceId) {
        return jsonResponse({
          error: "No active workspace is loaded. Run refresh_data() first.",
        });
      }

      const resolved = await resolveCampaignSelector(db, workspaceId, {
        campaign_id,
        campaign_name,
      });
      if (!resolved.ok) {
        return jsonResponse(resolved.payload);
      }

      const depth = resolveCampaignAnalysisDepth(
        analysis_depth as CampaignAnalysisDepth | undefined,
      );
      const latestOfThread = true;
      const resolvedStatuses = normalizeCampaignAnalysisStatuses(
        statuses,
        include_ooo,
      );
      const warnings: string[] = [
        "Instantly List Email is rate-limited to 20 requests/minute; this workflow spends that limited lane on exactly one campaign.",
        "Rendered outbound context is locally reconstructed from templates plus lead variables, not byte-for-byte delivered email.",
      ];
      if (cacheWarnings) warnings.push(...cacheWarnings);
      if (isDemoMode()) {
        warnings.push(
          "Demo mode uses pre-seeded synthetic reply bodies and does not call Instantly.",
        );
      }
      if (reply_evidence_detail === "full_reply_bodies") {
        warnings.push(
          "Explicit full reply evidence mode is enabled. reply_email_context_sample may include raw email addresses, full fetched reply bodies, and quoted thread content.",
        );
      } else {
        warnings.push(
          "Exact reply bodies may be fetched and stored locally for analysis coverage, but the default response redacts full reply bodies and raw email addresses. Set reply_evidence_detail to full_reply_bodies only when private reply evidence is explicitly required.",
        );
      }

      let fetchResult: Record<string, unknown>;
      let leadContextBackfill: Record<string, unknown> | null = null;
      if (isDemoMode()) {
        fetchResult = toReplyTextFetchResult({
          mode: "demo",
          status: "skipped_live_fetch",
          workspace_id: workspaceId,
          campaign_id: resolved.campaign_id,
          campaign_name: resolved.campaign_name,
          statuses: resolvedStatuses,
          max_pages_per_status: depth.maxPagesPerStatus,
          target_stored_rows_per_status: depth.targetStoredRowsPerStatus,
          message:
            "Demo mode uses pre-seeded synthetic reply bodies and does not call Instantly.",
          status_results: [],
        });
      } else {
        fetchResult = toReplyTextFetchResult(await hydrateReplyText({
          workspaceId,
          campaignId: resolved.campaign_id,
          statuses: resolvedStatuses,
          maxPagesPerStatus: depth.maxPagesPerStatus,
          latestOfThread,
          mode: "restart",
          targetStoredRowsPerStatus: depth.targetStoredRowsPerStatus,
          db,
        }));

        try {
          leadContextBackfill = await backfillReplyLeadContext({
            workspaceId,
            campaignId: resolved.campaign_id,
            statuses: resolvedStatuses,
            db,
          });
        } catch (error) {
          leadContextBackfill = {
            schema_version: "reply_lead_backfill.v1",
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          };
          warnings.push(
            "Reply bodies were fetched, but lead context backfill failed. Use reply_email_context and treat missing lead fields as context gaps.",
          );
        }
      }

      const workspaceSafe = sqlSafe(workspaceId);
      const campaignSafe = sqlSafe(resolved.campaign_id);
      const statusesSql = sqlNumberList(resolvedStatuses);
      const statusFilter = statusesSql
        ? `AND reply_email_i_status IN (${statusesSql})`
        : "";

      const overviewRows = await query(
        db,
        `SELECT *
         FROM sendlens.campaign_overview
         WHERE workspace_id = '${workspaceSafe}'
           AND campaign_id = '${campaignSafe}'
         LIMIT 1`,
      );
      const contextRows = await query(
         db,
         `SELECT
           campaign_id,
           source_provider,
           provider_campaign_id,
           campaign_source_id,
           campaign_name,
           reply_email_id,
           reply_thread_id,
           lead_id,
           provider_lead_id,
           lead_email,
           normalized_email,
           normalized_domain,
           reply_from_email,
           reply_to_email,
           reply_subject,
           reply_received_at,
           reply_email_i_status,
           reply_email_i_status_label,
           reply_outcome_label,
           reply_body_text,
           reply_content_preview,
           company_name,
           company_domain,
           job_title,
           step_resolved,
           variant_resolved,
           rendered_subject,
           template_subject,
           has_lead_context,
           has_template_context,
           hydrated_reply_body,
           context_gap_reason
         FROM sendlens.reply_email_context
         WHERE workspace_id = '${workspaceSafe}'
           AND campaign_id = '${campaignSafe}'
           ${statusFilter}
         ORDER BY reply_received_at DESC NULLS LAST, lead_email
         LIMIT ${depth.contextSampleLimit}`,
      );
      const contextCoverageRows = await query(
        db,
        `SELECT
           reply_email_i_status,
           reply_email_i_status_label,
           COUNT(DISTINCT reply_email_id) AS fetched_reply_rows,
           COUNT(DISTINCT CASE WHEN hydrated_reply_body THEN reply_email_id ELSE NULL END) AS hydrated_reply_body_rows,
           COUNT(DISTINCT CASE WHEN reply_is_auto_reply THEN reply_email_id ELSE NULL END) AS auto_reply_rows,
           COUNT(DISTINCT CASE WHEN has_lead_context THEN reply_email_id ELSE NULL END) AS rows_with_lead_context,
           COUNT(DISTINCT CASE WHEN has_template_context THEN reply_email_id ELSE NULL END) AS rows_with_template_context,
           MIN(reply_received_at) AS oldest_reply_received_at,
           MAX(reply_received_at) AS newest_reply_received_at
         FROM sendlens.reply_email_context
         WHERE workspace_id = '${workspaceSafe}'
           AND campaign_id = '${campaignSafe}'
           ${statusFilter}
         GROUP BY 1, 2
         ORDER BY reply_email_i_status DESC`,
      );
      const contextGapCounts = await query(
        db,
        `SELECT
           context_gap_reason,
           COUNT(DISTINCT reply_email_id) AS rows
         FROM sendlens.reply_email_context
         WHERE workspace_id = '${workspaceSafe}'
           AND campaign_id = '${campaignSafe}'
           ${statusFilter}
         GROUP BY 1
         ORDER BY rows DESC, context_gap_reason`,
      );
      const hydrationStateRows = await query(
        db,
        `SELECT
           i_status,
           latest_of_thread,
           email_type,
           next_starting_after,
           pages_hydrated,
           emails_hydrated,
           exhausted,
           last_hydrated_at
         FROM sendlens.reply_email_hydration_state
         WHERE workspace_id = '${workspaceSafe}'
           AND campaign_id = '${campaignSafe}'
           AND i_status IN (${statusesSql})
         ORDER BY i_status DESC`,
      );

      const fetchCoverage = buildHydrationCoverage(
        fetchResult,
        depth.targetStoredRowsPerStatus,
      );
      const replyCoverageSummary = buildCampaignReplyCoverageSummary({
        aggregateReplyCount: overviewRows.length > 0
          ? numberFromRow(overviewRows[0], "reply_count_unique")
          : null,
        selectedStatuses: resolvedStatuses,
        latestOfThread,
        fetchByStatus: fetchCoverage,
        storedContextByStatus: contextCoverageRows,
        hydrationState: hydrationStateRows,
      });
      const partialCoverage = fetchCoverage.filter((row) =>
        row.coverage_status === "partial_cap_reached"
      );
      if (partialCoverage.length > 0) {
        warnings.push(
          "At least one selected reply status hit the page cap before meeting the target. Maximum depth may expose more rows within non-exhausted selected buckets, but it does not guarantee closing an aggregate-to-hydrated gap.",
        );
      }
      if (
        replyCoverageSummary.all_selected_status_buckets_exhausted
        && Number(replyCoverageSummary.coverage_gap_count ?? 0) > 0
      ) {
        warnings.push(
          "Selected reply status buckets are exhausted with a remaining aggregate-to-hydrated numeric gap. Do not describe this as complete aggregate reply hydration; maximum depth does not guarantee recovery. See reply_coverage_summary for scope and neutral causes.",
        );
      }
      const replyEmailContextSample =
        reply_evidence_detail === "full_reply_bodies"
          ? contextRows
          : redactCampaignAnalysisReplySample(contextRows);
      const recommendedNextAnalysisRecipes =
        reply_evidence_detail === "full_reply_bodies"
          ? [
            "reply-hydration-coverage",
            "reply-email-context-feed",
            "campaign-evidence-coverage-audit",
            "campaign-daily-health-trend",
            "campaign-funnel-quality",
          ]
          : [
            "reply-hydration-coverage",
            "campaign-evidence-coverage-audit",
            "campaign-daily-health-trend",
            "campaign-funnel-quality",
          ];

      return jsonResponse({
        schema_version: "campaign_analysis_preparation.v1",
        campaign: {
          campaign_id: resolved.campaign_id,
          campaign_name: resolved.campaign_name,
          source_provider: resolved.source_provider,
          provider_campaign_id: resolved.provider_campaign_id,
          campaign_source_id: resolved.campaign_source_id,
        },
        analysis_depth: depth.depth,
        statuses: resolvedStatuses,
        include_ooo,
        hydration_budget: {
          max_pages_per_status: depth.maxPagesPerStatus,
          rows_per_page: 100,
          target_stored_non_auto_reply_bodies_per_status:
            depth.targetStoredRowsPerStatus,
          email_lane_spacing_seconds: 3,
        },
        fetch_result: fetchResult,
        lead_context_backfill: leadContextBackfill,
        hydration_coverage: {
          fetch_by_status: fetchCoverage,
          stored_context_by_status: contextCoverageRows,
          hydration_state: hydrationStateRows,
        },
        reply_coverage_summary: replyCoverageSummary,
        context_gap_counts: contextGapCounts,
        campaign_overview: overviewRows[0] ?? null,
        reply_email_context_sample: replyEmailContextSample,
        recommended_next_analysis_recipes: recommendedNextAnalysisRecipes,
        warnings: warnings.length > 0 ? warnings : undefined,
        output_limits: {
          reply_email_context_sample_limit: depth.contextSampleLimit,
          reply_body_preview_max_chars:
            reply_evidence_detail === "redacted_preview"
              ? CAMPAIGN_ANALYSIS_REPLY_PREVIEW_MAX_CHARS
              : undefined,
          reply_evidence_detail,
          response_max_chars: MCP_TEXT_RESPONSE_MAX_CHARS,
        },
        readiness: readinessPayload(readiness),
        demo_mode: isDemoMode() ? true : undefined,
      });
    } catch (error) {
      if (error instanceof CacheReadinessError) {
        return cacheReadinessResponse(error);
      }
      if (error instanceof LocalDbUnavailableError) {
        return dbUnavailableResponse(error);
      }
      throw error;
    } finally {
      if (db) closeDb(db);
    }
  },
);

server.registerTool(
  "fetch_reply_text",
  {
    description:
      [
        "Fetch actual inbound reply email text for exactly one campaign and write it into the local DuckDB cache.",
        "Use this only when the user needs real reply bodies; do not run it during routine startup or broad workspace triage because Instantly List email is capped at 20 requests per minute.",
        "Default sync_newest mode fetches the newest page and upserts by email ID so current replies are checked without duplicating cached rows. continue mode resumes older pagination from the saved reply-fetch cursor; restart mode starts from newest again; auto skips only when cached rows exist and no reply_context body gaps are detected.",
        "Default statuses are interested, not interested, and wrong person: 1, -1, -2. Out-of-office status 0 is excluded unless explicitly requested.",
      ].join(" "),
    inputSchema: {
      campaign_id: z
        .string()
        .optional()
        .describe("Exact provider-qualified or native campaign ID. Provide either campaign_id or campaign_name, not both."),
      campaign_name: z
        .string()
        .optional()
        .describe("Case-insensitive campaign name fragment. Must resolve to exactly one campaign."),
      statuses: z
        .array(z.number().int())
        .optional()
        .describe("Instantly i_status values to fetch. Defaults to [1, -1, -2]. Status 0 is out-of-office and excluded by default."),
      max_pages_per_status: z
        .number()
        .int()
        .min(1)
        .max(5)
        .optional()
        .describe("Maximum List email pages to fetch for each status. Each page can return up to 100 emails and costs about 3 seconds under Instantly's 20/min cap."),
      latest_of_thread: z
        .boolean()
        .optional()
        .describe("Whether to fetch only the latest email in each thread. Defaults to true."),
      mode: z
        .enum(["auto", "continue", "restart", "sync_newest"])
        .optional()
        .describe("sync_newest fetches the newest page and upserts by email ID; continue fetches older rows from the saved cursor; restart starts from newest again; auto skips only when cached rows exist and no body gaps are detected."),
      sample_limit: z
        .number()
        .int()
        .min(0)
        .max(50)
        .optional()
        .describe("Number of fetched reply rows to return as a preview after writing to DuckDB."),
    },
  },
  async ({
    campaign_id,
    campaign_name,
    statuses = [1, -1, -2],
    max_pages_per_status = 1,
    latest_of_thread = true,
    mode = "sync_newest",
    sample_limit = 10,
  }) => {
    const readiness = await waitForSessionSnapshot();
    if (readiness.timedOut) {
      return sessionRefreshBusyResponse(readiness);
    }

    let db: Awaited<ReturnType<typeof getDb>> | null = null;
    try {
      await ensureDemoWorkspaceForRead();
      db = await getDb();
      const cacheWarnings = await ensureCacheReadable(db);
      const workspaceId = await getActiveWorkspaceId(db);
      if (!workspaceId) {
        return jsonResponse({
          error: "No active workspace is loaded. Run refresh_data() first.",
        });
      }

      const workspaceSafe = workspaceId.replace(/'/g, "''");
      const resolved = await resolveCampaignSelector(db, workspaceId, {
        campaign_id,
        campaign_name,
      });
      if (!resolved.ok) {
        return jsonResponse(resolved.payload);
      }

      const resolvedCampaignId = resolved.campaign_id;
      const fetchResult = isDemoMode()
        ? toReplyTextFetchResult({
          mode: "demo",
          status: "skipped_live_fetch",
          workspace_id: workspaceId,
          campaign_id: resolvedCampaignId,
          campaign_name: resolved.campaign_name,
          message:
            "Demo mode uses pre-seeded synthetic reply bodies and does not call Instantly.",
        })
        : toReplyTextFetchResult(await hydrateReplyText({
          workspaceId,
          campaignId: resolvedCampaignId,
          statuses,
          maxPagesPerStatus: max_pages_per_status,
          latestOfThread: latest_of_thread,
          mode,
          db,
        }));

      const campaignSafe = resolvedCampaignId.replace(/'/g, "''");
      const fetchedRows = sample_limit > 0
        ? await query(
          db,
          `SELECT
             campaign_id,
             source_provider,
             provider_campaign_id,
             campaign_source_id,
             campaign_name,
             lead_email,
             provider_lead_id,
             normalized_email,
             normalized_domain,
             reply_email_id,
             reply_thread_id,
             reply_email_i_status,
             reply_email_i_status_label,
             reply_outcome_label,
             reply_subject,
             reply_from_email,
             reply_received_at,
             reply_body_text,
             reply_content_preview,
             has_lead_context,
             has_template_context,
             hydrated_reply_body,
             context_gap_reason
           FROM sendlens.reply_email_context
           WHERE workspace_id = '${workspaceSafe}'
             AND campaign_id = '${campaignSafe}'
             AND reply_email_id IS NOT NULL
           ORDER BY reply_received_at DESC NULLS LAST, lead_email
           LIMIT ${sample_limit}`,
        )
        : [];

      return jsonResponse({
        fetch_result: fetchResult,
        demo_mode: isDemoMode() ? true : undefined,
        readiness: readinessPayload(readiness),
        warnings: cacheWarnings,
        output_limits: {
          fetched_reply_sample_limit: sample_limit,
          response_max_chars: MCP_TEXT_RESPONSE_MAX_CHARS,
        },
        fetched_reply_sample: fetchedRows,
      });
    } catch (error) {
      if (error instanceof CacheReadinessError) {
        return cacheReadinessResponse(error);
      }
      if (error instanceof LocalDbUnavailableError) {
        return dbUnavailableResponse(error);
      }
      throw error;
    } finally {
      if (db) closeDb(db);
    }
  },
);

server.registerTool(
  "workspace_snapshot",
  {
    description:
      [
        "Get the first high-level read of the active local workspace, optionally scoped by source provider, exact Instantly tag, or campaign-name fragment.",
        "Use this for broad questions like what is working, what is risky, or which campaign to inspect next.",
        "Do not use this for detailed copy, lead-variable, or reply cohort analysis; pick one campaign and call load_campaign_data or use analysis_starters plus analyze_data.",
        "Returns exact headline campaign/account/inbox-placement metrics, provider breakdown and capability rows, bounded ranked campaigns from campaign_overview, campaign coverage rows, freshness/readiness metadata, and warnings when scoped output is capped.",
      ].join(" "),
    inputSchema: {
      provider: z
        .enum(["instantly", "smartlead", "all"])
        .optional()
        .describe("Optional source provider read scope. Use all for mixed-provider workspace analysis; instantly or smartlead for provider-scoped reads."),
      instantly_tag: z
        .string()
        .optional()
        .describe("Optional exact Instantly campaign tag label to filter by."),
      campaign_name: z
        .string()
        .optional()
        .describe("Optional case-insensitive campaign name fragment to filter by."),
    },
  },
  async ({ provider = "all", instantly_tag, campaign_name }) => {
    const readiness = await waitForSessionSnapshot();
    let db: Awaited<ReturnType<typeof getDb>> | null = null;
    try {
      await ensureDemoWorkspaceForRead();
      db = await getDb();
      const cacheWarnings = await ensureCacheReadable(db);
      const hasScope = Boolean(instantly_tag?.trim() || campaign_name?.trim());
      const summary = hasScope
        ? await buildScopedWorkspaceSnapshot(db, {
          provider,
          instantlyTag: instantly_tag?.trim() || undefined,
          campaignName: campaign_name?.trim() || undefined,
        })
        : await buildWorkspaceSummary(db, undefined, provider);
      const payload = {
        ...summary,
        warnings: [
          ...((summary as { warnings?: string[] }).warnings ?? []),
          ...(cacheWarnings ?? []),
        ],
        readiness: readinessPayload(readiness),
      };
      return jsonResponse(payload);
    } catch (error) {
      if (error instanceof CacheReadinessError) {
        return cacheReadinessResponse(error);
      }
      if (error instanceof LocalDbUnavailableError) {
        return dbUnavailableResponse(error);
      }
      throw error;
    } finally {
      if (db) closeDb(db);
    }
  },
);

server.registerTool(
  "list_tables",
  {
    description:
      [
        "List the public sendlens tables/views available for local analysis without opening the DuckDB cache.",
        "Use this for schema orientation before writing custom SQL.",
        "Do not use it to answer business questions directly; follow with list_columns, search_catalog, analysis_starters, or analyze_data.",
        "Returns table names and descriptions that distinguish exact aggregate surfaces from sampled evidence surfaces.",
      ].join(" "),
    inputSchema: {},
  },
  async () => {
    const tables = await listTables();
    return jsonResponse({ tables });
  },
);

server.registerTool(
  "list_columns",
  {
    description:
      [
        "List columns and DuckDB types for one sendlens table or view before writing custom SQL.",
        "Use this when a recipe or user question needs columns not already known.",
        "Do not use this for broad discovery across many concepts; use search_catalog first.",
        "Returns table name, readiness metadata, and column/type pairs only; it does not return campaign evidence.",
      ].join(" "),
    inputSchema: {
      table_name: z.string().describe("Table name without or with the sendlens. prefix."),
    },
  },
  async ({ table_name }) => {
    const readiness = await waitForSessionSnapshot();
    let db: Awaited<ReturnType<typeof getDb>> | null = null;
    try {
      await ensureDemoWorkspaceForRead();
      db = await getDb();
      const cacheWarnings = await ensureCacheReadable(db);
      const columns = await listColumns(db, table_name);
      return jsonResponse({
        table: table_name,
        readiness: readinessPayload(readiness),
        warnings: cacheWarnings,
        columns,
      });
    } catch (error) {
      if (error instanceof CacheReadinessError) {
        return cacheReadinessResponse(error);
      }
      if (error instanceof LocalDbUnavailableError) {
        return dbUnavailableResponse(error);
      }
      if (error instanceof CatalogPublicTableError) {
        return jsonResponse({
          error: "Table is not a public SendLens surface.",
          code: error.code,
          table: error.tableName,
        });
      }
      throw error;
    } finally {
      if (db) closeDb(db);
    }
  },
);

server.registerTool(
  "search_catalog",
  {
    description:
      [
        "Search public SendLens table and column names when the user gives a concept like reply, bounce, tag, variant, opportunity, or payload.",
        "Use this before custom SQL when the exact schema surface is unclear.",
        "For broad or workflow-style queries, it returns partial schema matches, narrower search terms, analysis_starters suggestions, and compact route cards with a named zero-row correction path when available.",
        "Do not use it as a data read; it returns routing and schema metadata only.",
        "Returns up to 25 table/column matches plus readiness metadata and does not read lead, reply, or campaign evidence rows.",
      ].join(" "),
    inputSchema: {
      query: z.string().describe("Search string such as reply, bounce, variant, opportunity, runway, or rendered outbound."),
    },
  },
  async ({ query: search }) => {
    const readiness = await waitForSessionSnapshot();
    let db: Awaited<ReturnType<typeof getDb>> | null = null;
    try {
      await ensureDemoWorkspaceForRead();
      db = await getDb();
      const cacheWarnings = await ensureCacheReadable(db);
      const matches = await searchCatalog(db, search);
      const guidance = buildCatalogSearchGuidance(search, matches);
      return jsonResponse({
        query: search,
        readiness: readinessPayload(readiness),
        warnings: cacheWarnings,
        matches,
        search_terms: guidance.search_terms,
        suggested_narrower_terms: guidance.suggested_narrower_terms,
        analysis_starter_suggestions: guidance.analysis_starter_suggestions,
        guidance: guidance.message,
      });
    } catch (error) {
      if (error instanceof CacheReadinessError) {
        return cacheReadinessResponse(error);
      }
      if (error instanceof LocalDbUnavailableError) {
        return dbUnavailableResponse(error);
      }
      throw error;
    } finally {
      if (db) closeDb(db);
    }
  },
);

server.registerTool(
  "analysis_starters",
  {
    description:
      [
        "Return curated SendLens SQL recipes for common workspace-health, campaign-performance, copy, reply-pattern, ICP-signal, and tag questions.",
        "Use this before writing custom SQL when the user's question matches a known analysis path.",
        "Do not run recipe SQL blindly; replace placeholders like campaign_id, tag_name, or payload_key and preserve the recipe exactness notes in the final answer.",
        "By default returns a compact recipe index without SQL; pass recipe_id for one full recipe or mode='full' with page/page_size for a bounded SQL page.",
        "Returns recipe metadata, route cards for common/high-risk routes, exact/sample/hybrid classification, output-shape metadata, and SQL on demand; it does not query the database.",
      ].join(" "),
    inputSchema: {
      topic: z
        .enum(QUERY_RECIPE_TOPICS)
        .optional()
        .describe("Optional recipe topic filter."),
      recipe_id: z
        .string()
        .optional()
        .describe("Optional exact recipe id. When set, returns that recipe with full SQL."),
      mode: z
        .enum(["summary", "full"])
        .optional()
        .describe("summary returns a compact index without SQL; full returns bounded pages with SQL."),
      page: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Optional 1-based page number for topic or all-recipes listings."),
      page_size: z
        .number()
        .int()
        .positive()
        .max(25)
        .optional()
        .describe("Optional page size for listings. Maximum 25."),
    },
  },
  async ({ topic, recipe_id, mode, page, page_size }) => {
    const response = buildQueryRecipeResponse({
      topic,
      recipe_id,
      mode,
      page,
      page_size,
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  },
);

server.registerTool(
  "setup_doctor",
  {
    description:
      [
        "Run a safe in-process SendLens setup doctor without shell commands.",
        "Use this for first-run setup, missing API key diagnosis, local cache readiness, stale refresh state, and host bundle context.",
        "It never prints secret values and does not refresh or mutate campaign data.",
      ].join(" "),
    inputSchema: {},
  },
  async () => {
    return jsonResponse(await buildSetupDoctorReport());
  },
);

if (shouldExposeDemoSeedTool()) {
  server.registerTool(
    "seed_demo_workspace",
    {
      description:
        [
          "Seed and activate a synthetic SendLens demo workspace in the local DuckDB cache without Instantly credentials.",
          "Use this when setup_doctor reports no usable Instantly API key and no local cache, when credential validation fails, or when the user explicitly wants demo, dummy, sample, synthetic, or proof data.",
          "Demo rows are public-safe fixtures, not customer data; label downstream analysis as synthetic demo evidence.",
        ].join(" "),
      inputSchema: {},
    },
    async () => {
      const seeded = await seedDemoWorkspace();
      invalidateCatalogColumnCache();
      return jsonResponse({
        ...seeded,
        demo_mode: true,
        next_steps: [
          "Run workspace_snapshot for a high-level demo workspace read.",
          "Ask workspace-health, campaign-performance, copy-analysis, icp-signals, or reply-patterns for synthetic examples.",
          "Label every conclusion as synthetic demo evidence, not real campaign performance.",
        ],
      });
    },
  );
}

server.registerTool(
  "refresh_status",
  {
    description:
      [
        "Check the local SendLens refresh lifecycle when data may be stale, the session-start refresh is still running, or a cache-lock/readiness response asks you to retry later.",
        "Use this for operational status, not analytics.",
        "Returns the last refresh state, timestamps, source, and error context when available; it does not read campaign rows.",
      ].join(" "),
    inputSchema: {},
  },
  async () => {
    const status = await readRefreshStatus();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(status, null, 2),
        },
      ],
    };
  },
);

server.registerTool(
  "analyze_data",
  {
    description:
      [
        "Run focused read-only DuckDB SELECT/WITH analysis against the active local SendLens workspace once the question, table surface, and filters are clear.",
        "Use analysis_starters first for common questions and list_columns/search_catalog first when schema is uncertain.",
        "Do not use this for mutation, external file/network reads, unqualified tables, cross-workspace analysis, or broad unbounded row dumps; the SQL guard injects workspace filters and blocks unsafe shapes.",
        "Returns rationale, readiness metadata, row_count, truncation/output limits, warnings, and rows capped to the tool limit.",
        "Exactness depends on the queried surface: campaign/account/step/template/tag/inbox-placement aggregates are exact, while lead_evidence, reply_context, and rendered_outbound_context include sampled or reconstructed evidence where their view notes say so.",
      ].join(" "),
    inputSchema: {
      sql: z
        .string()
        .describe("DuckDB SQL query using only SELECT/WITH and sendlens.<table> references."),
      rationale: z
        .string()
        .describe("One sentence explaining what the query is meant to answer."),
    },
  },
  async ({ sql, rationale }) => {
    const handlerStartedAt = performance.now();
    const readiness = await waitForSessionSnapshot();
    let db: Awaited<ReturnType<typeof getDb>> | null = null;
    let rewritten: string | null = null;
    try {
      await ensureDemoWorkspaceForRead();
      db = await getDb();
      const cacheWarnings = await ensureCacheReadable(db);
      const workspaceId = await getActiveWorkspaceId(db);
      if (!workspaceId) {
        return jsonResponse({
          error: "No active workspace is loaded. Run refresh_data() first.",
          diagnostics: buildAnalyzeDataDiagnostics({
            status: "cache_unavailable",
            startedAt: handlerStartedAt,
            refreshStatus: readiness.status,
            sql,
          }),
        });
      }
      try {
        enforceAnalyzeDataPrivacy(sql);
      } catch (err) {
        if (err instanceof AnalyzeDataPrivacyGuardError) {
          return jsonResponse(analyzeDataFailurePayload(
            err.code,
            buildAnalyzeDataDiagnostics({
              status: "guard_rejected",
              startedAt: handlerStartedAt,
              refreshStatus: readiness.status,
              sql,
            }),
            {
              hint: err.report.guidance,
              privacyGuard: err.report,
            },
          ));
        }
        throw err;
      }
      try {
        rewritten = enforceLocalWorkspaceScope(sql, workspaceId);
      } catch (err) {
        if (err instanceof LocalSqlGuardError) {
          return jsonResponse(analyzeDataFailurePayload(
            err.code,
            buildAnalyzeDataDiagnostics({
              status: "guard_rejected",
              startedAt: handlerStartedAt,
              refreshStatus: readiness.status,
              sql,
            }),
          ));
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

      for (const row of returnedRows) {
        const rowWorkspace = row.workspace_id;
        if (rowWorkspace != null && rowWorkspace !== workspaceId) {
          return jsonResponse(analyzeDataFailurePayload(
            "workspace_isolation",
            buildAnalyzeDataDiagnostics({
              status: "query_error",
              startedAt: handlerStartedAt,
              refreshStatus: readiness.status,
              sql,
              rowCount: 0,
              resultTruncated: false,
            }),
          ));
        }
      }
      const highCardinalityReport = highCardinalityResultPrivacyReport(returnedRows);
      if (highCardinalityReport) {
        return jsonResponse(analyzeDataFailurePayload(
          "privacy_guard",
          buildAnalyzeDataDiagnostics({
            status: "guard_rejected",
            startedAt: handlerStartedAt,
            refreshStatus: readiness.status,
            sql,
            rowCount: 0,
            resultTruncated: false,
          }),
          {
            hint: highCardinalityReport.guidance,
            privacyGuard: highCardinalityReport,
          },
        ));
      }
      const redactedRows = redactAnalyzeDataRows(returnedRows);

      return jsonResponse({
        rationale,
        readiness: readinessPayload(readiness),
        row_count: redactedRows.length,
        result_truncated: resultTruncated,
        output_limits: {
          row_limit: ANALYZE_DATA_ROW_LIMIT,
          response_max_chars: MCP_TEXT_RESPONSE_MAX_CHARS,
        },
        warnings: resultTruncated
          ? [
            `Result set was truncated to ${ANALYZE_DATA_ROW_LIMIT} rows. Add a tighter WHERE clause, aggregate, select fewer columns, or lower LIMIT for a sharper result.`,
            ...(cacheWarnings ?? []),
          ]
          : cacheWarnings,
        diagnostics: buildAnalyzeDataDiagnostics({
          status: redactedRows.length === 0 ? "zero_rows" : "ok",
          startedAt: handlerStartedAt,
          refreshStatus: readiness.status,
          sql,
          rowCount: redactedRows.length,
          resultTruncated,
        }),
        rows: redactedRows,
      });
    } catch (err) {
      if (err instanceof CacheReadinessError) {
        return jsonResponse(analyzeDataFailurePayload(
          "cache_unavailable",
          buildAnalyzeDataDiagnostics({
            status: "cache_unavailable",
            startedAt: handlerStartedAt,
            refreshStatus: readiness.status,
            sql,
          }),
        ));
      }
      if (err instanceof LocalDbUnavailableError) {
        return jsonResponse(analyzeDataFailurePayload(
          "cache_unavailable",
          buildAnalyzeDataDiagnostics({
            status: "cache_unavailable",
            startedAt: handlerStartedAt,
            refreshStatus: readiness.status,
            sql,
          }),
        ));
      }
      return jsonResponse(analyzeDataFailurePayload(
        "query_error",
        buildAnalyzeDataDiagnostics({
          status: "query_error",
          startedAt: handlerStartedAt,
          refreshStatus: readiness.status,
          sql,
        }),
      ));
    } finally {
      if (db) closeDb(db);
    }
  },
);

return server;
}

async function main() {
  const transportMode = resolveTransportMode();
  if (transportMode === "stdio") {
    const transport = new StdioServerTransport();
    await createSendLensServer().connect(transport);
    return;
  }

  const { startSendLensHttpServer } = await import("./http-transport");
  const controller = await startSendLensHttpServer({
    createServer: createSendLensServer,
  });
  console.error(`[sendlens] Streamable HTTP transport listening on ${controller.url.origin}`);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error("[sendlens] Streamable HTTP transport shutting down");
    await controller.close();
  };
  const handleSignal = () => {
    void shutdown().catch(() => {
      console.error("[sendlens] Streamable HTTP transport shutdown failed");
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
}

export function resolveTransportMode(env: NodeJS.ProcessEnv = process.env): "stdio" | "http" {
  const value = env.SENDLENS_TRANSPORT?.trim() || "stdio";
  if (value !== "stdio" && value !== "http") {
    throw new Error("SENDLENS_TRANSPORT must be either stdio or http.");
  }
  return value;
}

function stratifyHumanReplies(
  rows: Array<Record<string, unknown>>,
  bucketLimit: number,
) {
  const positive: Array<Record<string, unknown>> = [];
  const negative: Array<Record<string, unknown>> = [];
  const neutral: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const bucket = classifyReply(row);
    if (bucket === "positive") positive.push(row);
    else if (bucket === "negative") negative.push(row);
    else neutral.push(row);
  }

  const samplePositive = positive.slice(0, bucketLimit);
  const sampleNegative = negative.slice(0, bucketLimit);
  const sampleNeutral = neutral.slice(0, bucketLimit);

  return {
    counts: {
      total_human_replies: rows.length,
      positive: positive.length,
      negative: negative.length,
      neutral: neutral.length,
    },
    sample: {
      positive: samplePositive,
      negative: sampleNegative,
      neutral: sampleNeutral,
    },
  };
}

function classifyReply(row: Record<string, unknown>) {
  const label = String(row.reply_outcome_label ?? row.lt_interest_label ?? "").trim().toLowerCase();
  if (
    label === "positive"
    || label === "interested"
    || label === "meeting_booked"
    || label === "meeting_completed"
    || label === "won"
  ) {
    return "positive";
  }
  if (
    label === "negative"
    || label === "not_interested"
    || label === "wrong_person"
    || label === "lost"
    || label === "no_show"
  ) {
    return "negative";
  }
  return "neutral";
}

async function buildScopedWorkspaceSnapshot(
  db: Awaited<ReturnType<typeof getDb>>,
  scope: {
    provider?: SourceProviderMode;
    instantlyTag?: string;
    campaignName?: string;
  },
) {
  const workspaceId = await getActiveWorkspaceId(db);
  if (!workspaceId) {
    return {
      schema_version: "workspace_snapshot.v1",
      workspaceId: null,
      summary:
        "No active workspace is loaded. Run refresh_data() before asking for analysis.",
      exact_metrics: {},
      source_provider_scope: scope.provider ?? "all",
      provider_breakdown: [],
      provider_capabilities: [],
      rate_caveats: [],
      coverage: [],
      campaigns: [],
      warnings: ["No workspace has been refreshed locally yet."],
      last_refreshed_at: null,
    };
  }

  const workspace = workspaceId.replace(/'/g, "''");
  const providerScope = scope.provider ?? "all";
  const whereClauses = [
    `co.workspace_id = '${workspace}'`,
    `co.status = 'active'`,
  ];
  const scopeNotes: string[] = [];
  if (providerScope !== "all") {
    whereClauses.push(`co.source_provider = '${providerScope}'`);
    scopeNotes.push(`provider "${providerScope}"`);
  } else {
    scopeNotes.push("all providers");
  }

  if (scope.instantlyTag) {
    const safeTag = scope.instantlyTag.replace(/'/g, "''");
    whereClauses.push(
      `EXISTS (
        SELECT 1
        FROM sendlens.campaign_tags ct
        WHERE ct.workspace_id = co.workspace_id
          AND ct.campaign_id = co.campaign_id
          AND ct.source_provider = co.source_provider
          AND lower(ct.tag_label) = lower('${safeTag}')
      )`,
    );
    scopeNotes.push(`tag "${scope.instantlyTag}"`);
  }

  if (scope.campaignName) {
    const safeName = scope.campaignName.replace(/'/g, "''");
    whereClauses.push(`lower(co.campaign_name) LIKE lower('%${safeName}%')`);
    scopeNotes.push(`campaign name containing "${scope.campaignName}"`);
  }

  const whereSql = whereClauses.join("\n  AND ");

  const campaignRows = await query(
    db,
    `SELECT
       co.campaign_id,
       co.source_provider,
       co.provider_campaign_id,
       co.campaign_source_id,
       co.campaign_name,
       co.status,
       co.daily_limit,
       co.emails_sent_count,
       co.reply_count_unique,
       co.unique_reply_rate_pct,
       co.bounced_count,
	       co.bounce_rate_pct,
	       co.tracking_status,
	       co.deliverability_settings_status,
	       co.text_only,
	       co.first_email_text_only,
	       co.open_tracking,
	       co.link_tracking,
	       co.stop_on_reply,
	       co.stop_on_auto_reply,
	       co.match_lead_esp,
	       co.allow_risky_contacts,
	       co.disable_bounce_protect,
	       co.insert_unsubscribe_header,
	       co.total_opportunities,
       co.total_opportunity_value,
       co.reply_lead_rows,
       co.nonreply_rows_sampled,
       co.reply_outbound_rows,
       co.sampling_algorithm_version,
       co.sampling_seed,
       co.requested_window_start_at,
       co.requested_window_end_at,
       co.effective_population_size,
       co.selected_record_count,
       co.population_fingerprint,
       co.provenance_status
     FROM sendlens.campaign_overview co
     WHERE ${whereSql}
     ORDER BY co.emails_sent_count DESC, co.unique_reply_rate_pct DESC NULLS LAST
     LIMIT ${SCOPED_SNAPSHOT_CAMPAIGN_LIMIT + 1}`,
  );

  const providerBreakdown = await query(
    db,
    `SELECT
       co.source_provider,
       COUNT(*) AS active_campaign_count,
       COALESCE(SUM(co.emails_sent_count), 0) AS total_sent,
       COALESCE(SUM(co.reply_count_unique), 0) AS total_unique_replies,
       COALESCE(SUM(co.bounced_count), 0) AS total_bounces,
       CASE
         WHEN COALESCE(SUM(co.emails_sent_count), 0) = 0 THEN 0
         ELSE ROUND(100.0 * COALESCE(SUM(co.reply_count_unique), 0) / SUM(co.emails_sent_count), 2)
       END AS unique_reply_rate_pct,
       CASE
         WHEN COALESCE(SUM(co.emails_sent_count), 0) = 0 THEN 0
         ELSE ROUND(100.0 * COALESCE(SUM(co.bounced_count), 0) / SUM(co.emails_sent_count), 2)
       END AS bounce_rate_pct
     FROM sendlens.campaign_overview co
     WHERE ${whereSql}
     GROUP BY 1
     ORDER BY source_provider`,
  );

  const capabilityWhere = providerScope === "all"
    ? "TRUE"
    : `source_provider = '${providerScope}'`;
  const providerCapabilities = await query(
    db,
    `SELECT
       source_provider,
       capability,
       support_status,
       confidence,
       coverage_note,
       synced_at
     FROM sendlens.provider_capabilities
     WHERE workspace_id = '${workspace}'
       AND ${capabilityWhere}
     ORDER BY source_provider, capability`,
  );

  if (campaignRows.length === 0) {
    const warnings = providerEvidenceWarnings(providerScope, 0, providerCapabilities);
    if (warnings.length === 0) {
      warnings.push("No campaigns matched the requested scoped filter in the local cache.");
    }

    return {
      schema_version: "workspace_snapshot.v1",
      workspaceId,
      scope: scopeNotes,
      summary: `No campaigns matched ${scopeNotes.join(" and ")} in the active cached workspace.`,
      exact_metrics: {},
      source_provider_scope: providerScope,
      provider_breakdown: [],
      provider_capabilities: providerCapabilities,
      rate_caveats: [],
      coverage: [],
      warnings,
      last_refreshed_at: await readRefreshStatus().then((s) => s.lastSuccessAt ?? null),
      campaigns: [],
    };
  }

  const metricsRows = await query(
    db,
    `SELECT
       COUNT(*) AS campaign_count,
       SUM(CASE WHEN co.status = 'active' THEN 1 ELSE 0 END) AS active_campaign_count,
       COALESCE(SUM(co.daily_limit), 0) AS configured_daily_limit_total,
       COALESCE(SUM(co.emails_sent_count), 0) AS total_sent,
       COALESCE(SUM(co.reply_count_unique), 0) AS total_unique_replies,
       COALESCE(SUM(co.bounced_count), 0) AS total_bounces,
       COALESCE(SUM(co.total_opportunities), 0) AS total_opportunities,
       COALESCE(SUM(co.total_opportunity_value), 0) AS total_pipeline
     FROM sendlens.campaign_overview co
     WHERE ${whereSql}`,
  );

  const metrics = metricsRows[0] ?? {};
  const totalSent = Number(metrics.total_sent ?? 0) || 0;
  const configuredDailyLimitTotal = Number(metrics.configured_daily_limit_total ?? 0) || 0;
  const totalUniqueReplies = Number(metrics.total_unique_replies ?? 0) || 0;
  const totalBounces = Number(metrics.total_bounces ?? 0) || 0;
  const totalOpportunities = Number(metrics.total_opportunities ?? 0) || 0;
  const totalPipeline = Number(metrics.total_pipeline ?? 0) || 0;
  const replyRate = totalSent ? (totalUniqueReplies / totalSent) * 100 : 0;
  const bounceRate = totalSent ? (totalBounces / totalSent) * 100 : 0;
  const campaignRowsTruncated = campaignRows.length > SCOPED_SNAPSHOT_CAMPAIGN_LIMIT;
  const visibleCampaignRows = campaignRows.slice(0, SCOPED_SNAPSHOT_CAMPAIGN_LIMIT);
  const leader = visibleCampaignRows[0];
  const warnings: string[] = [];
  const activeProviders = new Set(
    providerBreakdown
      .filter((row) => Number(row.active_campaign_count ?? 0) > 0)
      .map((row) => String(row.source_provider ?? "instantly")),
  );

  if (bounceRate > 2) {
    warnings.push("Scoped bounce rate is above 2%, which deserves list-quality review.");
  }
  if (totalSent > 0 && replyRate < 1) {
    warnings.push("Scoped unique reply rate is below 1%, so copy and targeting need attention.");
  }
  warnings.push(
    ...providerEvidenceWarnings(
      providerScope,
      Number(metrics.active_campaign_count ?? 0) || 0,
      providerCapabilities,
    ),
  );
  if (campaignRowsTruncated) {
    warnings.push(
      `Scoped campaign list was truncated to ${SCOPED_SNAPSHOT_CAMPAIGN_LIMIT} campaigns. Add a narrower tag or campaign-name filter for more detail.`,
    );
  }
  const rateCaveats = providerScope === "all" && activeProviders.size > 1
    ? [
      "Cross-provider rates are recomputed from normalized SendLens count fields in the local cache.",
      "Do not compare provider-native rates directly unless their denominator/source definitions have been verified.",
    ]
    : [];
  if (rateCaveats.length > 0) warnings.push(rateCaveats[0]);

  if (
    providerCapabilities.some((row) =>
      row.source_provider === "smartlead"
      && row.capability === "inbox_placement"
      && row.support_status === "unsupported"
    )
  ) {
    warnings.push(
      "Smartlead Smart Delivery is support-gated and unavailable to the configured key; empty Smartlead placement rows do not prove deliverability is healthy.",
    );
  }

  const status = await readRefreshStatus();

  return {
    schema_version: "workspace_snapshot.v1",
    workspaceId,
    scope: scopeNotes,
    summary: [
      `Scoped cached snapshot for ${scopeNotes.join(" and ")}.`,
      `${Number(metrics.campaign_count ?? 0)} active campaigns, ${totalSent} sends, ${totalUniqueReplies} unique human replies, ${totalBounces} bounces, ${totalOpportunities} opportunities, and $${totalPipeline} pipeline.`,
      `Configured campaign daily limit in scope: ${configuredDailyLimitTotal} emails/day.`,
      `Exact scoped headline rates: ${replyRate.toFixed(2)}% unique reply rate and ${bounceRate.toFixed(2)}% bounce rate.`,
      leader
        ? `Largest campaign in scope: ${String(leader.campaign_name)} with ${Number(leader.emails_sent_count ?? 0)} sends and ${Number(leader.unique_reply_rate_pct ?? 0).toFixed(2)}% unique reply rate.`
        : "No leading campaign available.",
      "This read comes from the current local cache and does not trigger another workspace refresh.",
      "By default, scoped snapshots only include active campaigns. Ask explicitly for inactive or historical campaigns if you want them included.",
    ].join("\n"),
    exact_metrics: {
      campaign_count: Number(metrics.campaign_count ?? 0) || 0,
      active_campaign_count: Number(metrics.active_campaign_count ?? 0) || 0,
      configured_daily_limit_total: configuredDailyLimitTotal,
      total_sent: totalSent,
      total_unique_replies: totalUniqueReplies,
      total_bounces: totalBounces,
      total_opportunities: totalOpportunities,
      total_pipeline: totalPipeline,
      unique_reply_rate_pct: Number(replyRate.toFixed(2)),
      bounce_rate_pct: Number(bounceRate.toFixed(2)),
    },
    source_provider_scope: providerScope,
    provider_breakdown: providerBreakdown.map((row) => ({
      source_provider: row.source_provider ?? "instantly",
      active_campaign_count: Number(row.active_campaign_count ?? 0) || 0,
      total_sent: Number(row.total_sent ?? 0) || 0,
      total_unique_replies: Number(row.total_unique_replies ?? 0) || 0,
      total_bounces: Number(row.total_bounces ?? 0) || 0,
      unique_reply_rate_pct: Number(row.unique_reply_rate_pct ?? 0) || 0,
      bounce_rate_pct: Number(row.bounce_rate_pct ?? 0) || 0,
    })),
    provider_capabilities: providerCapabilities,
    rate_caveats: rateCaveats,
    output_limits: {
      campaign_limit: SCOPED_SNAPSHOT_CAMPAIGN_LIMIT,
      response_max_chars: MCP_TEXT_RESPONSE_MAX_CHARS,
    },
    coverage: visibleCampaignRows.map((row) => ({
      campaign_id: row.campaign_id,
      source_provider: row.source_provider ?? "instantly",
      provider_campaign_id: row.provider_campaign_id ?? row.campaign_id,
      campaign_source_id: row.campaign_source_id ?? row.campaign_id,
      campaign_name: row.campaign_name,
      reply_lead_rows: row.reply_lead_rows,
      nonreply_rows_sampled: row.nonreply_rows_sampled,
      reply_outbound_rows: row.reply_outbound_rows,
      sampling_algorithm_version: row.sampling_algorithm_version ?? "unknown",
      sampling_seed: row.sampling_seed ?? null,
      requested_window_start_at: row.requested_window_start_at ?? null,
      requested_window_end_at: row.requested_window_end_at ?? null,
      effective_population_size: row.effective_population_size ?? null,
      selected_record_count: row.selected_record_count ?? null,
      population_fingerprint: row.population_fingerprint ?? null,
      provenance_status: row.provenance_status ?? "unknown",
    })),
    campaigns: visibleCampaignRows,
    warnings,
    last_refreshed_at: status.lastSuccessAt ?? null,
    refresh_status: status.status,
  };
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[sendlens] MCP server failed:", error);
    process.exit(1);
  });
}
