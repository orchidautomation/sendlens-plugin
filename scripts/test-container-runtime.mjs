#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const image = `sendlens-container-test:${process.pid}-${Date.now()}`;
const volumeName = `sendlens-container-volume-${process.pid}-${Date.now()}`;
const overlayVolumeName = `${volumeName}-overlay`;
const allowedHost = "sendlens.example.com";
const authToken = "sendlens-container-private-canary-0123456789abcdef";
const commonEnv = [
  "-e", "SENDLENS_HTTP_BEARER_TOKEN=" + authToken,
  "-e", "SENDLENS_HTTP_ALLOWED_HOSTS=" + allowedHost,
  "-e", "SENDLENS_HTTP_MAX_SESSIONS=4",
];
const containers = [];
const volumes = [volumeName, overlayVolumeName];

try {
  await assertDockerignoreContract();
  await run("docker", ["build", "-t", image, "."], { cwd: root });
  await Promise.all(volumes.map((volume) => run("docker", ["volume", "create", volume])));
  await assertNonRootRuntime();
  await assertMissingAuthFails();
  await assertMissingProviderFails();
  await assertRelativePersistencePathFails();
  await assertExternalPersistencePathFails();
  await assertReadOnlyPersistenceFails();
  await assertCustomBindHealth();

  const first = await startContainer({ volume: volumeName, demoMode: true });
  const firstSnapshot = await callSetupDoctor(first.baseUrl, { seedDemo: true, readSnapshot: true });
  await stopContainer(first.id);
  await assertPersistentFiles(volumeName);

  const second = await startContainer({ volume: volumeName, demoMode: false });
  const secondSnapshot = await callSetupDoctor(second.baseUrl, { seedDemo: false, readSnapshot: true });
  assert.deepEqual(secondSnapshot, firstSnapshot, "workspace data must survive a restart without reseeding");
  await stopContainer(second.id);

  await assertOverlayOnlyProviderBoots();

  console.log("Container lifecycle smoke tests passed");
} finally {
  await Promise.allSettled(containers.map((id) => run("docker", ["rm", "-f", id], { allowFailure: true })));
  await run("docker", ["rmi", "-f", image], { allowFailure: true });
  await Promise.allSettled(volumes.map((volume) => run("docker", ["volume", "rm", "-f", volume], { allowFailure: true })));
}

async function assertMissingProviderFails() {
  const { code, stdout } = await run("docker", [
    "run",
    "--rm",
    "-e", "SENDLENS_HTTP_BEARER_TOKEN=" + authToken,
    "-e", "SENDLENS_HTTP_ALLOWED_HOSTS=" + allowedHost,
    image,
  ], { allowFailure: true });
  assert.notEqual(code, 0);
  assert.match(stdout, /provider API key|SENDLENS_DEMO_MODE|DuckDB cache/i);
}

async function assertMissingAuthFails() {
  const { code, stdout } = await run("docker", [
    "run",
    "--rm",
    "-e", "SENDLENS_DEMO_MODE=1",
    "-e", "SENDLENS_HTTP_ALLOWED_HOSTS=" + allowedHost,
    image,
  ], { allowFailure: true });
  assert.notEqual(code, 0);
  assert.match(stdout, /SENDLENS_HTTP_BEARER_TOKEN is required/i);
}

async function assertRelativePersistencePathFails() {
  const { code, stdout } = await run("docker", [
    "run",
    "--rm",
    "-e", "SENDLENS_DEMO_MODE=1",
    "-e", "SENDLENS_HTTP_BEARER_TOKEN=" + authToken,
    "-e", "SENDLENS_HTTP_ALLOWED_HOSTS=" + allowedHost,
    "-e", "SENDLENS_DB_PATH=relative-cache.duckdb",
    image,
  ], { allowFailure: true });
  assert.notEqual(code, 0);
  assert.match(stdout, /SENDLENS_DB_PATH must be an absolute persistent path/i);
}

async function assertExternalPersistencePathFails() {
  const { code, stdout } = await run("docker", [
    "run",
    "--rm",
    "-e", "SENDLENS_DEMO_MODE=1",
    "-e", "SENDLENS_HTTP_BEARER_TOKEN=" + authToken,
    "-e", "SENDLENS_HTTP_ALLOWED_HOSTS=" + allowedHost,
    "-e", "SENDLENS_DB_PATH=/tmp/ephemeral-cache.duckdb",
    image,
  ], { allowFailure: true });
  assert.notEqual(code, 0);
  assert.match(stdout, /SENDLENS_DB_PATH must resolve under SENDLENS_DATA_DIR/i);
}

async function assertNonRootRuntime() {
  await run("docker", [
    "run",
    "--rm",
    "--entrypoint", "/bin/sh",
    "-v", `${volumeName}:/data`,
    image,
    "-c",
    "test \"$(id -u)\" = 10001 && test ! -w /app && test ! -w /app/build/plugin/server.js && : > /data/.sendlens-runtime-write-probe && rm /data/.sendlens-runtime-write-probe",
  ]);
}

async function assertReadOnlyPersistenceFails() {
  const { code, stdout } = await run("docker", [
    "run",
    "--rm",
    "--read-only",
    "-v", `${volumeName}:/data:ro`,
    "-e", "SENDLENS_DEMO_MODE=1",
    "-e", "SENDLENS_HTTP_BEARER_TOKEN=" + authToken,
    "-e", "SENDLENS_HTTP_ALLOWED_HOSTS=" + allowedHost,
    image,
  ], { allowFailure: true });
  assert.notEqual(code, 0);
  assert.match(stdout, /SENDLENS_DATA_DIR.*(?:not writable|could not be created)/i);
}

async function assertCustomBindHealth() {
  const id = (await run("docker", [
    "run",
    "-d",
    "--health-interval", "1s",
    "--health-start-period", "1s",
    "-v", `${volumeName}:/data`,
    ...commonEnv,
    "-e", "SENDLENS_DEMO_MODE=1",
    "-e", "SENDLENS_HTTP_HOST=::1",
    image,
  ])).stdout.trim();
  containers.push(id);
  await waitForDockerHealth(id);
  await stopContainer(id);
}

async function startContainer({ volume, demoMode, extraEnv = [] }) {
  const env = [
    ...commonEnv,
    ...(demoMode ? ["-e", "SENDLENS_DEMO_MODE=1"] : []),
    ...extraEnv,
  ];
  const id = (await run("docker", [
    "run",
    "-d",
    "--health-interval", "1s",
    "--health-start-period", "1s",
    "-p", "127.0.0.1::3000",
    "-v", `${volume}:/data`,
    ...env,
    image,
  ])).stdout.trim();
  containers.push(id);

  const inspect = JSON.parse((await run("docker", [
    "inspect",
    id,
    "--format",
    "{{json .NetworkSettings.Ports}}",
  ])).stdout);
  const port = inspect["3000/tcp"][0].HostPort;
  const baseUrl = new URL(`http://127.0.0.1:${port}`);
  await waitForHealth(baseUrl);
  await waitForDockerHealth(id);
  return { id, baseUrl };
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithAllowedHost(new URL("/health", baseUrl), {
        headers: { Host: allowedHost },
      });
      if (response.ok) {
        const body = await response.json();
        assert.equal(body.transport, "http");
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(`container health did not become ready: ${lastError?.message ?? "timeout"}`);
}

async function waitForDockerHealth(id) {
  const deadline = Date.now() + 30_000;
  let status = "starting";
  while (Date.now() < deadline) {
    status = (await run("docker", [
      "inspect",
      id,
      "--format",
      "{{.State.Health.Status}}",
    ])).stdout.trim();
    if (status === "healthy") return;
    await sleep(500);
  }
  throw new Error(`Docker healthcheck did not report healthy (last status: ${status})`);
}

async function callSetupDoctor(baseUrl, { seedDemo, readSnapshot }) {
  const client = new Client({ name: "sendlens-container-smoke", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("/mcp", baseUrl), {
    fetch: fetchWithAllowedHost,
    requestInit: {
      headers: {
        Authorization: `Bearer ${authToken}`,
        Host: allowedHost,
      },
    },
  });
  try {
    let snapshotCanary;
    await client.connect(transport);
    const result = await client.callTool({ name: "setup_doctor", arguments: {} });
    assert.equal(result.content?.[0]?.type, "text");
    assert.equal(JSON.stringify(result).includes(authToken), false);
    if (seedDemo) {
      const seedResult = await client.callTool({ name: "seed_demo_workspace", arguments: {} });
      assert.equal(seedResult.content?.[0]?.type, "text");
      assert.equal(JSON.stringify(seedResult).includes(authToken), false);
    }
    if (readSnapshot) {
      const snapshotResult = await client.callTool({ name: "workspace_snapshot", arguments: {} });
      const snapshot = JSON.parse(snapshotResult.content?.[0]?.text ?? "null");
      assert.equal(snapshot.schema_version, "workspace_snapshot.v1");
      snapshotCanary = {
        workspaceId: snapshot.workspaceId,
        campaignCount: snapshot.exact_metrics?.campaign_count,
        totalSent: snapshot.exact_metrics?.total_sent,
        totalReplies: snapshot.exact_metrics?.total_unique_replies,
      };
    }
    await transport.terminateSession();
    return snapshotCanary;
  } finally {
    await client.close();
  }
}

function fetchWithAllowedHost(input, init = {}) {
  const target = new URL(input);
  const method = init.method ?? "GET";
  const headers = Object.fromEntries(new Headers(init.headers));
  headers.host = allowedHost;

  return new Promise((resolve, reject) => {
    const request = http.request(target, {
      method,
      headers,
      signal: init.signal,
    }, (response) => {
      const responseHeaders = new Headers();
      for (let index = 0; index < response.rawHeaders.length; index += 2) {
        responseHeaders.append(response.rawHeaders[index], response.rawHeaders[index + 1]);
      }
      const status = response.statusCode ?? 500;
      const hasBody = method !== "HEAD" && ![204, 205, 304].includes(status);
      resolve(new Response(hasBody ? Readable.toWeb(response) : null, {
        status,
        statusText: response.statusMessage,
        headers: responseHeaders,
      }));
    });
    request.once("error", reject);
    if (init.body == null) {
      request.end();
      return;
    }
    assert.equal(typeof init.body, "string", "container smoke fetch expects string request bodies");
    request.end(init.body);
  });
}

async function stopContainer(id) {
  if (!id) return;
  await run("docker", ["stop", "--timeout", "10", id]);
  const state = JSON.parse((await run("docker", [
    "inspect",
    id,
    "--format",
    "{{json .State}}",
  ])).stdout);
  assert.equal(state.OOMKilled, false, "container must not be OOM-killed during shutdown");
  assert.equal(state.ExitCode, 0, "container must exit cleanly from SIGTERM without SIGKILL fallback");
  await run("docker", ["rm", id]);
  const index = containers.indexOf(id);
  if (index >= 0) containers.splice(index, 1);
}

async function assertPersistentFiles(volume) {
  await run("docker", [
    "run",
    "--rm",
    "--entrypoint", "/bin/sh",
    "-v", `${volume}:/data`,
    image,
    "-c",
    "test -f /data/workspace-cache.duckdb && test -f /data/state/refresh-status.json",
  ]);
}

async function assertOverlayOnlyProviderBoots() {
  const overlayContent = [
    "SENDLENS_INSTANTLY_API_KEY=synthetic-overlay-provider-key",
    `SENDLENS_HTTP_BEARER_TOKEN=overlay-${"b".repeat(40)}`,
    "SENDLENS_HTTP_ALLOWED_HOSTS=overlay.invalid",
    "SENDLENS_HTTP_HOST=127.0.0.1",
    "SENDLENS_TRANSPORT=stdio",
    "SENDLENS_CONTAINER=0",
  ].join("\n");
  await run("docker", [
    "run",
    "--rm",
    "--user", "0",
    "--entrypoint", "/bin/sh",
    "-v", `${overlayVolumeName}:/data`,
    "-e", `SENDLENS_TEST_OVERLAY=${overlayContent}`,
    image,
    "-c",
    "mkdir -p /data/clients && printf '%s\\n' \"$SENDLENS_TEST_OVERLAY\" > /data/clients/acme.env && chown -R 10001:10001 /data",
  ]);

  const container = await startContainer({
    volume: overlayVolumeName,
    demoMode: false,
    extraEnv: ["-e", "SENDLENS_CLIENT=acme"],
  });
  await callSetupDoctor(container.baseUrl, { seedDemo: false, readSnapshot: false });
  await stopContainer(container.id);
}

async function assertDockerignoreContract() {
  const dockerignore = await fs.readFile(path.join(root, ".dockerignore"), "utf8");
  const rules = dockerignore.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  assert.equal(rules.some((rule) => rule.startsWith("!")), false, "secret exclusions must not be negated");
  for (const pattern of [
    ".env",
    ".env.*",
    ".npmrc",
    ".agent-artifacts/",
    ".sendlens/",
    ".sendlens-state/",
    ".private/",
    "*.duckdb",
    "*.duckdb.*",
    "*.key",
    "*.log",
    "*.p12",
    "*.pfx",
    "*.pem",
    "site/passthrough/",
    "passthrough/runtime/state/",
  ]) {
    assert.match(dockerignore, new RegExp(escapeRegExp(pattern)));
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || options.allowFailure) {
        resolve({ code, stdout: stdout + stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit ${code}`));
    });
  });
}
