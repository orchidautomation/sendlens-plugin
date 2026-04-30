import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type TracePayload = Record<string, unknown>;

function resolveStateDir() {
  const override = process.env.SENDLENS_STATE_DIR?.trim();
  if (override) {
    return path.isAbsolute(override)
      ? override
      : path.resolve(process.cwd(), override);
  }
  const dbPath = process.env.SENDLENS_DB_PATH?.trim();
  if (dbPath) {
    const resolved = path.isAbsolute(dbPath)
      ? dbPath
      : path.resolve(process.cwd(), dbPath);
    return path.dirname(resolved);
  }
  return path.join(os.homedir(), ".sendlens");
}

export function isTraceEnabled() {
  const value = process.env.SENDLENS_TRACE_REFRESH?.trim()?.toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function getTraceLogPath() {
  return path.join(resolveStateDir(), "refresh-trace.log");
}

export async function clearTraceLog() {
  if (!isTraceEnabled()) return;
  await fs.mkdir(resolveStateDir(), { recursive: true });
  await fs.rm(getTraceLogPath(), { force: true });
}

export async function appendTraceLog(event: string, payload: TracePayload = {}) {
  if (!isTraceEnabled()) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    pid: process.pid,
    event,
    ...payload,
  });
  await fs.mkdir(resolveStateDir(), { recursive: true });
  await fs.appendFile(getTraceLogPath(), `${line}\n`, "utf8");
}
