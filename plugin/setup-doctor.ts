import fs from "node:fs/promises";
import path from "node:path";
import { DEMO_WORKSPACE_ID } from "./demo-workspace";
import { getLastLoadedSendLensEnv, isUnresolvedEnvValue } from "./env";
import { validateApiKey } from "./instantly-client";
import {
  CacheReadinessError,
  type CacheOwnerMetadata,
  closeDb,
  currentApiKeyFingerprint,
  fingerprintPrefix,
  getCacheOwnerMetadata,
  getCacheReadiness,
  getDb,
  resolveDbPath,
} from "./local-db";
import {
  providerModeIncludes,
  providersForMode,
  resolveSourceProviderMode,
  validateSmartleadApiKey,
} from "./provider-config";
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
  const providerMode = resolveSourceProviderMode();
  const sourceProviders = providerMode.valid ? providersForMode(providerMode.mode) : [];
  const instantlySelected = providerMode.valid
    ? providerModeIncludes(providerMode.mode, "instantly")
    : false;
  const smartleadSelected = providerMode.valid
    ? providerModeIncludes(providerMode.mode, "smartlead")
    : false;
  const selectedClient = process.env.SENDLENS_CLIENT?.trim() || null;
  const apiKey = process.env.SENDLENS_INSTANTLY_API_KEY?.trim();
  const apiKeyConfigured = Boolean(apiKey) && !isUnresolvedEnvValue(apiKey);
  const smartleadApiKey = process.env.SENDLENS_SMARTLEAD_API_KEY?.trim();
  const smartleadApiKeyConfigured =
    Boolean(smartleadApiKey) && !isUnresolvedEnvValue(smartleadApiKey);
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
  const credentialValidation = apiKeyConfigured && !demoMode && instantlySelected
    ? await validateApiKey(apiKey!)
    : null;
  const smartleadCredentialValidation =
    smartleadApiKeyConfigured && !demoMode && smartleadSelected
      ? await validateSmartleadApiKey(smartleadApiKey!)
      : null;
  const activeCacheIsDemo = refreshStatus.workspaceId === DEMO_WORKSPACE_ID;
  const envLoad = getLastLoadedSendLensEnv();
  let cacheOwner: CacheOwnerMetadata | null = null;
  let cacheReadinessError: CacheReadinessError | null = null;
  if (dbExists) {
    let db: Awaited<ReturnType<typeof getDb>> | null = null;
    try {
      db = await getDb({ timeoutMs: 1_000, retryMs: 50 });
      cacheOwner = await getCacheOwnerMetadata(db);
      await getCacheReadiness(db);
    } catch (error) {
      if (error instanceof CacheReadinessError) {
        cacheReadinessError = error;
        cacheOwner = error.cacheOwner;
      }
    } finally {
      if (db) closeDb(db);
    }
  }

  const checks: DoctorCheck[] = [];

  checks.push({
    name: "Source provider mode",
    status: providerMode.valid ? "pass" : "fail",
    message: providerMode.valid
      ? providerMode.defaulted
        ? "Source provider mode defaults to Instantly."
        : `Source provider mode is ${providerMode.mode}.`
      : providerMode.message ?? "Invalid source provider mode.",
    detail: providerMode.valid
      ? `Configured source providers: ${sourceProviders.join(", ")}. Use source_provider for data-source identity; sendlens.accounts.provider remains mailbox/email-service provider.`
      : `Received SENDLENS_PROVIDER=${providerMode.raw ?? "(empty)"}.`,
  });

  if (demoMode) {
    checks.push({
      name: "Credentials",
      status: "pass",
      message: "Demo mode enabled; production provider API keys are optional.",
    });
  } else if (!providerMode.valid) {
    checks.push({
      name: "Credentials",
      status: "fail",
      message: "Provider credentials were not checked because SENDLENS_PROVIDER is invalid.",
      detail: "Set SENDLENS_PROVIDER to instantly, smartlead, or all.",
    });
  } else {
    const instantCheckName = smartleadSelected ? "Instantly credentials" : "Credentials";
    if (instantlySelected) {
      if (apiKeyConfigured) {
        if (credentialValidation?.status === "valid") {
          checks.push({
            name: instantCheckName,
            status: "pass",
            message: "Instantly API key is configured and validated.",
            detail: `${credentialValidation.message} Secret value suppressed.`,
          });
        } else if (credentialValidation?.status === "invalid") {
          checks.push({
            name: instantCheckName,
            status: "fail",
            message: "Instantly API key is configured but Instantly rejected it.",
            detail: `${credentialValidation.message} Secret value suppressed.`,
          });
        } else {
          checks.push({
            name: instantCheckName,
            status: "warn",
            message: "Instantly API key is configured but could not be validated.",
            detail: `${credentialValidation?.message ?? "Credential probe did not complete."} Secret value suppressed.`,
          });
        }
      } else if (dbExists) {
        checks.push({
          name: instantCheckName,
          status: "warn",
          message: "Instantly API key is not set; live refresh is disabled.",
          detail: "Existing local DuckDB cache can still be used for read-only analysis.",
        });
      } else {
        checks.push({
          name: instantCheckName,
          status: "fail",
          message: "Instantly API key is not set and no local DuckDB cache exists.",
          detail: "For the fastest first run, call seed_demo_workspace now to initialize synthetic demo data. Configure SENDLENS_INSTANTLY_API_KEY later for real workspace analysis.",
        });
      }
    }

    if (smartleadSelected) {
      if (smartleadApiKeyConfigured) {
        if (smartleadCredentialValidation?.status === "valid") {
          checks.push({
            name: "Smartlead credentials",
            status: "pass",
            message: "Smartlead API key is configured and validated.",
            detail: `${smartleadCredentialValidation.message} Query-string access value suppressed. Probe URL: ${smartleadCredentialValidation.redacted_url}.`,
          });
        } else if (smartleadCredentialValidation?.status === "invalid") {
          checks.push({
            name: "Smartlead credentials",
            status: "fail",
            message: "Smartlead API key is configured but Smartlead rejected it.",
            detail: `${smartleadCredentialValidation.message} Query-string access value suppressed. Probe URL: ${smartleadCredentialValidation.redacted_url}.`,
          });
        } else {
          checks.push({
            name: "Smartlead credentials",
            status: "warn",
            message: "Smartlead API key is configured but could not be validated.",
            detail: `${smartleadCredentialValidation?.message ?? "Credential probe did not complete."} Query-string access value suppressed${smartleadCredentialValidation?.redacted_url ? `. Probe URL: ${smartleadCredentialValidation.redacted_url}.` : "."}`,
          });
        }
      } else {
        checks.push({
          name: "Smartlead credentials",
          status: "fail",
          message: `SENDLENS_SMARTLEAD_API_KEY is not set for SENDLENS_PROVIDER=${providerMode.mode}.`,
          detail: "Configure SENDLENS_SMARTLEAD_API_KEY for Smartlead read-only setup checks. Smartlead uses query-string access, so setup output and errors suppress the value.",
        });
      }
    }
  }

  checks.push({
    name: "Local DuckDB cache",
    status: dbExists ? "pass" : "warn",
    message: dbExists
      ? `Exists at ${dbPath}${dbSize ? ` (${dbSize})` : ""}.`
      : `No local DuckDB cache found at ${dbPath}.`,
  });
  if (cacheOwner || cacheReadinessError) {
    checks.push({
      name: "Cache owner",
      status: cacheReadinessError ? "fail" : "pass",
      message: cacheReadinessError
        ? cacheReadinessError.message
        : `Cache owner is compatible with the current environment${cacheOwner?.workspaceId ? ` for workspace ${cacheOwner.workspaceId}` : ""}.`,
      detail: JSON.stringify({
        schema_version: cacheOwner?.schemaVersion ?? null,
        workspace_id: cacheOwner?.workspaceId ?? null,
        client: cacheOwner?.client || null,
        owner_mode: cacheOwner?.ownerMode ?? null,
        owner_api_key_fingerprint_prefix: fingerprintPrefix(cacheOwner?.apiKeyFingerprint),
        current_api_key_fingerprint_prefix: fingerprintPrefix(currentApiKeyFingerprint()),
        context_root: cacheOwner?.contextRoot ?? null,
        db_path: cacheOwner?.dbPath ?? null,
        refreshed_at: cacheOwner?.refreshedAt ?? null,
      }),
    });
  }
  if (!demoMode && apiKeyConfigured && activeCacheIsDemo) {
    checks.push({
      name: "Active workspace",
      status: "warn",
      message: "Active local cache is the synthetic demo workspace, not live Instantly data.",
      detail: "Run refresh_data after setup to replace the active analysis workspace with live Instantly data.",
    });
  }
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
  const liveRefreshReady = credentialValidation?.status === "valid";
  const smartleadConfigReady = smartleadCredentialValidation?.status === "valid";
  const dualProviderClientMissing =
    providerMode.mode === "all" && liveRefreshReady && smartleadConfigReady && !selectedClient;
  const providerLiveRefreshReady = demoMode ||
    (providerMode.mode === "all"
      ? liveRefreshReady && smartleadConfigReady && Boolean(selectedClient)
      : (instantlySelected && liveRefreshReady) || (smartleadSelected && smartleadConfigReady));
  const noReadableCache = !dbExists || Boolean(cacheReadinessError);
  const instantlyFirstRunDemoSeedReady =
    instantlySelected && !apiKeyConfigured && noReadableCache;
  const smartleadReadOnlyDemoSeedReady =
    smartleadSelected && !instantlySelected && smartleadConfigReady && noReadableCache;
  const demoSeedReady =
    demoMode ||
    instantlyFirstRunDemoSeedReady ||
    smartleadReadOnlyDemoSeedReady ||
    (!apiKeyConfigured && !smartleadApiKeyConfigured) ||
    credentialValidation?.status === "invalid" ||
    credentialValidation?.status === "unreachable" ||
    smartleadCredentialValidation?.status === "invalid" ||
    smartleadCredentialValidation?.status === "unreachable";
  if (!providerMode.valid) {
    nextSteps.push("Set SENDLENS_PROVIDER to instantly, smartlead, or all, then restart or reload the host.");
  } else if (smartleadSelected && !smartleadApiKeyConfigured && !demoMode) {
    nextSteps.push(`Configure SENDLENS_SMARTLEAD_API_KEY before using SENDLENS_PROVIDER=${providerMode.mode}.`);
    nextSteps.push("Smartlead access is passed as a query-string parameter by Smartlead; SendLens setup output suppresses the value.");
  } else if (smartleadSelected && smartleadCredentialValidation?.status === "invalid") {
    nextSteps.push("Update SENDLENS_SMARTLEAD_API_KEY with a valid Smartlead API key, then restart or reload the host.");
    nextSteps.push("Do not paste the Smartlead key into chat or logs; it is a query-string access value.");
  } else if (smartleadSelected && smartleadCredentialValidation?.status === "unreachable") {
    nextSteps.push("Retry /sendlens-setup after Smartlead connectivity is healthy; the configured Smartlead value was suppressed from the probe output.");
  } else if (smartleadReadOnlyDemoSeedReady) {
    nextSteps.push("Smartlead provider configuration is ready. Run refresh_data now to pull read-only Smartlead campaign, account, lead, analytics, and bounded message-history evidence.");
    nextSteps.push("No readable cache was found. Run refresh_data before real analysis, or call seed_demo_workspace only when you intentionally want synthetic proof data.");
  } else if (cacheReadinessError) {
    nextSteps.push("Run refresh_data now to rebuild and stamp the local cache for the currently configured Instantly API key.");
    nextSteps.push("Unset SENDLENS_INSTANTLY_API_KEY before starting the host only if you intentionally want to inspect the preserved legacy cache.");
  } else if (smartleadSelected && !instantlySelected && smartleadConfigReady) {
    nextSteps.push("Smartlead provider configuration is ready. Use workspace_snapshot against the existing local cache, or run refresh_data when you explicitly need a fresh Smartlead pull.");
  } else if (instantlySelected && !apiKeyConfigured && !demoMode && dbExists) {
    nextSteps.push("Use workspace_snapshot or analysis skills against the existing local cache.");
    nextSteps.push("Configure SENDLENS_INSTANTLY_API_KEY before running refresh_data for fresh Instantly data.");
  } else if (instantlySelected && !apiKeyConfigured && !demoMode) {
    nextSteps.push("Call seed_demo_workspace now for a zero-key synthetic demo workspace.");
    nextSteps.push("Configure SENDLENS_INSTANTLY_API_KEY later when you want real Instantly workspace analysis.");
  } else if (instantlySelected && apiKeyConfigured && credentialValidation?.status === "invalid") {
    nextSteps.push("Update SENDLENS_INSTANTLY_API_KEY with a valid Instantly API key, then restart or reload the host.");
    nextSteps.push("For the demo, call seed_demo_workspace now to use synthetic data while the key is fixed.");
  } else if (instantlySelected && apiKeyConfigured && credentialValidation?.status === "unreachable") {
    nextSteps.push("Retry /sendlens-setup or run refresh_data after network access to Instantly is healthy.");
    nextSteps.push("For the demo, call seed_demo_workspace now to use synthetic data while Instantly is unreachable.");
  } else if (dualProviderClientMissing) {
    nextSteps.push("Set SENDLENS_CLIENT before running refresh_data with SENDLENS_PROVIDER=all so Instantly and Smartlead refreshes write the same named local workspace.");
  } else if (providerMode.mode === "all" && liveRefreshReady && smartleadConfigReady) {
    nextSteps.push("Run refresh_data now to pull live Instantly and read-only Smartlead data into the current client workspace.");
  } else if (!demoMode && liveRefreshReady && activeCacheIsDemo) {
    nextSteps.push("Run refresh_data now to pull live Instantly data and switch the active workspace away from demo_workspace.");
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
      source_provider_mode: providerMode.mode,
      source_providers: sourceProviders,
      source_provider_config_valid: providerMode.valid,
      local_cache_read: dbExists && !cacheReadinessError,
      live_refresh: providerLiveRefreshReady,
      demo_seed: demoSeedReady,
      instantly_key_configured: apiKeyConfigured,
      instantly_key_validated: credentialValidation?.status === "valid",
      smartlead_key_configured: smartleadApiKeyConfigured,
      smartlead_key_validated: smartleadCredentialValidation?.status === "valid",
    },
    cache_freshness: cacheFreshness,
    paths: {
      plugin_root: root,
      context_root: envLoad?.contextRoot ?? process.env.SENDLENS_CONTEXT_ROOT ?? process.cwd(),
      selected_client: selectedClient,
      clients_dir: envLoad?.clientsDir ?? path.resolve(process.cwd(), ".env.clients"),
      loaded_env_files: envLoad?.loaded ?? [],
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
