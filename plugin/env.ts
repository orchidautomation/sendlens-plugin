import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  isUnresolvedProviderMode,
  type ProviderModeResolution,
  providerModeIncludes,
  resolveSourceProviderMode,
} from "./provider-config";

type EnvMap = Record<string, string>;
export type LoadedSendLensEnv = {
  client: string | undefined;
  clientsDir: string;
  contextRoot: string;
  loaded: string[];
};
export type SelectedClientEnvIdentity = {
  client: string;
  clientsDir: string;
  loaded: string[];
  apiKeyFingerprint: string | null;
  apiKeyFingerprintPrefix: string | null;
  configuredKeys: string[];
};

let lastLoadedSendLensEnv: LoadedSendLensEnv | null = null;

const SENDLENS_CLIENT_LOCKED_KEYS = new Set([
  "SENDLENS_CLIENT",
  "SENDLENS_CLIENTS_DIR",
  "SENDLENS_CONTEXT_ROOT",
]);
const SENDLENS_CONTAINER_LOCKED_KEYS = new Set([
  "SENDLENS_CONTAINER",
  "SENDLENS_TRANSPORT",
  "SENDLENS_DATA_DIR",
  "SENDLENS_DB_PATH",
  "SENDLENS_STATE_DIR",
  "SENDLENS_CLIENTS_DIR",
  "SENDLENS_CONTEXT_ROOT",
  "SENDLENS_HTTP_HOST",
  "SENDLENS_HTTP_PORT",
  "SENDLENS_HTTP_BEARER_TOKEN",
  "SENDLENS_HTTP_ALLOWED_HOSTS",
  "SENDLENS_HTTP_ALLOWED_ORIGINS",
  "SENDLENS_HTTP_MAX_SESSIONS",
  "SENDLENS_DEMO_MODE",
]);
const SENDLENS_PROVIDER_SECRET_KEYS = [
  "SENDLENS_INSTANTLY_API_KEY",
  "SENDLENS_SMARTLEAD_API_KEY",
] as const;

function isSendLensClientOverrideKey(key: string) {
  if (!key.startsWith("SENDLENS_") || SENDLENS_CLIENT_LOCKED_KEYS.has(key)) {
    return false;
  }
  if (isEnabledEnvValue(process.env.SENDLENS_CONTAINER) && SENDLENS_CONTAINER_LOCKED_KEYS.has(key)) {
    return false;
  }
  return true;
}

function isEnabledEnvValue(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseEnvFile(
  filePath: string,
  expandValues = !isEnabledEnvValue(process.env.SENDLENS_CONTAINER),
): EnvMap {
  const content = fs.readFileSync(filePath, "utf8");
  const values: EnvMap = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const exportLine = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = exportLine.indexOf("=");
    if (eq <= 0) continue;
    const key = exportLine.slice(0, eq).trim();
    let value = exportLine.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\\n/g, "\n");
    if (expandValues) {
      value = expandEnvValue(value);
    }
    values[key] = value;
  }

  return values;
}

function expandEnvValue(value: string) {
  return value.replace(/\$(\w+)|\$\{([^}]+)\}/g, (_match, simpleName, bracedName) => {
    const name = simpleName ?? bracedName;
    if (!name) return "";
    if (name === "HOME") {
      return process.env.HOME ?? os.homedir();
    }
    return process.env[name] ?? "";
  });
}

function applyEnv(values: EnvMap, lockedKeys: Set<string>, overrideKeys = new Set<string>()) {
  for (const [key, value] of Object.entries(values)) {
    if (lockedKeys.has(key) && !overrideKeys.has(key)) continue;
    process.env[key] = value;
  }
}

export function isUnresolvedEnvValue(value: string | undefined | null) {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return false;
  return (
    trimmed.includes("+ name +") ||
    trimmed.includes("${") ||
    trimmed.includes("{{") ||
    trimmed.includes("}}") ||
    trimmed === "your_key" ||
    trimmed === "your-api-key" ||
    trimmed === "your_api_key" ||
    trimmed === "your-instantly-api-key" ||
    trimmed === "your_instantly_api_key" ||
    trimmed === "your-smartlead-api-key" ||
    trimmed === "your_smartlead_api_key" ||
    trimmed === "instantly_api_key"
  );
}

function sanitizeSendLensEnv() {
  if (isUnresolvedEnvValue(process.env.SENDLENS_INSTANTLY_API_KEY)) {
    delete process.env.SENDLENS_INSTANTLY_API_KEY;
  }
  if (isUnresolvedEnvValue(process.env.SENDLENS_SMARTLEAD_API_KEY)) {
    delete process.env.SENDLENS_SMARTLEAD_API_KEY;
  }
  if (isUnresolvedProviderMode(process.env.SENDLENS_PROVIDER)) {
    delete process.env.SENDLENS_PROVIDER;
  }
}

export function getClientEnvPaths(rootDir = process.cwd()) {
  const clientsDir = process.env.SENDLENS_CLIENTS_DIR?.trim()
    ? path.resolve(rootDir, process.env.SENDLENS_CLIENTS_DIR)
    : path.resolve(rootDir, ".env.clients");
  const client = process.env.SENDLENS_CLIENT?.trim();

  return {
    client,
    clientsDir,
    basePaths: [
      path.resolve(rootDir, ".env"),
      path.resolve(rootDir, ".env.local"),
    ],
    clientPaths: client
      ? [
        path.join(clientsDir, `${client}.env`),
        path.join(clientsDir, `${client}.local.env`),
      ]
      : [],
  };
}

export function loadClientEnv(rootDir = process.cwd()) {
  const initial = getClientEnvPaths(rootDir);
  const loaded: string[] = [];
  const lockedKeys = new Set(
    Object.entries(process.env)
      .filter(([, value]) => value != null)
      .map(([key]) => key),
  );
  if (isEnabledEnvValue(process.env.SENDLENS_CONTAINER)) {
    for (const key of SENDLENS_CONTAINER_LOCKED_KEYS) lockedKeys.add(key);
  }

  for (const filePath of initial.basePaths) {
    if (!fs.existsSync(filePath)) continue;
    applyEnv(parseEnvFile(filePath), lockedKeys);
    loaded.push(filePath);
  }

  const resolved = getClientEnvPaths(rootDir);
  for (const filePath of resolved.clientPaths) {
    if (!fs.existsSync(filePath)) continue;
    const values = parseEnvFile(filePath);
    const clientOverrideKeys = new Set(
      Object.keys(values).filter((key) => isSendLensClientOverrideKey(key)),
    );
    applyEnv(values, lockedKeys, resolved.client ? clientOverrideKeys : new Set());
    loaded.push(filePath);
  }

  sanitizeSendLensEnv();

  const result = {
    client: resolved.client,
    clientsDir: resolved.clientsDir,
    contextRoot: path.resolve(rootDir),
    loaded,
  };
  lastLoadedSendLensEnv = result;
  return result;
}

export function loadSendLensEnv() {
  const rootDir = process.env.SENDLENS_CONTEXT_ROOT?.trim()
    ? path.resolve(process.env.SENDLENS_CONTEXT_ROOT)
    : process.cwd();
  return loadClientEnv(rootDir);
}

export function assertContainerStartupReady(env: NodeJS.ProcessEnv = process.env) {
  if (!isEnabledEnvValue(env.SENDLENS_CONTAINER) || isEnabledEnvValue(env.SENDLENS_DEMO_MODE)) {
    return;
  }

  const providerMode = env.SENDLENS_PROVIDER?.trim().toLowerCase();
  const instantlyConfigured = Boolean(env.SENDLENS_INSTANTLY_API_KEY?.trim());
  const smartleadConfigured = Boolean(env.SENDLENS_SMARTLEAD_API_KEY?.trim());
  const hasProviderCredential = providerMode === "instantly"
    ? instantlyConfigured
    : providerMode === "smartlead"
      ? smartleadConfigured
      : providerMode === "all" || !providerMode
        ? instantlyConfigured || smartleadConfigured
        : false;
  const dbPath = env.SENDLENS_DB_PATH?.trim();
  if (hasProviderCredential || (dbPath && fs.existsSync(dbPath))) {
    return;
  }

  throw new Error(
    "Set a provider API key, enable SENDLENS_DEMO_MODE=1 for synthetic proof data, "
    + "or mount an existing SendLens DuckDB cache at SENDLENS_DB_PATH.",
  );
}

export function getLastLoadedSendLensEnv() {
  return lastLoadedSendLensEnv;
}

function providerSecretFingerprint(
  values: EnvMap,
  providerMode: ProviderModeResolution = resolveSourceProviderMode(),
) {
  const fingerprints: Array<{ provider: "instantly" | "smartlead"; value: string }> = [];
  const instantlyKey = values.SENDLENS_INSTANTLY_API_KEY?.trim();
  const smartleadKey = values.SENDLENS_SMARTLEAD_API_KEY?.trim();

  if (
    (!providerMode.valid || providerModeIncludes(providerMode.mode, "instantly")) &&
    instantlyKey &&
    !isUnresolvedEnvValue(instantlyKey)
  ) {
    fingerprints.push({ provider: "instantly", value: instantlyKey });
  }
  if (
    providerMode.valid &&
    providerModeIncludes(providerMode.mode, "smartlead") &&
    smartleadKey &&
    !isUnresolvedEnvValue(smartleadKey)
  ) {
    fingerprints.push({ provider: "smartlead", value: smartleadKey });
  }

  if (fingerprints.length === 0) return null;
  if (fingerprints.length === 1 && fingerprints[0].provider === "instantly") {
    return createHash("sha256").update(fingerprints[0].value, "utf8").digest("hex");
  }

  return createHash("sha256")
    .update(fingerprints.map(({ provider, value }) => `${provider}:${value}`).join("\n"), "utf8")
    .digest("hex");
}

export function getSelectedClientEnvIdentity(
  rootDir = process.cwd(),
  providerMode: ProviderModeResolution = resolveSourceProviderMode(),
): SelectedClientEnvIdentity | null {
  const resolved = getClientEnvPaths(rootDir);
  if (!resolved.client) return null;

  const values: EnvMap = {};
  const loaded: string[] = [];
  for (const filePath of resolved.clientPaths) {
    if (!fs.existsSync(filePath)) continue;
    Object.assign(values, parseEnvFile(filePath));
    loaded.push(filePath);
  }
  if (loaded.length === 0) return null;

  const configuredKeys = SENDLENS_PROVIDER_SECRET_KEYS.filter((key) => {
    const value = values[key]?.trim();
    return value && !isUnresolvedEnvValue(value);
  });
  const apiKeyFingerprint = providerSecretFingerprint(values, providerMode);

  return {
    client: resolved.client,
    clientsDir: resolved.clientsDir,
    loaded,
    apiKeyFingerprint,
    apiKeyFingerprintPrefix: apiKeyFingerprint ? apiKeyFingerprint.slice(0, 12) : null,
    configuredKeys,
  };
}
