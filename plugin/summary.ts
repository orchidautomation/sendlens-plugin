import type { DuckDBConnection } from "@duckdb/node-api";
import { buildActiveDataState } from "./active-data-state";
import { getActiveWorkspaceId, getPluginState, query } from "./local-db";
import {
  providerModeIncludes,
  resolveSourceProviderMode,
  type SourceProviderMode,
} from "./provider-config";

const WORKSPACE_COVERAGE_LIMIT = 100;
const WORKSPACE_CAMPAIGN_LIMIT = 100;

export type CampaignInventoryScope = "active" | "active_or_recent" | "all";

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

export function recentCampaignEvidenceWhere(alias: string) {
  return `(${alias}.status <> 'active' AND COALESCE(${alias}.recent_activity_coverage, '') = 'available' AND COALESCE(${alias}.recent_sent_count, 0) > 0)`;
}

export function campaignInventoryScopeWhere(
  alias: string,
  campaignInventoryScope: CampaignInventoryScope,
) {
  if (campaignInventoryScope === "all") return "TRUE";
  if (campaignInventoryScope === "active_or_recent") {
    return `(${alias}.status = 'active' OR ${recentCampaignEvidenceWhere(alias)})`;
  }
  return `${alias}.status = 'active'`;
}

function campaignInventoryScopeLabel(campaignInventoryScope: CampaignInventoryScope) {
  switch (campaignInventoryScope) {
    case "active_or_recent":
      return "active or recently sending campaigns";
    case "all":
      return "all campaign directory rows";
    default:
      return "active campaigns";
  }
}

function rateCaveats(providerScope: SourceProviderMode, providerCount: number) {
  if (providerScope !== "all" || providerCount <= 1) return [];
  return [
    "Cross-provider rates are recomputed from normalized SendLens count fields in the local cache.",
    "Do not compare provider-native rates directly unless their denominator/source definitions have been verified.",
  ];
}

export function providerEvidenceWarnings(
  providerScope: SourceProviderMode,
  activeCampaignCount: number,
  providerCapabilities: Array<Record<string, unknown>>,
) {
  if (providerScope === "all" || activeCampaignCount > 0) return [];

  const warnings = [
    `No ${providerScope} campaign evidence is stored locally for this active workspace scope.`,
  ];

  if (providerScope === "smartlead") {
    const hasSmartleadCapabilities = providerCapabilities.some((row) =>
      row.source_provider === "smartlead"
    );
    const configuredMode = resolveSourceProviderMode();
    const smartleadConfigured = providerModeIncludes(configuredMode.mode, "smartlead")
      && Boolean(process.env.SENDLENS_SMARTLEAD_API_KEY?.trim());

    if (hasSmartleadCapabilities) {
      warnings.push(
        "Smartlead capability rows exist in the local cache, but no active Smartlead campaigns are stored for this workspace.",
      );
    } else if (smartleadConfigured) {
      warnings.push(
        "Smartlead is configured for this process, but this local cache has no active Smartlead campaign rows for the current workspace.",
      );
    } else {
      warnings.push(
        "Smartlead is not configured in the current SendLens provider environment, and no local Smartlead evidence is available.",
      );
    }
  }

  return warnings;
}

export async function buildWorkspaceSummary(
  conn: DuckDBConnection,
  workspaceId?: string,
  providerScope: SourceProviderMode = "all",
  campaignInventoryScope: CampaignInventoryScope = "active",
) {
  const activeWorkspaceId = workspaceId ?? (await getActiveWorkspaceId(conn));
  if (!activeWorkspaceId) {
    const activeDataState = buildActiveDataState({
      workspaceId: null,
      localCacheReadable: false,
      sourceProviderMode: providerScope,
    });
    return {
      schema_version: "workspace_snapshot.v1",
      workspaceId: null,
      active_data_state: activeDataState,
      summary:
        `${activeDataState.analysis_notice}\n${activeDataState.recommended_action}`,
      exact_metrics: {},
      coverage: [],
      campaigns: [],
      warnings: [
        activeDataState.message,
        "No workspace has been refreshed locally yet.",
      ],
      source_provider_scope: providerScope,
      campaign_inventory_scope: campaignInventoryScope,
      inventory_metrics: {},
      provider_breakdown: [],
      provider_capabilities: [],
      rate_caveats: [],
      last_refreshed_at: null,
    };
  }

  const workspace = activeWorkspaceId.replace(/'/g, "''");
  const activeDataState = buildActiveDataState({
    workspaceId: activeWorkspaceId,
    sourceProviderMode: providerScope,
  });
  const campaignProviderFilter = providerScopeWhere("c", providerScope);
  const overviewProviderFilter = providerScope === "all"
    ? "TRUE"
    : `COALESCE(source_provider, 'instantly') = '${providerScope}'`;
  const tagProviderFilter = overviewProviderFilter;
  const capabilityProviderFilter = overviewProviderFilter;
  const campaignInventoryFilter = campaignInventoryScopeWhere("c", campaignInventoryScope);
  const overviewInventoryFilter = campaignInventoryScopeWhere(
    "campaign_overview",
    campaignInventoryScope,
  ).replaceAll("campaign_overview.", "");
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

  const inventoryMetricsRows = await query(
    conn,
    `SELECT
       COUNT(*) AS campaign_count,
       SUM(CASE WHEN c.status = 'active' THEN 1 ELSE 0 END) AS active_campaign_count,
       SUM(CASE WHEN ${recentCampaignEvidenceWhere("c")} THEN 1 ELSE 0 END) AS recent_campaign_count,
       SUM(CASE WHEN COALESCE(c.detail_selection_reason, '') = 'directory_only' THEN 1 ELSE 0 END) AS directory_only_campaign_count,
       (
         SELECT COUNT(*)
         FROM sendlens.campaigns uc
         WHERE uc.workspace_id = '${workspace}'
           AND ${providerScopeWhere("uc", providerScope)}
           AND COALESCE(uc.recent_activity_coverage, '') = 'unavailable'
       ) AS recent_activity_unavailable_campaign_count
     FROM sendlens.campaigns c
     WHERE c.workspace_id = '${workspace}'
       AND ${campaignProviderFilter}
       AND ${campaignInventoryFilter}`,
  );
  const inventoryMetrics = inventoryMetricsRows[0] ?? {};

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
       detail_selection_reason,
       recent_activity_coverage,
       recent_activity_window_start,
       recent_activity_window_end,
       recent_activity_timezone,
       recent_activity_timezone_source,
       recent_sent_count,
       recent_activity_evaluated_at,
       recent_activity_source,
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
       AND ${overviewInventoryFilter}
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
       COALESCE(sr.sampling_algorithm_version, 'unknown') AS sampling_algorithm_version,
       sr.sampling_seed,
       sr.requested_window_start_at,
       sr.requested_window_end_at,
       sr.effective_population_size,
       sr.selected_record_count,
       sr.population_fingerprint,
       COALESCE(sr.provenance_status, 'unknown') AS provenance_status,
       sr.coverage_note,
       sr.created_at
     FROM sendlens.sampling_runs sr
     JOIN sendlens.campaigns c
       ON sr.workspace_id = c.workspace_id
      AND sr.campaign_id = c.id
      AND COALESCE(sr.source_provider, 'instantly') = COALESCE(c.source_provider, 'instantly')
     WHERE sr.workspace_id = '${workspace}'
       AND ${campaignInventoryFilter}
       AND ${campaignProviderFilter}
     ORDER BY source_provider, campaign_id
     LIMIT ${WORKSPACE_COVERAGE_LIMIT + 1}`,
  );

  const sampledLeadRows = await query(
    conn,
    `SELECT COUNT(*) AS count
     FROM sendlens.lead_evidence le
     JOIN sendlens.campaigns c
       ON le.workspace_id = c.workspace_id
      AND le.campaign_id = c.id
      AND COALESCE(le.source_provider, 'instantly') = COALESCE(c.source_provider, 'instantly')
     WHERE le.workspace_id = '${workspace}'
       AND ${campaignProviderFilter}
       AND ${campaignInventoryFilter}`,
  );
  const repliedLeadRows = await query(
    conn,
    `SELECT COUNT(*) AS count
     FROM sendlens.lead_evidence le
     JOIN sendlens.campaigns c
       ON le.workspace_id = c.workspace_id
      AND le.campaign_id = c.id
      AND COALESCE(le.source_provider, 'instantly') = COALESCE(c.source_provider, 'instantly')
     WHERE le.workspace_id = '${workspace}'
       AND le.has_reply_signal = TRUE
       AND ${campaignProviderFilter}
       AND ${campaignInventoryFilter}`,
  );
  const tagRows = await query(
    conn,
    `SELECT COUNT(*) AS count
     FROM sendlens.custom_tags
     WHERE workspace_id = '${workspace}'
       AND ${tagProviderFilter}`,
  );
  const inboxPlacementTestRows = await query(
    conn,
    providerScope === "smartlead"
      ? "SELECT 0 AS count"
      : `SELECT COUNT(*) AS count FROM sendlens.inbox_placement_tests WHERE workspace_id = '${workspace}'`,
  );
  const inboxPlacementAnalyticsRows = await query(
    conn,
    providerScope === "smartlead"
      ? "SELECT 0 AS count"
      : `SELECT COUNT(*) AS count FROM sendlens.inbox_placement_analytics WHERE workspace_id = '${workspace}'`,
  );
  const smartDeliveryTestRows = await query(
    conn,
    providerScope === "instantly"
      ? "SELECT 0 AS count"
      : `SELECT COUNT(*) AS count FROM sendlens.smartlead_delivery_tests WHERE workspace_id = '${workspace}'`,
  );
  const smartDeliveryEvidenceRows = await query(
    conn,
    providerScope === "instantly"
      ? "SELECT 0 AS count"
      : `SELECT COUNT(*) AS count FROM sendlens.smartlead_delivery_evidence WHERE workspace_id = '${workspace}'`,
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
  const activeCampaignCount = num(metrics.active_campaign_count);
  const campaignRowsTruncated = bestCampaignRows.length > WORKSPACE_CAMPAIGN_LIMIT;
  const campaignRows = bestCampaignRows.slice(0, WORKSPACE_CAMPAIGN_LIMIT);
  const bestCampaign = campaignRows[0];
  const warnings: string[] = [];

  if (bounceRate > 5) {
    warnings.push("Workspace bounce rate is above 5%, which is a deliverability red flag.");
  } else if (bounceRate > 2) {
    warnings.push("Workspace bounce rate is above 2%, which deserves list-quality review.");
  }

  if (activeDataState.status === "demo_workspace") {
    warnings.unshift(activeDataState.analysis_notice);
  } else if (activeDataState.status === "cached_workspace_refresh_disabled") {
    warnings.unshift(activeDataState.analysis_notice);
  }

  if (activeCampaignCount > 0 && totalSent > 0 && replyRate < 1) {
    warnings.push("Workspace unique reply rate is below 1%, so copy and targeting need attention.");
  }

  warnings.push(
    ...providerEvidenceWarnings(providerScope, activeCampaignCount, providerCapabilities),
  );

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
      `Coverage rows were truncated to ${WORKSPACE_COVERAGE_LIMIT} ${campaignInventoryScopeLabel(campaignInventoryScope)}. Use a scoped workspace_snapshot or analyze_data query for a narrower slice.`,
    );
  }
  if (campaignRowsTruncated) {
    warnings.push(
      `Campaign rows were truncated to ${WORKSPACE_CAMPAIGN_LIMIT} ${campaignInventoryScopeLabel(campaignInventoryScope)}. Use a scoped workspace_snapshot or analyze_data query for a narrower slice.`,
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
      "Smartlead Smart Delivery is support-gated and unavailable to the configured key; empty Smartlead placement rows do not prove deliverability is healthy.",
    );
  }

  const sampledLeadCount = num(sampledLeadRows[0]?.count);
  const repliedLeadCount = num(repliedLeadRows[0]?.count);
  const tagCount = num(tagRows[0]?.count);
  const inboxPlacementTestCount = num(inboxPlacementTestRows[0]?.count);
  const inboxPlacementAnalyticsCount = num(inboxPlacementAnalyticsRows[0]?.count);
  const smartDeliveryTestCount = num(smartDeliveryTestRows[0]?.count);
  const smartDeliveryEvidenceCount = num(smartDeliveryEvidenceRows[0]?.count);
  const lastRefreshedAt = await getPluginState(conn, "last_refresh_at");
  const bestCampaignLine = bestCampaign
    ? `${String(bestCampaign.name)} leads with ${pct(num(bestCampaign.reply_count_unique), num(bestCampaign.emails_sent_count)).toFixed(2)}% unique reply rate.`
    : "No campaign performance row is available yet.";

  return {
    schema_version: "workspace_snapshot.v1",
    workspaceId: activeWorkspaceId,
    active_data_state: activeDataState,
    summary: [
      activeDataState.status === "demo_workspace" ||
        activeDataState.status === "cached_workspace_refresh_disabled"
        ? activeDataState.message
        : null,
      `Workspace ${activeWorkspaceId} has ${num(metrics.active_campaign_count)} active campaigns in the current SendLens snapshot for ${providerScopeLabel(providerScope)}.`,
      `Campaign inventory scope "${campaignInventoryScope}" returns ${num(inventoryMetrics.campaign_count)} ${campaignInventoryScopeLabel(campaignInventoryScope)}; active KPI totals below remain active-only.`,
      `Exact totals: ${totalSent} sends, ${totalUniqueReplies} unique human replies, ${num(metrics.total_auto_replies)} auto-replies, ${num(metrics.total_opportunities)} opportunities.`,
      `Exact headline rates: ${replyRate.toFixed(2)}% unique reply rate and ${bounceRate.toFixed(2)}% bounce rate.`,
      `Best campaign: ${bestCampaignLine}`,
      bestCampaign
        ? `Coverage on the current leader: ${num(bestCampaign.reply_lead_rows)} reply-signal leads found during bounded lead scan, ${num(bestCampaign.nonreply_rows_sampled)} sampled non-reply leads, ${num(bestCampaign.reply_outbound_rows)} locally reconstructed reply-copy rows.`
        : "Coverage on the current leader is not available yet.",
      `Coverage across ${campaignInventoryScopeLabel(campaignInventoryScope)}: ${repliedLeadCount} replied leads, ${sampledLeadCount} sampled leads, and ${tagCount} custom tags stored locally.`,
      `Deliverability evidence: ${inboxPlacementTestCount} Instantly inbox-placement tests, ${inboxPlacementAnalyticsCount} Instantly per-email analytics rows, ${smartDeliveryTestCount} Smart Delivery tests, and ${smartDeliveryEvidenceCount} Smart Delivery aggregate/diagnostic rows stored locally.`,
      campaignInventoryScope === "active"
        ? "Inactive or purely historical campaigns are excluded from this default workspace read unless you explicitly ask for them."
        : campaignInventoryScope === "active_or_recent"
          ? "This workspace read includes active campaigns plus inactive campaigns with confirmed recent sends; inactive unknown or zero-send campaigns remain directory-only."
          : "This workspace read includes all campaign directory rows and does not imply every campaign detail, lead, reply, or outbound row has been hydrated.",
      "Reply analysis uses lead reply outcomes plus locally reconstructed template copy. Sampled raw tables are evidence support only and should not be treated as population totals.",
    ].filter(Boolean).join("\n"),
    exact_metrics: {
      active_campaign_count: activeCampaignCount,
      campaign_count: activeCampaignCount,
      total_sent: totalSent,
      total_unique_replies: totalUniqueReplies,
      total_auto_replies: num(metrics.total_auto_replies),
      total_bounces: totalBounces,
      total_opportunities: num(metrics.total_opportunities),
      unique_reply_rate_pct: Number(replyRate.toFixed(2)),
      bounce_rate_pct: Number(bounceRate.toFixed(2)),
      inbox_placement_test_count: inboxPlacementTestCount,
      inbox_placement_analytics_rows: inboxPlacementAnalyticsCount,
      smart_delivery_test_count: smartDeliveryTestCount,
      smart_delivery_evidence_rows: smartDeliveryEvidenceCount,
    },
    source_provider_scope: providerScope,
    campaign_inventory_scope: campaignInventoryScope,
    inventory_metrics: {
      campaign_count: num(inventoryMetrics.campaign_count),
      active_campaign_count: num(inventoryMetrics.active_campaign_count),
      recent_campaign_count: num(inventoryMetrics.recent_campaign_count),
      directory_only_campaign_count: num(inventoryMetrics.directory_only_campaign_count),
      recent_activity_unavailable_campaign_count: num(
        inventoryMetrics.recent_activity_unavailable_campaign_count,
      ),
    },
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
      detail_selection_reason: row.detail_selection_reason,
      recent_activity_coverage: row.recent_activity_coverage,
      recent_activity_window_start: row.recent_activity_window_start,
      recent_activity_window_end: row.recent_activity_window_end,
      recent_activity_timezone: row.recent_activity_timezone,
      recent_activity_timezone_source: row.recent_activity_timezone_source,
      recent_sent_count: row.recent_sent_count == null
        ? null
        : num(row.recent_sent_count),
      recent_activity_evaluated_at: row.recent_activity_evaluated_at,
      recent_activity_source: row.recent_activity_source,
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
