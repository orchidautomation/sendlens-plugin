import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { PLUGIN_VERSION } from "../build/plugin/version.js";

const pkg = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "..", "package.json"), "utf8"),
);

assert.equal(
  PLUGIN_VERSION,
  pkg.version,
  `MCP version (${PLUGIN_VERSION}) must match package.json (${pkg.version})`,
);

assert.match(
  PLUGIN_VERSION,
  /^\d+\.\d+\.\d+/,
  `PLUGIN_VERSION (${PLUGIN_VERSION}) must be a semver string`,
);

assert.notEqual(
  PLUGIN_VERSION,
  "0.0.0-unknown",
  "PLUGIN_VERSION must resolve from package.json, not the fallback",
);

const generatedFile = resolve(
  import.meta.dirname,
  "..",
  "plugin",
  "_generated",
  "version.generated.ts",
);
assert.ok(
  existsSync(generatedFile),
  `Expected generated version module at ${generatedFile}`,
);

console.log(`OK: McpServer version (${PLUGIN_VERSION}) matches package.json`);
