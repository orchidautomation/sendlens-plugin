import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sendlens-launch-lock-"));
const stateDir = path.join(tempRoot, "state");
const markerPath = path.join(tempRoot, "refreshes.txt");

function runHook(env) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [path.join(tempRoot, "scripts/session-start.sh")], { env });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stderr }));
  });
}

try {
  await mkdir(path.join(tempRoot, "scripts"), { recursive: true });
  await mkdir(path.join(tempRoot, "build/plugin"), { recursive: true });
  await cp(path.join(root, "scripts/session-start.sh"), path.join(tempRoot, "scripts/session-start.sh"));
  await cp(path.join(root, "scripts/load-env.sh"), path.join(tempRoot, "scripts/load-env.sh"));
  await writeFile(path.join(tempRoot, "build/plugin/refresh-cli.js"), `const fs = require("node:fs");\nfs.appendFileSync(process.env.SENDLENS_TEST_MARKER, "refresh\\n");\nsetTimeout(() => process.exit(0), 1500);\n`);

  const env = {
    ...process.env,
    PLUGIN_ROOT: tempRoot,
    SENDLENS_CONTEXT_ROOT: tempRoot,
    SENDLENS_DB_PATH: path.join(tempRoot, "cache.duckdb"),
    SENDLENS_STATE_DIR: stateDir,
    SENDLENS_PROVIDER: "instantly",
    SENDLENS_INSTANTLY_API_KEY: "test-key",
    SENDLENS_RUNTIME_BOOTSTRAPPED: "1",
    SENDLENS_TEST_MARKER: markerPath,
  };
  const first = runHook(env);
  const lockDir = path.join(stateDir, "session-start-refresh.lock");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await stat(markerPath);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  const results = await Promise.all([first, runHook(env)]);
  assert.deepEqual(results.map((result) => result.code), [0, 0]);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await stat(lockDir);
      await new Promise((resolve) => setTimeout(resolve, 20));
    } catch {
      break;
    }
  }
  const marker = await readFile(markerPath, "utf8");
  assert.deepEqual(marker.trim().split("\n"), ["refresh"]);
  console.log("refresh launch lock test passed");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
