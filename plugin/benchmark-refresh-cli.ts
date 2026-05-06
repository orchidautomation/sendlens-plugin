import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { clearTraceLog, getTraceLogPath, isTraceEnabled } from "./debug-log";
import { loadSendLensEnv } from "./env";
import { closeDb, getDb, query, resolveDbPath } from "./local-db";
import { refreshWorkspace } from "./instantly-ingest";
import { writeRefreshStatus } from "./refresh-status";

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
  const shadowDbPath = path.join(
    path.dirname(liveDbPath),
    `.${path.basename(liveDbPath)}.refreshing`,
  );
  const startedAt = performance.now();

  await fs.mkdir(path.dirname(liveDbPath), { recursive: true });
  await fs.rm(shadowDbPath, { force: true });
  const hasLiveDb = await fs.stat(liveDbPath).then(() => true).catch(() => false);
  if (hasLiveDb) {
    await fs.copyFile(liveDbPath, shadowDbPath);
  }

  const previousDbPath = process.env.SENDLENS_DB_PATH;
  process.env.SENDLENS_DB_PATH = shadowDbPath;

  let summary;
  const refreshStartedAt = performance.now();
  try {
    summary = await refreshWorkspace({
      source: "session_start",
    });
  } finally {
    if (previousDbPath == null) {
      delete process.env.SENDLENS_DB_PATH;
    } else {
      process.env.SENDLENS_DB_PATH = previousDbPath;
    }
  }
  const refreshElapsedMs = performance.now() - refreshStartedAt;

  const swapStartedAt = performance.now();
  const hasShadowDb = await fs.stat(shadowDbPath).then(() => true).catch(() => false);
  if (hasShadowDb) {
    await fs.rename(shadowDbPath, liveDbPath);
    await writeRefreshStatus({ dbPath: liveDbPath });
  }
  const swapElapsedMs = performance.now() - swapStartedAt;
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
  console.error(`  db_swap_elapsed: ${formatMs(swapElapsedMs)}`);
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
