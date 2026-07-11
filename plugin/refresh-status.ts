import fs from "node:fs/promises";
import path from "node:path";
import { isUnresolvedDbPath, resolveDbPath } from "./local-db";
import { getRateLimitStats, type RateLimitStats } from "./instantly-client";
import { resolveSourceProviderMode } from "./provider-config";

export type RefreshScopeType =
  | "workspace"
  | "provider_workspace"
  | "campaign"
  | "failed_scoped_lookup";

export type RefreshScopeFreshness =
  | "workspace"
  | "provider_workspace"
  | "scoped"
  | "unknown";

export type RefreshScope = {
  type: RefreshScopeType;
  label: string;
  provider?: "instantly" | "smartlead" | "all" | null;
  requestedCampaignIds?: string[];
  campaignIds?: string[];
  campaignsMatched?: number | null;
  workspaceFreshness: RefreshScopeFreshness;
};

export type RefreshStatus = {
  status: "idle" | "running" | "succeeded" | "failed";
  source?: "session_start" | "manual";
  lastRefreshScope?: RefreshScopeType;
  refreshScope?: RefreshScope;
  partialFailures?: Array<{
    provider: "instantly" | "smartlead";
    refreshScope: RefreshScope;
    message: string;
  }>;
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
  rateLimit?: RateLimitStats;
};

export function buildRefreshScope(options: {
  provider?: RefreshScope["provider"];
  campaignIds?: string[] | null;
  campaignsMatched?: number | null;
  failedScopedLookup?: boolean;
}): RefreshScope {
  const campaignIds = (options.campaignIds ?? []).filter(Boolean);
  const provider = options.provider ?? "instantly";
  const providerLabel = provider === "all"
    ? "all configured providers"
    : provider ?? "configured provider";

  if (options.failedScopedLookup) {
    return {
      type: "failed_scoped_lookup",
      label: `Failed scoped campaign lookup for ${providerLabel}.`,
      provider,
      requestedCampaignIds: campaignIds,
      campaignIds,
      campaignsMatched: 0,
      workspaceFreshness: "unknown",
    };
  }

  if (campaignIds.length > 0) {
    const matched = options.campaignsMatched ?? null;
    return {
      type: "campaign",
      label: matched == null
        ? `Campaign-scoped refresh for ${campaignIds.length} requested campaigns.`
        : `Campaign-scoped refresh matched ${matched} of ${campaignIds.length} requested campaigns.`,
      provider,
      requestedCampaignIds: campaignIds,
      campaignIds,
      campaignsMatched: matched,
      workspaceFreshness: "scoped",
    };
  }

  if (provider === "all") {
    return {
      type: "workspace",
      label: "Full workspace refresh across all configured providers.",
      provider,
      workspaceFreshness: "workspace",
    };
  }

  return {
    type: "provider_workspace",
    label: `Provider-scoped workspace refresh for ${providerLabel}.`,
    provider,
    workspaceFreshness: "provider_workspace",
  };
}

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
  if (normalized.refreshScope && !normalized.lastRefreshScope) {
    normalized.lastRefreshScope = normalized.refreshScope.type;
  }

  // Always attach a fresh rate-limit snapshot so callers can see
  // the current limiter state without re-querying the client.
  normalized.rateLimit = getRateLimitStats();

  if (
    (normalized.status === "failed" || normalized.status === "idle") &&
    normalized.source === "session_start" &&
    /SENDLENS_(?:INSTANTLY|SMARTLEAD)_API_KEY is not set|neither SENDLENS_INSTANTLY_API_KEY nor SENDLENS_SMARTLEAD_API_KEY is set/i.test(normalized.message ?? "")
  ) {
    const providerMode = resolveSourceProviderMode();
    if (providerMode.valid && providerMode.mode === "smartlead") {
      return {
        ...normalized,
        status: "idle",
        dbPath: activeDbPath,
        message:
          "Session-start refresh skipped for SENDLENS_PROVIDER=smartlead because SENDLENS_SMARTLEAD_API_KEY is not set. Existing local DuckDB cache remains usable; configure the Smartlead provider and run refresh_data if fresh data is required.",
      };
    }

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
    // Always refresh the rate-limit snapshot at write time so the
    // persisted file shows the limiter state at the moment the
    // status was updated, not the moment it was first read.
    rateLimit: getRateLimitStats(),
  };
  const statusPath = await resolveWritableStatusPath();
  await fs.writeFile(statusPath, JSON.stringify(next, null, 2));
  return next;
}
