#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_SKILLS } from "./sendlens-contract.mjs";
import {
  blindOrderTriggerCases,
  inspectOutputCases,
  inspectTriggerCases,
  VALID_COHORTS,
} from "./skill-eval-contract.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const ARTIFACT_DIR = [".agent", "artifacts"].join("-");
const ARTIFACT_ROOT = path.join(REPO_ROOT, ARTIFACT_DIR);
const SKILL_EVAL_ARTIFACT_ROOT = path.join(ARTIFACT_ROOT, "skill-evals");
const CONFIGURATIONS = ["baseline", "with_skill"];

class ContractError extends Error {}
class RunnerError extends Error {}

function usage() {
  return `Usage: node scripts/run-skill-evals.mjs [options]

Options:
  --mode contract|host       Validate contracts or run Codex host evals (default: contract)
  --skills-root PATH         Skill source root (default: skills/)
  --output-dir PATH          Raw artifact workspace (default: ignored timestamped directory)
  --json-out PATH            Also write sanitized JSON inside the ignored artifact workspace
  --skill NAME               Select a skill; repeat or use comma-separated names
  --case ID                  Select an output case; repeat or use comma-separated IDs
  --trigger-cohort train|validation
                            Select a trigger-query cohort; output fixtures are selected separately
  --runs NUMBER              Repetitions per host configuration (default: 3)
  --host-cases-only          Execute only the designated one-per-skill smoke cases
  --baseline REF             Git baseline for comparison (default: origin/main)
  --help                     Show this help
`;
}

function addSelector(target, value, flag) {
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) throw new ContractError(`${flag} requires a value`);
  for (const entry of entries) target.add(entry);
}

function isInsideArtifactRoot(candidate, allowRoot = false) {
  const relative = path.relative(SKILL_EVAL_ARTIFACT_ROOT, candidate);
  return (allowRoot && relative === "")
    || (relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function verifyArtifactPath(candidate, label) {
  const realArtifactRoot = await realpath(SKILL_EVAL_ARTIFACT_ROOT);
  if (realArtifactRoot !== path.resolve(SKILL_EVAL_ARTIFACT_ROOT)) {
    throw new ContractError("the skill-eval artifact workspace root must not be symlinked");
  }
  let existing = candidate;
  while (isInsideArtifactRoot(existing, true)) {
    try {
      const realExisting = await realpath(existing);
      const relative = path.relative(realArtifactRoot, realExisting);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new ContractError(`${label} resolves outside the ignored skill-eval artifact workspace`);
      }
      return;
    } catch (error) {
      if (error instanceof ContractError) throw error;
      if (error.code !== "ENOENT") throw new ContractError(`${label} could not be verified: ${error.message}`);
      existing = path.dirname(existing);
    }
  }
  throw new ContractError(`${label} must stay inside the ignored skill-eval artifact workspace`);
}

function parseArgs(argv) {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const options = {
    mode: "contract",
    skillsRoot: path.join(REPO_ROOT, "skills"),
    outputDir: path.join(REPO_ROOT, ARTIFACT_DIR, "skill-evals", timestamp),
    jsonOut: undefined,
    skills: new Set(),
    cases: new Set(),
    triggerCohort: undefined,
    runs: 3,
    hostCasesOnly: false,
    baseline: "origin/main",
    help: false,
  };

  const takeValue = (index, flag) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new ContractError(`${flag} requires a value`);
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      options.help = true;
      continue;
    }
    if (flag === "--mode") {
      options.mode = takeValue(index, flag);
      index += 1;
    } else if (flag === "--skills-root") {
      options.skillsRoot = path.resolve(REPO_ROOT, takeValue(index, flag));
      index += 1;
    } else if (flag === "--output-dir") {
      options.outputDir = path.resolve(REPO_ROOT, takeValue(index, flag));
      index += 1;
    } else if (flag === "--json-out") {
      options.jsonOut = path.resolve(REPO_ROOT, takeValue(index, flag));
      index += 1;
    } else if (flag === "--skill") {
      addSelector(options.skills, takeValue(index, flag), flag);
      index += 1;
    } else if (flag === "--case") {
      addSelector(options.cases, takeValue(index, flag), flag);
      index += 1;
    } else if (flag === "--trigger-cohort" || flag === "--cohort") {
      options.triggerCohort = takeValue(index, flag);
      index += 1;
    } else if (flag === "--runs") {
      options.runs = Number(takeValue(index, flag));
      index += 1;
    } else if (flag === "--host-cases-only") {
      options.hostCasesOnly = true;
    } else if (flag === "--baseline") {
      options.baseline = takeValue(index, flag);
      index += 1;
    } else {
      throw new ContractError(`Unknown option: ${flag}`);
    }
  }

  if (!new Set(["contract", "host"]).has(options.mode)) {
    throw new ContractError(`--mode must be contract or host, received ${options.mode}`);
  }
  if (!Number.isInteger(options.runs) || options.runs < 1) {
    throw new ContractError("--runs must be a positive integer");
  }
  if (options.triggerCohort && !VALID_COHORTS.has(options.triggerCohort)) {
    throw new ContractError("--trigger-cohort must be train or validation");
  }
  if (!isInsideArtifactRoot(options.outputDir)) {
    throw new ContractError("--output-dir must stay inside the ignored skill-eval artifact workspace");
  }
  if (options.jsonOut && !isInsideArtifactRoot(options.jsonOut)) {
    throw new ContractError("--json-out must stay inside the ignored skill-eval artifact workspace");
  }
  return options;
}

async function readJson(filePath) {
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    throw new ContractError(`${path.relative(REPO_ROOT, filePath)}: ${error.message}`);
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new ContractError(`${path.relative(REPO_ROOT, filePath)}: invalid JSON: ${error.message}`);
  }
}

function requireContract(condition, message) {
  if (!condition) throw new ContractError(message);
}

function caseMatches(selectors, skillName, caseId) {
  if (selectors.size === 0) return true;
  return selectors.has(caseId)
    || selectors.has(`${skillName}/${caseId}`)
    || selectors.has(`${skillName}:${caseId}`);
}

function validateOutputCases(skillName, evalPath, payload) {
  const label = path.relative(REPO_ROOT, evalPath);
  const result = inspectOutputCases(skillName, label, payload);
  requireContract(result.errors.length === 0, result.errors[0]);
  return result.cases;
}

function validateTriggerCases(skillName, triggerPath, payload) {
  const label = path.relative(REPO_ROOT, triggerPath);
  const result = inspectTriggerCases(skillName, label, payload);
  requireContract(result.errors.length === 0, result.errors[0]);
  return result.cases;
}

async function loadContracts(options) {
  const contracts = [];
  for (const skillName of PUBLIC_SKILLS) {
    const skillDir = path.join(options.skillsRoot, skillName);
    const evalPath = path.join(skillDir, "evals", "evals.json");
    const triggerPath = path.join(skillDir, "evals", "trigger-queries.json");
    const skillPath = path.join(skillDir, "SKILL.md");
    try {
      await readFile(skillPath, "utf8");
    } catch (error) {
      throw new ContractError(`${path.relative(REPO_ROOT, skillPath)}: ${error.message}`);
    }
    const outputPayload = await readJson(evalPath);
    const triggerPayload = await readJson(triggerPath);
    contracts.push({
      skillName,
      skillDir,
      outputCases: validateOutputCases(skillName, evalPath, outputPayload),
      triggerCases: validateTriggerCases(skillName, triggerPath, triggerPayload),
    });
  }

  const unknownSkills = [...options.skills].filter((name) => !PUBLIC_SKILLS.includes(name));
  requireContract(unknownSkills.length === 0, `Unknown --skill selection: ${unknownSkills.join(", ")}`);
  const selectedSkills = options.skills.size > 0
    ? PUBLIC_SKILLS.filter((name) => options.skills.has(name))
    : [...PUBLIC_SKILLS];
  requireContract(selectedSkills.length > 0, "zero selected skills");

  const selectedContracts = contracts.filter((contract) => selectedSkills.includes(contract.skillName));
  const selectedOutputCases = selectedContracts.flatMap((contract) => contract.outputCases
    .filter((testCase) => caseMatches(options.cases, contract.skillName, testCase.id))
    .map((testCase) => ({ ...testCase, skill_name: contract.skillName })));
  requireContract(selectedOutputCases.length > 0, "zero selected output cases");
  const unmatchedCases = [...options.cases].filter((selector) => !selectedOutputCases.some(
    (testCase) => caseMatches(new Set([selector]), testCase.skill_name, testCase.id),
  ));
  requireContract(unmatchedCases.length === 0, `Unmatched --case selection: ${unmatchedCases.join(", ")}`);

  const activeSkills = options.cases.size > 0 && options.skills.size === 0
    ? [...new Set(selectedOutputCases.map((testCase) => testCase.skill_name))]
    : selectedSkills;
  const activeContracts = contracts.filter((contract) => activeSkills.includes(contract.skillName));
  const selectedTriggerCases = blindOrderTriggerCases(activeContracts.flatMap((contract) => contract.triggerCases
    .filter((testCase) => !options.triggerCohort || testCase.cohort === options.triggerCohort)));
  requireContract(selectedTriggerCases.length > 0, "zero selected trigger cases");

  return { contracts, activeSkills, selectedOutputCases, selectedTriggerCases };
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sanitizedOptions(options) {
  return {
    mode: options.mode,
    skills_root: path.relative(REPO_ROOT, options.skillsRoot) || ".",
    selected_skills: [...options.skills].sort(),
    selected_cases: [...options.cases].sort(),
    trigger_cohort: options.triggerCohort ?? "all",
    runs: options.runs,
    host_cases_only: options.hostCasesOnly,
    runner: "codex",
    baseline: options.baseline,
    baseline_sha: options.baselineSha,
  };
}

async function writeSanitizedReport(options, report) {
  await writeJson(path.join(options.outputDir, "summary.json"), report);
  if (options.jsonOut) await writeJson(options.jsonOut, report);
}

async function writeContractSummary(options, loaded, startedAt) {
  const summary = {
    schema_version: 1,
    mode: "contract",
    status: "passed",
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    options: sanitizedOptions(options),
    validated_skills: loaded.contracts.map((contract) => contract.skillName),
    counts: {
      validated_skills: loaded.contracts.length,
      discovered_output_cases: loaded.contracts.reduce((sum, item) => sum + item.outputCases.length, 0),
      discovered_trigger_cases: loaded.contracts.reduce((sum, item) => sum + item.triggerCases.length, 0),
      selected_output_cases: loaded.selectedOutputCases.length,
      selected_trigger_cases: loaded.selectedTriggerCases.length,
      validated_output_cases: loaded.selectedOutputCases.length,
    },
    raw_output_included: false,
  };
  await writeSanitizedReport(options, summary);
  return summary;
}

function runGit(args, binary = false) {
  const result = spawnSync("git", args, {
    cwd: REPO_ROOT,
    encoding: binary ? null : "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : result.stderr;
    throw new RunnerError(`git ${args[0]} failed: ${stderr?.trim() || `status ${result.status}`}`);
  }
  return result.stdout;
}

async function snapshotBaselineSkill(baseline, skillName, destination) {
  const relativeSkillDir = `skills/${skillName}`;
  const output = runGit(["ls-tree", "-r", "-z", "--name-only", baseline, "--", relativeSkillDir]);
  const files = output.split("\0").filter(Boolean);
  if (files.length === 0) throw new RunnerError(`baseline ${baseline} has no evidence for ${relativeSkillDir}`);
  for (const file of files) {
    const contents = runGit(["show", `${baseline}:${file}`], true);
    const relative = path.relative(relativeSkillDir, file);
    const target = path.join(destination, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  const baselineSkill = path.join(destination, "SKILL.md");
  try {
    await readFile(baselineSkill, "utf8");
  } catch (error) {
    throw new RunnerError(`baseline ${baseline} is missing required evidence ${relativeSkillDir}/SKILL.md: ${error.message}`);
  }
}

async function createSnapshots(options) {
  const snapshotsRoot = path.join(options.outputDir, "snapshots");
  const currentRoot = path.join(snapshotsRoot, "current", "skills");
  const baselineRoot = path.join(snapshotsRoot, "baseline", "skills");
  await rm(snapshotsRoot, { recursive: true, force: true });
  for (const skillName of PUBLIC_SKILLS) {
    await cp(path.join(options.skillsRoot, skillName), path.join(currentRoot, skillName), { recursive: true });
    await snapshotBaselineSkill(options.baselineSha, skillName, path.join(baselineRoot, skillName));
  }
  return { currentRoot, baselineRoot };
}

function parseFrontmatterString(rawValue) {
  const value = rawValue.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    if (value.startsWith('"')) {
      try {
        return JSON.parse(value);
      } catch {
        return value.slice(1, -1);
      }
    }
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

async function readSkillMetadata(skillRoot, skillName) {
  const skillPath = path.join(skillRoot, skillName, "SKILL.md");
  const source = await readFile(skillPath, "utf8");
  const frontmatter = source.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!frontmatter) throw new RunnerError(`${skillPath} has no YAML frontmatter evidence`);
  const nameMatch = frontmatter[1].match(/^name:\s*(.+)$/m);
  const descriptionMatch = frontmatter[1].match(/^description:\s*(.+)$/m);
  if (!nameMatch || !descriptionMatch) throw new RunnerError(`${skillPath} needs name and description metadata`);
  return {
    name: parseFrontmatterString(nameMatch[1]),
    description: parseFrontmatterString(descriptionMatch[1]),
  };
}

async function prepareOutputContext(snapshotSkillDir, contextDir) {
  await rm(contextDir, { recursive: true, force: true });
  await mkdir(contextDir, { recursive: true });
  await cp(path.join(snapshotSkillDir, "SKILL.md"), path.join(contextDir, "SKILL.md"));
  try {
    await cp(path.join(snapshotSkillDir, "references"), path.join(contextDir, "references"), { recursive: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function markdownDependencies(source, sourcePath, snapshotSkillsRoot) {
  const dependencies = [];
  const linkPattern = /\[[^\]]*\]\(([^)\s]+\.md)(?:#[^)]+)?\)/g;
  for (const match of source.matchAll(linkPattern)) {
    const target = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const resolved = path.resolve(path.dirname(sourcePath), target);
    const relative = path.relative(snapshotSkillsRoot, resolved);
    if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new RunnerError(`${sourcePath} links outside the skill snapshot: ${target}`);
    }
    dependencies.push(resolved);
  }
  return dependencies;
}

export async function readOutputInstructions(snapshotSkillsRoot, skillName) {
  const skillDir = path.join(snapshotSkillsRoot, skillName);
  const queue = [path.join(skillDir, "SKILL.md")];
  const referencesDir = path.join(skillDir, "references");
  try {
    const referenceNames = (await readdir(referencesDir))
      .filter((name) => name.endsWith(".md"))
      .sort();
    queue.push(...referenceNames.map((name) => path.join(referencesDir, name)));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const sections = [];
  const seen = new Set();
  while (queue.length > 0) {
    const sourcePath = queue.shift();
    if (seen.has(sourcePath)) continue;
    seen.add(sourcePath);
    let source;
    try {
      source = await readFile(sourcePath, "utf8");
    } catch (error) {
      throw new RunnerError(`${sourcePath}: referenced skill evidence is unavailable: ${error.message}`);
    }
    const label = path.relative(snapshotSkillsRoot, sourcePath);
    sections.push(`### ${label}\n${source}`);
    queue.push(...markdownDependencies(source, sourcePath, snapshotSkillsRoot));
  }
  return sections.join("\n\n");
}

function extractUsageData(jsonl) {
  let usage;
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const candidates = [event.usage, event.data?.usage, event.turn?.usage, event.item?.usage];
      for (const candidate of candidates) {
        if (candidate && typeof candidate === "object"
          && Object.values(candidate).some((value) => Number.isFinite(value))) {
          usage = candidate;
        }
      }
    } catch {
      // Non-JSON diagnostics stay in the raw event file.
    }
  }
  return usage
    ? { available: true, source: "codex_jsonl_usage", usage }
    : { available: false, reason: "Codex JSONL events did not expose usage counts" };
}

export function detectProhibitedToolEvents(jsonl) {
  const prohibitedTypes = new Set([
    "command_execution",
    "file_change",
    "mcp_tool_call",
    "web_search",
    "image_generation",
    "tool_call",
  ]);
  const events = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const itemType = event.item?.type;
      if (typeof itemType === "string" && prohibitedTypes.has(itemType)) {
        events.push({ event_type: event.type ?? "unknown", item_type: itemType });
      }
    } catch {
      // Non-JSON diagnostics are retained only in the ignored event file.
    }
  }
  return events;
}

function parseStructuredResponse(response, label) {
  const trimmed = response.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        // Report the stable error below.
      }
    }
  }
  throw new RunnerError(`${label}: Codex did not return valid structured JSON`);
}

async function runCodex({ contextDir, prompt, schemaPath, rawDir, label }) {
  await mkdir(rawDir, { recursive: true });
  const finalPath = path.join(rawDir, "last-message.txt");
  const args = [
    "exec",
    "--ephemeral",
    "--sandbox", "read-only",
    "--skip-git-repo-check",
    "--ignore-rules",
    "--ignore-user-config",
    "--color", "never",
    "--json",
    "--cd", contextDir,
    "--output-last-message", finalPath,
  ];
  if (schemaPath) args.push("--output-schema", schemaPath);
  args.push(prompt);

  const started = Date.now();
  const result = spawnSync("codex", args, {
    cwd: contextDir,
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  });
  const durationMs = Date.now() - started;
  await writeFile(path.join(rawDir, "events.jsonl"), result.stdout ?? "", "utf8");
  await writeFile(path.join(rawDir, "runner-stderr.txt"), result.stderr ?? "", "utf8");

  let response = "";
  try {
    response = await readFile(finalPath, "utf8");
  } catch {
    // Missing evidence is handled as a runner failure.
  }
  const usageData = extractUsageData(result.stdout ?? "");
  const prohibitedToolEvents = detectProhibitedToolEvents(result.stdout ?? "");
  await writeJson(path.join(rawDir, "invocation.json"), {
    runner: "codex",
    exit_status: result.status,
    signal: result.signal ?? null,
    duration_ms: durationMs,
    usage_data: usageData,
    prohibited_tool_events: prohibitedToolEvents,
    last_message_available: response.length > 0,
  });
  if (prohibitedToolEvents.length > 0) {
    throw new RunnerError(`${label}: Codex used prohibited tools during an isolated evaluation; details remain in the ignored run artifacts`);
  }
  if (result.error || result.status !== 0 || response.length === 0) {
    const detail = result.error
      ? `spawn error ${result.error.code ?? "unknown"}`
      : result.status !== 0
        ? `exit status ${result.status}${result.signal ? ` (${result.signal})` : ""}`
        : "no final response was produced";
    throw new RunnerError(`${label}: Codex runner failed with ${detail}; raw diagnostics remain in the ignored run artifacts`);
  }
  return { response, durationMs, usageData };
}

function triggerSchema(caseIds) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["classifications"],
    properties: {
      classifications: {
        type: "array",
        minItems: caseIds.length,
        maxItems: caseIds.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["case_id", "activated_skills"],
          properties: {
            case_id: { type: "string", enum: caseIds },
            activated_skills: {
              type: "array",
              maxItems: PUBLIC_SKILLS.length,
              items: { type: "string", enum: PUBLIC_SKILLS },
            },
          },
        },
      },
    },
  };
}

function triggerPrompt(metadata, triggerCases) {
  const metadataLines = metadata.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n");
  const cases = triggerCases.map((testCase) => ({
    case_id: testCase.id,
    user_query: testCase.query,
  }));
  return `You are measuring automatic skill routing from skill metadata. Do not use tools, inspect files, access MCP, or use knowledge beyond the metadata below. For every case, independently select the zero or more skills that should activate for the user query. Do not infer a hidden target from the case ID. Return exactly one classification per case and preserve every case_id.\n\nSkill metadata:\n${metadataLines}\n\nCases:\n${JSON.stringify(cases, null, 2)}`;
}

function validateTriggerResponse(response, triggerCases, label) {
  const payload = parseStructuredResponse(response, label);
  if (!Array.isArray(payload.classifications)) throw new RunnerError(`${label}: classifications must be an array`);
  const byId = new Map();
  for (const item of payload.classifications) {
    if (byId.has(item?.case_id)) throw new RunnerError(`${label}: duplicate classification ${item?.case_id}`);
    if (!Array.isArray(item?.activated_skills)) throw new RunnerError(`${label}: classification ${item?.case_id} needs activated_skills`);
    if (new Set(item.activated_skills).size !== item.activated_skills.length) {
      throw new RunnerError(`${label}: classification ${item.case_id} repeats an activated skill`);
    }
    byId.set(item.case_id, item.activated_skills);
  }
  if (byId.size !== triggerCases.length || triggerCases.some((testCase) => !byId.has(testCase.id))) {
    throw new RunnerError(`${label}: expected ${triggerCases.length} complete classifications, received ${byId.size}`);
  }
  return triggerCases.map((testCase) => {
    const activatedSkills = byId.get(testCase.id);
    const observedShouldTrigger = activatedSkills.includes(testCase.skill_name);
    return {
      case_id: testCase.id,
      skill_name: testCase.skill_name,
      cohort: testCase.cohort,
      expected_should_trigger: testCase.should_trigger,
      observed_should_trigger: observedShouldTrigger,
      observed_activated_skills: activatedSkills,
      passed: testCase.should_trigger
        ? observedShouldTrigger && activatedSkills.length === 1
        : !observedShouldTrigger,
    };
  });
}

function outputPrompt(testCase, skillInstructions) {
  return `Apply the complete SendLens skill instructions embedded below to answer the task. Treat the synthetic input as the sole source of workspace facts. Do not use tools, inspect the environment, access MCP or the network, or read files. Do not claim to have taken external action. Do not mention this evaluation or its checks.\n\n<skill_instructions>\n${skillInstructions}\n</skill_instructions>\n\nUser task:\n${testCase.prompt}\n\nSynthetic input:\n${testCase.input}`;
}

function evidenceQuote(match) {
  const normalized = match.replaceAll(/\s+/g, " ").trim();
  return normalized.length <= 280 ? normalized : `${normalized.slice(0, 277)}...`;
}

export function gradeOutput(response, objectiveChecks) {
  const nonEmptyLines = response.split("\n").filter((line) => line.trim()).length;
  const integrityCheck = {
    id: "substantive-structured-response",
    description: "Response contains enough structured substance to resist keyword-only false positives.",
    pattern: null,
    passed: response.trim().length >= 500 && nonEmptyLines >= 4,
    matched_evidence_quote: null,
    measured_characters: response.trim().length,
    measured_nonempty_lines: nonEmptyLines,
  };
  return [integrityCheck, ...objectiveChecks.map((check) => {
    const matches = [...response.matchAll(new RegExp(check.pattern, "gi"))];
    const minimum = check.mode === "forbidden" ? 0 : (check.min_occurrences ?? 1);
    const maximum = check.mode === "forbidden" ? 0 : (check.max_occurrences ?? Number.POSITIVE_INFINITY);
    const passed = matches.length >= minimum && matches.length <= maximum;
    return {
      id: check.id,
      description: check.description,
      pattern: check.pattern,
      mode: check.mode ?? "required",
      minimum_occurrences: minimum,
      maximum_occurrences: Number.isFinite(maximum) ? maximum : null,
      observed_occurrences: matches.length,
      passed,
      matched_evidence_quote: matches[0] ? evidenceQuote(matches[0][0]) : null,
    };
  })];
}

function rate(numerator, denominator) {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(6));
}

function average(values) {
  const numeric = values.filter((value) => Number.isFinite(value));
  return numeric.length === 0
    ? null
    : Number((numeric.reduce((sum, value) => sum + value, 0) / numeric.length).toFixed(2));
}

function difference(current, baseline) {
  return current === null || baseline === null
    ? null
    : Number((current - baseline).toFixed(6));
}

function aggregateBenchmark(options, loaded, triggerResults, outputResults, startedAt) {
  const configurations = {};
  for (const configuration of CONFIGURATIONS) {
    const configurationTriggers = triggerResults.filter((result) => result.configuration === configuration);
    const triggerAttempts = configurationTriggers.flatMap((result) => result.cases);
    const passedTriggerAttempts = triggerAttempts.filter((attempt) => attempt.passed).length;
    const configurationOutputs = outputResults.filter((result) => result.configuration === configuration);
    const outputChecks = configurationOutputs.flatMap((result) => result.checks);
    const passedOutputCases = configurationOutputs.filter((result) => result.passed).length;
    const passedOutputChecks = outputChecks.filter((check) => check.passed).length;
    configurations[configuration] = {
      trigger: {
        unique_cases: loaded.selectedTriggerCases.length,
        attempts: triggerAttempts.length,
        passed_attempts: passedTriggerAttempts,
        pass_rate: rate(passedTriggerAttempts, triggerAttempts.length),
        average_duration_ms_per_batch: average(configurationTriggers.map((result) => result.duration_ms)),
        runs: configurationTriggers.map((result) => ({
          run: result.run,
          duration_ms: result.duration_ms,
          usage_data: result.usage_data,
        })),
      },
      output: {
        unique_cases: new Set(configurationOutputs.map((result) => `${result.skill_name}/${result.case_id}`)).size,
        attempts: configurationOutputs.length,
        passed_attempts: passedOutputCases,
        case_pass_rate: rate(passedOutputCases, configurationOutputs.length),
        objective_check_attempts: outputChecks.length,
        passed_objective_checks: passedOutputChecks,
        objective_check_pass_rate: rate(passedOutputChecks, outputChecks.length),
        average_duration_ms: average(configurationOutputs.map((result) => result.duration_ms)),
      },
    };
  }

  const triggerCases = loaded.selectedTriggerCases.map((testCase) => {
    const result = {
      id: testCase.id,
      skill_name: testCase.skill_name,
      cohort: testCase.cohort,
      suites: testCase.suites,
      expected_should_trigger: testCase.should_trigger,
      configurations: {},
    };
    for (const configuration of CONFIGURATIONS) {
      const attempts = triggerResults
        .filter((run) => run.configuration === configuration)
        .flatMap((run) => run.cases)
        .filter((attempt) => attempt.case_id === testCase.id);
      result.configurations[configuration] = {
        attempts: attempts.length,
        observed_trigger_rate: rate(attempts.filter((attempt) => attempt.observed_should_trigger).length, attempts.length),
        expected_match_rate: rate(attempts.filter((attempt) => attempt.passed).length, attempts.length),
      };
    }
    result.pass_rate_delta_with_skill_minus_baseline = difference(
      result.configurations.with_skill.expected_match_rate,
      result.configurations.baseline.expected_match_rate,
    );
    return result;
  });

  const executedOutputKeys = new Set(
    outputResults.map((result) => `${result.skill_name}/${result.case_id}`),
  );
  const outputCases = loaded.selectedOutputCases
    .filter((testCase) => executedOutputKeys.has(`${testCase.skill_name}/${testCase.id}`))
    .map((testCase) => {
    const result = {
      id: testCase.id,
      skill_name: testCase.skill_name,
      configurations: {},
    };
    for (const configuration of CONFIGURATIONS) {
      const attempts = outputResults.filter((attempt) => attempt.configuration === configuration
        && attempt.skill_name === testCase.skill_name && attempt.case_id === testCase.id);
      const checks = attempts.flatMap((attempt) => attempt.checks);
      result.configurations[configuration] = {
        attempts: attempts.map((attempt) => ({
          run: attempt.run,
          passed: attempt.passed,
          duration_ms: attempt.duration_ms,
          usage_data: attempt.usage_data,
          checks: attempt.checks,
        })),
        case_pass_rate: rate(attempts.filter((attempt) => attempt.passed).length, attempts.length),
        objective_check_pass_rate: rate(checks.filter((check) => check.passed).length, checks.length),
      };
    }
    result.pass_rate_delta_with_skill_minus_baseline = {
      case: difference(
        result.configurations.with_skill.case_pass_rate,
        result.configurations.baseline.case_pass_rate,
      ),
      objective_checks: difference(
        result.configurations.with_skill.objective_check_pass_rate,
        result.configurations.baseline.objective_check_pass_rate,
      ),
    };
      return result;
    });

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    started_at: startedAt,
    runner: "codex",
    runs: options.runs,
    baseline_ref: options.baseline,
    baseline_sha: options.baselineSha,
    configurations,
    pass_rate_delta_with_skill_minus_baseline: {
      trigger: difference(configurations.with_skill.trigger.pass_rate, configurations.baseline.trigger.pass_rate),
      output_cases: difference(configurations.with_skill.output.case_pass_rate, configurations.baseline.output.case_pass_rate),
      objective_checks: difference(
        configurations.with_skill.output.objective_check_pass_rate,
        configurations.baseline.output.objective_check_pass_rate,
      ),
    },
    trigger_cases: triggerCases,
    output_cases: outputCases,
    raw_output_included: false,
    matched_evidence_quotes_included: true,
  };
}

async function runHostMode(options, loaded, startedAt) {
  const hostCases = options.hostCasesOnly
    ? loaded.selectedOutputCases.filter((testCase) => testCase.host_case)
    : loaded.selectedOutputCases;
  requireContract(hostCases.length > 0, "zero selected executable output cases");
  for (const skillName of loaded.activeSkills) {
    requireContract(hostCases.some((testCase) => testCase.skill_name === skillName), `zero selected host output cases for ${skillName}`);
  }

  options.baselineSha = runGit(["rev-parse", options.baseline]).trim();
  const snapshots = await createSnapshots(options);
  for (const skillName of loaded.activeSkills) {
    const currentInstructions = await readOutputInstructions(snapshots.currentRoot, skillName);
    const baselineInstructions = await readOutputInstructions(snapshots.baselineRoot, skillName);
    requireContract(
      currentInstructions !== baselineInstructions,
      `${skillName}: evaluated instructions are identical to baseline ${options.baselineSha}`,
    );
  }
  const schemaPath = path.join(options.outputDir, "schemas", "trigger-response.schema.json");
  await writeJson(schemaPath, triggerSchema(loaded.selectedTriggerCases.map((testCase) => testCase.id)));
  const emptyContext = path.join(options.outputDir, "contexts", "trigger-routing");
  await mkdir(emptyContext, { recursive: true });
  const triggerResults = [];
  const outputResults = [];

  for (const configuration of CONFIGURATIONS) {
    const snapshotRoot = configuration === "baseline" ? snapshots.baselineRoot : snapshots.currentRoot;
    const metadata = [];
    for (const skillName of loaded.activeSkills) metadata.push(await readSkillMetadata(snapshotRoot, skillName));
    const prompt = triggerPrompt(metadata, loaded.selectedTriggerCases);
    for (let run = 1; run <= options.runs; run += 1) {
      const label = `${configuration} trigger run ${run}`;
      const rawDir = path.join(options.outputDir, "raw", "triggers", configuration, `run-${String(run).padStart(3, "0")}`);
      const invocation = await runCodex({ contextDir: emptyContext, prompt, schemaPath, rawDir, label });
      const cases = validateTriggerResponse(invocation.response, loaded.selectedTriggerCases, label);
      const result = {
        configuration,
        run,
        duration_ms: invocation.durationMs,
        usage_data: invocation.usageData,
        cases,
      };
      await writeJson(path.join(rawDir, "result.json"), result);
      triggerResults.push(result);
    }

    for (const testCase of hostCases) {
      const snapshotSkillDir = path.join(snapshotRoot, testCase.skill_name);
      const contextDir = path.join(options.outputDir, "contexts", "outputs", configuration, testCase.skill_name);
      await prepareOutputContext(snapshotSkillDir, contextDir);
      const skillInstructions = await readOutputInstructions(snapshotRoot, testCase.skill_name);
      for (let run = 1; run <= options.runs; run += 1) {
        const label = `${configuration} ${testCase.skill_name}/${testCase.id} run ${run}`;
        const rawDir = path.join(
          options.outputDir,
          "raw",
          "outputs",
          configuration,
          testCase.skill_name,
          testCase.id,
          `run-${String(run).padStart(3, "0")}`,
        );
        const invocation = await runCodex({
          contextDir,
          prompt: outputPrompt(testCase, skillInstructions),
          rawDir,
          label,
        });
        const checks = gradeOutput(invocation.response, testCase.objective_checks);
        const result = {
          configuration,
          skill_name: testCase.skill_name,
          case_id: testCase.id,
          run,
          duration_ms: invocation.durationMs,
          usage_data: invocation.usageData,
          passed: checks.every((check) => check.passed),
          checks,
        };
        await writeJson(path.join(rawDir, "result.json"), result);
        outputResults.push(result);
      }
    }
  }

  requireContract(triggerResults.length > 0 && outputResults.length > 0, "zero executed host cases");
  const benchmark = aggregateBenchmark(options, loaded, triggerResults, outputResults, startedAt);
  await writeJson(path.join(options.outputDir, "benchmark.json"), benchmark);
  if (options.jsonOut) await writeJson(options.jsonOut, benchmark);
  const summary = {
    schema_version: 1,
    mode: "host",
    status: "completed",
    quality_passed: benchmark.configurations.with_skill.trigger.pass_rate === 1
      && benchmark.configurations.with_skill.output.objective_check_pass_rate === 1,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    options: sanitizedOptions(options),
    validated_skills: loaded.contracts.map((contract) => contract.skillName),
    active_skills: loaded.activeSkills,
    counts: {
      validated_skills: loaded.contracts.length,
      selected_trigger_cases: loaded.selectedTriggerCases.length,
      selected_host_output_cases: hostCases.length,
      executed_trigger_batches: triggerResults.length,
      executed_trigger_attempts: triggerResults.reduce((sum, result) => sum + result.cases.length, 0),
      executed_output_attempts: outputResults.length,
    },
    pass_rates: {
      baseline: benchmark.configurations.baseline,
      with_skill: benchmark.configurations.with_skill,
      delta_with_skill_minus_baseline: benchmark.pass_rate_delta_with_skill_minus_baseline,
    },
    artifacts: {
      benchmark: "benchmark.json",
      snapshots: "snapshots/",
      raw_runs: "raw/",
      sanitized_report_copy_written: Boolean(options.jsonOut),
    },
    raw_output_included: false,
    matched_evidence_quotes_included: false,
  };
  await writeJson(path.join(options.outputDir, "summary.json"), summary);
  return summary;
}

async function main(argv) {
let options;
const startedAt = new Date().toISOString();
try {
  options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  await mkdir(ARTIFACT_ROOT, { recursive: true });
  if (await realpath(ARTIFACT_ROOT) !== path.resolve(ARTIFACT_ROOT)) {
    throw new ContractError("the artifact workspace root must not be symlinked");
  }
  await mkdir(SKILL_EVAL_ARTIFACT_ROOT, { recursive: true });
  await verifyArtifactPath(options.outputDir, "--output-dir");
  if (options.jsonOut) await verifyArtifactPath(options.jsonOut, "--json-out");
  options.artifactPathsVerified = true;
  await rm(options.outputDir, { recursive: true, force: true });
  await mkdir(options.outputDir, { recursive: true });
  const loaded = await loadContracts(options);
  if (options.mode === "contract") {
    const summary = await writeContractSummary(options, loaded, startedAt);
    console.log(`Skill eval contract passed: ${summary.counts.validated_skills} skills, ${summary.counts.validated_output_cases} validated output cases, ${summary.counts.selected_trigger_cases} selected trigger cases.`);
  } else {
    const summary = await runHostMode(options, loaded, startedAt);
    if (!summary.quality_passed) {
      console.error(`Skill host eval failed its with-skill quality gate. Evidence retained at ${options.outputDir}`);
      process.exitCode = 1;
    } else {
      console.log(`Skill host eval passed: ${summary.counts.validated_skills} skills, ${summary.counts.executed_output_attempts} output attempts. Artifacts: ${options.outputDir}`);
    }
  }
} catch (error) {
  const failure = {
    schema_version: 1,
    mode: options?.mode ?? "unknown",
    status: "failed",
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    options: options ? sanitizedOptions(options) : undefined,
    error: error.message,
    raw_output_included: false,
  };
  if (options?.outputDir && options.artifactPathsVerified) {
    try {
      await writeJson(path.join(options.outputDir, "summary.json"), failure);
      if (options.jsonOut) await writeJson(options.jsonOut, failure);
    } catch {
      // Keep the original failure authoritative when report writing also fails.
    }
  }
  console.error(`Skill eval runner failed: ${error.message}`);
  process.exitCode = 1;
}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
