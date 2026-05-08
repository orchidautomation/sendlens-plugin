import { loadSendLensEnv } from "./env";
import { refreshWorkspaceAtomically } from "./instantly-ingest";

loadSendLensEnv();

async function main() {
  const summary = await refreshWorkspaceAtomically({ source: "session_start" });
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
