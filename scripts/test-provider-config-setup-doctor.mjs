import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
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
const { buildSetupDoctorReport } = require("../build/plugin/setup-doctor.js");

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

try {
  assert.deepEqual(resolveSourceProviderMode(undefined), {
    mode: "instantly",
    raw: null,
    valid: true,
    defaulted: true,
  });
  assert.equal(resolveSourceProviderMode("SMARTLEAD").mode, "smartlead");
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
  assert.equal(report.capabilities.live_refresh, false);
  assert.equal(report.capabilities.demo_seed, true);
  assert.equal(report.capabilities.smartlead_key_validated, true);
  assert.equal(findCheck(report, "Smartlead credentials")?.status, "pass");
  assertNoSensitiveValue(report, smartleadValue);
  assert.ok(
    report.next_steps.some((step) => step.includes("Smartlead provider configuration is ready")),
  );
  assert.ok(report.next_steps.some((step) => step.includes("seed_demo_workspace")));
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
  assert.equal(findCheck(report, "Instantly credentials")?.status, "pass");
  assert.equal(findCheck(report, "Smartlead credentials")?.status, "pass");
  assertNoSensitiveValue(report, smartleadValue);

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
} finally {
  globalThis.fetch = originalFetch;
  restoreEnv();
}
