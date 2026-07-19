#!/usr/bin/env node

import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const privateCanary = "sendlens-http-private-canary-0123456789abcdef";
const wrongCanary = "sendlens-http-wrong-canary-0123456789abcdef";
const bodyCanary = "sendlens-http-body-canary";
const logLines = [];

process.env.SENDLENS_DEMO_MODE = "1";
process.env.SENDLENS_STATE_DIR = path.join(os.tmpdir(), `sendlens-http-${process.pid}-${Date.now()}`);

const { createSendLensServer, resolveTransportMode } = await import("../build/plugin/server.js");
const { resolveHttpTransportConfig, startSendLensHttpServer } = await import("../build/plugin/http-transport.js");

assert.equal(resolveTransportMode({}), "stdio");
assert.equal(resolveTransportMode({ SENDLENS_TRANSPORT: "http" }), "http");
assert.throws(
  () => resolveTransportMode({ SENDLENS_TRANSPORT: "websocket" }),
  /SENDLENS_TRANSPORT must be either stdio or http/,
);

assert.throws(
  () => resolveHttpTransportConfig({ SENDLENS_TRANSPORT: "http" }),
  /credential/i,
);
assert.throws(
  () => resolveHttpTransportConfig(httpEnv({ credential: "too-short" })),
  /32 UTF-8 bytes/i,
);
assert.throws(
  () => resolveHttpTransportConfig(httpEnv({ host: "0.0.0.0", allowedHosts: "" })),
  /non-loopback/i,
);
assert.throws(
  () => resolveHttpTransportConfig(httpEnv({ allowedOrigins: "https://example.com/path" })),
  /origin/i,
);

await testStdioDefault();

const controller = await startSendLensHttpServer({
  createServer: createSendLensServer,
  env: httpEnv(),
  logger: (line) => logLines.push(line),
});

try {
  await testHealth(controller.url);
  await testBoundaryFailures(controller.url);
  await testOfficialClient(controller);
} finally {
  await controller.close();
  await controller.close();
}

assert.equal(controller.activeConnectionCount(), 0);
assertNoCanaries(logLines.join("\n"));
console.log("Streamable HTTP transport tests passed");

async function testStdioDefault() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["./build/plugin/server.js"],
    env: {
      ...process.env,
      SENDLENS_TRANSPORT: "",
      SENDLENS_DEMO_MODE: "1",
      SENDLENS_STATE_DIR: process.env.SENDLENS_STATE_DIR,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "sendlens-stdio-parity-test", version: "0.0.0" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some(({ name }) => name === "setup_doctor"));
  } finally {
    await client.close();
  }
}

async function testHealth(baseUrl) {
  const response = await fetch(new URL("/health", baseUrl));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    version: controller.version,
    transport: "http",
  });
}

async function testBoundaryFailures(baseUrl) {
  const endpoint = new URL("/mcp", baseUrl);
  const missing = await fetch(endpoint, { method: "POST", body: "{}", headers: jsonHeaders() });
  assert.equal(missing.status, 401);

  const wrong = await fetch(endpoint, {
    method: "POST",
    body: "{}",
    headers: requestHeaders(wrongCanary),
  });
  assert.equal(wrong.status, 401);
  assert.deepEqual(await wrong.json(), await missing.json());

  const invalidInitialization = await fetch(endpoint, {
    method: "POST",
    body: "{}",
    headers: requestHeaders(privateCanary),
  });
  assert.equal(invalidInitialization.status, 400);

  const missingId = await fetch(endpoint, {
    method: "GET",
    headers: requestHeaders(privateCanary),
  });
  assert.equal(missingId.status, 400);

  const unknownIdHeaders = requestHeaders(privateCanary);
  unknownIdHeaders.set("Mcp-Session-Id", "unknown-connection-canary");
  const unknownId = await fetch(endpoint, { method: "GET", headers: unknownIdHeaders });
  assert.equal(unknownId.status, 404);

  const deniedOrigin = await fetch(endpoint, {
    method: "POST",
    body: "{}",
    headers: requestHeaders(privateCanary, { Origin: "https://denied.example" }),
  });
  assert.equal(deniedOrigin.status, 403);

  const deniedHost = await rawRequest(endpoint, {
    Host: "denied.example",
    Authorization: authValue(privateCanary),
    "Content-Type": "application/json",
  });
  assert.equal(deniedHost.status, 403);

  const preflight = await fetch(endpoint, {
    method: "OPTIONS",
    headers: {
      Origin: "https://allowed.example",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type,mcp-protocol-version",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://allowed.example");
  assert.equal(preflight.headers.get("vary"), "Origin");

  const malformed = await fetch(endpoint, {
    method: "POST",
    body: `{${bodyCanary}`,
    headers: requestHeaders(privateCanary),
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.text()).includes(bodyCanary), false);

  const oversized = await fetch(endpoint, {
    method: "POST",
    body: JSON.stringify({ value: bodyCanary.repeat(8_000) }),
    headers: requestHeaders(privateCanary),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.text()).includes(bodyCanary), false);
}

async function testOfficialClient(activeController) {
  const transport = new StreamableHTTPClientTransport(new URL("/mcp", activeController.url), {
    requestInit: { headers: requestHeaders(privateCanary) },
  });
  const client = new Client({ name: "sendlens-http-test", version: "0.0.0" });

  try {
    await client.connect(transport);
    assert.equal(activeController.activeConnectionCount(), 1);
    const blockedTransport = new StreamableHTTPClientTransport(new URL("/mcp", activeController.url), {
      requestInit: { headers: requestHeaders(privateCanary) },
    });
    const blockedClient = new Client({ name: "sendlens-http-cap-test", version: "0.0.0" });
    await assert.rejects(() => blockedClient.connect(blockedTransport), /503|capacity/i);
    await blockedClient.close();
    assert.equal(activeController.activeConnectionCount(), 1);
    const tools = await client.listTools();
    assert.ok(tools.tools.some(({ name }) => name === "setup_doctor"));
    const result = await client.callTool({ name: "setup_doctor", arguments: {} });
    assert.equal(result.content?.[0]?.type, "text");
    await transport.terminateSession();
    assert.equal(activeController.activeConnectionCount(), 0);
  } finally {
    await client.close();
  }
}

function httpEnv({ credential = privateCanary, host = "127.0.0.1", allowedHosts = "localhost,127.0.0.1,[::1]", allowedOrigins = "https://allowed.example" } = {}) {
  return {
    SENDLENS_TRANSPORT: "http",
    SENDLENS_HTTP_HOST: host,
    SENDLENS_HTTP_PORT: "0",
    SENDLENS_HTTP_ALLOWED_HOSTS: allowedHosts,
    SENDLENS_HTTP_ALLOWED_ORIGINS: allowedOrigins,
    SENDLENS_HTTP_BEARER_TOKEN: credential,
    SENDLENS_HTTP_MAX_SESSIONS: "1",
  };
}

function requestHeaders(credential, extra = {}) {
  const headers = new Headers({ "Content-Type": "application/json", ...extra });
  headers.set("Authorization", authValue(credential));
  return headers;
}

function authValue(credential) {
  return `Bearer ${credential}`;
}

function rawRequest(url, headers) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method: "POST", headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
    request.end("{}");
  });
}

function jsonHeaders(extra = {}) {
  return { "Content-Type": "application/json", ...extra };
}

function assertNoCanaries(text) {
  for (const canary of [privateCanary, wrongCanary, bodyCanary]) {
    assert.equal(text.includes(canary), false, `logs must not contain ${canary}`);
  }
}
