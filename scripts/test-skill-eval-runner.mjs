#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectProhibitedToolEvents, gradeOutput, readOutputInstructions } from "./run-skill-evals.mjs";
import { blindOrderTriggerCases, inspectTriggerCases } from "./skill-eval-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const runner = path.join(root, "scripts", "run-skill-evals.mjs");
const artifactRoot = path.join(root, [".agent", "artifacts"].join("-"));
const skillEvalRoot = path.join(artifactRoot, "skill-evals");
await mkdir(skillEvalRoot, { recursive: true });
const outputRoot = await mkdtemp(path.join(skillEvalRoot, "runner-test-"));

function run(args) {
  return spawnSync("node", [runner, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

try {
  const substantive = (...lines) => [...lines, `context ${"detail ".repeat(90)}`].join("\n");
  const keywordOnly = gradeOutput(
    "ready passed_checks source Launch Runbook v3 7-send days",
    [
      { id: "verdict", description: "A launch verdict is present.", pattern: "ready" },
      { id: "checks", description: "A passed checks marker is present.", pattern: "passed_checks" },
      { id: "source", description: "Threshold provenance is present.", pattern: "Launch Runbook v3" },
    ],
  );
  assert.equal(keywordOnly.every((check) => check.passed), false, "keyword-only output must fail the substance gate");
  const cleanEvents = '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}\n';
  const toolEvents = `${cleanEvents}{"type":"item.completed","item":{"type":"command_execution","command":"pwd"}}\n`;
  assert.deepEqual(detectProhibitedToolEvents(cleanEvents), []);
  assert.equal(detectProhibitedToolEvents(toolEvents)[0]?.item_type, "command_execution", "tool use must invalidate isolated eval evidence");

  const polarityChecks = [
    { id: "required", description: "Required marker must appear in the response.", pattern: "official installer" },
    { id: "forbidden", description: "Unsafe manual copying must remain absent.", pattern: "manual copy", mode: "forbidden" },
  ];
  assert.equal(gradeOutput(substantive("official installer", "safe", "reload", "doctor"), polarityChecks).every((check) => check.passed), true);
  const forbiddenResult = gradeOutput(substantive("official installer", "manual copy", "reload", "doctor"), polarityChecks);
  assert.equal(forbiddenResult.find((check) => check.id === "required")?.passed, true);
  assert.equal(forbiddenResult.find((check) => check.id === "forbidden")?.passed, false, "a forbidden phrase alone must flip the result");

  const countCheck = [{ id: "cta-count", description: "Exactly two CTA markers are required.", pattern: "CTA", min_occurrences: 2, max_occurrences: 2 }];
  assert.equal(gradeOutput(substantive("CTA", "one", "line", "line"), countCheck).at(-1).passed, false);
  assert.equal(gradeOutput(substantive("CTA CTA", "two", "line", "line"), countCheck).at(-1).passed, true);
  assert.equal(gradeOutput(substantive("CTA CTA CTA", "three", "line", "line"), countCheck).at(-1).passed, false);

  const copyInstructions = await readOutputInstructions(path.join(root, "skills"), "sendlens-copywriter");
  assert.match(copyInstructions, /sendlens-analyst\/references\/evidence-and-metrics\.md/);
  assert.match(copyInstructions, /sendlens-analyst\/references\/replies-icp-and-copy\.md/);

  const stableQueries = [
    { query: "Diagnose this synthetic workspace", should_trigger: true, cohort: "validation", suites: ["focused"] },
    { query: "Show only cache age", should_trigger: false, cohort: "validation", suites: ["focused"] },
  ];
  const originalIds = inspectTriggerCases("sendlens-analyst", "fixture", stableQueries).cases.map((entry) => entry.id).sort();
  const reorderedIds = inspectTriggerCases("sendlens-analyst", "fixture", [...stableQueries].reverse()).cases.map((entry) => entry.id).sort();
  assert.deepEqual(reorderedIds, originalIds, "trigger identities must remain stable when fixtures are reordered");
  assert.equal(originalIds.some((id) => id.includes("sendlens-analyst")), false, "classifier-visible trigger IDs must not reveal the hidden target skill");
  const blindCases = [
    { id: "trigger-b", skill_name: "sendlens-analyst" },
    { id: "trigger-d", skill_name: "sendlens-analyst" },
    { id: "trigger-a", skill_name: "sendlens-setup" },
    { id: "trigger-c", skill_name: "sendlens-setup" },
  ];
  assert.deepEqual(
    blindOrderTriggerCases(blindCases).map((entry) => entry.id),
    ["trigger-a", "trigger-b", "trigger-c", "trigger-d"],
    "blind trigger order must derive from opaque IDs instead of skill grouping",
  );
  assert.deepEqual(blindCases.map((entry) => entry.id), ["trigger-b", "trigger-d", "trigger-a", "trigger-c"], "blind ordering must not mutate fixture order");

  const analystEvals = JSON.parse(await readFile(path.join(root, "skills", "sendlens-analyst", "evals", "evals.json"), "utf8"));
  const diagnosisCase = analystEvals.evals.find((testCase) => testCase.id === "workspace-diagnosis");
  const genericDiagnosis = substantive(
    "Verdict: sender deliverability risk is the primary constraint.",
    "This is exact evidence rather than inference.",
    "Fix first: review unhealthy sender bounce and then inspect reply quality.",
    "Ranked actions should follow the evidence.",
  );
  assert.equal(
    gradeOutput(genericDiagnosis, diagnosisCase.objective_checks).every((check) => check.passed),
    false,
    "a generic diagnosis without the supplied synthetic facts must fail",
  );
  const selectedCampaignCheck = diagnosisCase.objective_checks.find((check) => check.id === "selects-deep-dive-campaign");
  const deepDiveActionCheck = diagnosisCase.objective_checks.find((check) => check.id === "names-deep-dive-action");
  const negatedDeepDiveCheck = diagnosisCase.objective_checks.find((check) => check.id === "forbids-negated-deep-dive-action");
  assert.equal(
    gradeOutput(substantive("The 18 human replies but only 1 positive identify the low-quality campaign.", "Deep-review the 18-reply campaign before rewriting it.", "ranked actions", "exact evidence"), [selectedCampaignCheck, deepDiveActionCheck]).every((check) => check.passed),
    true,
    "the deep-dive checks should recognize supplied campaign outcomes and an explicit review action",
  );
  assert.equal(
    gradeOutput(substantive("Only 1 of its 18 replies was positive.", "Do not scale the 18-reply campaign. Review that single campaign next.", "ranked actions", "exact evidence"), [selectedCampaignCheck, deepDiveActionCheck]).every((check) => check.passed),
    true,
    "the deep-dive checks should recognize alternate exact-outcome and cross-sentence action wording",
  );
  assert.equal(
    gradeOutput(substantive("31 human replies and Eight positives.", "The campaign generated 18 human replies but only one positive.", "Deep-review the 18-reply campaign.", "ranked actions"), diagnosisCase.objective_checks.filter((check) => ["cites-reply-outcomes", "selects-deep-dive-campaign", "names-deep-dive-action"].includes(check.id))).every((check) => check.passed),
    true,
    "number-word outcome variants should preserve the same synthetic facts",
  );
  assert.equal(
    gradeOutput(substantive("Only 1 of its 18 replies was positive.", "Do not review the 18-reply campaign.", "ranked actions", "exact evidence"), [deepDiveActionCheck, negatedDeepDiveCheck]).every((check) => check.passed),
    false,
    "negated deep-dive advice must fail even when the campaign is named",
  );
  for (const negatedAction of [
    "Skip reviewing the 18-reply campaign.",
    "There is no need to review the 18-reply campaign.",
    "Do not bother inspecting the 18-reply campaign.",
    "The 18-reply campaign should not be reviewed.",
  ]) {
    assert.equal(
      gradeOutput(substantive("Only 1 of its 18 replies was positive.", negatedAction, "ranked actions", "exact evidence"), [deepDiveActionCheck, negatedDeepDiveCheck]).every((check) => check.passed),
      false,
      `negated deep-dive advice must fail: ${negatedAction}`,
    );
  }

  const setupEvals = JSON.parse(await readFile(path.join(root, "skills", "sendlens-setup", "evals", "evals.json"), "utf8"));
  const recoveryCase = setupEvals.evals.find((testCase) => testCase.id === "missing-tools-no-pluxx-release-recovery");
  const noPluxxPrerequisiteCheck = recoveryCase.objective_checks.find((check) => check.id === "states-no-pluxx-prerequisite");
  const pluxxRequiredCheck = recoveryCase.objective_checks.find((check) => check.id === "forbids-pluxx-required");
  for (const safePhrase of [
    "No global Pluxx installation is required.",
    "No separate global Pluxx installation is required.",
    "A global Pluxx CLI is not a required prerequisite.",
    "You do not need to install Pluxx.",
    "You do not need to install a separate global Pluxx CLI.",
  ]) {
    assert.equal(gradeOutput(substantive(safePhrase, "safe", "reload", "doctor"), [noPluxxPrerequisiteCheck, pluxxRequiredCheck]).every((check) => check.passed), true, safePhrase);
  }
  for (const unsafePhrase of [
    "A global Pluxx installation is required.",
    "You must install Pluxx before continuing.",
    "Users need a separate global Pluxx CLI.",
    "This recovery requires a global Pluxx CLI.",
    "Install global Pluxx before continuing.",
    "A global Pluxx CLI will be required.",
    "Global Pluxx is necessary before recovery.",
    "The installer requires a global Pluxx CLI.",
    "The setup needs Pluxx.",
    "The recovery will require global Pluxx.",
  ]) {
    assert.equal(gradeOutput(substantive(unsafePhrase, "unsafe", "reload", "doctor"), [pluxxRequiredCheck]).at(-1).passed, false, unsafePhrase);
  }
  assert.equal(
    gradeOutput(substantive("No separate global Pluxx installation is required. However, this recovery requires a global Pluxx CLI.", "unsafe contradiction", "reload", "doctor"), [noPluxxPrerequisiteCheck, pluxxRequiredCheck]).every((check) => check.passed),
    false,
    "an affirmative prerequisite clause must override an earlier safe phrase",
  );

  const copyEvals = JSON.parse(await readFile(path.join(root, "skills", "sendlens-copywriter", "evals", "evals.json"), "utf8"));
  const sequenceCase = copyEvals.evals.find((testCase) => testCase.id === "strategy-to-sequence");
  const threeStepsCheck = sequenceCase.objective_checks.find((check) => check.id === "writes-three-steps");
  assert.equal(
    gradeOutput(substantive("sequence:\n1. Initial relevance\nBody one\n2. Proof and clarification\nBody two\n3. Close the loop\nBody three", "claims", "fields", "cta"), [threeStepsCheck]).at(-1).passed,
    true,
    "numbered Markdown sequence steps should satisfy the three-step contract",
  );
  assert.equal(
    gradeOutput(substantive("### Step 1 — Initial relevance\nBody one\n### Step 2 — Proof and clarification\nBody two\n### Step 3 — Close the loop\nBody three", "claims", "fields", "cta"), [threeStepsCheck]).at(-1).passed,
    true,
    "Markdown step headings should satisfy the three-step contract",
  );

  const launchEvals = JSON.parse(await readFile(path.join(root, "skills", "sendlens-launch-operator", "evals", "evals.json"), "utf8"));
  const launchCase = launchEvals.evals.find((testCase) => testCase.id === "launch-gate");
  const provenanceCheck = launchCase.objective_checks.find((check) => check.id === "cites-threshold-provenance");
  const negatedProvenanceCheck = launchCase.objective_checks.find((check) => check.id === "forbids-negated-threshold-provenance");
  const runwayCheck = launchCase.objective_checks.find((check) => check.id === "checks-runway");
  assert.equal(
    gradeOutput(substantive("threshold_provenance:\n- Sender-bounce blocker greater than 5% for any sender; user_policy; four assigned senders; Launch Runbook v3 account-owner policy.", "blocked", "runway", "measurement"), [provenanceCheck]).at(-1).passed,
    true,
    "multiline threshold provenance should recognize the named runbook source",
  );
  assert.equal(
    gradeOutput(substantive("source: proposed campaign package and Launch Runbook v3; scope: Healthcare Operators v2; freshness: not provided", "blocked", "runway", "measurement"), [provenanceCheck, negatedProvenanceCheck]).every((check) => check.passed),
    true,
    "missing campaign-package freshness must not negate the named runbook source",
  );
  assert.equal(
    gradeOutput(substantive("Exact runway is 3 send days.", "Operational warnings and passed checks separate the calculation from the policy statement.", "Launch Runbook v3 requires seven send days.", "measurement"), [runwayCheck]).at(-1).passed,
    true,
    "the runway comparison may span structured report sections",
  );
  for (const affirmedCaveat of [
    "Launch Runbook v3 was not provided verbatim, but its account-owner-approved thresholds were supplied and it is the governing source.",
    "Launch Runbook v3 cannot be verified independently here, but it is the supplied and approved source for these thresholds.",
  ]) {
    assert.equal(
      gradeOutput(substantive(affirmedCaveat, "blocked", "runway", "measurement"), [provenanceCheck, negatedProvenanceCheck]).every((check) => check.passed),
      true,
      `affirmed threshold-source caveat must pass: ${affirmedCaveat}`,
    );
  }
  for (const deniedProvenance of [
    "threshold_provenance: Launch Runbook v3 was not provided and is not an approved source.",
    "source: unavailable; the supplied package does not include Launch Runbook v3.",
    "Launch Runbook v3 is not the source for these thresholds.",
    "Launch Runbook v3 does not establish these thresholds.",
    "Launch Runbook v3 cannot be verified.",
    "Launch Runbook v3 is unapproved, but it was supplied as the threshold source.",
    "Launch Runbook v3 is not approved, but it was supplied as the source.",
    "Launch Runbook v3 is unapproved, but it remains the governing source for these thresholds.",
    "Launch Runbook v3 is not approved, but it is the governing source.",
    "Launch Runbook v3 was not provided, but the campaign package is the approved source for these thresholds.",
    "Launch Runbook v3 was not provided, but it is uncertain whether it remains the approved source.",
  ]) {
    assert.equal(
      gradeOutput(substantive(deniedProvenance, "blocked", "runway", "measurement"), [negatedProvenanceCheck]).at(-1).passed,
      false,
      `negated threshold provenance must fail: ${deniedProvenance}`,
    );
  }
  const unsafeRecovery = [
    "Do not run https://sendlens.app/install.sh --codex -y.",
    "A global Pluxx installation is required before recovery.",
    "Do not restart Codex after the attempted repair.",
    "This deliberately wrong recommendation repeats enough filler to exceed the response-length guard while contradicting the required recovery contract and omitting a trustworthy post-install doctor rerun.",
    "Additional filler keeps the response structured but cannot turn unsafe setup advice into a passing result. Additional filler keeps the response structured but cannot turn unsafe setup advice into a passing result.",
  ].join("\n");
  assert.equal(
    gradeOutput(unsafeRecovery, recoveryCase.objective_checks).every((check) => check.passed),
    false,
    "polarity-conflicting no-Pluxx advice must fail executable checks",
  );

  const longKeywordSalad = substantive(
    "blocked",
    "passed_checks",
    "threshold provenance source: Launch Runbook v3",
    "3 send days versus 7 send days",
  );
  assert.equal(
    gradeOutput(longKeywordSalad, launchCase.objective_checks).every((check) => check.passed),
    false,
    "long keyword filler must not pass the launch output contract",
  );

  const fabricatedSequence = substantive(
    "Email 1: Hi first_name at company_name. Worth sending the checklist?",
    "Email 2: Follow-up for the role. Worth sending the checklist?",
    "Email 3: Customers see 30% revenue lift. Worth sending the checklist?",
    "claim ledger: approved synthetic reply count",
  );
  const fabricatedChecks = gradeOutput(fabricatedSequence, sequenceCase.objective_checks);
  assert.equal(fabricatedChecks.find((check) => check.id === "forbids-fabricated-outcomes")?.passed, false);
  assert.equal(fabricatedChecks.every((check) => check.passed), false, "fabricated customer outcomes must fail the copy output contract");

  const unsafeOutput = run([
    "--mode",
    "contract",
    "--output-dir",
    path.join(os.tmpdir(), "sendlens-raw-output-must-not-be-tracked"),
  ]);
  if (unsafeOutput.status === 0 || !/output-dir must stay inside the ignored skill-eval artifact workspace/i.test(`${unsafeOutput.stdout}${unsafeOutput.stderr}`)) {
    throw new Error("raw eval output outside the ignored artifact workspace must fail");
  }

  const rootOutput = run(["--mode", "contract", "--output-dir", artifactRoot]);
  if (rootOutput.status === 0 || !/output-dir must stay inside the ignored skill-eval artifact workspace/i.test(`${rootOutput.stdout}${rootOutput.stderr}`)) {
    throw new Error("the artifact workspace root itself must never be an output directory");
  }

  const evalRootOutput = run(["--mode", "contract", "--output-dir", skillEvalRoot]);
  if (evalRootOutput.status === 0 || !/output-dir must stay inside the ignored skill-eval artifact workspace/i.test(`${evalRootOutput.stdout}${evalRootOutput.stderr}`)) {
    throw new Error("the skill-eval workspace root itself must never be an output directory");
  }

  const escapeLink = path.join(outputRoot, "escape-link");
  await symlink(os.tmpdir(), escapeLink);
  const symlinkEscape = run([
    "--mode",
    "contract",
    "--output-dir",
    path.join(escapeLink, "sendlens-escape"),
  ]);
  if (symlinkEscape.status === 0 || !/resolves outside the ignored skill-eval artifact workspace/i.test(`${symlinkEscape.stdout}${symlinkEscape.stderr}`)) {
    throw new Error("symlinked output paths must not escape the artifact workspace");
  }

  const unsafeJson = run([
    "--mode",
    "contract",
    "--json-out",
    path.join(root, "docs", "orchid", "qa", "raw-eval.json"),
  ]);
  if (unsafeJson.status === 0 || !/json-out must stay inside the ignored skill-eval artifact workspace/i.test(`${unsafeJson.stdout}${unsafeJson.stderr}`)) {
    throw new Error("detailed eval JSON outside the ignored artifact workspace must fail");
  }

  const contract = run([
    "--mode",
    "contract",
    "--output-dir",
    path.join(outputRoot, "contract"),
  ]);
  if (contract.status !== 0) {
    throw new Error(
      `skill eval contract failed\n${contract.stdout}${contract.stderr}`,
    );
  }
  if (!/5 skills/i.test(`${contract.stdout}${contract.stderr}`)) {
    throw new Error("skill eval contract did not report all five skills");
  }

  const mixedCase = run([
    "--mode",
    "contract",
    "--skill",
    "sendlens-setup",
    "--case",
    "missing-tools-no-pluxx-release-recovery,case-that-does-not-exist",
    "--output-dir",
    path.join(outputRoot, "mixed-case"),
  ]);
  if (mixedCase.status === 0 || !/unmatched --case selection/i.test(`${mixedCase.stdout}${mixedCase.stderr}`)) {
    throw new Error("every requested case selector must match executable fixture evidence");
  }

  const zeroCase = run([
    "--mode",
    "contract",
    "--skill",
    "sendlens-setup",
    "--case",
    "case-that-does-not-exist",
    "--output-dir",
    path.join(outputRoot, "zero-case"),
  ]);
  if (zeroCase.status === 0) {
    throw new Error("zero selected output cases must fail");
  }
  if (!/zero (?:discovered|selected|executed).*cases/i.test(`${zeroCase.stdout}${zeroCase.stderr}`)) {
    throw new Error(
      `zero-case failure did not explain the hard failure\n${zeroCase.stdout}${zeroCase.stderr}`,
    );
  }

  console.log("Skill eval runner contract passed, including zero-case hard failure.");
} finally {
  await rm(outputRoot, { recursive: true, force: true });
}
