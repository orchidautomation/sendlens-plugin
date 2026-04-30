import type { DuckDBConnection } from "@duckdb/node-api";
import { getActiveWorkspaceId, getPluginState, query } from "./local-db";

function pct(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return (numerator / denominator) * 100;
}

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function buildWorkspaceSummary(
  conn: DuckDBConnection,
  workspaceId?: string,
) {
  const activeWorkspaceId = workspaceId ?? (await getActiveWorkspaceId(conn));
  if (!activeWorkspaceId) {
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

  const workspace = activeWorkspaceId.replace(/'/g, "''");
  const metricsRows = await query(
    conn,
    `SELECT
       COUNT(*) AS campaign_count,
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_campaign_count,
       COALESCE(SUM(ca.emails_sent_count), 0) AS total_sent,
       COALESCE(SUM(ca.reply_count_unique), 0) AS total_unique_replies,
       COALESCE(SUM(ca.reply_count_automatic), 0) AS total_auto_replies,
       COALESCE(SUM(ca.bounced_count), 0) AS total_bounces,
       COALESCE(SUM(ca.total_opportunities), 0) AS total_opportunities
     FROM sendlens.campaigns c
     LEFT JOIN sendlens.campaign_analytics ca
       ON c.workspace_id = ca.workspace_id AND c.id = ca.campaign_id
     WHERE c.workspace_id = '${workspace}'`,
  );
  const metrics = metricsRows[0] ?? {};

  const bestCampaignRows = await query(
    conn,
    `SELECT
       campaign_name AS name,
       reply_count_unique,
       emails_sent_count,
       bounced_count,
       total_opportunities,
       reply_lead_rows,
       nonreply_rows_sampled,
       reply_outbound_rows
     FROM sendlens.campaign_overview
     WHERE workspace_id = '${workspace}'
     ORDER BY unique_reply_rate_pct DESC NULLS LAST,
              emails_sent_count DESC
     LIMIT 1`,
  );

  const coverage = await query(
    conn,
    `SELECT
       campaign_id,
       ingest_mode,
       total_leads,
       total_sent,
       reply_rows,
       nonreply_rows_sampled,
       outbound_rows_sampled,
       coverage_note,
       created_at
     FROM sendlens.sampling_runs
     WHERE workspace_id = '${workspace}'
     ORDER BY campaign_id`,
  );

  const sampledLeadRows = await query(
    conn,
    `SELECT COUNT(*) AS count FROM sendlens.sampled_leads WHERE workspace_id = '${workspace}'`,
  );
  const repliedLeadRows = await query(
    conn,
    `SELECT COUNT(*) AS count
     FROM sendlens.lead_evidence
     WHERE workspace_id = '${workspace}' AND has_reply_signal = TRUE`,
  );
  const tagRows = await query(
    conn,
    `SELECT COUNT(*) AS count FROM sendlens.custom_tags WHERE workspace_id = '${workspace}'`,
  );

  const totalSent = num(metrics.total_sent);
  const totalUniqueReplies = num(metrics.total_unique_replies);
  const totalBounces = num(metrics.total_bounces);
  const replyRate = pct(totalUniqueReplies, totalSent);
  const bounceRate = pct(totalBounces, totalSent);
  const bestCampaign = bestCampaignRows[0];
  const warnings: string[] = [];

  if (bounceRate > 5) {
    warnings.push("Workspace bounce rate is above 5%, which is a deliverability red flag.");
  } else if (bounceRate > 2) {
    warnings.push("Workspace bounce rate is above 2%, which deserves list-quality review.");
  }

  if (replyRate < 1) {
    warnings.push("Workspace unique reply rate is below 1%, so copy and targeting need attention.");
  }

  const sampledLeadCount = num(sampledLeadRows[0]?.count);
  const repliedLeadCount = num(repliedLeadRows[0]?.count);
  const tagCount = num(tagRows[0]?.count);
  const lastRefreshedAt = await getPluginState(conn, "last_refresh_at");
  const bestCampaignLine = bestCampaign
    ? `${String(bestCampaign.name)} leads with ${pct(num(bestCampaign.reply_count_unique), num(bestCampaign.emails_sent_count)).toFixed(2)}% unique reply rate.`
    : "No campaign performance row is available yet.";

  return {
    workspaceId: activeWorkspaceId,
    summary: [
      `Workspace ${activeWorkspaceId} has ${num(metrics.campaign_count)} campaigns (${num(metrics.active_campaign_count)} active).`,
      `Exact totals: ${totalSent} sends, ${totalUniqueReplies} unique human replies, ${num(metrics.total_auto_replies)} auto-replies, ${num(metrics.total_opportunities)} opportunities.`,
      `Exact headline rates: ${replyRate.toFixed(2)}% unique reply rate and ${bounceRate.toFixed(2)}% bounce rate.`,
      `Best campaign: ${bestCampaignLine}`,
      bestCampaign
        ? `Coverage on the current leader: ${num(bestCampaign.reply_lead_rows)} full reply leads, ${num(bestCampaign.nonreply_rows_sampled)} sampled non-reply leads, ${num(bestCampaign.reply_outbound_rows)} locally reconstructed reply-copy rows.`
        : "Coverage on the current leader is not available yet.",
      `Coverage: ${repliedLeadCount} replied leads, ${sampledLeadCount} sampled leads, and ${tagCount} custom tags stored locally.`,
      "Reply analysis uses lead reply outcomes plus locally reconstructed template copy. Sampled raw tables are evidence support only and should not be treated as population totals.",
    ].join("\n"),
    exact_metrics: {
      campaign_count: num(metrics.campaign_count),
      active_campaign_count: num(metrics.active_campaign_count),
      total_sent: totalSent,
      total_unique_replies: totalUniqueReplies,
      total_auto_replies: num(metrics.total_auto_replies),
      total_bounces: totalBounces,
      total_opportunities: num(metrics.total_opportunities),
      unique_reply_rate_pct: Number(replyRate.toFixed(2)),
      bounce_rate_pct: Number(bounceRate.toFixed(2)),
    },
    coverage,
    warnings,
    last_refreshed_at: lastRefreshedAt,
  };
}
