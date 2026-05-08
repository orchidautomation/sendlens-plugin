import { performance } from "node:perf_hooks";
import { clearTraceLog, getTraceLogPath, isTraceEnabled } from "./debug-log";
import { loadSendLensEnv } from "./env";
import { closeDb, getDb, query, resolveDbPath } from "./local-db";
import { refreshWorkspaceAtomically } from "./instantly-ingest";

loadSendLensEnv();

function formatMs(ms: number) {
  return `${ms.toFixed(0)}ms`;
}

async function readSingleNumber(sql: string) {
  const conn = await getDb();
  try {
    const rows = await query(conn, sql);
    return Number(rows[0]?.value ?? 0);
  } finally {
    closeDb(conn);
  }
}

async function main() {
  await clearTraceLog();
  const liveDbPath = resolveDbPath();
  const startedAt = performance.now();

  let summary;
  const refreshStartedAt = performance.now();
  summary = await refreshWorkspaceAtomically({
    source: "session_start",
  });
  const refreshElapsedMs = performance.now() - refreshStartedAt;
  const totalElapsedMs = performance.now() - startedAt;

  const campaignOverviewCount = await readSingleNumber(
    "SELECT COUNT(*) AS value FROM sendlens.campaign_overview",
  );
  const repliedLeadCount = await readSingleNumber(
    "SELECT COUNT(*) AS value FROM sendlens.lead_evidence WHERE has_reply_signal = TRUE",
  );
  const sampledLeadCount = await readSingleNumber(
    "SELECT COUNT(*) AS value FROM sendlens.sampled_leads",
  );
  const reconstructedOutboundCount = await readSingleNumber(
    "SELECT COUNT(*) AS value FROM sendlens.sampled_outbound_emails",
  );

  const exact = summary.exact_metrics ?? {};
  const workspaceId = summary.workspaceId ?? "unknown";

  console.error("[sendlens] Refresh benchmark complete.");
  console.error(`  workspace_id: ${workspaceId}`);
  console.error(`  db_path: ${liveDbPath}`);
  console.error(`  refresh_elapsed: ${formatMs(refreshElapsedMs)}`);
  console.error(`  total_elapsed: ${formatMs(totalElapsedMs)}`);
  console.error(`  active_campaigns: ${Number(exact.active_campaign_count ?? 0)}`);
  console.error(`  campaigns_in_overview: ${campaignOverviewCount}`);
  console.error(`  total_sent_exact: ${Number(exact.total_sent ?? 0)}`);
  console.error(`  unique_replies_exact: ${Number(exact.total_unique_replies ?? 0)}`);
  console.error(`  replied_leads_cached: ${repliedLeadCount}`);
  console.error(`  sampled_leads_cached: ${sampledLeadCount}`);
  console.error(`  reconstructed_outbound_cached: ${reconstructedOutboundCount}`);
  console.error(`  last_refreshed_at: ${summary.last_refreshed_at ?? "unknown"}`);
  if (isTraceEnabled()) {
    console.error(`  trace_log: ${getTraceLogPath()}`);
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error("[sendlens] Refresh benchmark failed.");
  console.error(message);
  process.exit(1);
});
