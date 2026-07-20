#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const { assertContainerStartupReady, loadSendLensEnv } = await import("../build/plugin/env.js");
const { buildSetupDoctorReport } = await import("../build/plugin/setup-doctor.js");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sendlens-container-config-"));
const clientsDir = path.join(tempRoot, "clients");
const dbPath = path.join(tempRoot, "workspace-cache.duckdb");
const stateDir = path.join(tempRoot, "state");
const operatorCredential = `operator-${"a".repeat(40)}`;
const originalEnv = { ...process.env };

try {
  await fs.mkdir(clientsDir, { recursive: true });
  await fs.writeFile(path.join(tempRoot, "." + "env"), [
    "SENDLENS_HTTP_ALLOWED_ORIGINS=https://overlay.invalid",
    "SENDLENS_HTTP_MAX_SESSIONS=999",
    "SENDLENS_HTTP_HOST=127.0.0.1",
    "SENDLENS_DEMO_MODE=1",
  ].join("\n"));
  await fs.writeFile(path.join(clientsDir, "acme.env"), [
    "SENDLENS_INSTANTLY_API_KEY=synthetic-overlay-provider-key",
    "SENDLENS_PROVIDER=$" + "{SENDLENS_HTTP_BEARER_TOKEN}",
    `SENDLENS_HTTP_BEARER_TOKEN=overlay-${"b".repeat(40)}`,
    "SENDLENS_HTTP_ALLOWED_HOSTS=overlay.invalid",
    "SENDLENS_HTTP_HOST=127.0.0.1",
    "SENDLENS_TRANSPORT=stdio",
    "SENDLENS_CONTAINER=0",
    "SENDLENS_DATA_DIR=relative-data",
    "SENDLENS_DB_PATH=relative-cache.duckdb",
    "SENDLENS_STATE_DIR=relative-state",
  ].join("\n"));

  Object.assign(process.env, {
    SENDLENS_CONTAINER: "1",
    SENDLENS_TRANSPORT: "http",
    SENDLENS_CONTEXT_ROOT: tempRoot,
    SENDLENS_CLIENTS_DIR: clientsDir,
    SENDLENS_CLIENT: "acme",
    SENDLENS_DATA_DIR: tempRoot,
    SENDLENS_DB_PATH: dbPath,
    SENDLENS_STATE_DIR: stateDir,
    SENDLENS_HTTP_HOST: "0.0.0.0",
    SENDLENS_HTTP_BEARER_TOKEN: operatorCredential,
    SENDLENS_HTTP_ALLOWED_HOSTS: "sendlens.example.com",
  });
  delete process.env.SENDLENS_INSTANTLY_API_KEY;
  delete process.env.SENDLENS_SMARTLEAD_API_KEY;
  delete process.env.SENDLENS_DEMO_MODE;

  loadSendLensEnv();

  assert.equal(process.env.SENDLENS_INSTANTLY_API_KEY, "synthetic-overlay-provider-key");
  assert.equal(process.env.SENDLENS_HTTP_BEARER_TOKEN, operatorCredential);
  assert.equal(process.env.SENDLENS_HTTP_ALLOWED_HOSTS, "sendlens.example.com");
  assert.equal(process.env.SENDLENS_HTTP_HOST, "0.0.0.0");
  assert.equal(process.env.SENDLENS_HTTP_ALLOWED_ORIGINS, undefined);
  assert.equal(process.env.SENDLENS_HTTP_MAX_SESSIONS, undefined);
  assert.equal(process.env.SENDLENS_TRANSPORT, "http");
  assert.equal(process.env.SENDLENS_CONTAINER, "1");
  assert.equal(process.env.SENDLENS_DEMO_MODE, undefined);
  assert.equal(process.env.SENDLENS_PROVIDER, undefined);
  assert.equal(process.env.SENDLENS_DATA_DIR, tempRoot);
  assert.equal(process.env.SENDLENS_DB_PATH, dbPath);
  assert.equal(process.env.SENDLENS_STATE_DIR, stateDir);
  assert.doesNotThrow(() => assertContainerStartupReady());
  assertProviderCredentialMatrix();

  process.env.SENDLENS_DEMO_MODE = "1";
  await fs.mkdir(stateDir, { recursive: true });
  const doctor = await buildSetupDoctorReport();
  assert.equal(doctor.deployment.runtime, "container");
  assert.equal(doctor.deployment.transport, "http");
  assert.equal(doctor.deployment.container.data_root, tempRoot);
  assert.equal(doctor.deployment.container.persistent_paths_under_data_root, true);
  assert.equal(doctor.deployment.container.http.bearer_credential_configured, true);
  assert.deepEqual(doctor.deployment.container.http.allowed_hosts, ["sendlens.example.com"]);
  assert.equal(
    doctor.docs.container_deployment,
    "https://github.com/orchidautomation/sendlens-plugin/blob/main/docs/CONTAINER_DEPLOYMENT.md",
  );
  assert.equal(JSON.stringify(doctor).includes(operatorCredential), false);
  assert.equal(JSON.stringify(doctor).includes("synthetic-overlay-provider-key"), false);

  process.env.SENDLENS_CONTEXT_ROOT = path.join(os.tmpdir(), "sendlens-container-external-context");
  const externalPathDoctor = await buildSetupDoctorReport();
  assert.equal(externalPathDoctor.deployment.container.persistent_paths_under_data_root, false);
  assert.equal(
    externalPathDoctor.checks.find((check) => check.name === "Container deployment")?.status,
    "warn",
  );

  delete process.env.SENDLENS_INSTANTLY_API_KEY;
  delete process.env.SENDLENS_DEMO_MODE;
  assert.throws(() => assertContainerStartupReady(), /provider API key/i);
  process.env.SENDLENS_DEMO_MODE = "1";
  assert.doesNotThrow(() => assertContainerStartupReady());

  console.log("Container configuration contract tests passed");
} finally {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  await fs.rm(tempRoot, { recursive: true, force: true });
}

function assertProviderCredentialMatrix() {
  const base = {
    SENDLENS_CONTAINER: "1",
    SENDLENS_DB_PATH: path.join(tempRoot, "missing-provider-matrix.duckdb"),
  };
  const instantlyKey = { SENDLENS_INSTANTLY_API_KEY: "synthetic-instantly-key" };
  const smartleadKey = { SENDLENS_SMARTLEAD_API_KEY: "synthetic-smartlead-key" };

  assert.doesNotThrow(() => assertContainerStartupReady({ ...base, ...instantlyKey }));
  assert.doesNotThrow(() => assertContainerStartupReady({ ...base, ...smartleadKey }));
  assert.doesNotThrow(() => assertContainerStartupReady({ ...base, SENDLENS_PROVIDER: "instantly", ...instantlyKey }));
  assert.throws(
    () => assertContainerStartupReady({ ...base, SENDLENS_PROVIDER: "instantly", ...smartleadKey }),
    /provider API key/i,
  );
  assert.doesNotThrow(() => assertContainerStartupReady({ ...base, SENDLENS_PROVIDER: "smartlead", ...smartleadKey }));
  assert.throws(
    () => assertContainerStartupReady({ ...base, SENDLENS_PROVIDER: "smartlead", ...instantlyKey }),
    /provider API key/i,
  );
  assert.doesNotThrow(() => assertContainerStartupReady({ ...base, SENDLENS_PROVIDER: "all", ...instantlyKey }));
  assert.doesNotThrow(() => assertContainerStartupReady({ ...base, SENDLENS_PROVIDER: "all", ...smartleadKey }));
}
