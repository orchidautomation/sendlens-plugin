import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const execFile = promisify(childProcess.execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const accessParam = "api" + "_key";

const {
  buildSmartleadAccessProbeUrl,
  redactSmartleadAccess,
  resolveSourceProviderMode,
  validateSmartleadApiKey,
} = require("../build/plugin/provider-config.js");
const { loadClientEnv } = require("../build/plugin/env.js");
const { refreshWorkspace } = require("../build/plugin/instantly-ingest.js");
const { currentApiKeyFingerprint, fingerprintPrefix } = require("../build/plugin/local-db.js");
const { buildSetupDoctorReport } = require("../build/plugin/setup-doctor.js");
const { readRefreshStatus } = require("../build/plugin/refresh-status.js");

const originalFetch = globalThis.fetch;
const managedEnv = [
  "PLUGIN_ROOT",
  "SENDLENS_CONTEXT_ROOT",
  "SENDLENS_DB_PATH",
  "SENDLENS_STATE_DIR",
  "SENDLENS_PROVIDER",
  "SENDLENS_INSTANTLY_API_KEY",
  "SENDLENS_SMARTLEAD_API_KEY",
  "SENDLENS_DEMO_MODE",
  "SENDLENS_CLIENT",
  "SENDLENS_CLIENTS_DIR",
];
const originalEnv = Object.fromEntries(
  managedEnv.map((key) => [key, process.env[key]]),
);

function responseJson(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function resetEnv(label) {
  for (const key of managedEnv) delete process.env[key];
  const tempDir = path.join(os.tmpdir(), `sendlens-provider-config-${label}-${Date.now()}`);
  process.env.PLUGIN_ROOT = root;
  process.env.SENDLENS_CONTEXT_ROOT = tempDir;
  process.env.SENDLENS_DB_PATH = path.join(tempDir, "workspace-cache.duckdb");
  process.env.SENDLENS_STATE_DIR = tempDir;
  return tempDir;
}

function restoreEnv() {
  for (const key of managedEnv) {
    if (originalEnv[key] == null) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
}

function assertNoSensitiveValue(value, sensitiveValue) {
  assert.ok(
    !JSON.stringify(value).includes(sensitiveValue),
    "setup/config output must not include the full Smartlead access value",
  );
}

function findCheck(report, name) {
  return report.checks.find((check) => check.name === name);
}

async function runScript(scriptPath, env) {
  try {
    const result = await execFile("bash", [scriptPath], {
      cwd: root,
      env: { ...process.env, ...env },
      timeout: 10000,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

async function commandPath(commandName) {
  const { stdout } = await execFile("bash", ["-lc", `command -v ${commandName}`], {
    cwd: root,
    env: process.env,
  });
  return stdout.trim();
}

async function createPathWithoutNode(label) {
  const binDir = path.join(os.tmpdir(), `sendlens-provider-config-${label}-bin-${Date.now()}`);
  await fs.mkdir(binDir, { recursive: true });
  for (const commandName of ["bash", "dirname", "tr"]) {
    await fs.symlink(await commandPath(commandName), path.join(binDir, commandName));
  }
  return binDir;
}

function assertInvalidProviderResult(result, entryPoint) {
  assert.equal(result.code, 1, `${entryPoint} should reject invalid SENDLENS_PROVIDER`);
  assert.match(result.stderr, /Invalid SENDLENS_PROVIDER value 'mailgun'/);
  assert.match(result.stderr, /Set SENDLENS_PROVIDER to instantly, smartlead, or all/);
}

try {
  assert.deepEqual(resolveSourceProviderMode(undefined), {
    mode: "instantly",
    raw: null,
    valid: true,
    defaulted: true,
  });
  assert.equal(resolveSourceProviderMode("SMARTLEAD").mode, "smartlead");
  assert.equal(resolveSourceProviderMode(" smartlead ").mode, "smartlead");
  assert.equal(resolveSourceProviderMode("all").mode, "all");
  assert.equal(resolveSourceProviderMode("mailgun").valid, false);

  const smartleadValue = "sl_test_value_123456";
  const probeUrl = buildSmartleadAccessProbeUrl(smartleadValue);
  const parsedProbeUrl = new URL(probeUrl);
  assert.equal(parsedProbeUrl.searchParams.get(accessParam), smartleadValue);
  assert.equal(parsedProbeUrl.searchParams.get("include_tags"), "true");
  const redactedProbeUrl = redactSmartleadAccess(probeUrl, [smartleadValue]);
  assertNoSensitiveValue(redactedProbeUrl, smartleadValue);
  assert.ok(redactedProbeUrl.includes(`${accessParam}=[REDACTED]`));

  const smartleadCalls = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    smartleadCalls.push(parsed);
    return responseJson([{ id: 1 }, { id: 2 }]);
  };
  const validSmartlead = await validateSmartleadApiKey(smartleadValue, 500);
  assert.equal(validSmartlead.status, "valid");
  assert.equal(validSmartlead.returned_campaigns, 2);
  assert.equal(smartleadCalls[0].searchParams.get(accessParam), smartleadValue);
  assertNoSensitiveValue(validSmartlead, smartleadValue);

  globalThis.fetch = async (url) => {
    throw new Error(`connection failed for ${url}`);
  };
  const unreachableSmartlead = await validateSmartleadApiKey(smartleadValue, 500);
  assert.equal(unreachableSmartlead.status, "unreachable");
  assertNoSensitiveValue(unreachableSmartlead, smartleadValue);
  assert.ok(unreachableSmartlead.message.includes("[REDACTED]"));

  let tempDir = resetEnv("instantly-default-no-cache");
  await fs.mkdir(tempDir, { recursive: true });
  let report = await buildSetupDoctorReport();
  assert.equal(report.capabilities.source_provider_mode, "instantly");
  assert.equal(report.capabilities.source_providers.join(","), "instantly");
  assert.equal(report.capabilities.local_cache_read, false);
  assert.equal(report.capabilities.demo_seed, true);
  assert.equal(findCheck(report, "Credentials")?.status, "fail");
  assert.ok(report.next_steps.some((step) => step.includes("seed_demo_workspace")));

  tempDir = resetEnv("smartlead-missing");
  await fs.mkdir(tempDir, { recursive: true });
  process.env.SENDLENS_PROVIDER = "smartlead";
  report = await buildSetupDoctorReport();
  assert.equal(report.setup_status, "blocked");
  assert.equal(report.capabilities.source_provider_mode, "smartlead");
  assert.equal(report.capabilities.smartlead_key_configured, false);
  assert.equal(findCheck(report, "Smartlead credentials")?.status, "fail");
  assert.ok(report.failures.some((failure) => failure.includes("SENDLENS_SMARTLEAD_API_KEY")));

  tempDir = resetEnv("smartlead-valid");
  await fs.mkdir(tempDir, { recursive: true });
  process.env.SENDLENS_PROVIDER = "smartlead";
  process.env.SENDLENS_SMARTLEAD_API_KEY = smartleadValue;
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.hostname, "server.smartlead.ai");
    assert.equal(parsed.searchParams.get(accessParam), smartleadValue);
    return responseJson({ data: [{ id: 1 }] });
  };
  report = await buildSetupDoctorReport();
  assert.equal(report.capabilities.source_provider_mode, "smartlead");
  assert.equal(report.capabilities.source_providers.join(","), "smartlead");
  assert.equal(report.capabilities.local_cache_read, false);
  assert.equal(report.capabilities.live_refresh, true);
  assert.equal(report.capabilities.demo_seed, true);
  assert.equal(report.capabilities.smartlead_key_validated, true);
  assert.equal(findCheck(report, "Smartlead credentials")?.status, "pass");
  assertNoSensitiveValue(report, smartleadValue);
  assert.ok(
    report.next_steps.some((step) => step.includes("Smartlead provider configuration is ready")),
  );
  assert.ok(report.next_steps.some((step) => step.includes("refresh_data")));
  assert.ok(!report.next_steps.some((step) => step.includes("follow-up ingest")));
  assert.ok(report.next_steps.some((step) => step.includes("No readable cache was found")));
  assert.ok(!report.next_steps.some((step) => step.includes("existing readable cache")));

  tempDir = resetEnv("all-valid");
  await fs.mkdir(tempDir, { recursive: true });
  process.env.SENDLENS_PROVIDER = "all";
  process.env.SENDLENS_INSTANTLY_API_KEY = "instantly-test-value";
  process.env.SENDLENS_SMARTLEAD_API_KEY = smartleadValue;
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === "api.instantly.ai") {
      return responseJson({ items: [{ id: "instantly-campaign" }] });
    }
    assert.equal(parsed.hostname, "server.smartlead.ai");
    return responseJson([{ id: 10 }]);
  };
  report = await buildSetupDoctorReport();
  assert.equal(report.capabilities.source_provider_mode, "all");
  assert.deepEqual(report.capabilities.source_providers, ["instantly", "smartlead"]);
  assert.equal(report.capabilities.instantly_key_validated, true);
  assert.equal(report.capabilities.smartlead_key_validated, true);
  assert.equal(report.capabilities.live_refresh, false);
  assert.equal(findCheck(report, "Instantly credentials")?.status, "pass");
  assert.equal(findCheck(report, "Smartlead credentials")?.status, "pass");
  assert.ok(report.next_steps.some((step) => step.includes("SENDLENS_CLIENT")));
  assert.ok(!report.next_steps.some((step) => step.includes("follow-up")));
  assertNoSensitiveValue(report, smartleadValue);

  tempDir = resetEnv("all-valid-with-client");
  await fs.mkdir(tempDir, { recursive: true });
  process.env.SENDLENS_PROVIDER = "all";
  process.env.SENDLENS_CLIENT = "acme";
  process.env.SENDLENS_INSTANTLY_API_KEY = "instantly-test-value";
  process.env.SENDLENS_SMARTLEAD_API_KEY = smartleadValue;
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === "api.instantly.ai") {
      return responseJson({ items: [{ id: "instantly-campaign" }] });
    }
    assert.equal(parsed.hostname, "server.smartlead.ai");
    return responseJson([{ id: 10 }]);
  };
  report = await buildSetupDoctorReport();
  assert.equal(report.capabilities.source_provider_mode, "all");
  assert.equal(report.paths.selected_client, "acme");
  assert.equal(report.capabilities.live_refresh, true);
  assert.ok(report.next_steps.some((step) => step.includes("live Instantly and read-only Smartlead")));
  assertNoSensitiveValue(report, smartleadValue);

  tempDir = resetEnv("all-refresh-requires-client");
  await fs.mkdir(tempDir, { recursive: true });
  process.env.SENDLENS_PROVIDER = "all";
  process.env.SENDLENS_INSTANTLY_API_KEY = "instantly-test-value";
  process.env.SENDLENS_SMARTLEAD_API_KEY = smartleadValue;
  let allRefreshProviderFetchCount = 0;
  globalThis.fetch = async () => {
    allRefreshProviderFetchCount += 1;
    return responseJson([]);
  };
  await assert.rejects(
    refreshWorkspace({ provider: "all", source: "manual" }),
    /requires SENDLENS_CLIENT/,
  );
  assert.equal(allRefreshProviderFetchCount, 0);

  tempDir = resetEnv("all-smartlead-valid-no-instantly-no-cache");
  await fs.mkdir(tempDir, { recursive: true });
  process.env.SENDLENS_PROVIDER = "all";
  process.env.SENDLENS_SMARTLEAD_API_KEY = smartleadValue;
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.hostname, "server.smartlead.ai");
    assert.equal(parsed.searchParams.get(accessParam), smartleadValue);
    return responseJson([{ id: 10 }]);
  };
  report = await buildSetupDoctorReport();
  assert.equal(report.setup_status, "blocked");
  assert.equal(report.capabilities.source_provider_mode, "all");
  assert.deepEqual(report.capabilities.source_providers, ["instantly", "smartlead"]);
  assert.equal(report.capabilities.local_cache_read, false);
  assert.equal(report.capabilities.live_refresh, false);
  assert.equal(report.capabilities.demo_seed, true);
  assert.equal(report.capabilities.instantly_key_configured, false);
  assert.equal(report.capabilities.smartlead_key_validated, true);
  assert.equal(findCheck(report, "Instantly credentials")?.status, "fail");
  assert.equal(findCheck(report, "Smartlead credentials")?.status, "pass");
  assert.ok(report.next_steps.some((step) => step.includes("seed_demo_workspace")));
  assertNoSensitiveValue(report, smartleadValue);

  tempDir = resetEnv("env-sanitize");
  await fs.mkdir(tempDir, { recursive: true });
  process.env.SENDLENS_SMARTLEAD_API_KEY = "your_smartlead_api_key";
  process.env.SENDLENS_PROVIDER = "${SENDLENS_PROVIDER}";
  loadClientEnv(tempDir);
  assert.equal(process.env.SENDLENS_SMARTLEAD_API_KEY, undefined);
  assert.equal(process.env.SENDLENS_PROVIDER, undefined);

  tempDir = resetEnv("client-env-overrides-stale-process");
  await fs.mkdir(path.join(tempDir, ".env.clients"), { recursive: true });
  process.env.SENDLENS_CLIENT = "sendoso";
  process.env.SENDLENS_PROVIDER = "all";
  process.env.SENDLENS_INSTANTLY_API_KEY = "stale-instantly-process-value";
  process.env.SENDLENS_SMARTLEAD_API_KEY = "stale-smartlead-process-value";
  process.env.SENDLENS_DB_PATH = path.join(tempDir, "stale-process.duckdb");
  process.env.SENDLENS_STATE_DIR = path.join(tempDir, "stale-state");
  await fs.writeFile(
    path.join(tempDir, ".env.clients", "sendoso.env"),
    [
      "SENDLENS_INSTANTLY_API_KEY=sendoso-instantly-client-value",
      "SENDLENS_SMARTLEAD_API_KEY=sendoso-smartlead-client-value",
      "SENDLENS_DB_PATH=sendoso-client.duckdb",
      "SENDLENS_STATE_DIR=sendoso-state",
    ].join("\n"),
  );
  loadClientEnv(tempDir);
  assert.equal(process.env.SENDLENS_INSTANTLY_API_KEY, "sendoso-instantly-client-value");
  assert.equal(process.env.SENDLENS_SMARTLEAD_API_KEY, "sendoso-smartlead-client-value");
  assert.equal(process.env.SENDLENS_DB_PATH, "sendoso-client.duckdb");
  assert.equal(process.env.SENDLENS_STATE_DIR, "sendoso-state");
  assert.equal(process.env.SENDLENS_CLIENT, "sendoso");
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === "api.instantly.ai") {
      return responseJson({ items: [{ id: "instantly-campaign" }] });
    }
    return responseJson([{ id: 10 }]);
  };
  report = await buildSetupDoctorReport();
  const clientIdentityCheck = findCheck(report, "Client env identity");
  assert.equal(clientIdentityCheck?.status, "pass");
  assert.ok(String(clientIdentityCheck?.detail).includes(fingerprintPrefix(currentApiKeyFingerprint())));
  assertNoSensitiveValue(report, "sendoso-instantly-client-value");
  assertNoSensitiveValue(report, "sendoso-smartlead-client-value");

  tempDir = resetEnv("client-env-provider-filtering");
  await fs.mkdir(path.join(tempDir, ".env.clients"), { recursive: true });
  process.env.SENDLENS_CLIENT = "sendoso";
  process.env.SENDLENS_PROVIDER = "instantly";
  process.env.SENDLENS_INSTANTLY_API_KEY = "stale-instantly-process-value";
  process.env.SENDLENS_SMARTLEAD_API_KEY = "stale-smartlead-process-value";
  await fs.writeFile(
    path.join(tempDir, ".env.clients", "sendoso.env"),
    [
      "SENDLENS_INSTANTLY_API_KEY=sendoso-instantly-client-value",
      "SENDLENS_SMARTLEAD_API_KEY=sendoso-smartlead-client-value",
    ].join("\n"),
  );
  loadClientEnv(tempDir);
  assert.equal(process.env.SENDLENS_INSTANTLY_API_KEY, "sendoso-instantly-client-value");
  assert.equal(process.env.SENDLENS_SMARTLEAD_API_KEY, "sendoso-smartlead-client-value");
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.hostname, "api.instantly.ai");
    return responseJson({ items: [{ id: "instantly-campaign" }] });
  };
  report = await buildSetupDoctorReport();
  const singleProviderClientIdentityCheck = findCheck(report, "Client env identity");
  assert.equal(singleProviderClientIdentityCheck?.status, "pass");
  assert.ok(
    String(singleProviderClientIdentityCheck?.detail).includes(
      fingerprintPrefix(currentApiKeyFingerprint()),
    ),
  );
  assertNoSensitiveValue(report, "sendoso-instantly-client-value");
  assertNoSensitiveValue(report, "sendoso-smartlead-client-value");

  tempDir = resetEnv("automatic-single-client-selection");
  await fs.mkdir(path.join(tempDir, ".env.clients"), { recursive: true });
  await fs.writeFile(
    path.join(tempDir, ".env.clients", "sendoso.env"),
    [
      "SENDLENS_PROVIDER=instantly",
      "SENDLENS_INSTANTLY_API_KEY=automatic-client-value",
      `SENDLENS_DB_PATH=${path.join(tempDir, "sendoso.duckdb")}`,
      `SENDLENS_STATE_DIR=${path.join(tempDir, "sendoso-state")}`,
    ].join("\n"),
  );
  const automaticClientResult = await runScript(path.join(root, "scripts/check-env.sh"), {
    PLUGIN_ROOT: root,
    SENDLENS_CONTEXT_ROOT: tempDir,
  });
  assert.equal(automaticClientResult.code, 0);
  assert.match(automaticClientResult.stderr, /client 'sendoso'/);
  assert.doesNotMatch(automaticClientResult.stderr, /SENDLENS_INSTANTLY_API_KEY is not set/);
  assertNoSensitiveValue(automaticClientResult, "automatic-client-value");

  tempDir = resetEnv("invalid-provider-check-env");
  await fs.mkdir(tempDir, { recursive: true });
  assertInvalidProviderResult(
    await runScript(path.join(root, "scripts/check-env.sh"), {
      PLUGIN_ROOT: root,
      SENDLENS_CONTEXT_ROOT: tempDir,
      SENDLENS_DB_PATH: path.join(tempDir, "workspace-cache.duckdb"),
      SENDLENS_STATE_DIR: tempDir,
      SENDLENS_PROVIDER: "mailgun",
    }),
    "check-env.sh",
  );

  tempDir = resetEnv("invalid-provider-start-mcp");
  await fs.mkdir(tempDir, { recursive: true });
  assertInvalidProviderResult(
    await runScript(path.join(root, "scripts/start-mcp.sh"), {
      PLUGIN_ROOT: root,
      SENDLENS_CONTEXT_ROOT: tempDir,
      SENDLENS_DB_PATH: path.join(tempDir, "workspace-cache.duckdb"),
      SENDLENS_STATE_DIR: tempDir,
      SENDLENS_PROVIDER: "mailgun",
    }),
    "start-mcp.sh",
  );

  tempDir = resetEnv("invalid-provider-session-start");
  await fs.mkdir(tempDir, { recursive: true });
  assertInvalidProviderResult(
    await runScript(path.join(root, "scripts/session-start.sh"), {
      PLUGIN_ROOT: root,
      SENDLENS_CONTEXT_ROOT: tempDir,
      SENDLENS_DB_PATH: path.join(tempDir, "workspace-cache.duckdb"),
      SENDLENS_STATE_DIR: tempDir,
      SENDLENS_PROVIDER: "mailgun",
    }),
    "session-start.sh",
  );

  tempDir = resetEnv("trimmed-provider-check");
  await fs.mkdir(tempDir, { recursive: true });
  const trimmedCheckResult = await runScript(path.join(root, "scripts/check-env.sh"), {
    PLUGIN_ROOT: root,
    SENDLENS_CONTEXT_ROOT: tempDir,
    SENDLENS_DB_PATH: path.join(tempDir, "workspace-cache.duckdb"),
    SENDLENS_STATE_DIR: tempDir,
    SENDLENS_PROVIDER: " smartlead ",
  });
  assert.equal(trimmedCheckResult.code, 0);
  assert.match(
    trimmedCheckResult.stderr,
    /SENDLENS_SMARTLEAD_API_KEY is not set for SENDLENS_PROVIDER=smartlead/,
  );
  assert.doesNotMatch(trimmedCheckResult.stderr, /Invalid SENDLENS_PROVIDER/);

  tempDir = resetEnv("trimmed-provider-start");
  await fs.mkdir(tempDir, { recursive: true });
  const pathWithoutNode = await createPathWithoutNode("trimmed-provider-start");
  const trimmedStartResult = await runScript(path.join(root, "scripts/start-mcp.sh"), {
    PLUGIN_ROOT: root,
    PATH: pathWithoutNode,
    SENDLENS_CONTEXT_ROOT: tempDir,
    SENDLENS_DB_PATH: path.join(tempDir, "workspace-cache.duckdb"),
    SENDLENS_STATE_DIR: tempDir,
    SENDLENS_PROVIDER: " smartlead ",
  });
  assert.equal(trimmedStartResult.code, 1);
  assert.match(
    trimmedStartResult.stderr,
    /SENDLENS_SMARTLEAD_API_KEY is not set for SENDLENS_PROVIDER=smartlead/,
  );
  assert.match(trimmedStartResult.stderr, /Node\.js is required/);
  assert.doesNotMatch(trimmedStartResult.stderr, /Invalid SENDLENS_PROVIDER/);

  tempDir = resetEnv("trimmed-provider-doctor");
  await fs.mkdir(tempDir, { recursive: true });
  const trimmedDoctorResult = await runScript(path.join(root, "scripts/sendlens-doctor.sh"), {
    PLUGIN_ROOT: root,
    SENDLENS_CONTEXT_ROOT: tempDir,
    SENDLENS_DB_PATH: path.join(tempDir, "workspace-cache.duckdb"),
    SENDLENS_STATE_DIR: tempDir,
    SENDLENS_PROVIDER: " smartlead ",
    SENDLENS_SMARTLEAD_API_KEY: smartleadValue,
  });
  assert.equal(trimmedDoctorResult.code, 0);
  assert.match(trimmedDoctorResult.stdout, /PASS  Source provider mode: smartlead/);
  assert.doesNotMatch(
    `${trimmedDoctorResult.stdout}\n${trimmedDoctorResult.stderr}`,
    /Invalid SENDLENS_PROVIDER/,
  );

  tempDir = resetEnv("stale-instantly-status-smartlead");
  await fs.mkdir(tempDir, { recursive: true });
  process.env.SENDLENS_PROVIDER = "smartlead";
  await fs.writeFile(
    path.join(tempDir, "refresh-status.json"),
    JSON.stringify({
      status: "idle",
      source: "session_start",
      message:
        "Session-start refresh skipped because SENDLENS_INSTANTLY_API_KEY is not set. Existing local DuckDB cache remains usable; configure the key before running refresh_data.",
      dbPath: process.env.SENDLENS_DB_PATH,
    }),
  );
  const smartleadRefreshStatus = await readRefreshStatus();
  assert.equal(smartleadRefreshStatus.status, "idle");
  assert.ok(!String(smartleadRefreshStatus.message).includes("SENDLENS_INSTANTLY_API_KEY"));
  assert.match(String(smartleadRefreshStatus.message), /SENDLENS_PROVIDER=smartlead/);

  tempDir = resetEnv("session-start-smartlead");
  await fs.mkdir(tempDir, { recursive: true });
  const sessionStartResult = await runScript(path.join(root, "scripts/session-start.sh"), {
    PLUGIN_ROOT: root,
    SENDLENS_CONTEXT_ROOT: tempDir,
    SENDLENS_DB_PATH: path.join(tempDir, "workspace-cache.duckdb"),
    SENDLENS_STATE_DIR: tempDir,
    SENDLENS_PROVIDER: " smartlead ",
    SENDLENS_SMARTLEAD_API_KEY: smartleadValue,
  });
  assert.equal(sessionStartResult.code, 0);
  assert.ok(!sessionStartResult.stderr.includes("SENDLENS_INSTANTLY_API_KEY"));
  assert.match(sessionStartResult.stderr, /does not use the Instantly session-start refresh/);
  const sessionStartStatus = JSON.parse(
    await fs.readFile(path.join(tempDir, "refresh-status.json"), "utf8"),
  );
  assert.ok(!sessionStartStatus.message.includes("SENDLENS_INSTANTLY_API_KEY"));
  assert.match(sessionStartStatus.message, /SENDLENS_PROVIDER=smartlead/);
} finally {
  globalThis.fetch = originalFetch;
  restoreEnv();
}
