#!/usr/bin/env node

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const dbPath = path.join(
  os.tmpdir(),
  `sendlens-load-campaign-data-${process.pid}-${Date.now()}.duckdb`,
);

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
  name: "sendlens-load-campaign-data-runtime-test",
  version: "0.0.0",
});

try {
  await client.connect(transport);
  const result = await client.callTool({
    name: "load_campaign_data",
    arguments: {
      campaign_id: "demo-alpha",
    },
  });

  assert.equal(result.content?.[0]?.type, "text");
  const payload = JSON.parse(result.content[0].text);

  assert.equal(payload.schema_version, "load_campaign_data.v2");
  assert.equal(payload.refresh_metadata.requested_campaign_id, "demo-alpha");
  assert.equal(payload.refresh_metadata.full_refresh_result_included, false);
  assert.equal(payload.refreshed, undefined);
  assert.equal(payload.rendered_outbound_sample, undefined);

  const summary = payload.rendered_outbound_summary;
  assert.equal(summary.raw_rows_included, false);
  assert.equal(summary.raw_row_limit, 0);
  assert.equal(summary.sampled_row_count > 0, true);
  assert.equal(summary.redacted_preview.length > 0, true);
  assert.equal(summary.redacted_preview.length <= 3, true);

  const previewRow = summary.redacted_preview[0];
  assert.equal(previewRow.recipient, "[redacted]");
  assert.equal(previewRow.sender, "[redacted]");
  assert.ok(previewRow.rendered_subject_preview);
  assert.ok(previewRow.rendered_body_preview);
  assert.equal(Object.hasOwn(previewRow, "to_email"), false);
  assert.equal(Object.hasOwn(previewRow, "from_email"), false);

  console.log("load_campaign_data runtime tests passed");
} finally {
  await client.close();
}
