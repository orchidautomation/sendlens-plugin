import * as z from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { listColumns, listTables, searchCatalog } from "./catalog";
import { loadClientEnv } from "./env";
import { closeDb, getActiveWorkspaceId, getDb, query } from "./local-db";
import { refreshWorkspace } from "./instantly-ingest";
import { getQueryRecipes, QUERY_RECIPE_TOPICS } from "./query-recipes";
import { readRefreshStatus } from "./refresh-status";
import { enforceLocalWorkspaceScope, LocalSqlGuardError } from "./sql-guard";
import { buildWorkspaceSummary } from "./summary";

loadClientEnv();

const server = new McpServer({
  name: "sendlens",
  version: "0.1.6",
});

const SESSION_REFRESH_WAIT_TIMEOUT_MS = 15_000;
const SESSION_REFRESH_POLL_MS = 500;
const PLUXX_READINESS_FOLLOWUP = [
  "Temporary SendLens readiness gate in effect.",
  "Proper cross-host readiness modeling is tracked in PLUXX-212 and PLUXX-213.",
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

server.registerTool(
  "refresh_data",
  {
    description:
      "Pull the latest SendLens data from Instantly into the local cache.",
    inputSchema: {
      campaign_ids: z
        .array(z.string())
        .optional()
        .describe("Optional list of campaign IDs to refresh instead of the full workspace."),
    },
  },
  async ({ campaign_ids }) => {
    const refreshed = await refreshWorkspace({
      campaignIds: campaign_ids,
      source: "manual",
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(refreshed, null, 2),
        },
      ],
    };
  },
);

server.registerTool(
  "load_campaign_data",
  {
    description:
      "Load one campaign with richer lead and copy context for deeper analysis. Use this when the user wants to understand what is landing, who is responding, and what to change next for a single campaign.",
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
    const refreshed = await refreshWorkspace({
      campaignIds: [campaign_id],
      source: "manual",
      forceHybrid: true,
      nonReplyLeadLimit: max_nonreply_leads,
    });

    const db = await getDb();
    try {
      const workspaceId = refreshed.workspaceId ?? (await getActiveWorkspaceId(db));
      if (!workspaceId) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "No active workspace is loaded after campaign hydration.",
              }),
            },
          ],
        };
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
         ORDER BY reply_at DESC NULLS LAST, lead_email`,
      );
      const renderedRows = include_rendered_outbound
        ? await query(
          db,
          `SELECT *
           FROM sendlens.rendered_outbound_context
           WHERE workspace_id = '${workspaceSafe}'
             AND campaign_id = '${campaignSafe}'
           ORDER BY sent_at DESC NULLS LAST
           LIMIT 25`,
        )
        : [];

      const replySample = stratifyHumanReplies(replyRows, reply_bucket_limit);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
            {
              refreshed,
              readiness:
                readiness.waited || readiness.timedOut
                  ? {
                    waited_for_session_snapshot: readiness.waited,
                    timed_out: readiness.timedOut,
                    current_status: readiness.status.status,
                    message: readiness.warning,
                  }
                  : undefined,
              campaign_overview: overviewRows[0] ?? null,
              human_reply_sample: replySample,
              rendered_outbound_sample: renderedRows,
              },
              null,
              2,
            ),
          },
        ],
      };
    } finally {
      closeDb(db);
    }
  },
);

server.registerTool(
  "workspace_snapshot",
  {
    description:
      "Get the current high-level SendLens snapshot for the local workspace, optionally scoped to a campaign name or Instantly tag using only the current local cache.",
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
    const db = await getDb();
    try {
      const hasScope = Boolean(instantly_tag?.trim() || campaign_name?.trim());
      const summary = hasScope
        ? await buildScopedWorkspaceSnapshot(db, {
          instantlyTag: instantly_tag?.trim() || undefined,
          campaignName: campaign_name?.trim() || undefined,
        })
        : await buildWorkspaceSummary(db);
      const payload = {
        ...summary,
        readiness:
          readiness.waited || readiness.timedOut
            ? {
              waited_for_session_snapshot: readiness.waited,
              timed_out: readiness.timedOut,
              current_status: readiness.status.status,
              message: readiness.warning,
            }
            : undefined,
      };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    } finally {
      closeDb(db);
    }
  },
);

server.registerTool(
  "list_tables",
  {
    description:
      "List the local analytical tables available to the plugin. These describe exact and sampled surfaces separately.",
    inputSchema: {},
  },
  async () => {
    const db = await getDb();
    try {
      const tables = await listTables(db);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ tables }, null, 2),
          },
        ],
      };
    } finally {
      closeDb(db);
    }
  },
);

server.registerTool(
  "list_columns",
  {
    description:
      "List columns for a specific sendlens table before writing SQL.",
    inputSchema: {
      table_name: z.string().describe("Table name without or with the sendlens. prefix."),
    },
  },
  async ({ table_name }) => {
    const db = await getDb();
    try {
      const columns = await listColumns(db, table_name);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ table: table_name, columns }, null, 2),
          },
        ],
      };
    } finally {
      closeDb(db);
    }
  },
);

server.registerTool(
  "search_catalog",
  {
    description:
      "Search tables and columns when you know the concept but not the exact schema name.",
    inputSchema: {
      query: z.string().describe("Search string such as reply, bounce, variant, or opportunity."),
    },
  },
  async ({ query: search }) => {
    const db = await getDb();
    try {
      const matches = await searchCatalog(db, search);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ query: search, matches }, null, 2),
          },
        ],
      };
    } finally {
      closeDb(db);
    }
  },
);

server.registerTool(
  "analysis_starters",
  {
    description:
      "Return curated analysis starters for common SendLens questions before writing custom analysis.",
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
      "Check whether SendLens data is current, still refreshing, or failed to load.",
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
      "Run a custom analysis against the active local SendLens data once the question is clear.",
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
    const db = await getDb();
    let rewritten: string | null = null;
    try {
      const workspaceId = await getActiveWorkspaceId(db);
      if (!workspaceId) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "No active workspace is loaded. Run refresh_data() first.",
              }),
            },
          ],
        };
      }
      try {
        rewritten = enforceLocalWorkspaceScope(sql, workspaceId);
      } catch (err) {
        if (err instanceof LocalSqlGuardError) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: err.message,
                  hint:
                    "Use only SELECT/WITH queries against sendlens.* tables. Workspace filters are injected automatically.",
                }),
              },
            ],
          };
        }
        throw err;
      }

      const limitedSql = /\blimit\s+\d+/i.test(rewritten)
        ? rewritten
        : `${rewritten} LIMIT 1000`;
      const rows = await query(db, limitedSql);

      for (const row of rows) {
        const rowWorkspace = row.workspace_id;
        if (rowWorkspace != null && rowWorkspace !== workspaceId) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "Workspace isolation check failed for this query result.",
                }),
              },
            ],
          };
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                rationale,
                readiness:
                  readiness.waited || readiness.timedOut
                    ? {
                      waited_for_session_snapshot: readiness.waited,
                      timed_out: readiness.timedOut,
                      current_status: readiness.status.status,
                      message: readiness.warning,
                    }
                    : undefined,
                row_count: rows.length,
                rows,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: (err as Error).message,
              sql: rewritten ?? sql,
            }),
          },
        ],
      };
    } finally {
      closeDb(db);
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
     ORDER BY co.emails_sent_count DESC, co.unique_reply_rate_pct DESC NULLS LAST`,
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
  const leader = campaignRows[0];
  const warnings: string[] = [];

  if (bounceRate > 2) {
    warnings.push("Scoped bounce rate is above 2%, which deserves list-quality review.");
  }
  if (replyRate < 1) {
    warnings.push("Scoped unique reply rate is below 1%, so copy and targeting need attention.");
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
    coverage: campaignRows.map((row) => ({
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name,
      reply_lead_rows: row.reply_lead_rows,
      nonreply_rows_sampled: row.nonreply_rows_sampled,
      reply_outbound_rows: row.reply_outbound_rows,
    })),
    campaigns: campaignRows,
    warnings,
    last_refreshed_at: status.lastSuccessAt ?? null,
    refresh_status: status.status,
  };
}

main().catch((error) => {
  console.error("[sendlens] MCP server failed:", error);
  process.exit(1);
});
