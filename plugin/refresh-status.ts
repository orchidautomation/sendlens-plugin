import fs from "node:fs/promises";
import path from "node:path";
import { isUnresolvedDbPath, resolveDbPath } from "./local-db";

export type RefreshStatus = {
  status: "idle" | "running" | "succeeded" | "failed";
  source?: "session_start" | "manual";
  pid?: number;
  workspaceId?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  lastSuccessAt?: string | null;
  campaignsTotal?: number;
  campaignsProcessed?: number;
  currentCampaignId?: string | null;
  currentCampaignName?: string | null;
  message?: string | null;
  dbPath?: string;
};

function getStateDir() {
  const override = process.env.SENDLENS_STATE_DIR?.trim();
  if (override) {
    return path.isAbsolute(override)
      ? override
      : path.resolve(process.cwd(), override);
  }
  return path.dirname(resolveDbPath());
}

function getStatusPath() {
  return path.join(getStateDir(), "refresh-status.json");
}

function isPidActive(pid: number | undefined) {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function normalizeStatus(status: RefreshStatus): RefreshStatus {
  const activeDbPath = resolveDbPath();
  const normalized: RefreshStatus = {
    ...status,
    dbPath:
      status.dbPath && !isUnresolvedDbPath(status.dbPath)
        ? status.dbPath
        : activeDbPath,
  };

  if (
    normalized.status === "failed" &&
    normalized.source === "session_start" &&
    /SENDLENS_INSTANTLY_API_KEY is not set/i.test(normalized.message ?? "")
  ) {
    return {
      ...normalized,
      status: "idle",
      dbPath: activeDbPath,
    };
  }

  if (normalized.status === "running" && !isPidActive(normalized.pid)) {
    return {
      ...normalized,
      status: "failed",
      endedAt: normalized.endedAt ?? new Date().toISOString(),
      dbPath: activeDbPath,
      message:
        `Refresh status was left running by pid ${normalized.pid ?? "unknown"}, but that process is no longer active. Run refresh_data when you need a fresh pull; existing local cache reads can continue if workspace_snapshot is available.`,
    };
  }

  return normalized;
}

async function resolveWritableStatusPath() {
  const primaryDir = getStateDir();
  try {
    await fs.mkdir(primaryDir, { recursive: true });
    const probePath = path.join(primaryDir, ".write-probe");
    await fs.writeFile(probePath, "");
    await fs.rm(probePath, { force: true });
    return path.join(primaryDir, "refresh-status.json");
  } catch {
    const fallbackDir = path.resolve(process.cwd(), ".sendlens-state");
    await fs.mkdir(fallbackDir, { recursive: true });
    return path.join(fallbackDir, "refresh-status.json");
  }
}

export async function readRefreshStatus(): Promise<RefreshStatus> {
  const candidates = [
    getStatusPath(),
    path.resolve(process.cwd(), ".sendlens-state", "refresh-status.json"),
    path.resolve(process.cwd(), ".sendlens-local-state", "refresh-status.json"),
  ];
  try {
    for (const candidate of candidates) {
      try {
        const raw = await fs.readFile(candidate, "utf8");
        const parsed = JSON.parse(raw) as RefreshStatus & { mode?: unknown };
        const { mode: _legacyMode, ...rest } = parsed;
        return normalizeStatus(rest as RefreshStatus);
      } catch {
        continue;
      }
    }
    throw new Error("missing");
  } catch {
    return {
      status: "idle",
      message: "No refresh has run yet in this environment.",
      dbPath: resolveDbPath(),
    };
  }
}

export async function writeRefreshStatus(
  patch: Partial<RefreshStatus>,
): Promise<RefreshStatus> {
  const current = await readRefreshStatus();
  const { mode: _legacyMode, ...currentSansLegacyMode } =
    current as RefreshStatus & { mode?: unknown };
  const next: RefreshStatus = {
    ...currentSansLegacyMode,
    ...patch,
    dbPath: patch.dbPath ?? resolveDbPath(),
  };
  const statusPath = await resolveWritableStatusPath();
  await fs.writeFile(statusPath, JSON.stringify(next, null, 2));
  return next;
}
