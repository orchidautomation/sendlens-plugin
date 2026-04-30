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
  version: "0.1.0",
});

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
      "Get the current high-level SendLens snapshot for the local workspace.",
    inputSchema: {},
  },
  async () => {
    const db = await getDb();
    try {
      const summary = await buildWorkspaceSummary(db);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(summary, null, 2),
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
  if (label === "positive" || label === "interested" || label === "meeting_booked") {
    return "positive";
  }
  if (label === "negative" || label === "not_interested" || label === "do_not_contact") {
    return "negative";
  }
  return "neutral";
}

main().catch((error) => {
  console.error("[sendlens] MCP server failed:", error);
  process.exit(1);
});
