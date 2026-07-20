#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const options = { file: null, jsonOut: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--file") {
      options.file = argv[index + 1];
      index += 1;
    } else if (argument === "--json-out") {
      options.jsonOut = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  assert.ok(options.file, "Usage: verify-public-installer-contract.mjs --file <install.sh> [--json-out <report.json>]");
  return options;
}

function requiredCommandPattern(command) {
  return new RegExp(`^\\s*need_cmd\\s+${command}\\s*$`, "m");
}

export function inspectPublicInstaller(source) {
  const prerequisites = ["curl", "bash", "mktemp", "node"];
  const pluxxInvocation = new RegExp(
    String.raw`(?:^|[;|&()]\s*)(?:(?:if|elif|while|until|then|do|command|exec|sudo|env)\s+)*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:pluxx|(?:\/[^\s/;|&()]+)*\/pluxx)(?:\s|;|$)`,
    "m",
  );
  const globalPluxxRequired =
    /^\s*need_cmd\s+pluxx\s*$/m.test(source) || pluxxInvocation.test(source);
  const checks = prerequisites.map((command) => ({
    id: `requires-${command}`,
    pass: requiredCommandPattern(command).test(source),
    detail: `installer declares ${command} as a required command`,
  }));

  checks.push(
    {
      id: "fail-closed-shell",
      pass: /^\s*set\s+-euo\s+pipefail\s*$/m.test(source),
      detail: "installer exits on command, unset-variable, and pipeline failures",
    },
    {
      id: "network-release-fetch",
      pass:
        /https:\/\/github\.com\/\$repo\/releases\//.test(source) &&
        /^\s*curl\s+[^\n]*release-manifest\.json/m.test(source),
      detail: "installer fetches the public GitHub release manifest over the network",
    },
    {
      id: "bounded-retried-downloads",
      pass:
        /curl[^\n]*--connect-timeout\s+\d+/.test(source) &&
        /curl[^\n]*--max-time\s+\d+/.test(source) &&
        /curl[^\n]*--retry\s+\d+/.test(source),
      detail: "installer bounds and retries release downloads",
    },
    {
      id: "release-checksum-verification",
      pass:
        /SHA256SUMS\.txt/.test(source) &&
        /verify_release_asset/.test(source) &&
        /createHash\(['"]sha256['"]\)/.test(source) &&
        /Checksum mismatch|actual\s*!==/.test(source),
      detail: "installer verifies downloaded release assets against checksums",
    },
    {
      id: "no-global-pluxx-prerequisite",
      pass: !globalPluxxRequired,
      detail: "installer does not require or execute a global Pluxx CLI",
    },
    {
      id: "exact-missing-command-report",
      pass: /Missing required command:\s*\$1/.test(source),
      detail: "installer reports the exact missing command",
    },
    {
      id: "isolated-temporary-directory",
      pass:
        /tmp_dir="\$\(mktemp -d\)"/.test(source) &&
        /trap\s+cleanup\s+EXIT/.test(source) &&
        /rm\s+-rf\s+"\$tmp_dir"/.test(source),
      detail: "installer stages release assets in a cleaned temporary directory",
    },
  );

  return {
    contract: "sendlens-public-installer-no-pluxx-v1",
    sha256: createHash("sha256").update(source).digest("hex"),
    prerequisites: [...prerequisites, "network"],
    globalPluxxRequired,
    checks,
    passed: checks.every((check) => check.pass),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const source = await readFile(path.resolve(options.file), "utf8");
  const report = inspectPublicInstaller(source);
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (options.jsonOut) await writeFile(path.resolve(options.jsonOut), output);
  process.stdout.write(output);
  assert.ok(
    report.passed,
    `Public installer contract failed: ${report.checks.filter((check) => !check.pass).map((check) => check.id).join(", ")}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
