#!/usr/bin/env node

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const tempRoot = path.join(os.tmpdir(), `sendlens-analyze-data-${process.pid}-${Date.now()}`);
const dbPath = path.join(tempRoot, "cache-db-path-canary.duckdb");
const canaries = [
  "diagnostic-sql-canary@example.invalid",
  "diagnostic-tag-canary",
  "diagnostic-row-canary",
  "cache-client-canary",
  "cache-context-canary",
  "cache-key-canary",
  "cache-db-path-canary",
  "parser-sql-canary",
  "binder-sql-canary",
  "runtime-sql-canary",
];

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["./build/plugin/server.js"],
  env: {
    ...process.env,
    SENDLENS_DB_PATH: dbPath,
    SENDLENS_STATE_DIR: path.join(tempRoot, "demo-state"),
    SENDLENS_CONTEXT_ROOT: path.join(tempRoot, "demo-context"),
    SENDLENS_DEMO_MODE: "1",
  },
  stderr: "pipe",
});
const demoStderr = captureStderr(transport);

const client = new Client({
  name: "sendlens-analyze-data-runtime-test",
  version: "0.0.0",
});

try {
  await client.connect(transport);

  const okPayload = await callAnalyzeData(client,
    "SELECT campaign_id, campaign_name FROM sendlens.campaign_overview WHERE campaign_id = 'demo-alpha'",
  );
  assert.equal(okPayload.row_count, 1);
  assert.equal(okPayload.diagnostics?.status, "ok");
  assert.equal(okPayload.diagnostics?.schema_version, "analyze_data_diagnostics.v1");
  assert.deepEqual(okPayload.diagnostics?.referenced_surfaces, ["campaign_overview"]);
  assert.equal(typeof okPayload.diagnostics?.elapsed_ms, "number");

  const zeroPayload = await callAnalyzeData(client,
    `SELECT campaign_id FROM sendlens.campaign_overview WHERE campaign_name = '${canaries[1]}'`,
  );
  assert.equal(zeroPayload.row_count, 0);
  assert.equal(zeroPayload.diagnostics?.status, "zero_rows");
  assertNoCanaries(zeroPayload);

  const guardPayload = await callAnalyzeData(client,
    `SELECT * FROM sendlens.schema_migrations WHERE migration_id = '${canaries[0]}'`,
  );
  assert.equal(guardPayload.error, "Query could not be executed safely.");
  assert.equal(guardPayload.code, "disallowed_table");
  assert.equal(guardPayload.diagnostics?.status, "guard_rejected");
  assertNoCanaries(guardPayload);

  const queryErrorPayload = await callAnalyzeData(client,
    `SELECT ${canaries[8]} FROM sendlens.campaign_overview WHERE campaign_name = '${canaries[2]}'`,
  );
  assert.equal(queryErrorPayload.error, "Query could not be executed safely.");
  assert.equal(queryErrorPayload.code, "query_error");
  assert.equal(queryErrorPayload.diagnostics?.status, "query_error");
  assert.deepEqual(queryErrorPayload.diagnostics?.referenced_surfaces, ["campaign_overview"]);
  assertNoCanaries(queryErrorPayload);

  const parserErrorPayload = await callAnalyzeData(client,
    `SELECT campaign_id FROM sendlens.campaign_overview WHERE ('${canaries[7]}'`,
  );
  assert.equal(parserErrorPayload.error, "Query could not be executed safely.");
  assertNoCanaries(parserErrorPayload);

  const runtimeErrorPayload = await callAnalyzeData(client,
    `SELECT CAST('${canaries[9]}' AS INTEGER) FROM sendlens.campaign_overview`,
  );
  assert.equal(runtimeErrorPayload.error, "Query could not be executed safely.");
  assert.equal(runtimeErrorPayload.code, "query_error");
  assertNoCanaries(runtimeErrorPayload);

  console.log("analyze_data runtime diagnostics tests passed");
} finally {
  await client.close();
}
assertNoCanariesInText(demoStderr.join(""), "demo analyze_data stderr");

const cacheFailureTransport = new StdioClientTransport({
  command: process.execPath,
  args: ["./build/plugin/server.js"],
  env: {
    ...process.env,
    SENDLENS_DB_PATH: dbPath,
    SENDLENS_STATE_DIR: path.join(tempRoot, "cache-state"),
    SENDLENS_CONTEXT_ROOT: path.join(tempRoot, "cache-context-canary"),
    SENDLENS_CLIENT: "cache-client-canary",
    SENDLENS_PROVIDER: "instantly",
    SENDLENS_INSTANTLY_API_KEY: "cache-key-canary",
    SENDLENS_DEMO_MODE: "",
  },
  stderr: "pipe",
});
const cacheFailureStderr = captureStderr(cacheFailureTransport);
const cacheFailureClient = new Client({
  name: "sendlens-analyze-data-cache-failure-test",
  version: "0.0.0",
});

try {
  await cacheFailureClient.connect(cacheFailureTransport);
  const cacheFailurePayload = await callAnalyzeData(
    cacheFailureClient,
    `SELECT campaign_id FROM sendlens.campaign_overview WHERE campaign_name = '${canaries[0]}'`,
  );
  assert.equal(cacheFailurePayload.error, "Query could not be executed safely.");
  assert.equal(cacheFailurePayload.code, "cache_unavailable");
  assert.equal(cacheFailurePayload.diagnostics?.status, "cache_unavailable");
  assertNoCanaries(cacheFailurePayload);
  for (const privateField of [
    "cache_owner",
    "expected_api_key_fingerprint_prefix",
    "selected_client_env",
    "db_path",
    "context_root",
    "loaded_env_files",
  ]) {
    assert.equal(
      Object.hasOwn(cacheFailurePayload, privateField),
      false,
      `analyze_data cache failures must omit ${privateField}`,
    );
  }
} finally {
  await cacheFailureClient.close();
}
assertNoCanariesInText(cacheFailureStderr.join(""), "cache-failure analyze_data stderr");

async function callAnalyzeData(client, sql) {
  const result = await client.callTool({
    name: "analyze_data",
    arguments: {
      sql,
      rationale: "runtime diagnostics contract test",
    },
  });
  assert.equal(result.content?.[0]?.type, "text");
  return JSON.parse(result.content[0].text);
}

function assertNoCanaries(payload) {
  const text = JSON.stringify(payload);
  assertNoCanariesInText(text, "payload");
  assert.equal(Object.hasOwn(payload, "sql"), false, "payloads must not expose SQL");
}

function assertNoCanariesInText(text, surface) {
  for (const canary of canaries) {
    assert.equal(text.includes(canary), false, `${surface} must not expose ${canary}`);
  }
}

function captureStderr(stdioTransport) {
  const chunks = [];
  stdioTransport.stderr?.on("data", (chunk) => chunks.push(String(chunk)));
  return chunks;
}
