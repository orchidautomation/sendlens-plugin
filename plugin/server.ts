import * as z from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { listColumns, listTables, searchCatalog } from "./catalog";
import { loadClientEnv } from "./env";
import {
  closeDb,
  getActiveWorkspaceId,
  getDb,
  LocalDbUnavailableError,
  query,
} from "./local-db";
import { refreshWorkspace } from "./instantly-ingest";
import { getQueryRecipes, QUERY_RECIPE_TOPICS } from "./query-recipes";
import { readRefreshStatus } from "./refresh-status";
import { enforceLocalWorkspaceScope, LocalSqlGuardError } from "./sql-guard";
import { buildWorkspaceSummary } from "./summary";

loadClientEnv();

const server = new McpServer({
  name: "sendlens",
  version: "0.1.10",
});

const SESSION_REFRESH_WAIT_TIMEOUT_MS = 15_000;
const SESSION_REFRESH_POLL_MS = 500;
const MCP_TEXT_RESPONSE_MAX_CHARS = 120_000;
const ANALYZE_DATA_ROW_LIMIT = 1_000;
const REPLY_CONTEXT_SCAN_LIMIT = 500;
const RENDERED_OUTBOUND_SAMPLE_LIMIT = 25;
const SCOPED_SNAPSHOT_CAMPAIGN_LIMIT = 100;
const PLUXX_READINESS_FOLLOWUP = [
  "Temporary SendLens readiness gate in effect.",
  "If startup refresh is still running, this tool may wait briefly for the local snapshot before answering.",
].join(" ");

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
      "A session-start refresh is still running. Check refresh_status and retry this tool once the refresh completes.",
    readiness: readinessPayload(readiness),
  });
}

function dbUnavailableResponse(error: LocalDbUnavailableError) {
  return jsonResponse({
    error: error.message,
    hint:
      "The local cache usually unlocks when the active refresh finishes. Use refresh_status to check progress, then retry the tool.",
  });
}

server.registerTool(
  "refresh_data",
  {
    description:
      [
        "Refresh the local SendLens cache from Instantly when the user explicitly asks for fresh data, changes client/workspace context, or refresh_status shows stale/failed data.",
        "Do not use this as the default first read in a new session; session start already runs a lean background refresh and workspace_snapshot is usually the better first tool.",
        "Returns refresh metadata, campaign coverage, and readiness information. Campaign/account/inbox-placement aggregates are exact from Instantly when available; lead and outbound evidence remains bounded or sampled where noted by the ingest coverage fields.",
      ].join(" "),
    inputSchema: {
      campaign_ids: z
        .array(z.string())
        .optional()
        .describe("Optional list of campaign IDs to refresh instead of the full workspace."),
    },
  },
  async ({ campaign_ids }) => {
    const readiness = await waitForSessionSnapshot();
    if (readiness.timedOut) {
      return sessionRefreshBusyResponse(readiness);
    }

    try {
      const refreshed = await refreshWorkspace({
        campaignIds: campaign_ids,
        source: "manual",
      });
      return jsonResponse({
        ...refreshed,
        readiness: readinessPayload(readiness),
      });
    } catch (error) {
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
        "Hydrate and return one campaign's analysis context when the user has chosen a campaign and wants copy, ICP, reply outcome, or next-test diagnosis.",
        "Use this after workspace_snapshot or campaign ranking, not for broad workspace comparisons.",
        "Returns campaign_overview, a stratified human_reply_sample, optional rendered_outbound_sample, output limits, warnings, and refresh/readiness metadata.",
        "campaign_overview uses exact Instantly aggregates; human replies use lead-level reply outcome state; rendered outbound rows are locally reconstructed/sampled evidence, not exact delivered email bodies.",
      ].join(" "),
    inputSchema: {
      campaign_id: z.string().describe("Instantly campaign ID to hydrate."),
      include_rendered_outbound: z
        .boolean()
        .optional()
        .describe("Whether to include locally reconstructed outbound copy for this campaign in the response."),
      max_nonreply_leads: z
        .number()
        .int()
        .min(0)
        .max(500)
        .optional()
        .describe("Maximum non-reply leads to retain for this campaign hydration."),
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
    include_rendered_outbound = true,
    max_nonreply_leads = 350,
    reply_bucket_limit = 10,
  }) => {
    const readiness = await waitForSessionSnapshot();
    if (readiness.timedOut) {
      return sessionRefreshBusyResponse(readiness);
    }

    let db: Awaited<ReturnType<typeof getDb>> | null = null;
    try {
      const refreshed = await refreshWorkspace({
        campaignIds: [campaign_id],
        source: "manual",
        forceHybrid: true,
        nonReplyLeadLimit: max_nonreply_leads,
      });

      db = await getDb();
      const workspaceId = refreshed.workspaceId ?? (await getActiveWorkspaceId(db));
      if (!workspaceId) {
        return jsonResponse({
          error: "No active workspace is loaded after campaign hydration.",
        });
      }

      const campaignSafe = campaign_id.replace(/'/g, "''");
      const workspaceSafe = workspaceId.replace(/'/g, "''");
      const overviewRows = await query(
        db,
        `SELECT *
         FROM sendlens.campaign_overview
         WHERE workspace_id = '${workspaceSafe}'
           AND campaign_id = '${campaignSafe}'
         LIMIT 1`,
      );
      const replyRows = await query(
        db,
        `SELECT *
         FROM sendlens.reply_context
         WHERE workspace_id = '${workspaceSafe}'
           AND campaign_id = '${campaignSafe}'
         ORDER BY reply_at DESC NULLS LAST, lead_email
         LIMIT ${REPLY_CONTEXT_SCAN_LIMIT + 1}`,
      );
      const renderedRows = include_rendered_outbound
        ? await query(
          db,
          `SELECT *
           FROM sendlens.rendered_outbound_context
           WHERE workspace_id = '${workspaceSafe}'
             AND campaign_id = '${campaignSafe}'
           ORDER BY sent_at DESC NULLS LAST
           LIMIT ${RENDERED_OUTBOUND_SAMPLE_LIMIT}`,
        )
        : [];

      const replyRowsTruncated = replyRows.length > REPLY_CONTEXT_SCAN_LIMIT;
      const replySample = stratifyHumanReplies(
        replyRows.slice(0, REPLY_CONTEXT_SCAN_LIMIT),
        reply_bucket_limit,
      );
      return jsonResponse({
        refreshed,
        readiness: readinessPayload(readiness),
        output_limits: {
          reply_context_scan_limit: REPLY_CONTEXT_SCAN_LIMIT,
          rendered_outbound_sample_limit: RENDERED_OUTBOUND_SAMPLE_LIMIT,
          response_max_chars: MCP_TEXT_RESPONSE_MAX_CHARS,
        },
        warnings: replyRowsTruncated
          ? [
            `Reply context scan was truncated to the ${REPLY_CONTEXT_SCAN_LIMIT} most recent rows before stratified sampling. Narrow the campaign question or use analyze_data for a tighter slice.`,
          ]
          : undefined,
        campaign_overview: overviewRows[0] ?? null,
        human_reply_sample: replySample,
        rendered_outbound_sample: renderedRows,
      });
    } catch (error) {
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
        "Get the first high-level read of the active local workspace, optionally scoped by exact Instantly tag or campaign-name fragment.",
        "Use this for broad questions like what is working, what is risky, or which campaign to inspect next.",
        "Do not use this for detailed copy, lead-variable, or reply cohort analysis; pick one campaign and call load_campaign_data or use analysis_starters plus analyze_data.",
        "Returns exact headline campaign/account/inbox-placement metrics, bounded campaign coverage rows, freshness/readiness metadata, and warnings when scoped output is capped.",
      ].join(" "),
    inputSchema: {
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
  async ({ instantly_tag, campaign_name }) => {
    const readiness = await waitForSessionSnapshot();
    let db: Awaited<ReturnType<typeof getDb>> | null = null;
    try {
      db = await getDb();
      const hasScope = Boolean(instantly_tag?.trim() || campaign_name?.trim());
      const summary = hasScope
        ? await buildScopedWorkspaceSnapshot(db, {
          instantlyTag: instantly_tag?.trim() || undefined,
          campaignName: campaign_name?.trim() || undefined,
        })
        : await buildWorkspaceSummary(db);
      const payload = {
        ...summary,
        readiness: readinessPayload(readiness),
      };
      return jsonResponse(payload);
    } catch (error) {
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
      db = await getDb();
      const columns = await listColumns(db, table_name);
      return jsonResponse({
        table: table_name,
        readiness: readinessPayload(readiness),
        columns,
      });
    } catch (error) {
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
  "search_catalog",
  {
    description:
      [
        "Search public SendLens table and column names when the user gives a concept like reply, bounce, tag, variant, opportunity, or payload.",
        "Use this before custom SQL when the exact schema surface is unclear.",
        "Do not use it as a data read; it only returns schema matches.",
        "Returns up to 25 table/column matches plus readiness metadata and does not read lead, reply, or campaign rows.",
      ].join(" "),
    inputSchema: {
      query: z.string().describe("Search string such as reply, bounce, variant, or opportunity."),
    },
  },
  async ({ query: search }) => {
    const readiness = await waitForSessionSnapshot();
    let db: Awaited<ReturnType<typeof getDb>> | null = null;
    try {
      db = await getDb();
      const matches = await searchCatalog(db, search);
      return jsonResponse({
        query: search,
        readiness: readinessPayload(readiness),
        matches,
      });
    } catch (error) {
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
        "Returns recipe metadata, exact/sample/hybrid classification, SQL, and usage notes; it does not query the database.",
      ].join(" "),
    inputSchema: {
      topic: z
        .enum(QUERY_RECIPE_TOPICS)
        .optional()
        .describe("Optional recipe topic filter."),
    },
  },
  async ({ topic }) => {
    const recipes = getQueryRecipes(topic);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              topic: topic ?? "all",
              recipe_count: recipes.length,
              recipes,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

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
    const readiness = await waitForSessionSnapshot();
    let db: Awaited<ReturnType<typeof getDb>> | null = null;
    let rewritten: string | null = null;
    try {
      db = await getDb();
      const workspaceId = await getActiveWorkspaceId(db);
      if (!workspaceId) {
        return jsonResponse({
          error: "No active workspace is loaded. Run refresh_data() first.",
        });
      }
      try {
        rewritten = enforceLocalWorkspaceScope(sql, workspaceId);
      } catch (err) {
        if (err instanceof LocalSqlGuardError) {
          return jsonResponse({
            error: err.message,
            hint:
              "Use only SELECT/WITH queries against sendlens.* tables. Workspace filters are injected automatically.",
          });
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
          return jsonResponse({
            error: "Workspace isolation check failed for this query result.",
          });
        }
      }

      return jsonResponse({
        rationale,
        readiness: readinessPayload(readiness),
        row_count: returnedRows.length,
        result_truncated: resultTruncated,
        output_limits: {
          row_limit: ANALYZE_DATA_ROW_LIMIT,
          response_max_chars: MCP_TEXT_RESPONSE_MAX_CHARS,
        },
        warnings: resultTruncated
          ? [
            `Result set was truncated to ${ANALYZE_DATA_ROW_LIMIT} rows. Add a tighter WHERE clause, aggregate, select fewer columns, or lower LIMIT for a sharper result.`,
          ]
          : undefined,
        rows: returnedRows,
      });
    } catch (err) {
      if (err instanceof LocalDbUnavailableError) {
        return dbUnavailableResponse(err);
      }
      return jsonResponse({
        error: (err as Error).message,
        sql: rewritten ?? sql,
      });
    } finally {
      if (db) closeDb(db);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
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
    instantlyTag?: string;
    campaignName?: string;
  },
) {
  const workspaceId = await getActiveWorkspaceId(db);
  if (!workspaceId) {
    return {
      workspaceId: null,
      summary:
        "No active workspace is loaded. Run refresh_data() before asking for analysis.",
      exact_metrics: {},
      coverage: [],
      warnings: ["No workspace has been refreshed locally yet."],
      last_refreshed_at: null,
    };
  }

  const workspace = workspaceId.replace(/'/g, "''");
  const whereClauses = [
    `co.workspace_id = '${workspace}'`,
    `co.status = 'active'`,
  ];
  const scopeNotes: string[] = [];

  if (scope.instantlyTag) {
    const safeTag = scope.instantlyTag.replace(/'/g, "''");
    whereClauses.push(
      `EXISTS (
        SELECT 1
        FROM sendlens.campaign_tags ct
        WHERE ct.workspace_id = co.workspace_id
          AND ct.campaign_id = co.campaign_id
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
       co.campaign_name,
       co.status,
       co.emails_sent_count,
       co.reply_count_unique,
       co.unique_reply_rate_pct,
       co.bounced_count,
       co.bounce_rate_pct,
       co.total_opportunities,
       co.total_opportunity_value,
       co.reply_lead_rows,
       co.nonreply_rows_sampled,
       co.reply_outbound_rows
     FROM sendlens.campaign_overview co
     WHERE ${whereSql}
     ORDER BY co.emails_sent_count DESC, co.unique_reply_rate_pct DESC NULLS LAST
     LIMIT ${SCOPED_SNAPSHOT_CAMPAIGN_LIMIT + 1}`,
  );

  if (campaignRows.length === 0) {
    return {
      workspaceId,
      scope: scopeNotes,
      summary: `No campaigns matched ${scopeNotes.join(" and ")} in the active cached workspace.`,
      exact_metrics: {},
      coverage: [],
      warnings: ["No campaigns matched the requested scoped filter in the local cache."],
      last_refreshed_at: await readRefreshStatus().then((s) => s.lastSuccessAt ?? null),
      campaigns: [],
    };
  }

  const metricsRows = await query(
    db,
    `SELECT
       COUNT(*) AS campaign_count,
       SUM(CASE WHEN co.status = 'active' THEN 1 ELSE 0 END) AS active_campaign_count,
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

  if (bounceRate > 2) {
    warnings.push("Scoped bounce rate is above 2%, which deserves list-quality review.");
  }
  if (replyRate < 1) {
    warnings.push("Scoped unique reply rate is below 1%, so copy and targeting need attention.");
  }
  if (campaignRowsTruncated) {
    warnings.push(
      `Scoped campaign list was truncated to ${SCOPED_SNAPSHOT_CAMPAIGN_LIMIT} campaigns. Add a narrower tag or campaign-name filter for more detail.`,
    );
  }

  const status = await readRefreshStatus();

  return {
    workspaceId,
    scope: scopeNotes,
    summary: [
      `Scoped cached snapshot for ${scopeNotes.join(" and ")}.`,
      `${Number(metrics.campaign_count ?? 0)} active campaigns, ${totalSent} sends, ${totalUniqueReplies} unique human replies, ${totalBounces} bounces, ${totalOpportunities} opportunities, and $${totalPipeline} pipeline.`,
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
      total_sent: totalSent,
      total_unique_replies: totalUniqueReplies,
      total_bounces: totalBounces,
      total_opportunities: totalOpportunities,
      total_pipeline: totalPipeline,
      unique_reply_rate_pct: Number(replyRate.toFixed(2)),
      bounce_rate_pct: Number(bounceRate.toFixed(2)),
    },
    output_limits: {
      campaign_limit: SCOPED_SNAPSHOT_CAMPAIGN_LIMIT,
      response_max_chars: MCP_TEXT_RESPONSE_MAX_CHARS,
    },
    coverage: visibleCampaignRows.map((row) => ({
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name,
      reply_lead_rows: row.reply_lead_rows,
      nonreply_rows_sampled: row.nonreply_rows_sampled,
      reply_outbound_rows: row.reply_outbound_rows,
    })),
    campaigns: visibleCampaignRows,
    warnings,
    last_refreshed_at: status.lastSuccessAt ?? null,
    refresh_status: status.status,
  };
}

main().catch((error) => {
  console.error("[sendlens] MCP server failed:", error);
  process.exit(1);
});
