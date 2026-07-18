#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const matrixPath = ".pluxx/behavioral-routing-matrix.json";
const directOwner = "direct-mcp";

const failures = [];

function fail(message) {
  failures.push(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function readJson(relativePath) {
  try {
    return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
  } catch (error) {
    fail(`${relativePath}: ${error.message}`);
    return null;
  }
}

async function listSkillNames() {
  const entries = await readdir(path.join(root, "skills"), {
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function expectedPrimarySkill(caseEntry, skillNames) {
  return skillNames.includes(caseEntry.expected_primary_owner)
    ? caseEntry.expected_primary_owner
    : null;
}

function triggerMapFor(triggerEntries, skillName) {
  const map = new Map();
  for (const [index, entry] of triggerEntries.entries()) {
    if (typeof entry?.query !== "string" || entry.query.trim().length === 0) {
      fail(`${skillName}: trigger entry ${index + 1} must have a non-empty query`);
      continue;
    }
    if (typeof entry.should_trigger !== "boolean") {
      fail(`${skillName}: trigger "${entry.query}" must have boolean should_trigger`);
      continue;
    }
    if (map.has(entry.query)) {
      fail(`${skillName}: duplicate trigger query "${entry.query}"`);
    }
    map.set(entry.query, entry.should_trigger);
  }
  return map;
}

function assertMockCoverage(matrix) {
  const responses = matrix?.mock_mcp_responses;
  assert(
    responses && typeof responses === "object" && Object.keys(responses).length > 0,
    `${matrixPath}: mock_mcp_responses must define deterministic local tool fixtures`,
  );

  for (const toolName of ["setup_doctor", "refresh_status", "workspace_snapshot"]) {
    assert(
      responses?.[toolName] && typeof responses[toolName] === "object",
      `${matrixPath}: mock_mcp_responses must include ${toolName}`,
    );
  }
}

function assertCaseShape(caseEntry, skillNames, index) {
  const label = `${matrixPath}: case ${caseEntry?.id ?? index + 1}`;
  assert(typeof caseEntry?.id === "string" && caseEntry.id.length > 0, `${label} must have an id`);
  assert(typeof caseEntry?.category === "string" && caseEntry.category.length > 0, `${label} must have a category`);
  assert(typeof caseEntry?.prompt === "string" && caseEntry.prompt.trim().length >= 12, `${label} must have a realistic prompt`);
  assert(
    [...skillNames, directOwner].includes(caseEntry?.expected_primary_owner),
    `${label} has unknown expected_primary_owner "${caseEntry?.expected_primary_owner}"`,
  );

  const expected = caseEntry?.expected_should_trigger;
  assert(expected && typeof expected === "object", `${label} must define expected_should_trigger`);
  for (const skillName of skillNames) {
    assert(typeof expected?.[skillName] === "boolean", `${label} must define expected_should_trigger.${skillName}`);
  }

  const unexpectedKeys = Object.keys(expected ?? {}).filter(
    (skillName) => !skillNames.includes(skillName),
  );
  assert(unexpectedKeys.length === 0, `${label} has unknown expected_should_trigger keys: ${unexpectedKeys.join(", ")}`);

  const trueOwners = skillNames.filter((skillName) => expected?.[skillName]);
  if (caseEntry.expected_primary_owner === directOwner) {
    assert(trueOwners.length === 0, `${label} routes to ${directOwner} but triggers ${trueOwners.join(", ")}`);
    assert(
      typeof caseEntry.expected_disposition === "string" && caseEntry.expected_disposition.length > 0,
      `${label} direct-MCP/no-skill cases must name expected_disposition`,
    );
  } else {
    assert(
      trueOwners.length === 1,
      `${label} must have exactly one should-trigger skill owner; got ${trueOwners.join(", ") || "none"}`,
    );
    assert(
      trueOwners[0] === caseEntry.expected_primary_owner,
      `${label} expected_primary_owner must match the one should-trigger skill`,
    );
  }

  if (Array.isArray(caseEntry.expected_staged_handoff)) {
    assert(
      caseEntry.expected_staged_handoff.length > 0,
      `${label} expected_staged_handoff must be non-empty when present`,
    );
    for (const owner of caseEntry.expected_staged_handoff) {
      assert(skillNames.includes(owner), `${label} staged handoff references unknown skill "${owner}"`);
    }
  }
}

function assertMatrixCoverage(matrix, skillNames) {
  const cases = matrix?.cases ?? [];
  assert(Array.isArray(cases), `${matrixPath}: cases must be an array`);
  assert(cases.length > 0, `${matrixPath}: zero cases is a hard failure`);

  const ids = new Set();
  const prompts = new Set();
  const categories = new Set();
  const primaryOwners = new Set();

  for (const [index, caseEntry] of cases.entries()) {
    assertCaseShape(caseEntry, skillNames, index);
    if (ids.has(caseEntry.id)) fail(`${matrixPath}: duplicate case id "${caseEntry.id}"`);
    if (prompts.has(caseEntry.prompt)) fail(`${matrixPath}: duplicate prompt "${caseEntry.prompt}"`);
    ids.add(caseEntry.id);
    prompts.add(caseEntry.prompt);
    categories.add(caseEntry.category);
    primaryOwners.add(caseEntry.expected_primary_owner);
  }

  for (const owner of [...skillNames, directOwner]) {
    assert(primaryOwners.has(owner), `${matrixPath}: missing primary-owner coverage for ${owner}`);
  }

  for (const category of [
    "setup",
    "analysis",
    "strategy",
    "copy",
    "launch",
    "freshness",
    "ambiguous",
    "multi-intent",
    "privacy-sensitive",
    "unsupported-mutation",
    "negative",
  ]) {
    assert(categories.has(category), `${matrixPath}: missing ${category} coverage`);
  }
}

function assertExactSenderRiskRoute(matrix) {
  const routeCase = (matrix?.cases ?? []).find(
    (caseEntry) => caseEntry.id === "analyst-exact-tag-sender-risk",
  );
  assert(routeCase, `${matrixPath}: missing exact tag sender-risk routing case`);
  assert(
    routeCase.expected_primary_owner === "sendlens-analyst",
    `${matrixPath}: exact tag sender-risk case must stay analyst-owned`,
  );
  assert(
    routeCase.expected_route?.first_tool === "analysis_starters",
    `${matrixPath}: exact tag sender-risk must start with analysis_starters`,
  );
  assert(
    routeCase.expected_route?.recipe_id === "campaign-sender-inventory-by-tag",
    `${matrixPath}: exact tag sender-risk must route to campaign-sender-inventory-by-tag`,
  );
  assert(
    routeCase.expected_route?.forbidden_before_recipe?.includes("workspace_snapshot"),
    `${matrixPath}: exact tag sender-risk must forbid workspace_snapshot before recipe lookup`,
  );
  assert(
    routeCase.expected_call_budget?.fast_path_max_calls === 2,
    `${matrixPath}: exact tag sender-risk fast path must stay within two calls`,
  );
}

function assertTriggerFilesMatchMatrix(matrix, triggerMaps, skillNames) {
  let executedAssertions = 0;
  for (const caseEntry of matrix.cases ?? []) {
    for (const skillName of skillNames) {
      const expected = caseEntry.expected_should_trigger[skillName];
      const triggerMap = triggerMaps.get(skillName);
      if (!triggerMap.has(caseEntry.prompt)) {
        fail(`skills/${skillName}/evals/trigger-queries.json: missing matrix prompt "${caseEntry.prompt}"`);
        continue;
      }
      const actual = triggerMap.get(caseEntry.prompt);
      executedAssertions += 1;
      assert(
        actual === expected,
        `${caseEntry.id}: ${skillName} should_trigger expected ${expected} but got ${actual}`,
      );
    }

    const primarySkill = expectedPrimarySkill(caseEntry, skillNames);
    const actualOwners = skillNames.filter(
      (skillName) => triggerMaps.get(skillName)?.get(caseEntry.prompt) === true,
    );
    if (primarySkill) {
      assert(
        actualOwners.length === 1 && actualOwners[0] === primarySkill,
        `${caseEntry.id}: expected single primary owner ${primarySkill}; got ${actualOwners.join(", ") || "none"}`,
      );
    } else {
      assert(
        actualOwners.length === 0,
        `${caseEntry.id}: expected no skill owner; got ${actualOwners.join(", ")}`,
      );
    }
  }

  assert(executedAssertions > 0, "behavioral routing executed zero trigger assertions");
}

const skillNames = await listSkillNames();
assert(skillNames.length > 0, "skills/: expected at least one skill");

const matrix = await readJson(matrixPath);
const triggerMaps = new Map();
for (const skillName of skillNames) {
  const triggerPath = `skills/${skillName}/evals/trigger-queries.json`;
  const triggerEntries = await readJson(triggerPath);
  if (Array.isArray(triggerEntries)) {
    triggerMaps.set(skillName, triggerMapFor(triggerEntries, skillName));
  } else {
    fail(`${triggerPath}: expected an array`);
    triggerMaps.set(skillName, new Map());
  }
}

if (matrix) {
assertMockCoverage(matrix);
assertMatrixCoverage(matrix, skillNames);
assertExactSenderRiskRoute(matrix);
assertTriggerFilesMatchMatrix(matrix, triggerMaps, skillNames);
}

if (failures.length > 0) {
  console.error("Behavioral routing failures:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Behavioral routing matrix passed (${matrix.cases.length} cases across ${skillNames.length} skills).`,
);
