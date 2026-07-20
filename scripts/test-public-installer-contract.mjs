#!/usr/bin/env node

import assert from "node:assert/strict";
import { inspectPublicInstaller } from "./verify-public-installer-contract.mjs";

const validFixture = `#!/usr/bin/env bash
set -euo pipefail
need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}
need_cmd curl
need_cmd mktemp
need_cmd bash
need_cmd node
repo="orchidautomation/sendlens-plugin"
base_url="https://github.com/$repo/releases/latest/download"
tmp_dir="$(mktemp -d)"
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT
curl -fsSL --connect-timeout 10 --max-time 120 --retry 3 "$base_url/release-manifest.json" -o "$tmp_dir/release-manifest.json"
curl -fsSL --connect-timeout 10 --max-time 120 --retry 3 "$base_url/SHA256SUMS.txt" -o "$tmp_dir/SHA256SUMS.txt"
verify_release_asset() {
  node <<'NODE'
const crypto = require('crypto')
const expected = 'fixture'
const actual = crypto.createHash('sha256').update('fixture').digest('hex')
if (actual !== expected) throw new Error('Checksum mismatch')
NODE
}
verify_release_asset "$tmp_dir/release-manifest.json" release-manifest.json
`;

const validReport = inspectPublicInstaller(validFixture);
assert.equal(validReport.passed, true, JSON.stringify(validReport.checks, null, 2));
assert.deepEqual(validReport.prerequisites, ["curl", "bash", "mktemp", "node", "network"]);
assert.equal(validReport.globalPluxxRequired, false);

const missingNodeReport = inspectPublicInstaller(validFixture.replace("need_cmd node\n", ""));
assert.equal(missingNodeReport.passed, false);
assert.equal(missingNodeReport.checks.find((check) => check.id === "requires-node")?.pass, false);

const globalPluxxReport = inspectPublicInstaller(`${validFixture}need_cmd pluxx\npluxx install\n`);
assert.equal(globalPluxxReport.passed, false);
assert.equal(globalPluxxReport.globalPluxxRequired, true);
assert.equal(
  globalPluxxReport.checks.find((check) => check.id === "no-global-pluxx-prerequisite")?.pass,
  false,
);

for (const invocation of [
  "if pluxx install; then :; fi",
  "command pluxx install",
  "env pluxx install",
  "if command pluxx install; then :; fi",
  "/usr/local/bin/pluxx install",
]) {
  const report = inspectPublicInstaller(`${validFixture}${invocation}\n`);
  assert.equal(report.passed, false, `must reject global Pluxx execution: ${invocation}`);
  assert.equal(report.globalPluxxRequired, true, `must detect global Pluxx execution: ${invocation}`);
}

console.log("OK: public installer contract requires curl, bash, mktemp, node, and network without global Pluxx");
