#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "package.json");
const LOCK_PATH = path.join(ROOT, "package-lock.json");
const FALLBACK_PATH = path.join(__dirname, "runtime-dependencies.lock.json");
const REQUIRED_PROBES = {
  "@duckdb/node-api": ["@duckdb/node-api"],
  "@modelcontextprotocol/sdk": [
    "@modelcontextprotocol/sdk/server/mcp.js",
    "@modelcontextprotocol/sdk/server/stdio.js",
  ],
  "node-sql-parser": ["node-sql-parser"],
  zod: ["zod"],
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sourceDependencies() {
  const fallback = readJson(FALLBACK_PATH);
  const fallbackDependencies = fallback.dependencies ?? {};
  const dependencyNames = fs.existsSync(MANIFEST_PATH)
    ? Object.keys(readJson(MANIFEST_PATH).dependencies ?? {}).sort()
    : Object.keys(fallbackDependencies).sort();

  if (fs.existsSync(LOCK_PATH)) {
    const lock = readJson(LOCK_PATH);
    const dependencies = {};
    for (const name of dependencyNames) {
      const entry = lock.packages?.[`node_modules/${name}`];
      if (!entry?.version) {
        throw new Error(
          `package-lock.json is missing a resolved runtime version for ${name}`,
        );
      }
      dependencies[name] = entry.version;
    }
    return { source: "package-lock.json", dependencies };
  }

  return {
    source: "scripts/runtime-dependencies.lock.json",
    dependencies: fallbackDependencies,
  };
}

function dependencySpecs() {
  const { dependencies } = sourceDependencies();
  return Object.entries(dependencies)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, version]) => `${name}@${version}`);
}

function verifyRuntime(root) {
  const { dependencies } = sourceDependencies();
  const runtimeRequire = createRequire(path.join(root, "runtime-check.cjs"));
  const failures = [];

  for (const [name, version] of Object.entries(dependencies).sort()) {
    const probes = REQUIRED_PROBES[name] ?? [name];
    let resolvedProbe = null;
    for (const probe of probes) {
      try {
        resolvedProbe = runtimeRequire.resolve(probe);
        runtimeRequire(probe);
      } catch (error) {
        failures.push({
          dependency: name,
          expectedVersion: version,
          probe,
          code: error?.code || "runtime_load_failed",
        });
        break;
      }
    }
    if (resolvedProbe) {
      const installedVersion = installedPackageVersion(resolvedProbe, name);
      if (installedVersion !== version) {
        failures.push({
          dependency: name,
          expectedVersion: version,
          installedVersion: installedVersion || "unknown",
          probe: `${name}/package.json`,
          code: "runtime_version_mismatch",
        });
      }
    }
  }

  if (failures.length > 0) {
    console.error("[sendlens] Runtime dependency check failed.");
    for (const failure of failures) {
      if (failure.code === "runtime_version_mismatch") {
        console.error(
          `[sendlens] Incompatible ${failure.dependency}: expected ${failure.expectedVersion}, found ${failure.installedVersion}.`,
        );
        continue;
      }
      console.error(
        `[sendlens] Missing or incompatible ${failure.dependency}@${failure.expectedVersion} (${failure.probe}, ${failure.code}).`,
      );
    }
    console.error(
      "[sendlens] Run bash scripts/bootstrap-runtime.sh from the installed SendLens plugin, then restart your host.",
    );
    process.exit(1);
  }
}

function installedPackageVersion(resolvedProbe, packageName) {
  const parts = path.resolve(resolvedProbe).split(path.sep);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index] !== "node_modules") continue;
    const packageParts = packageName.startsWith("@")
      ? packageName.split("/")
      : [packageName];
    const candidate = path.join(
      path.sep,
      ...parts.slice(0, index + 1),
      ...packageParts,
      "package.json",
    );
    try {
      return readJson(candidate).version;
    } catch {
      return null;
    }
  }
  return null;
}

function assertFallbackCurrent() {
  if (!fs.existsSync(LOCK_PATH)) return;

  const fromLock = sourceDependencies().dependencies;
  const fallback = readJson(FALLBACK_PATH).dependencies ?? {};
  const expected = JSON.stringify(fromLock, null, 2);
  const actual = JSON.stringify(fallback, null, 2);
  if (expected !== actual) {
    console.error(
      "[sendlens] scripts/runtime-dependencies.lock.json is out of date with package-lock.json.",
    );
    console.error(
      "[sendlens] Regenerate it from package-lock.json before building host bundles.",
    );
    process.exit(1);
  }
}

const command = process.argv[2];
if (command === "specs") {
  console.log(dependencySpecs().join("\n"));
} else if (command === "verify") {
  verifyRuntime(path.resolve(process.argv[3] || ROOT));
} else if (command === "assert-current") {
  assertFallbackCurrent();
} else {
  console.error(
    "Usage: runtime-dependencies.cjs specs | verify [root] | assert-current",
  );
  process.exit(2);
}
