#!/usr/bin/env node

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const dbPath = path.join(
  os.tmpdir(),
  `sendlens-analyze-data-${process.pid}-${Date.now()}.duckdb`,
);
const canaries = [
  "diagnostic-sql-canary@example.invalid",
  "diagnostic-tag-canary",
  "diagnostic-row-canary",
];

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["./build/plugin/server.js"],
  env: {
    ...process.env,
    SENDLENS_DB_PATH: dbPath,
    SENDLENS_DEMO_MODE: "1",
  },
});

const client = new Client({
  name: "sendlens-analyze-data-runtime-test",
  version: "0.0.0",
});

try {
  await client.connect(transport);

  const okPayload = await callAnalyzeData(
    "SELECT campaign_id, campaign_name FROM sendlens.campaign_overview WHERE campaign_id = 'demo-alpha'",
  );
  assert.equal(okPayload.row_count, 1);
  assert.equal(okPayload.diagnostics?.status, "ok");
  assert.equal(okPayload.diagnostics?.schema_version, "analyze_data_diagnostics.v1");
  assert.deepEqual(okPayload.diagnostics?.referenced_surfaces, ["campaign_overview"]);
  assert.equal(typeof okPayload.diagnostics?.elapsed_ms, "number");

  const zeroPayload = await callAnalyzeData(
    `SELECT campaign_id FROM sendlens.campaign_overview WHERE campaign_name = '${canaries[1]}'`,
  );
  assert.equal(zeroPayload.row_count, 0);
  assert.equal(zeroPayload.diagnostics?.status, "zero_rows");
  assertNoCanaries(zeroPayload);

  const guardPayload = await callAnalyzeData(
    `SELECT * FROM sendlens.schema_migrations WHERE migration_id = '${canaries[0]}'`,
  );
  assert.equal(guardPayload.error, "Query could not be executed safely.");
  assert.equal(guardPayload.code, "disallowed_table");
  assert.equal(guardPayload.diagnostics?.status, "guard_rejected");
  assertNoCanaries(guardPayload);

  const queryErrorPayload = await callAnalyzeData(
    `SELECT missing_column FROM sendlens.campaign_overview WHERE campaign_name = '${canaries[2]}'`,
  );
  assert.equal(queryErrorPayload.error, "Query could not be executed safely.");
  assert.equal(queryErrorPayload.code, "query_error");
  assert.equal(queryErrorPayload.diagnostics?.status, "query_error");
  assert.deepEqual(queryErrorPayload.diagnostics?.referenced_surfaces, ["campaign_overview"]);
  assertNoCanaries(queryErrorPayload);

  console.log("analyze_data runtime diagnostics tests passed");
} finally {
  await client.close();
}

async function callAnalyzeData(sql) {
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
  for (const canary of canaries) {
    assert.equal(text.includes(canary), false, `payload must not expose ${canary}`);
  }
  assert.equal(Object.hasOwn(payload, "sql"), false, "payloads must not expose SQL");
}
