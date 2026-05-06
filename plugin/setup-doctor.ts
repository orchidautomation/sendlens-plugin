import fs from "node:fs/promises";
import path from "node:path";
import { resolveDbPath } from "./local-db";
import { readRefreshStatus, type RefreshStatus } from "./refresh-status";

type CheckStatus = "pass" | "warn" | "fail" | "info";

type DoctorCheck = {
  name: string;
  status: CheckStatus;
  message: string;
  detail?: string;
};

type CacheFreshness = {
  status: RefreshStatus["status"];
  source?: RefreshStatus["source"];
  timestamp: string | null;
  age_seconds: number | null;
  label: string;
};

function isDemoMode() {
  const raw = process.env.SENDLENS_DEMO_MODE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

async function exists(filePath: string) {
  return fs.stat(filePath).then(() => true).catch(() => false);
}

async function fileSize(filePath: string) {
  const stat = await fs.stat(filePath).catch(() => null);
  return stat?.isFile() ? stat.size : null;
}

function formatBytes(bytes: number | null) {
  if (bytes == null) return null;
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = units[0];
  for (const next of units) {
    unit = next;
    if (value < 1024 || next === units[units.length - 1]) break;
    value /= 1024;
  }
  return `${value >= 10 || unit === "B" ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

async function checkWritableDir(dir: string) {
  try {
    await fs.mkdir(dir, { recursive: true });
    const probe = path.join(dir, ".sendlens-doctor-write-probe");
    await fs.writeFile(probe, "");
    await fs.rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

function pluginRoot() {
  return process.env.PLUGIN_ROOT?.trim() || process.cwd();
}

function statusSummary(status: RefreshStatus) {
  const timestamp = status.lastSuccessAt ?? status.endedAt ?? status.startedAt;
  const freshness = buildCacheFreshness(status);
  const timestampWithAge = timestamp && freshness.age_seconds != null
    ? `${timestamp} (${freshness.label})`
    : timestamp;
  return [status.status, status.source, timestampWithAge].filter(Boolean).join(" | ");
}

function refreshTimestamp(status: RefreshStatus) {
  return status.lastSuccessAt ?? status.endedAt ?? status.startedAt ?? null;
}

function plural(value: number, unit: string) {
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

function formatAge(seconds: number) {
  if (seconds < 60) return plural(seconds, "second");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return plural(hours, "hour");
  const days = Math.floor(hours / 24);
  return plural(days, "day");
}

function buildCacheFreshness(status: RefreshStatus): CacheFreshness {
  const timestamp = refreshTimestamp(status);
  if (!timestamp) {
    return {
      status: status.status,
      source: status.source,
      timestamp: null,
      age_seconds: null,
      label: "No successful refresh timestamp is available.",
    };
  }

  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return {
      status: status.status,
      source: status.source,
      timestamp,
      age_seconds: null,
      label: "Refresh timestamp could not be parsed.",
    };
  }

  const ageSeconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  const age = formatAge(ageSeconds);
  return {
    status: status.status,
    source: status.source,
    timestamp,
    age_seconds: ageSeconds,
    label: ageSeconds < 60 ? `just now (${age} ago)` : `${age} ago`,
  };
}

export async function buildSetupDoctorReport() {
  const root = pluginRoot();
  const dbPath = resolveDbPath();
  const stateDir = process.env.SENDLENS_STATE_DIR?.trim()
    ? path.resolve(process.env.SENDLENS_STATE_DIR)
    : path.dirname(dbPath);
  const shadowDbPath = path.join(stateDir, `.${path.basename(dbPath)}.refreshing`);
  const demoMode = isDemoMode();
  const apiKeyConfigured = Boolean(process.env.SENDLENS_INSTANTLY_API_KEY?.trim());
  const dbExists = await exists(dbPath);
  const dbSize = formatBytes(await fileSize(dbPath));
  const dbDirWritable = await checkWritableDir(path.dirname(dbPath));
  const stateDirWritable = await checkWritableDir(stateDir);
  const refreshStatus = await readRefreshStatus();
  const cacheFreshness = buildCacheFreshness(refreshStatus);
  const shadowDbExists = await exists(shadowDbPath);
  const lockDir = path.join(stateDir, "session-start-refresh.lock");
  const lockPidPath = path.join(lockDir, "pid");
  const lockExists = await exists(lockDir);
  const lockPid = lockExists
    ? await fs.readFile(lockPidPath, "utf8").then((raw) => raw.trim()).catch(() => "")
    : "";
  const lockActive =
    lockPid.length > 0
      ? (() => {
        try {
          process.kill(Number(lockPid), 0);
          return true;
        } catch {
          return false;
        }
      })()
      : false;
  const sourceProject = await exists(path.join(root, "pluxx.config.ts"));
  const installedBundle =
    (await exists(path.join(root, ".claude-plugin", "plugin.json"))) ||
    (await exists(path.join(root, ".codex-plugin", "plugin.json"))) ||
    (await exists(path.join(root, ".cursor", "mcp.json"))) ||
    (await exists(path.join(root, "opencode.json")));
  const buildRuntimeExists = await exists(path.join(root, "build", "plugin", "server.js"));
  const refreshRuntimeExists = await exists(path.join(root, "build", "plugin", "refresh-cli.js"));
  const demoRuntimeExists = await exists(path.join(root, "build", "plugin", "demo-workspace.js"));

  const checks: DoctorCheck[] = [];

  if (demoMode) {
    checks.push({
      name: "Credentials",
      status: "pass",
      message: "Demo mode enabled; production Instantly API key is optional.",
    });
  } else if (apiKeyConfigured) {
    checks.push({
      name: "Credentials",
      status: "pass",
      message: "Instantly API key is configured.",
      detail: "Secret value suppressed.",
    });
  } else if (dbExists) {
    checks.push({
      name: "Credentials",
      status: "warn",
      message: "Instantly API key is not set; live refresh is disabled.",
      detail: "Existing local DuckDB cache can still be used for read-only analysis.",
    });
  } else {
    checks.push({
      name: "Credentials",
      status: "fail",
      message: "Instantly API key is not set and no local DuckDB cache exists.",
      detail: "For the fastest first run, call seed_demo_workspace now to initialize synthetic demo data. Configure SENDLENS_INSTANTLY_API_KEY later for real workspace analysis.",
    });
  }

  checks.push({
    name: "Local DuckDB cache",
    status: dbExists ? "pass" : "warn",
    message: dbExists
      ? `Exists at ${dbPath}${dbSize ? ` (${dbSize})` : ""}.`
      : `No local DuckDB cache found at ${dbPath}.`,
  });
  checks.push({
    name: "DuckDB directory",
    status: dbDirWritable ? "pass" : "fail",
    message: dbDirWritable ? "Writable." : "Not writable.",
    detail: path.dirname(dbPath),
  });
  checks.push({
    name: "State directory",
    status: stateDirWritable ? "pass" : "fail",
    message: stateDirWritable ? "Writable." : "Not writable.",
    detail: stateDir,
  });
  checks.push({
    name: "Refresh status",
    status:
      refreshStatus.status === "running"
        ? "warn"
        : refreshStatus.status === "failed" && !dbExists
          ? "fail"
          : refreshStatus.status === "failed"
            ? "warn"
            : "pass",
    message: statusSummary(refreshStatus) || "No refresh status found.",
    detail: refreshStatus.message ?? undefined,
  });
  checks.push({
    name: "Interrupted refresh temp DB",
    status: shadowDbExists ? "warn" : "pass",
    message: shadowDbExists
      ? "Interrupted refresh temp database exists; the live cache is not replaced until refresh succeeds."
      : "No interrupted refresh temp database.",
    detail: shadowDbExists ? shadowDbPath : undefined,
  });
  checks.push({
    name: "Session-start lock",
    status: lockActive ? "warn" : lockExists ? "warn" : "pass",
    message: lockActive
      ? `Session-start refresh appears active at pid ${lockPid}.`
      : lockExists
        ? "Stale session-start lock exists."
        : "No active session-start lock.",
    detail: lockExists ? lockDir : undefined,
  });
  checks.push({
    name: "Runtime",
    status: buildRuntimeExists && refreshRuntimeExists && demoRuntimeExists ? "pass" : "fail",
    message:
      buildRuntimeExists && refreshRuntimeExists && demoRuntimeExists
        ? "Compiled MCP, refresh, and demo runtimes are present."
        : "One or more compiled runtime entries are missing.",
  });
  checks.push({
    name: "Host bundle context",
    status: sourceProject ? "info" : "pass",
    message: sourceProject
      ? "Source project detected; build host bundles with Pluxx only when preparing a release or local host install."
      : installedBundle
        ? "Installed host bundle detected."
        : "Plugin root detected.",
    detail: root,
  });

  const failures = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");
  const setupStatus =
    failures.length > 0
      ? "blocked"
      : warnings.length > 0
        ? "ready_with_warnings"
        : "ready";

  const nextSteps: string[] = [];
  if (!apiKeyConfigured && !demoMode && dbExists) {
    nextSteps.push("Use workspace_snapshot or analysis skills against the existing local cache.");
    nextSteps.push("Configure SENDLENS_INSTANTLY_API_KEY before running refresh_data for fresh Instantly data.");
  } else if (!apiKeyConfigured && !demoMode) {
    nextSteps.push("Call seed_demo_workspace now for a zero-key synthetic demo workspace.");
    nextSteps.push("Configure SENDLENS_INSTANTLY_API_KEY later when you want real Instantly workspace analysis.");
  } else if (demoMode && !dbExists) {
    nextSteps.push("Call seed_demo_workspace before analysis.");
  } else {
    nextSteps.push(`Current cache freshness: ${cacheFreshness.label}. Use workspace_snapshot as the first read; run refresh_data only when you explicitly need another fresh pull.`);
  }

  return {
    schema_version: "sendlens_setup_doctor.v1",
    setup_status: setupStatus,
    demo_mode: demoMode,
    capabilities: {
      local_cache_read: dbExists,
      live_refresh: apiKeyConfigured || demoMode,
      demo_seed: demoMode || !apiKeyConfigured,
    },
    cache_freshness: cacheFreshness,
    paths: {
      plugin_root: root,
      db_path: dbPath,
      state_dir: stateDir,
    },
    checks,
    failures: failures.map((check) => check.message),
    warnings: warnings.map((check) => check.message),
    next_steps: nextSteps,
    docs: {
      install: "docs/INSTALL.md",
      troubleshooting: "docs/TROUBLESHOOTING.md",
      trust_and_privacy: "docs/TRUST_AND_PRIVACY.md",
    },
  };
}
