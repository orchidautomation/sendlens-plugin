#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tempRoots = [];

async function tempDir(prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

async function makeGeneratedBundleFixture({
  dependencies = { "fixture-runtime": "1.0.0" },
} = {}) {
  const bundleRoot = await tempDir("sendlens-runtime-bootstrap-");
  const scriptsDir = path.join(bundleRoot, "scripts");
  await mkdir(scriptsDir, { recursive: true });
  await cp(
    path.join(root, "scripts", "bootstrap-runtime.sh"),
    path.join(scriptsDir, "bootstrap-runtime.sh"),
  );
  await cp(
    path.join(root, "scripts", "runtime-dependencies.cjs"),
    path.join(scriptsDir, "runtime-dependencies.cjs"),
  );
  await writeFile(
    path.join(scriptsDir, "runtime-dependencies.lock.json"),
    `${JSON.stringify({ generatedFrom: "test", dependencies }, null, 2)}\n`,
  );

  const binDir = path.join(bundleRoot, "bin");
  await mkdir(binDir, { recursive: true });
  const npmPath = path.join(binDir, "npm");
  await writeFile(
    npmPath,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "\${SENDLENS_TEST_NPM_LOG}"
sleep "\${SENDLENS_TEST_NPM_SLEEP:-0}"
for spec in "$@"; do
  case "$spec" in
    fixture-runtime@*)
      mkdir -p "$PWD/node_modules/fixture-runtime"
      printf 'module.exports = {};\\n' > "$PWD/node_modules/fixture-runtime/index.js"
      printf '{"name":"fixture-runtime","version":"%s"}\\n' "\${spec#fixture-runtime@}" > "$PWD/node_modules/fixture-runtime/package.json"
      ;;
  esac
done
`,
  );
  await chmod(npmPath, 0o755);

  return { bundleRoot, binDir };
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    ...options,
    env: {
      ...process.env,
      ...options.env,
    },
  });
}

function runAsync(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      ...options,
      env: {
        ...process.env,
        ...options.env,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function testDependencyMetadataIsCurrent() {
  const result = run("node", ["scripts/runtime-dependencies.cjs", "assert-current"], {
    cwd: root,
  });
  assert.equal(result.status, 0, result.stderr);

  const specs = run("node", ["scripts/runtime-dependencies.cjs", "specs"], {
    cwd: root,
  });
  assert.equal(specs.status, 0, specs.stderr);
  assert.match(specs.stdout, /@duckdb\/node-api@1\.5\.1-r\.2/);
  assert.match(specs.stdout, /@modelcontextprotocol\/sdk@1\.29\.0/);
  assert.match(specs.stdout, /node-sql-parser@5\.4\.0/);
  assert.match(specs.stdout, /zod@4\.4\.1/);
}

async function testMissingGeneratedBundleDependenciesFailBeforeStartup() {
  const cases = [
    ["@duckdb/node-api", "1.5.1-r.2"],
    ["@modelcontextprotocol/sdk", "1.29.0"],
    ["node-sql-parser", "5.4.0"],
    ["zod", "4.4.1"],
  ];

  for (const [dependency, version] of cases) {
    const { bundleRoot } = await makeGeneratedBundleFixture({
      dependencies: { [dependency]: version },
    });
    const result = run(
      "node",
      [path.join(bundleRoot, "scripts", "runtime-dependencies.cjs"), "verify", bundleRoot],
      { cwd: bundleRoot },
    );

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      new RegExp(`Missing or incompatible ${escapeRegExp(dependency)}@${escapeRegExp(version)}`),
    );
    assert.doesNotMatch(result.stderr, new RegExp(escapeRegExp(bundleRoot)));
  }
}

async function testWrongGeneratedBundleDependencyVersionFails() {
  const { bundleRoot } = await makeGeneratedBundleFixture({
    dependencies: { "fixture-runtime": "1.0.0" },
  });
  const moduleDir = path.join(bundleRoot, "node_modules", "fixture-runtime");
  await mkdir(moduleDir, { recursive: true });
  await writeFile(path.join(moduleDir, "index.js"), "module.exports = {};\n");
  await writeFile(
    path.join(moduleDir, "package.json"),
    '{"name":"fixture-runtime","version":"0.9.0"}\n',
  );

  const result = run(
    "node",
    [path.join(bundleRoot, "scripts", "runtime-dependencies.cjs"), "verify", bundleRoot],
    { cwd: bundleRoot },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Incompatible fixture-runtime: expected 1\.0\.0, found 0\.9\.0/);
}

async function testStaleLockRecoversAndInstalls() {
  const { bundleRoot, binDir } = await makeGeneratedBundleFixture();
  const lockDir = path.join(bundleRoot, ".runtime-bootstrap.lock");
  await mkdir(lockDir);
  await writeFile(
    path.join(lockDir, "owner.env"),
    `pid=999999
started_at=${Math.floor(Date.now() / 1000) - 10}
timeout_seconds=3
stale_seconds=1
`,
  );
  const npmLog = path.join(bundleRoot, "npm.log");
  const result = run("bash", [path.join(bundleRoot, "scripts", "bootstrap-runtime.sh")], {
    cwd: bundleRoot,
    env: {
      PATH: `${binDir}:${process.env.PATH}`,
      PLUGIN_ROOT: bundleRoot,
      SENDLENS_TEST_NPM_LOG: npmLog,
      SENDLENS_RUNTIME_BOOTSTRAP_LOCK_TIMEOUT_SECONDS: "3",
      SENDLENS_RUNTIME_BOOTSTRAP_LOCK_STALE_SECONDS: "1",
    },
  });

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /Recovering stale runtime bootstrap lock older than 1s/);
  assert.match(await readFile(npmLog, "utf8"), /fixture-runtime@1\.0\.0/);
}

async function testConcurrentStaleLockRecoveryInstallsOnce() {
  const { bundleRoot, binDir } = await makeGeneratedBundleFixture();
  const lockDir = path.join(bundleRoot, ".runtime-bootstrap.lock");
  await mkdir(lockDir);
  await writeFile(
    path.join(lockDir, "owner.env"),
    `pid=999999\nstarted_at=${Math.floor(Date.now() / 1000) - 10}\ntimeout_seconds=5\nstale_seconds=1\n`,
  );
  const npmLog = path.join(bundleRoot, "npm.log");
  const command = path.join(bundleRoot, "scripts", "bootstrap-runtime.sh");
  const env = {
    PATH: `${binDir}:${process.env.PATH}`,
    PLUGIN_ROOT: bundleRoot,
    SENDLENS_TEST_NPM_LOG: npmLog,
    SENDLENS_TEST_NPM_SLEEP: "0.5",
    SENDLENS_RUNTIME_BOOTSTRAP_LOCK_TIMEOUT_SECONDS: "5",
    SENDLENS_RUNTIME_BOOTSTRAP_LOCK_STALE_SECONDS: "1",
  };

  const results = await Promise.all(
    Array.from({ length: 6 }, () => runAsync("bash", [command], { cwd: bundleRoot, env })),
  );
  for (const result of results) {
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  }
  const installs = (await readFile(npmLog, "utf8")).trim().split("\n").filter(Boolean);
  assert.equal(installs.length, 1, "concurrent stale-lock waiters must allow only one npm install");
  const recoveryCount = results.reduce(
    (count, result) => count + Number(/Recovering stale runtime bootstrap lock/.test(result.stderr)),
    0,
  );
  assert.equal(recoveryCount, 1, "only one waiter may recover the observed stale lock");
}

async function testOldLiveLockTimesOutWithoutRecovery() {
  const { bundleRoot, binDir } = await makeGeneratedBundleFixture();
  const sleeper = spawn("node", ["-e", "setTimeout(() => {}, 5000)"], {
    stdio: "ignore",
  });
  try {
    const lockDir = path.join(bundleRoot, ".runtime-bootstrap.lock");
    await mkdir(lockDir);
    await writeFile(
      path.join(lockDir, "owner.env"),
      `pid=${sleeper.pid}
started_at=${Math.floor(Date.now() / 1000) - 10}
timeout_seconds=1
stale_seconds=1
`,
    );
    const result = run("bash", [path.join(bundleRoot, "scripts", "bootstrap-runtime.sh")], {
      cwd: bundleRoot,
      env: {
        PATH: `${binDir}:${process.env.PATH}`,
        PLUGIN_ROOT: bundleRoot,
        SENDLENS_TEST_NPM_LOG: path.join(bundleRoot, "npm.log"),
        SENDLENS_RUNTIME_BOOTSTRAP_LOCK_TIMEOUT_SECONDS: "1",
        SENDLENS_RUNTIME_BOOTSTRAP_LOCK_STALE_SECONDS: "1",
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Runtime bootstrap lock was not released within 1s/);
    assert.doesNotMatch(result.stderr, /Recovering stale runtime bootstrap lock/);
    try {
      assert.equal(await readFile(path.join(bundleRoot, "npm.log"), "utf8"), "");
    } catch (error) {
      assert.equal(error.code, "ENOENT");
    }
  } finally {
    sleeper.kill();
  }
}

async function testInvalidLockConfigFailsActionably() {
  for (const [name, value] of [
    ["SENDLENS_RUNTIME_BOOTSTRAP_LOCK_TIMEOUT_SECONDS", "nope"],
    ["SENDLENS_RUNTIME_BOOTSTRAP_LOCK_STALE_SECONDS", "0"],
  ]) {
    const { bundleRoot, binDir } = await makeGeneratedBundleFixture();
    const result = run("bash", [path.join(bundleRoot, "scripts", "bootstrap-runtime.sh")], {
      cwd: bundleRoot,
      env: {
        PATH: `${binDir}:${process.env.PATH}`,
        PLUGIN_ROOT: bundleRoot,
        SENDLENS_TEST_NPM_LOG: path.join(bundleRoot, "npm.log"),
        [name]: value,
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      new RegExp(`${name} must be a positive integer`),
    );
  }
}

try {
  await testDependencyMetadataIsCurrent();
  await testMissingGeneratedBundleDependenciesFailBeforeStartup();
  await testWrongGeneratedBundleDependencyVersionFails();
  await testStaleLockRecoversAndInstalls();
  await testConcurrentStaleLockRecoveryInstallsOnce();
  await testOldLiveLockTimesOutWithoutRecovery();
  await testInvalidLockConfigFailsActionably();
  console.log("Runtime bootstrap tests passed.");
} finally {
  await Promise.all(tempRoots.map((dir) => rm(dir, { recursive: true, force: true })));
}
