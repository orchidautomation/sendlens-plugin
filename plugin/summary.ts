import type { DuckDBConnection } from "@duckdb/node-api";
import { getActiveWorkspaceId, getPluginState, query } from "./local-db";
import type { SourceProviderMode } from "./provider-config";

const WORKSPACE_COVERAGE_LIMIT = 100;
const WORKSPACE_CAMPAIGN_LIMIT = 100;

function pct(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return (numerator / denominator) * 100;
}

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function providerScopeWhere(alias: string, providerScope: SourceProviderMode) {
  if (providerScope === "all") return "TRUE";
  return `COALESCE(${alias}.source_provider, 'instantly') = '${providerScope}'`;
}

function providerScopeLabel(providerScope: SourceProviderMode) {
  return providerScope === "all" ? "all providers" : providerScope;
}

function rateCaveats(providerScope: SourceProviderMode, providerCount: number) {
  if (providerScope !== "all" || providerCount <= 1) return [];
  return [
    "Cross-provider rates are recomputed from normalized SendLens count fields in the local cache.",
    "Do not compare provider-native rates directly unless their denominator/source definitions have been verified.",
  ];
}

export async function buildWorkspaceSummary(
  conn: DuckDBConnection,
  workspaceId?: string,
  providerScope: SourceProviderMode = "all",
) {
  const activeWorkspaceId = workspaceId ?? (await getActiveWorkspaceId(conn));
  if (!activeWorkspaceId) {
    return {
      schema_version: "workspace_snapshot.v1",
      workspaceId: null,
      summary:
        "No active workspace is loaded. Run refresh_data() before asking for analysis.",
      exact_metrics: {},
      coverage: [],
      campaigns: [],
      warnings: ["No workspace has been refreshed locally yet."],
      source_provider_scope: providerScope,
      provider_breakdown: [],
      provider_capabilities: [],
      rate_caveats: [],
      last_refreshed_at: null,
    };
  }

  const workspace = activeWorkspaceId.replace(/'/g, "''");
  const campaignProviderFilter = providerScopeWhere("c", providerScope);
  const overviewProviderFilter = providerScope === "all"
    ? "TRUE"
    : `COALESCE(source_provider, 'instantly') = '${providerScope}'`;
  const leadProviderFilter = overviewProviderFilter;
  const tagProviderFilter = overviewProviderFilter;
  const capabilityProviderFilter = overviewProviderFilter;
  const metricsRows = await query(
    conn,
    `SELECT
       COUNT(*) AS active_campaign_count,
       COALESCE(SUM(ca.emails_sent_count), 0) AS total_sent,
       COALESCE(SUM(ca.reply_count_unique), 0) AS total_unique_replies,
       COALESCE(SUM(ca.reply_count_automatic), 0) AS total_auto_replies,
       COALESCE(SUM(ca.bounced_count), 0) AS total_bounces,
       COALESCE(SUM(ca.total_opportunities), 0) AS total_opportunities
     FROM sendlens.campaigns c
     LEFT JOIN sendlens.campaign_analytics ca
       ON c.workspace_id = ca.workspace_id
      AND c.id = ca.campaign_id
      AND COALESCE(c.source_provider, 'instantly') = COALESCE(ca.source_provider, 'instantly')
     WHERE c.workspace_id = '${workspace}'
       AND c.status = 'active'
       AND ${campaignProviderFilter}`,
  );
  const metrics = metricsRows[0] ?? {};

  const providerBreakdown = await query(
    conn,
    `SELECT
       COALESCE(c.source_provider, 'instantly') AS source_provider,
       COUNT(*) AS active_campaign_count,
       COALESCE(SUM(ca.emails_sent_count), 0) AS total_sent,
       COALESCE(SUM(ca.reply_count_unique), 0) AS total_unique_replies,
       COALESCE(SUM(ca.bounced_count), 0) AS total_bounces,
       CASE
         WHEN COALESCE(SUM(ca.emails_sent_count), 0) = 0 THEN 0
         ELSE ROUND(100.0 * COALESCE(SUM(ca.reply_count_unique), 0) / SUM(ca.emails_sent_count), 2)
       END AS unique_reply_rate_pct,
       CASE
         WHEN COALESCE(SUM(ca.emails_sent_count), 0) = 0 THEN 0
         ELSE ROUND(100.0 * COALESCE(SUM(ca.bounced_count), 0) / SUM(ca.emails_sent_count), 2)
       END AS bounce_rate_pct
     FROM sendlens.campaigns c
     LEFT JOIN sendlens.campaign_analytics ca
       ON c.workspace_id = ca.workspace_id
      AND c.id = ca.campaign_id
      AND COALESCE(c.source_provider, 'instantly') = COALESCE(ca.source_provider, 'instantly')
     WHERE c.workspace_id = '${workspace}'
       AND c.status = 'active'
       AND ${campaignProviderFilter}
     GROUP BY 1
     ORDER BY source_provider`,
  );

  const bestCampaignRows = await query(
    conn,
    `SELECT
       campaign_id,
       source_provider,
       provider_campaign_id,
       campaign_source_id,
       campaign_name AS name,
       campaign_name,
       status,
       leads_count,
       reply_count_unique,
       emails_sent_count,
       bounced_count,
       total_opportunities,
       total_opportunity_value,
       unique_reply_rate_pct,
       bounce_rate_pct,
       tracking_status,
       deliverability_settings_status,
       text_only,
       first_email_text_only,
       open_tracking,
       link_tracking,
       stop_on_reply,
       stop_on_auto_reply,
       match_lead_esp,
       allow_risky_contacts,
       disable_bounce_protect,
       insert_unsubscribe_header,
       reply_lead_rows,
       nonreply_rows_sampled,
       reply_outbound_rows
     FROM sendlens.campaign_overview
     WHERE workspace_id = '${workspace}'
       AND status = 'active'
       AND ${overviewProviderFilter}
     ORDER BY unique_reply_rate_pct DESC NULLS LAST,
              emails_sent_count DESC
     LIMIT ${WORKSPACE_CAMPAIGN_LIMIT + 1}`,
  );

  const coverage = await query(
    conn,
    `SELECT
       sr.campaign_id,
       COALESCE(sr.source_provider, c.source_provider, 'instantly') AS source_provider,
       COALESCE(sr.provider_campaign_id, c.provider_campaign_id, sr.campaign_id) AS provider_campaign_id,
       COALESCE(
         sr.campaign_source_id,
         c.campaign_source_id,
         COALESCE(c.source_provider, sr.source_provider, 'instantly') || ':' || COALESCE(sr.provider_campaign_id, c.provider_campaign_id, sr.campaign_id)
       ) AS campaign_source_id,
       sr.ingest_mode,
       sr.total_leads,
       sr.total_sent,
       sr.reply_rows,
       sr.nonreply_rows_sampled,
       sr.outbound_rows_sampled,
       sr.coverage_note,
       sr.created_at
     FROM sendlens.sampling_runs sr
     JOIN sendlens.campaigns c
       ON sr.workspace_id = c.workspace_id
      AND sr.campaign_id = c.id
      AND COALESCE(sr.source_provider, 'instantly') = COALESCE(c.source_provider, 'instantly')
     WHERE sr.workspace_id = '${workspace}'
       AND c.status = 'active'
       AND ${campaignProviderFilter}
     ORDER BY source_provider, campaign_id
     LIMIT ${WORKSPACE_COVERAGE_LIMIT + 1}`,
  );

  const sampledLeadRows = await query(
    conn,
    `SELECT COUNT(*) AS count
     FROM sendlens.lead_evidence
     WHERE workspace_id = '${workspace}'
       AND ${leadProviderFilter}`,
  );
  const repliedLeadRows = await query(
    conn,
    `SELECT COUNT(*) AS count
     FROM sendlens.lead_evidence
     WHERE workspace_id = '${workspace}'
       AND has_reply_signal = TRUE
       AND ${leadProviderFilter}`,
  );
  const tagRows = await query(
    conn,
    `SELECT COUNT(*) AS count
     FROM sendlens.custom_tags
     WHERE workspace_id = '${workspace}'
       AND ${tagProviderFilter}`,
  );
  const inboxPlacementTestRows = providerScope === "smartlead"
    ? [{ count: 0 }]
    : await query(
      conn,
      `SELECT COUNT(*) AS count FROM sendlens.inbox_placement_tests WHERE workspace_id = '${workspace}'`,
    );
  const inboxPlacementAnalyticsRows = providerScope === "smartlead"
    ? [{ count: 0 }]
    : await query(
      conn,
      `SELECT COUNT(*) AS count FROM sendlens.inbox_placement_analytics WHERE workspace_id = '${workspace}'`,
    );
  const providerCapabilities = await query(
    conn,
    `SELECT
       source_provider,
       capability,
       support_status,
       confidence,
       coverage_note,
       synced_at
     FROM sendlens.provider_capabilities
     WHERE workspace_id = '${workspace}'
       AND ${capabilityProviderFilter}
     ORDER BY source_provider, capability`,
  );

  const totalSent = num(metrics.total_sent);
  const totalUniqueReplies = num(metrics.total_unique_replies);
  const totalBounces = num(metrics.total_bounces);
  const replyRate = pct(totalUniqueReplies, totalSent);
  const bounceRate = pct(totalBounces, totalSent);
  const campaignRowsTruncated = bestCampaignRows.length > WORKSPACE_CAMPAIGN_LIMIT;
  const campaignRows = bestCampaignRows.slice(0, WORKSPACE_CAMPAIGN_LIMIT);
  const bestCampaign = campaignRows[0];
  const warnings: string[] = [];

  if (bounceRate > 5) {
    warnings.push("Workspace bounce rate is above 5%, which is a deliverability red flag.");
  } else if (bounceRate > 2) {
    warnings.push("Workspace bounce rate is above 2%, which deserves list-quality review.");
  }

  if (replyRate < 1) {
    warnings.push("Workspace unique reply rate is below 1%, so copy and targeting need attention.");
  }

  const activeProviderCount = providerBreakdown.filter((row) =>
    num(row.active_campaign_count) > 0
  ).length;
  const normalizedRateCaveats = rateCaveats(providerScope, activeProviderCount);
  if (normalizedRateCaveats.length > 0) {
    warnings.push(normalizedRateCaveats[0]);
  }

  const coverageTruncated = coverage.length > WORKSPACE_COVERAGE_LIMIT;
  const visibleCoverage = coverage.slice(0, WORKSPACE_COVERAGE_LIMIT);
  if (coverageTruncated) {
    warnings.push(
      `Coverage rows were truncated to ${WORKSPACE_COVERAGE_LIMIT} active campaigns. Use a scoped workspace_snapshot or analyze_data query for a narrower slice.`,
    );
  }
  if (campaignRowsTruncated) {
    warnings.push(
      `Campaign rows were truncated to ${WORKSPACE_CAMPAIGN_LIMIT} active campaigns. Use a scoped workspace_snapshot or analyze_data query for a narrower slice.`,
    );
  }
  if (
    providerCapabilities.some((row) =>
      row.source_provider === "smartlead"
      && row.capability === "inbox_placement"
      && row.support_status === "unsupported"
    )
  ) {
    warnings.push(
      "Smartlead inbox placement is explicitly unsupported in the current provider capability surface; do not treat empty inbox-placement rows as stale Smartlead data.",
    );
  }

  const sampledLeadCount = num(sampledLeadRows[0]?.count);
  const repliedLeadCount = num(repliedLeadRows[0]?.count);
  const tagCount = num(tagRows[0]?.count);
  const inboxPlacementTestCount = num(inboxPlacementTestRows[0]?.count);
  const inboxPlacementAnalyticsCount = num(inboxPlacementAnalyticsRows[0]?.count);
  const lastRefreshedAt = await getPluginState(conn, "last_refresh_at");
  const bestCampaignLine = bestCampaign
    ? `${String(bestCampaign.name)} leads with ${pct(num(bestCampaign.reply_count_unique), num(bestCampaign.emails_sent_count)).toFixed(2)}% unique reply rate.`
    : "No campaign performance row is available yet.";

  return {
    schema_version: "workspace_snapshot.v1",
    workspaceId: activeWorkspaceId,
    summary: [
      `Workspace ${activeWorkspaceId} has ${num(metrics.active_campaign_count)} active campaigns in the current SendLens snapshot for ${providerScopeLabel(providerScope)}.`,
      `Exact totals: ${totalSent} sends, ${totalUniqueReplies} unique human replies, ${num(metrics.total_auto_replies)} auto-replies, ${num(metrics.total_opportunities)} opportunities.`,
      `Exact headline rates: ${replyRate.toFixed(2)}% unique reply rate and ${bounceRate.toFixed(2)}% bounce rate.`,
      `Best campaign: ${bestCampaignLine}`,
      bestCampaign
        ? `Coverage on the current leader: ${num(bestCampaign.reply_lead_rows)} reply-signal leads found during bounded lead scan, ${num(bestCampaign.nonreply_rows_sampled)} sampled non-reply leads, ${num(bestCampaign.reply_outbound_rows)} locally reconstructed reply-copy rows.`
        : "Coverage on the current leader is not available yet.",
      `Coverage across active campaigns: ${repliedLeadCount} replied leads, ${sampledLeadCount} sampled leads, and ${tagCount} custom tags stored locally.`,
      `Deliverability evidence: ${inboxPlacementTestCount} inbox placement tests and ${inboxPlacementAnalyticsCount} inbox placement analytics rows stored locally.`,
      "Inactive or purely historical campaigns are excluded from this default workspace read unless you explicitly ask for them.",
      "Reply analysis uses lead reply outcomes plus locally reconstructed template copy. Sampled raw tables are evidence support only and should not be treated as population totals.",
    ].join("\n"),
    exact_metrics: {
      active_campaign_count: num(metrics.active_campaign_count),
      campaign_count: num(metrics.active_campaign_count),
      total_sent: totalSent,
      total_unique_replies: totalUniqueReplies,
      total_auto_replies: num(metrics.total_auto_replies),
      total_bounces: totalBounces,
      total_opportunities: num(metrics.total_opportunities),
      unique_reply_rate_pct: Number(replyRate.toFixed(2)),
      bounce_rate_pct: Number(bounceRate.toFixed(2)),
      inbox_placement_test_count: inboxPlacementTestCount,
      inbox_placement_analytics_rows: inboxPlacementAnalyticsCount,
    },
    source_provider_scope: providerScope,
    provider_breakdown: providerBreakdown.map((row) => ({
      source_provider: row.source_provider ?? "instantly",
      active_campaign_count: num(row.active_campaign_count),
      total_sent: num(row.total_sent),
      total_unique_replies: num(row.total_unique_replies),
      total_bounces: num(row.total_bounces),
      unique_reply_rate_pct: num(row.unique_reply_rate_pct),
      bounce_rate_pct: num(row.bounce_rate_pct),
    })),
    provider_capabilities: providerCapabilities,
    rate_caveats: normalizedRateCaveats,
    output_limits: {
      coverage_limit: WORKSPACE_COVERAGE_LIMIT,
      campaign_limit: WORKSPACE_CAMPAIGN_LIMIT,
    },
    campaigns: campaignRows.map((row) => ({
      campaign_id: row.campaign_id,
      source_provider: row.source_provider ?? "instantly",
      provider_campaign_id: row.provider_campaign_id ?? row.campaign_id,
      campaign_source_id: row.campaign_source_id ?? row.campaign_id,
      campaign_name: row.campaign_name ?? row.name,
      status: row.status,
      leads_count: num(row.leads_count),
      emails_sent_count: num(row.emails_sent_count),
      reply_count_unique: num(row.reply_count_unique),
      bounced_count: num(row.bounced_count),
      total_opportunities: num(row.total_opportunities),
      total_opportunity_value: num(row.total_opportunity_value),
      unique_reply_rate_pct: num(row.unique_reply_rate_pct),
      bounce_rate_pct: num(row.bounce_rate_pct),
      tracking_status: row.tracking_status,
      deliverability_settings_status: row.deliverability_settings_status,
      text_only: row.text_only,
      first_email_text_only: row.first_email_text_only,
      open_tracking: row.open_tracking,
      link_tracking: row.link_tracking,
      stop_on_reply: row.stop_on_reply,
      stop_on_auto_reply: row.stop_on_auto_reply,
      match_lead_esp: row.match_lead_esp,
      allow_risky_contacts: row.allow_risky_contacts,
      disable_bounce_protect: row.disable_bounce_protect,
      insert_unsubscribe_header: row.insert_unsubscribe_header,
      reply_lead_rows: num(row.reply_lead_rows),
      nonreply_rows_sampled: num(row.nonreply_rows_sampled),
      reply_outbound_rows: num(row.reply_outbound_rows),
    })),
    coverage: visibleCoverage,
    warnings,
    last_refreshed_at: lastRefreshedAt,
  };
}
