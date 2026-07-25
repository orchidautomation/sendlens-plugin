#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoots = [];

async function tempDir(prefix) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(directory);
  return directory;
}

async function exists(filepath) {
  try {
    await stat(filepath);
    return true;
  } catch {
    return false;
  }
}

function loadConfig(contextRoot, assertions, processOverrides = {}, loaderRoot = root) {
  return spawnSync(
    "bash",
    [
      "-c",
      ['set -euo pipefail', 'source "$1/scripts/load-env.sh"', assertions].join("\n"),
      "sendlens-config-test",
      loaderRoot,
    ],
    {
      cwd: contextRoot,
      encoding: "utf8",
      env: {
        HOME: os.homedir(),
        PATH: process.env.PATH,
        SENDLENS_CONTEXT_ROOT: contextRoot,
        ...processOverrides,
      },
    },
  );
}

function assertSucceeded(result, label) {
  assert.equal(
    result.status,
    0,
    `${label} failed with exit ${result.status}; output is intentionally suppressed to avoid config-value leakage`,
  );
}

async function waitFor(filepath, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await exists(filepath)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return exists(filepath);
}

function assertSensitiveOutputSuppressed(result, sentinel) {
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(output.includes(sentinel), false, "diagnostics must never expose raw values");
  assert.equal(output.includes("must-not-exist"), false, "diagnostics must never expose raw lines");
  assert.equal(output.includes(" at line "), false, "diagnostics must not identify sensitive line numbers");
}

try {
  const overlayRoot = await tempDir("sendlens-safe-config-overlay-");
  await mkdir(path.join(overlayRoot, "config", "clients"), { recursive: true });
  await writeFile(
    path.join(overlayRoot, ".env"),
    [
      "SENDLENS_CLIENT=acme",
      "SENDLENS_CLIENTS_DIR=config/clients",
      'SENDLENS_INSTANTLY_API_KEY="base value"',
      "SENDLENS_DB_PATH=$HOME/.sendlens/base db.duckdb",
      "export SENDLENS_PROVIDER=instantly",
      "UNRELATED_ENV=must-not-load",
      "",
    ].join("\r\n"),
  );
  await writeFile(
    path.join(overlayRoot, ".env.local"),
    [
      "SENDLENS_INSTANTLY_API_KEY=local-value # local override",
      "SENDLENS_SMARTLEAD_API_KEY=left=right # first equals wins",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(overlayRoot, "config", "clients", "acme.env"),
    [
      "SENDLENS_INSTANTLY_API_KEY=client-value",
      'SENDLENS_STATE_DIR="/tmp/client state"',
      "SENDLENS_CLIENT=must-not-change",
      "SENDLENS_CLIENTS_DIR=/tmp/must-not-change",
      'SENDLENS_DEMO_MODE="yes # literal hash"',
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(overlayRoot, "config", "clients", "acme.local.env"),
    [
      "export SENDLENS_INSTANTLY_API_KEY='client local value'",
      "SENDLENS_SMARTLEAD_API_KEY=",
      "",
    ].join("\n"),
  );

  const overlayResult = loadConfig(
    overlayRoot,
    [
      '[[ "${SENDLENS_CLIENT:-}" == "acme" ]]',
      '[[ "${SENDLENS_CLIENTS_DIR:-}" == "config/clients" ]]',
      '[[ "${SENDLENS_INSTANTLY_API_KEY:-}" == "client local value" ]]',
      '[[ "${SENDLENS_SMARTLEAD_API_KEY+x}" == "x" ]]',
      '[[ -z "${SENDLENS_SMARTLEAD_API_KEY}" ]]',
      '[[ "${SENDLENS_DB_PATH:-}" == "${HOME}/.sendlens/base db.duckdb" ]]',
      '[[ "${SENDLENS_STATE_DIR:-}" == "/tmp/client state" ]]',
      '[[ "${SENDLENS_PROVIDER:-}" == "instantly" ]]',
      '[[ "$(source_provider_mode)" == "instantly" ]]',
      'validate_source_provider "$(source_provider_mode)"',
      '[[ "${SENDLENS_DEMO_MODE:-}" == "yes # literal hash" ]]',
      '[[ -z "${UNRELATED_ENV:-}" ]]',
    ].join("\n"),
  );
  assertSucceeded(overlayResult, "safe dotenv and overlay precedence");

  const homePathRoot = await tempDir("sendlens-safe-config-home-paths-");
  await writeFile(
    path.join(homePathRoot, ".env"),
    [
      'SENDLENS_DB_PATH="$HOME/.sendlens/home-db.duckdb"',
      'SENDLENS_STATE_DIR="${HOME}/.sendlens/home-state"',
      "",
    ].join("\n"),
  );
  const homePathResult = loadConfig(
    homePathRoot,
    [
      '[[ "${SENDLENS_DB_PATH:-}" == "${HOME}/.sendlens/home-db.duckdb" ]]',
      '[[ "${SENDLENS_STATE_DIR:-}" == "${HOME}/.sendlens/home-state" ]]',
    ].join("\n"),
  );
  assertSucceeded(homePathResult, "narrow non-evaluating HOME path compatibility");

  const quotedCommentRoot = await tempDir("sendlens-safe-config-quoted-comments-");
  await writeFile(
    path.join(quotedCommentRoot, ".env"),
    [
      'SENDLENS_PROVIDER="smartlead" # choose provider',
      "SENDLENS_DEMO_MODE='yes # literal single hash' # enable demo",
      'SENDLENS_STATE_DIR="/tmp/state # literal double hash" # keep workspace state isolated',
      "",
    ].join("\n"),
  );
  const quotedCommentResult = loadConfig(
    quotedCommentRoot,
    [
      '[[ "${SENDLENS_PROVIDER:-}" == "smartlead" ]]',
      '[[ "$(source_provider_mode)" == "smartlead" ]]',
      '[[ "${SENDLENS_DEMO_MODE:-}" == "yes # literal single hash" ]]',
      '[[ "${SENDLENS_STATE_DIR:-}" == "/tmp/state # literal double hash" ]]',
    ].join("\n"),
  );
  assertSucceeded(quotedCommentResult, "quoted values with trailing comments");

  const singleClientRoot = await tempDir("sendlens-safe-config-single-client-");
  await mkdir(path.join(singleClientRoot, ".env.clients"));
  await writeFile(
    path.join(singleClientRoot, ".env.clients", "solo.env"),
    "SENDLENS_INSTANTLY_API_KEY=single-client\n",
  );
  const singleClientResult = loadConfig(
    singleClientRoot,
    [
      '[[ "${SENDLENS_CLIENT:-}" == "solo" ]]',
      '[[ "${SENDLENS_INSTANTLY_API_KEY:-}" == "single-client" ]]',
    ].join("\n"),
  );
  assertSucceeded(singleClientResult, "single client auto-selection");

  const multiClientRoot = await tempDir("sendlens-safe-config-multi-client-");
  await mkdir(path.join(multiClientRoot, ".env.clients"));
  await writeFile(
    path.join(multiClientRoot, ".env"),
    "SENDLENS_INSTANTLY_API_KEY=base-only\n",
  );
  await writeFile(
    path.join(multiClientRoot, ".env.clients", "alpha.env"),
    "SENDLENS_INSTANTLY_API_KEY=alpha\n",
  );
  await writeFile(
    path.join(multiClientRoot, ".env.clients", "bravo.env"),
    "SENDLENS_INSTANTLY_API_KEY=bravo\n",
  );
  const multiClientResult = loadConfig(
    multiClientRoot,
    [
      '[[ -z "${SENDLENS_CLIENT:-}" ]]',
      '[[ "${SENDLENS_INSTANTLY_API_KEY:-}" == "base-only" ]]',
    ].join("\n"),
  );
  assertSucceeded(multiClientResult, "multiple clients require explicit selection");

  const absoluteClientRoot = await tempDir("sendlens-safe-config-absolute-client-");
  const absoluteProfiles = await tempDir("sendlens-safe-config-absolute-profiles-");
  await writeFile(
    path.join(absoluteClientRoot, ".env"),
    [
      "SENDLENS_CLIENT=absolute",
      `SENDLENS_CLIENTS_DIR=${absoluteProfiles}`,
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(absoluteProfiles, "absolute.env"),
    "SENDLENS_INSTANTLY_API_KEY=absolute-client\n",
  );
  const absoluteClientResult = loadConfig(
    absoluteClientRoot,
    [
      '[[ "${SENDLENS_CLIENT:-}" == "absolute" ]]',
      `[[ "\${SENDLENS_CLIENTS_DIR:-}" == "${absoluteProfiles}" ]]`,
      '[[ "${SENDLENS_INSTANTLY_API_KEY:-}" == "absolute-client" ]]',
    ].join("\n"),
  );
  assertSucceeded(absoluteClientResult, "absolute client profile directory");

  const lockedRoot = await tempDir("sendlens-safe-config-locks-");
  const lockedProfiles = path.join(lockedRoot, "ambient-profiles");
  await mkdir(lockedProfiles);
  await writeFile(
    path.join(lockedRoot, ".env"),
    [
      "SENDLENS_CLIENT=file-client",
      "SENDLENS_CLIENTS_DIR=file-profiles",
      "SENDLENS_DB_PATH=/tmp/file.duckdb",
      "SENDLENS_STATE_DIR=/tmp/file-state",
      "SENDLENS_DEMO_MODE=1",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(lockedProfiles, "ambient-client.env"),
    [
      "SENDLENS_CLIENT=client-overlay-must-not-change",
      "SENDLENS_CLIENTS_DIR=/tmp/client-overlay-must-not-change",
      "SENDLENS_DB_PATH=/tmp/client-overlay.duckdb",
      "SENDLENS_STATE_DIR=/tmp/client-overlay-state",
      "SENDLENS_DEMO_MODE=yes",
      "SENDLENS_INSTANTLY_API_KEY=client-key",
      "",
    ].join("\n"),
  );
  const lockedResult = loadConfig(
    lockedRoot,
    [
      '[[ "${SENDLENS_CLIENT:-}" == "ambient-client" ]]',
      '[[ "${SENDLENS_CLIENTS_DIR:-}" == "$SENDLENS_EXPECTED_CLIENTS_DIR" ]]',
      '[[ "${SENDLENS_DB_PATH:-}" == "/tmp/ambient.duckdb" ]]',
      '[[ "${SENDLENS_STATE_DIR:-}" == "/tmp/ambient-state" ]]',
      '[[ "${SENDLENS_DEMO_MODE:-}" == "0" ]]',
      '[[ "${SENDLENS_INSTANTLY_API_KEY:-}" == "client-key" ]]',
    ].join("\n"),
    {
      SENDLENS_CLIENT: "ambient-client",
      SENDLENS_CLIENTS_DIR: lockedProfiles,
      SENDLENS_CONTAINER: "1",
      SENDLENS_DB_PATH: "/tmp/ambient.duckdb",
      SENDLENS_STATE_DIR: "/tmp/ambient-state",
      SENDLENS_DEMO_MODE: "0",
      SENDLENS_INSTANTLY_API_KEY: "ambient-key",
      SENDLENS_EXPECTED_CLIENTS_DIR: lockedProfiles,
    },
  );
  assertSucceeded(lockedResult, "ambient root and container locks");

  const placeholderRoot = await tempDir("sendlens-safe-config-placeholders-");
  await writeFile(
    path.join(placeholderRoot, ".env"),
    [
      "SENDLENS_INSTANTLY_API_KEY=your_key",
      "SENDLENS_SMARTLEAD_API_KEY=${SMARTLEAD_KEY}",
      "SENDLENS_PROVIDER={{provider}}",
      "",
    ].join("\n"),
  );
  const placeholderResult = loadConfig(
    placeholderRoot,
    [
      '[[ -z "${SENDLENS_INSTANTLY_API_KEY:-}" ]]',
      '[[ -z "${SENDLENS_SMARTLEAD_API_KEY:-}" ]]',
      '[[ -z "${SENDLENS_PROVIDER:-}" ]]',
    ].join("\n"),
  );
  assertSucceeded(placeholderResult, "placeholder sanitation");

  const ambientPlaceholderRoot = await tempDir("sendlens-safe-config-ambient-placeholders-");
  await writeFile(
    path.join(ambientPlaceholderRoot, ".env"),
    [
      "SENDLENS_CLIENT=resolved-client",
      "SENDLENS_CLIENTS_DIR=resolved-profiles",
      "SENDLENS_DB_PATH=/tmp/resolved.duckdb",
      "SENDLENS_INSTANTLY_API_KEY=resolved-key",
      "SENDLENS_PROVIDER=instantly",
      "SENDLENS_STATE_DIR=/tmp/resolved-state",
      "",
    ].join("\n"),
  );
  const ambientPlaceholderResult = loadConfig(
    ambientPlaceholderRoot,
    [
      '[[ "${SENDLENS_CLIENT:-}" == "resolved-client" ]]',
      '[[ "${SENDLENS_CLIENTS_DIR:-}" == "resolved-profiles" ]]',
      '[[ "${SENDLENS_DB_PATH:-}" == "/tmp/resolved.duckdb" ]]',
      '[[ "${SENDLENS_INSTANTLY_API_KEY:-}" == "resolved-key" ]]',
      '[[ "${SENDLENS_PROVIDER:-}" == "instantly" ]]',
      '[[ "${SENDLENS_STATE_DIR:-}" == "/tmp/resolved-state" ]]',
    ].join("\n"),
    {
      SENDLENS_CLIENT: "${CLIENT}",
      SENDLENS_CLIENTS_DIR: "${CLIENTS_DIR}",
      SENDLENS_DB_PATH: "${DB_PATH}",
      SENDLENS_INSTANTLY_API_KEY: "your_key",
      SENDLENS_PROVIDER: "{{provider}}",
      SENDLENS_STATE_DIR: "workspace/+ name +/state",
    },
  );
  assertSucceeded(ambientPlaceholderResult, "ambient placeholders do not lock out safe file values");

  const rejectionRoot = await tempDir("sendlens-safe-config-rejections-");
  await writeFile(
    path.join(rejectionRoot, ".env"),
    [
      "SENDLENS_INSTANTLY_API_KEY=prior-key",
      "SENDLENS_DB_PATH=/tmp/prior.duckdb",
      "SENDLENS_PROVIDER=smartlead",
      "SENDLENS_STATE_DIR=/tmp/prior-state",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(rejectionRoot, ".env.local"),
    [
      'SENDLENS_INSTANTLY_API_KEY="unsafe\\nmultiline"',
      "SENDLENS_DB_PATH=${OTHER_PATH}",
      "SENDLENS_PROVIDER=instantly; invalid-command",
      'SENDLENS_STATE_DIR="unterminated',
      "",
    ].join("\n"),
  );
  const rejectionResult = loadConfig(
    rejectionRoot,
    [
      '[[ "${SENDLENS_INSTANTLY_API_KEY:-}" == "prior-key" ]]',
      '[[ "${SENDLENS_DB_PATH:-}" == "/tmp/prior.duckdb" ]]',
      '[[ "${SENDLENS_PROVIDER:-}" == "smartlead" ]]',
      '[[ "$(source_provider_mode)" == "smartlead" ]]',
      '[[ "${SENDLENS_STATE_DIR:-}" == "/tmp/prior-state" ]]',
    ].join("\n"),
  );
  assertSucceeded(rejectionResult, "unsafe later assignment preserves prior value");
  assert.match(
    rejectionResult.stderr,
    /\[sendlens] Ignoring unsafe or invalid SendLens dotenv entry\./,
  );
  assertSensitiveOutputSuppressed(rejectionResult, "unsafe\\nmultiline");

  const controlCharacterRoot = await tempDir("sendlens-safe-config-control-characters-");
  const controlCharacterSentinel = "control-value-must-not-be-logged";
  await writeFile(
    path.join(controlCharacterRoot, ".env"),
    [
      "SENDLENS_INSTANTLY_API_KEY=prior-key",
      "SENDLENS_DB_PATH=/tmp/prior.duckdb",
      "SENDLENS_PROVIDER=smartlead",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(controlCharacterRoot, ".env.local"),
    [
      `SENDLENS_INSTANTLY_API_KEY=${controlCharacterSentinel}\u0001`,
      `SENDLENS_DB_PATH=/tmp/${controlCharacterSentinel}\u001f`,
      "SENDLENS_PROVIDER=smartlead\u007f",
      "",
    ].join("\n"),
  );
  const controlCharacterResult = loadConfig(
    controlCharacterRoot,
    [
      '[[ "${SENDLENS_INSTANTLY_API_KEY:-}" == "prior-key" ]]',
      '[[ "${SENDLENS_DB_PATH:-}" == "/tmp/prior.duckdb" ]]',
      '[[ "${SENDLENS_PROVIDER:-}" == "smartlead" ]]',
    ].join("\n"),
  );
  assertSucceeded(controlCharacterResult, "ASCII control characters are rejected");
  assert.match(
    controlCharacterResult.stderr,
    /\[sendlens] Ignoring unsafe or invalid SendLens dotenv entry\./,
  );
  assertSensitiveOutputSuppressed(controlCharacterResult, controlCharacterSentinel);

  const canaryRoot = await tempDir("sendlens-safe-config-canary-");
  const markers = Array.from(
    { length: 11 },
    (_, index) => path.join(canaryRoot, `must-not-exist-${index + 1}`),
  );
  const sensitiveSentinel = "unsafe-value-must-not-be-logged";
  await writeFile(
    path.join(canaryRoot, ".env"),
    [
      "SENDLENS_INSTANTLY_API_KEY=base-instantly",
      "SENDLENS_SMARTLEAD_API_KEY=base-smartlead",
      "SENDLENS_DB_PATH=/tmp/base.duckdb",
      "SENDLENS_DEMO_MODE=0",
      "SENDLENS_PROVIDER=smartlead",
      "SENDLENS_STATE_DIR=/tmp/base-state",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(canaryRoot, ".env.local"),
    [
      `SENDLENS_INSTANTLY_API_KEY=$(printf %s ${sensitiveSentinel}; touch "${markers[0]}")`,
      `SENDLENS_SMARTLEAD_API_KEY=\`touch "${markers[1]}"\``,
      `SENDLENS_DB_PATH="$HOME/$(touch ${markers[10]})" # reject expansion after HOME`,
      `SENDLENS_DEMO_MODE=1 > "${markers[2]}"`,
      `touch "${markers[3]}"`,
      `SENDLENS_PROVIDER=instantly; touch "${markers[4]}"`,
      `SENDLENS_STATE_DIR=/tmp/unsafe | touch "${markers[5]}"`,
      `SENDLENS_INSTANTLY_API_KEY="$(touch "${markers[6]}")" # reject quoted expansion`,
      `SENDLENS_SMARTLEAD_API_KEY='\`touch "${markers[7]}"\`' # reject quoted backticks`,
      `SENDLENS_DB_PATH="/tmp/safe" > "${markers[8]}"`,
      `SENDLENS_STATE_DIR="/tmp/unsafe | touch ${markers[9]}" # reject quoted command syntax`,
      'SENDLENS_DEMO_MODE="unterminated',
      "PATH=/tmp/must-not-load",
      "HOME=/tmp/must-not-load",
      "NODE_OPTIONS=--require=/tmp/must-not-load.cjs",
      "BASH_ENV=/tmp/must-not-load.sh",
      "PLUGIN_ROOT=/tmp/must-not-load",
      "PLUXX_PLUGIN_ROOT=/tmp/must-not-load",
      "SENDLENS_EXPECTED_PLUGIN_ROOT=/tmp/must-not-load",
      "UNRELATED_ENV=must-not-load",
      "",
    ].join("\n"),
  );

  const ambient = {
    PLUGIN_ROOT: root,
    SENDLENS_EXPECTED_PLUGIN_ROOT: root,
  };
  const canaryResult = loadConfig(
    canaryRoot,
    [
      '[[ "${SENDLENS_INSTANTLY_API_KEY:-}" == "base-instantly" ]]',
      '[[ "${SENDLENS_SMARTLEAD_API_KEY:-}" == "base-smartlead" ]]',
      '[[ "${SENDLENS_DB_PATH:-}" == "/tmp/base.duckdb" ]]',
      '[[ "${SENDLENS_DEMO_MODE:-}" == "0" ]]',
      '[[ "${SENDLENS_PROVIDER:-}" == "smartlead" ]]',
      '[[ "${SENDLENS_STATE_DIR:-}" == "/tmp/base-state" ]]',
      '[[ "${PATH}" == "$SENDLENS_EXPECTED_PATH" ]]',
      '[[ "${HOME}" == "$SENDLENS_EXPECTED_HOME" ]]',
      '[[ "${PLUGIN_ROOT}" == "$SENDLENS_EXPECTED_PLUGIN_ROOT" ]]',
      '[[ -z "${NODE_OPTIONS:-}" ]]',
      '[[ -z "${BASH_ENV:-}" ]]',
      '[[ -z "${PLUXX_PLUGIN_ROOT:-}" ]]',
      '[[ -z "${UNRELATED_ENV:-}" ]]',
    ].join("\n"),
    {
      ...ambient,
      SENDLENS_EXPECTED_HOME: os.homedir(),
      SENDLENS_EXPECTED_PATH: process.env.PATH,
    },
  );
  assertSucceeded(canaryResult, "unsafe dotenv entries fail closed");

  for (const marker of markers) {
    assert.equal(
      await exists(marker),
      false,
      "dotenv shell syntax must not execute or create canary files",
    );
  }
  assertSensitiveOutputSuppressed(canaryResult, sensitiveSentinel);

  const startFixture = await tempDir("sendlens-safe-config-start-mcp-");
  const startContext = await tempDir("sendlens-safe-config-start-context-");
  await mkdir(path.join(startFixture, "scripts"), { recursive: true });
  await mkdir(path.join(startFixture, "build", "plugin"), { recursive: true });
  for (const scriptName of ["load-env.sh", "start-mcp.sh"]) {
    await writeFile(
      path.join(startFixture, "scripts", scriptName),
      await readFile(path.join(root, "scripts", scriptName), "utf8"),
    );
  }
  await writeFile(path.join(startFixture, "scripts", "bootstrap-runtime.sh"), "exit 0\n");
  await writeFile(path.join(startFixture, "scripts", "session-start.sh"), "exit 0\n");
  await writeFile(
    path.join(startFixture, "build", "plugin", "server.js"),
    [
      'const fs = require("node:fs");',
      'fs.writeFileSync(process.env.SENDLENS_TEST_MARKER, "started");',
      "",
    ].join("\n"),
  );
  const startAttackMarker = path.join(startContext, "must-not-exist-start-attack");
  const startSuccessMarker = path.join(startContext, "start-success");
  await writeFile(
    path.join(startContext, ".env"),
    `SENDLENS_INSTANTLY_API_KEY=$(printf %s ${sensitiveSentinel}; touch "${startAttackMarker}")\n`,
  );
  const startResult = spawnSync("bash", [path.join(startFixture, "scripts", "start-mcp.sh")], {
    cwd: startContext,
    encoding: "utf8",
    env: {
      HOME: os.homedir(),
      PATH: process.env.PATH,
      PLUGIN_ROOT: startFixture,
      SENDLENS_CONTEXT_ROOT: startContext,
      SENDLENS_DEMO_MODE: "1",
      SENDLENS_TEST_MARKER: startSuccessMarker,
    },
  });
  assertSucceeded(startResult, "start-mcp safe config integration");
  assert.equal(await exists(startSuccessMarker), true, "start-mcp should reach the Node runtime");
  assert.equal(await exists(startAttackMarker), false, "start-mcp must not execute dotenv commands");
  assertSensitiveOutputSuppressed(startResult, sensitiveSentinel);

  const sessionFixture = await tempDir("sendlens-safe-config-session-start-");
  const sessionContext = await tempDir("sendlens-safe-config-session-context-");
  await mkdir(path.join(sessionFixture, "scripts"), { recursive: true });
  await mkdir(path.join(sessionFixture, "build", "plugin"), { recursive: true });
  for (const scriptName of ["load-env.sh", "session-start.sh"]) {
    await writeFile(
      path.join(sessionFixture, "scripts", scriptName),
      await readFile(path.join(root, "scripts", scriptName), "utf8"),
    );
  }
  await writeFile(path.join(sessionFixture, "scripts", "bootstrap-runtime.sh"), "exit 0\n");
  await writeFile(
    path.join(sessionFixture, "build", "plugin", "refresh-cli.js"),
    [
      'const fs = require("node:fs");',
      "const resolved = {",
      "  dbPath: process.env.SENDLENS_DB_PATH,",
      "  stateDir: process.env.SENDLENS_STATE_DIR,",
      "  provider: process.env.SENDLENS_PROVIDER,",
      '  hasWorkspaceKey: process.env.SENDLENS_INSTANTLY_API_KEY === "workspace-safe-key",',
      "};",
      "fs.writeFileSync(process.env.SENDLENS_TEST_MARKER, JSON.stringify(resolved));",
      "",
    ].join("\n"),
  );
  const sessionAttackMarker = path.join(sessionContext, "must-not-exist-session-attack");
  const sessionSuccessMarker = path.join(sessionContext, "session-success");
  const sessionHome = await tempDir("sendlens-safe-config-session-home-");
  const sessionDbPath = path.join(sessionContext, "workspace.duckdb");
  const sessionStateDir = path.join(sessionContext, "state");
  await writeFile(
    path.join(sessionContext, ".env"),
    [
      `SENDLENS_DB_PATH=${sessionDbPath}`,
      `SENDLENS_STATE_DIR=${sessionStateDir}`,
      "SENDLENS_PROVIDER=instantly",
      "SENDLENS_INSTANTLY_API_KEY=workspace-safe-key",
      `SENDLENS_INSTANTLY_API_KEY=$(printf %s ${sensitiveSentinel}; touch "${sessionAttackMarker}")`,
      "",
    ].join("\n"),
  );
  const sessionResult = spawnSync(
    "bash",
    [path.join(sessionFixture, "scripts", "session-start.sh")],
    {
      cwd: sessionContext,
      encoding: "utf8",
      env: {
        HOME: sessionHome,
        PATH: process.env.PATH,
        PLUGIN_ROOT: sessionFixture,
        SENDLENS_CONTEXT_ROOT: sessionContext,
        SENDLENS_TEST_MARKER: sessionSuccessMarker,
      },
    },
  );
  assertSucceeded(sessionResult, "session-start safe config integration");
  assert.equal(
    await waitFor(sessionSuccessMarker),
    true,
    "session-start should reach the background refresh runtime",
  );
  const sessionResolvedConfig = JSON.parse(await readFile(sessionSuccessMarker, "utf8"));
  assert.deepEqual(
    sessionResolvedConfig,
    {
      dbPath: sessionDbPath,
      stateDir: sessionStateDir,
      provider: "instantly",
      hasWorkspaceKey: true,
    },
    "session-start background refresh should inherit workspace dotenv config",
  );
  assert.equal(
    await exists(sessionAttackMarker),
    false,
    "session-start and its background refresh must not execute dotenv commands",
  );
  assert.equal(
    await exists(path.join(sessionHome, ".sendlens")),
    false,
    "session-start must not create HOME/.sendlens when workspace dotenv paths are configured",
  );
  assertSensitiveOutputSuppressed(sessionResult, sensitiveSentinel);

  if (process.argv.includes("--bundles")) {
    for (const host of ["claude-code", "cursor", "codex", "opencode"]) {
      const bundleRoot = path.join(root, "dist", host);
      const bundledLoader = path.join(bundleRoot, "scripts", "load-env.sh");
      assert.equal(
        await exists(bundledLoader),
        true,
        `generated ${host} bundle should include scripts/load-env.sh`,
      );

      const bundleContext = await tempDir(`sendlens-safe-config-${host}-bundle-`);
      const bundleAttackMarker = path.join(bundleContext, "must-not-exist-bundle-attack");
      await writeFile(
        path.join(bundleContext, ".env"),
        `SENDLENS_INSTANTLY_API_KEY=$(touch "${bundleAttackMarker}")\n`,
      );
      const bundleResult = loadConfig(
        bundleContext,
        '[[ "${SENDLENS_INSTANTLY_API_KEY:-}" == "ambient-bundle-key" ]]',
        {
          PLUGIN_ROOT: bundleRoot,
          SENDLENS_INSTANTLY_API_KEY: "ambient-bundle-key",
        },
        bundleRoot,
      );
      assertSucceeded(bundleResult, `${host} bundled safe config loader`);
      assert.equal(
        await exists(bundleAttackMarker),
        false,
        `${host} bundled loader must not execute dotenv commands`,
      );
    }
  }

  const loaderSource = await readFile(path.join(root, "scripts", "load-env.sh"), "utf8");
  assert.doesNotMatch(loaderSource, /^\s*(?:source|\.)\s+["']?\$\{?file_path/m);

  console.log("Safe config-loader command, expansion, redirection, and precedence checks passed.");
} finally {
  await Promise.all(tempRoots.map((directory) => rm(directory, { recursive: true, force: true })));
}
