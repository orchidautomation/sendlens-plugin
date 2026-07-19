#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const image = `sendlens-container-test:${process.pid}-${Date.now()}`;
const volumeDir = await fs.mkdtemp(path.join(os.tmpdir(), "sendlens-container-volume-"));
await fs.chmod(volumeDir, 0o777);
const authToken = "sendlens-container-private-canary-0123456789abcdef";
const commonEnv = [
  "-e", "SENDLENS_HTTP_BEARER_TOKEN=" + authToken,
  "-e", "SENDLENS_HTTP_ALLOWED_HOSTS=127.0.0.1,localhost",
  "-e", "SENDLENS_HTTP_MAX_SESSIONS=4",
  "-e", "SENDLENS_DEMO_MODE=1",
];
const containers = [];

try {
  await assertDockerignoreContract();
  await run("docker", ["build", "-t", image, "."], { cwd: root });
  await assertMissingAuthFails();
  await assertMissingProviderFails();
  const first = await startContainer();
  await callSetupDoctor(first.baseUrl);
  await stopContainer(first.id);

  const dbPath = path.join(volumeDir, "workspace-cache.duckdb");
  const statusPath = path.join(volumeDir, "state", "refresh-status.json");
  assert.equal(await exists(dbPath), true, "DuckDB cache must be created under /data");
  assert.equal(await exists(statusPath), true, "refresh state must be created under /data/state");

  const second = await startContainer();
  await callSetupDoctor(second.baseUrl);
  await stopContainer(second.id);

  console.log("Container lifecycle smoke tests passed");
} finally {
  await Promise.allSettled(containers.map((id) => stopContainer(id)));
  await resetVolumePermissions();
  await run("docker", ["rmi", "-f", image], { allowFailure: true });
  await fs.rm(volumeDir, { recursive: true, force: true });
}

async function assertMissingProviderFails() {
  const { code, stdout } = await run("docker", [
    "run",
    "--rm",
    "-e", "SENDLENS_HTTP_BEARER_TOKEN=" + authToken,
    "-e", "SENDLENS_HTTP_ALLOWED_HOSTS=localhost",
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
    "-e", "SENDLENS_HTTP_ALLOWED_HOSTS=localhost",
    image,
  ], { allowFailure: true });
  assert.notEqual(code, 0);
  assert.match(stdout, /SENDLENS_HTTP_BEARER_TOKEN is required/i);
}

async function startContainer() {
  const id = (await run("docker", [
    "run",
    "-d",
    "-p", "127.0.0.1::3000",
    "-v", `${volumeDir}:/data`,
    ...commonEnv,
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
  return { id, baseUrl };
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL("/health", baseUrl));
      if (response.ok) {
        const body = await response.json();
        assert.equal(body.transport, "http");
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(`container health did not become ready: ${lastError?.message ?? "timeout"}`);
}

async function callSetupDoctor(baseUrl) {
  const client = new Client({ name: "sendlens-container-smoke", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("/mcp", baseUrl), {
    requestInit: {
      headers: { Authorization: `Bearer ${authToken}` },
    },
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: "setup_doctor", arguments: {} });
    assert.equal(result.content?.[0]?.type, "text");
    assert.equal(JSON.stringify(result).includes(authToken), false);
    const seedResult = await client.callTool({ name: "seed_demo_workspace", arguments: {} });
    assert.equal(seedResult.content?.[0]?.type, "text");
    assert.equal(JSON.stringify(seedResult).includes(authToken), false);
    await transport.terminateSession();
  } finally {
    await client.close();
  }
}

async function stopContainer(id) {
  if (!id) return;
  await run("docker", ["stop", "--timeout", "10", id], { allowFailure: true });
  const index = containers.indexOf(id);
  if (index >= 0) containers.splice(index, 1);
}

async function resetVolumePermissions() {
  await run("docker", [
    "run",
    "--rm",
    "--user", "0",
    "--entrypoint", "/bin/sh",
    "-v", `${volumeDir}:/data`,
    image,
    "-c",
    "chmod -R a+rwX /data",
  ], { allowFailure: true });
}

async function assertDockerignoreContract() {
  const dockerignore = await fs.readFile(path.join(root, ".dockerignore"), "utf8");
  for (const pattern of [
    ".env",
    ".env.*",
    ".agent-artifacts/",
    ".sendlens/",
    ".sendlens-state/",
    ".private/",
    "*.duckdb",
    "*.duckdb.*",
    "*.log",
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

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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
