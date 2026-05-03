import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const localDbModulePath = path.resolve("build/plugin/local-db.js");
const {
  closeDb,
  getDb,
  isDuckDbLockError,
  LocalDbUnavailableError,
  resetDbConnectionForTests,
} = require("../build/plugin/local-db.js");

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sendlens-lock-"));
const dbPath = path.join(tempDir, "workspace-cache.duckdb");
process.env.SENDLENS_DB_PATH = dbPath;

assert.equal(
  isDuckDbLockError(
    new Error("IO Error: Could not set lock on file: Conflicting lock is held"),
  ),
  true,
);
assert.equal(
  isDuckDbLockError(
    new Error(
      "Failure while replaying WAL file /Users/example/.sendlens/workspace-cache.duckdb.wal",
    ),
  ),
  true,
);
assert.equal(isDuckDbLockError(new Error("Parser Error: syntax error")), false);

await resetDbConnectionForTests();
const initialDb = await getDb({ timeoutMs: 1_000, retryMs: 25 });
closeDb(initialDb);

const retryHolder = await startLockHolder(450);
const retryStartedAt = Date.now();
const retriedDb = await getDb({ timeoutMs: 2_000, retryMs: 50 });
const retryElapsedMs = Date.now() - retryStartedAt;
closeDb(retriedDb);
assert.ok(
  retryElapsedMs >= 150,
  `expected getDb to wait for the held DuckDB lock, waited ${retryElapsedMs}ms`,
);
await assertHolderExited(retryHolder);

const timeoutHolder = await startLockHolder(700);
await assert.rejects(
  () => getDb({ timeoutMs: 100, retryMs: 25 }),
  (error) =>
    error instanceof LocalDbUnavailableError &&
    error.code === "duckdb_unavailable" &&
    /temporarily unavailable/.test(error.message),
);
await assertHolderExited(timeoutHolder);

const reopenedDb = await getDb({ timeoutMs: 1_000, retryMs: 25 });
closeDb(reopenedDb);

console.log("db lock retry tests passed");

async function startLockHolder(holdMs) {
  const childSource = `
    const { closeDb, getDb } = require(${JSON.stringify(localDbModulePath)});
    (async () => {
      const db = await getDb({ timeoutMs: 1000, retryMs: 25 });
      process.stdout.write("ready\\n");
      await new Promise((resolve) => setTimeout(resolve, Number(process.env.SENDLENS_LOCK_HOLD_MS)));
      closeDb(db);
    })().catch((error) => {
      console.error(error && error.stack ? error.stack : String(error));
      process.exit(1);
    });
  `;
  const child = spawn(process.execPath, ["-e", childSource], {
    env: {
      ...process.env,
      SENDLENS_DB_PATH: dbPath,
      SENDLENS_LOCK_HOLD_MS: String(holdMs),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderrChunks = [];
  const exitPromise = once(child, "exit");
  child.stderr.on("data", (chunk) => stderrChunks.push(String(chunk)));
  await waitForReady(child, stderrChunks, exitPromise);
  return { child, stderrChunks, exitPromise };
}

async function waitForReady(child, stderrChunks, exitPromise) {
  let stdout = "";
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for lock holder. stderr: ${stderrChunks.join("")}`,
        ),
      );
    }, 2_000);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.includes("ready")) {
        clearTimeout(timeout);
        resolve();
      }
    });

    exitPromise.then(([code, signal]) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Lock holder exited before ready: code=${code} signal=${signal} stderr=${stderrChunks.join("")}`,
        ),
      );
    });
  });
}

async function assertHolderExited({ stderrChunks, exitPromise }) {
  const [code, signal] = await exitPromise;
  assert.equal(
    code,
    0,
    `lock holder failed: code=${code} signal=${signal} stderr=${stderrChunks.join("")}`,
  );
}
