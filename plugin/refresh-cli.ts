import fs from "node:fs/promises";
import path from "node:path";
import { loadSendLensEnv } from "./env";
import { resolveDbPath } from "./local-db";
import { refreshWorkspace } from "./instantly-ingest";
import { writeRefreshStatus } from "./refresh-status";

loadSendLensEnv();

async function main() {
  const liveDbPath = resolveDbPath();
  const shadowDbPath = path.join(
    path.dirname(liveDbPath),
    `.${path.basename(liveDbPath)}.refreshing`,
  );

  await fs.mkdir(path.dirname(liveDbPath), { recursive: true });
  await fs.rm(shadowDbPath, { force: true });
  const hasLiveDb = await fs.stat(liveDbPath).then(() => true).catch(() => false);
  if (hasLiveDb) {
    await fs.copyFile(liveDbPath, shadowDbPath);
  }

  const previousDbPath = process.env.SENDLENS_DB_PATH;
  process.env.SENDLENS_DB_PATH = shadowDbPath;

  let summary;
  try {
    summary = await refreshWorkspace({ source: "session_start" });
  } finally {
    if (previousDbPath == null) {
      delete process.env.SENDLENS_DB_PATH;
    } else {
      process.env.SENDLENS_DB_PATH = previousDbPath;
    }
  }

  const hasShadowDb = await fs.stat(shadowDbPath).then(() => true).catch(() => false);
  if (hasShadowDb) {
    await fs.rename(shadowDbPath, liveDbPath);
    await writeRefreshStatus({ dbPath: liveDbPath });
  }
  const workspaceId = summary.workspaceId ?? "unknown";
  const refreshedAt = summary.last_refreshed_at ?? new Date().toISOString();
  console.error(
    `[sendlens] Refreshed workspace '${workspaceId}' at ${refreshedAt}.`,
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[sendlens] Fresh session refresh failed: ${message}`);
  process.exit(1);
});
