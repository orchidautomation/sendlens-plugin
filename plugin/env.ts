import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type EnvMap = Record<string, string>;
export type LoadedSendLensEnv = {
  client: string | undefined;
  clientsDir: string;
  contextRoot: string;
  loaded: string[];
};

let lastLoadedSendLensEnv: LoadedSendLensEnv | null = null;

function parseEnvFile(filePath: string): EnvMap {
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
    value = expandEnvValue(value);
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

function applyEnv(values: EnvMap, lockedKeys: Set<string>) {
  for (const [key, value] of Object.entries(values)) {
    if (lockedKeys.has(key)) continue;
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
    trimmed === "instantly_api_key"
  );
}

function sanitizeSendLensEnv() {
  if (isUnresolvedEnvValue(process.env.SENDLENS_INSTANTLY_API_KEY)) {
    delete process.env.SENDLENS_INSTANTLY_API_KEY;
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

  for (const filePath of initial.basePaths) {
    if (!fs.existsSync(filePath)) continue;
    applyEnv(parseEnvFile(filePath), lockedKeys);
    loaded.push(filePath);
  }

  const resolved = getClientEnvPaths(rootDir);
  for (const filePath of resolved.clientPaths) {
    if (!fs.existsSync(filePath)) continue;
    applyEnv(parseEnvFile(filePath), lockedKeys);
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

export function getLastLoadedSendLensEnv() {
  return lastLoadedSendLensEnv;
}
