#!/usr/bin/env node

import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { DuckDBInstance, version as duckDbVersion } from "@duckdb/node-api";

const require = createRequire(import.meta.url);
const nodeApiPackage = require("@duckdb/node-api/package.json");
const nodeBindingsPackage = require("@duckdb/node-bindings/package.json");

const ROWS = Number.parseInt(process.env.SENDLENS_DUCKDB_BENCH_ROWS ?? "80000", 10);
const SAFE_ROWS = Number.isFinite(ROWS) && ROWS > 0 ? ROWS : 80000;

const root = await mkdtemp(path.join(os.tmpdir(), "sendlens-duckdb-runtime-"));

try {
  const scenarios = [
    {
      name: "default",
      options: {},
    },
    {
      name: "bounded",
      options: {
        memory_limit: process.env.SENDLENS_DUCKDB_BENCH_MEMORY_LIMIT ?? "256MB",
        threads: process.env.SENDLENS_DUCKDB_BENCH_THREADS ?? "2",
        temp_directory: path.join(root, "bounded.tmp"),
        max_temp_directory_size: process.env.SENDLENS_DUCKDB_BENCH_MAX_TEMP ?? "512MB",
      },
    },
  ];

  const results = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(scenario));
  }

  const variant = await runVariantProbe();

  console.log(JSON.stringify({
    generated_at: new Date().toISOString(),
    row_count: SAFE_ROWS,
    versions: {
      duckdb_engine: duckDbVersion(),
      node_api_package: nodeApiPackage.version,
      node_bindings_package: nodeBindingsPackage.version,
    },
    scenarios: results,
    variant,
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}

async function runScenario({ name, options }) {
  const dbPath = path.join(root, `${name}.duckdb`);
  const instance = await DuckDBInstance.create(dbPath, options);
  const conn = await instance.connect();
  const tempDir = options.temp_directory ?? `${dbPath}.tmp`;

  try {
    const settings = await readSettings(conn, [
      "memory_limit",
      "threads",
      "temp_directory",
      "max_temp_directory_size",
      "storage_compatibility_version",
    ]);

    const ingest = await timed(async () => {
      await conn.run(`
        CREATE TABLE synthetic_lead_events AS
        SELECT
          'ws_bench' AS workspace_id,
          'campaign_' || lpad(CAST(i % 64 AS VARCHAR), 2, '0') AS campaign_id,
          'lead_' || CAST(i AS VARCHAR) AS lead_id,
          i % 17 AS sender_bucket,
          i % 5 AS variant,
          CASE WHEN i % 19 = 0 THEN 'positive'
               WHEN i % 11 = 0 THEN 'negative'
               ELSE 'neutral'
          END AS reply_label,
          ('{"title":"Director","company_size":' || CAST(50 + (i % 1000) AS VARCHAR) ||
            ',"region":"' || CASE WHEN i % 3 = 0 THEN 'na' WHEN i % 3 = 1 THEN 'emea' ELSE 'apac' END ||
            '","score":' || CAST(i % 100 AS VARCHAR) || '}') AS custom_payload
        FROM range(${SAFE_ROWS}) AS r(i)
      `);
      await conn.run(`
        CREATE TABLE synthetic_campaigns AS
        SELECT DISTINCT
          workspace_id,
          campaign_id,
          'Campaign ' || campaign_id AS campaign_name
        FROM synthetic_lead_events
      `);
      await conn.run("CHECKPOINT");
    });

    const internalWork = await timed(async () => {
      const reader = await conn.runAndReadAll(`
        SELECT
          c.campaign_id,
          count(*) AS touched_rows,
          sum(CASE WHEN e.reply_label = 'positive' THEN 1 ELSE 0 END) AS positives,
          approx_count_distinct(e.lead_id) AS approximate_leads,
          string_agg(DISTINCT e.reply_label, ', ' ORDER BY e.reply_label) AS labels
        FROM synthetic_lead_events e
        JOIN synthetic_campaigns c
          ON c.workspace_id = e.workspace_id
         AND c.campaign_id = e.campaign_id
        GROUP BY c.campaign_id
        ORDER BY positives DESC, touched_rows DESC
        LIMIT 8
      `);
      return reader.getRowObjectsJson();
    });

    const fileSizes = {
      database_bytes: await sizeOf(dbPath),
      wal_bytes: await sizeOf(`${dbPath}.wal`),
      temp_directory_bytes: await sizeOf(tempDir),
    };

    return {
      name,
      options,
      settings,
      ingest_ms: Math.round(ingest.elapsedMs),
      internal_work_ms: Math.round(internalWork.elapsedMs),
      returned_rows: internalWork.value,
      file_sizes: fileSizes,
    };
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

async function runVariantProbe() {
  const dbPath = path.join(root, "variant.duckdb");
  const defaultStorage = await runDefaultVariantStorageProbe();
  const instance = await DuckDBInstance.create(dbPath, {
    storage_compatibility_version: "v1.5.0",
  });
  const conn = await instance.connect();

  try {
    const settings = await readSettings(conn, ["storage_compatibility_version"]);
    const varchar = await timed(async () => {
      await conn.run(`
        CREATE TABLE payload_varchar AS
        SELECT
          i AS id,
          ('{"title":"Director","company_size":' || CAST(50 + (i % 1000) AS VARCHAR) ||
            ',"region":"' || CASE WHEN i % 3 = 0 THEN 'na' WHEN i % 3 = 1 THEN 'emea' ELSE 'apac' END ||
            '","score":' || CAST(i % 100 AS VARCHAR) || '}') AS custom_payload
        FROM range(${SAFE_ROWS}) AS r(i)
      `);
      await conn.run("CHECKPOINT");
    });
    const varcharSize = await sizeOf(dbPath);

    const variant = await timed(async () => {
      await conn.run(`
        CREATE TABLE payload_variant AS
        SELECT id, custom_payload::VARIANT AS custom_payload
        FROM payload_varchar
      `);
      await conn.run("CHECKPOINT");
    });
    const withVariantSize = await sizeOf(dbPath);

    let rawVariantSerialization = "not_tested";
    try {
      const reader = await conn.runAndReadAll("SELECT custom_payload FROM payload_variant LIMIT 1");
      reader.getRowObjectsJson();
      rawVariantSerialization = "ok";
    } catch (error) {
      rawVariantSerialization = error instanceof Error ? error.message : String(error);
    }

    const castRead = await timed(async () => {
      const reader = await conn.runAndReadAll(`
        SELECT custom_payload::VARCHAR AS custom_payload
        FROM payload_variant
        WHERE id % 1000 = 0
        LIMIT 10
      `);
      return reader.getRowObjectsJson();
    });

    return {
      default_storage_variant_create: defaultStorage,
      settings,
      varchar_ingest_ms: Math.round(varchar.elapsedMs),
      variant_ingest_ms: Math.round(variant.elapsedMs),
      varchar_only_database_bytes: varcharSize,
      combined_database_bytes_after_variant_table: withVariantSize,
      estimated_variant_table_delta_bytes: withVariantSize - varcharSize,
      raw_variant_node_serialization: rawVariantSerialization,
      cast_read_ms: Math.round(castRead.elapsedMs),
      cast_read_sample: castRead.value.slice(0, 2),
    };
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

async function runDefaultVariantStorageProbe() {
  const dbPath = path.join(root, "variant-default-storage.duckdb");
  const instance = await DuckDBInstance.create(dbPath);
  const conn = await instance.connect();
  try {
    const settings = await readSettings(conn, ["storage_compatibility_version"]);
    try {
      await conn.run(`
        CREATE TABLE payload_variant_default AS
        SELECT ('{"score":1}')::VARIANT AS custom_payload
      `);
      return { ok: true, settings };
    } catch (error) {
      return {
        ok: false,
        settings,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

async function readSettings(conn, names) {
  const quoted = names.map((name) => `'${name}'`).join(", ");
  const reader = await conn.runAndReadAll(`
    SELECT name, value
    FROM duckdb_settings()
    WHERE name IN (${quoted})
    ORDER BY name
  `);
  return Object.fromEntries(
    reader.getRowObjectsJson().map((row) => [row.name, row.value]),
  );
}

async function timed(operation) {
  const startedAt = performance.now();
  const value = await operation();
  return {
    elapsedMs: performance.now() - startedAt,
    value,
  };
}

async function sizeOf(targetPath) {
  try {
    const info = await stat(targetPath);
    if (info.isFile()) return info.size;
    if (info.isDirectory()) return 0;
    return null;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}
