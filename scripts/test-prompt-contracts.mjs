#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMMAND_AGENTS,
  COMMAND_ARGUMENT_HINTS,
  COMMAND_ROUTING_EXCEPTIONS,
  COMMAND_SKILLS,
  OPENAI_AGENT_SKILL_SUMMARIES,
  PUBLIC_SKILLS,
  REQUIRED_PRIVACY_PATTERNS,
  REQUIRED_PROVIDER_PATTERNS,
  REQUIRED_READ_ONLY_PATTERNS,
} from "./sendlens-contract.mjs";
import { inspectOutputCases, inspectTriggerCases } from "./skill-eval-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const DESCRIPTION_MIN_LENGTH = 60;
const DESCRIPTION_MAX_LENGTH = 250;

const REQUIRED_SKILL_FRONTMATTER = ["name", "description"];
const ALLOWED_SKILL_FRONTMATTER = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);
const REQUIRED_COMMAND_FRONTMATTER = [
  "description",
  "argument-hint",
  "subtask",
];

const RELOAD_OR_REINSTALL_PLUGIN_PATTERN =
  /\b(plugin\/MCP server\b.{0,80}\breload(?:ed)? or reinstall(?:ed)?|reload(?:ed)? or reinstall(?:ed)?\b.{0,80}\bplugin\/MCP server)\b/i;

const ALLOWED_ANALYSIS_FALLBACK_DENIALS = [
  {
    pattern:
      /\bdo not inspect local files or repo source\b|\bdo not use shell, local files, repo inspection, or MCP setup commands as a fallback\b/i,
    rationale:
      "Specialist agents may name shell, local files, and repo inspection only to deny them as SendLens-analysis fallbacks.",
  },
  {
    pattern: /\buse only SendLens MCP tools\b/i,
    rationale:
      "This is the positive MCP-only routing instruction the agents must preserve.",
  },
  {
    pattern: RELOAD_OR_REINSTALL_PLUGIN_PATTERN,
    rationale:
      "Reload or reinstall guidance is the allowed stop condition when MCP tools are unavailable.",
  },
];

const PROHIBITED_AGENT_SURFACES = [
  "shell",
  "bash",
  "local files",
  "local file",
  "repo source",
  "repo inspection",
  "jq",
  "DuckDB",
  "raw DuckDB",
  "MCP setup commands",
];

const REQUIRED_ANALYST_TERMS = [
  "workspace_snapshot",
  "analysis_starters",
  "load_campaign_data",
  "prepare_campaign_analysis",
  "orchestration contract",
  "sendlens-campaign-strategist",
  "sendlens-copywriter",
  "sendlens-launch-operator",
  "reload or reinstall the plugin/MCP server",
  "provider operations read-only",
];

const REQUIRED_ANALYST_DENIAL_PATTERNS = [
  /\bDo not inspect repository files\b/i,
  /\braw DuckDB files\b/i,
  /\bcached JSON\b/i,
  /\bshell output\b/i,
  /\bsetup scripts\b/i,
];

const REQUIRED_DELEGATION_AGENTS = [
  "workspace-triager",
  "campaign-analyst",
  "reply-auditor",
  "icp-auditor",
  "copy-auditor",
  "campaign-strategist",
  "campaign-copywriter",
  "launch-operator",
  "synthesis-reviewer",
];

const REQUIRED_DELEGATION_PATTERNS = [
  /simple inventory, freshness, setup, (?:and|or) status requests[^.]*must not spawn/i,
  /must (?:spawn|delegate) `workspace-triager` first/i,
  /select (?:exactly )?one campaign before (?:spawning|delegating)/i,
  /analyst evidence[^\n]*`campaign-strategist`[^\n]*`campaign-copywriter`[^\n]*`launch-operator`/i,
  /run analyst evidence[^.]*sequentially/i,
  /do not parallelize stages that consume an earlier handoff/i,
  /focused strategy, copy, or launch request[^.]*delegate the owning/i,
  /delegate only the lanes the user's decision requires/i,
  /must (?:spawn|delegate) `synthesis-reviewer`[^.]*before the coordinator answers/i,
  /parallel[^.]*only[^.]*independent specialist lanes/i,
  /coordinator owns every spawn/i,
  /specialists must not spawn nested agents/i,
  /native delegation is unavailable[^.]*execute the same lane boundaries inline/i,
  /must not claim or imply that a specialist was spawned/i,
];

const PROMOTION_GUARD_CONTRACTS = [
  {
    path: "skills/sendlens-analyst/references/evidence-and-metrics.md",
    patterns: [
      /Promotion Guard/i,
      /metric leader requiring verification/i,
      /prepare_campaign_analysis/i,
    ],
  },
  {
    path: "skills/sendlens-analyst/references/workspace-and-performance.md",
    patterns: [
      /low-volume leaders as candidates for validation/i,
      /campaign_variants/i,
      /aggregate unique human reply count/i,
      /selected statuses/i,
      /fetch_latest_of_thread/i,
      /stored context latest-thread basis/i,
      /aggregate-to-hydrated numeric gap/i,
      /maximum depth does not guarantee recovery/i,
    ],
  },
  {
    path: "skills/sendlens-analyst/references/replies-icp-and-copy.md",
    patterns: [
      /reply_email_context/i,
      /different product, industry, compliance domain, or topic/i,
      /Do not generate generic rewrites/i,
      /aggregate unique human reply count/i,
      /OOO status `0` was excluded/i,
      /fetch_latest_of_thread/i,
      /stored context latest-thread basis/i,
      /aggregate-to-hydrated numeric gap/i,
      /maximum depth does not guarantee recovery/i,
      /Do not assert which cause applies without evidence/i,
      /source-specific absence, not automatically as missing uploaded metadata/i,
      /rendering integrity, visitor-source provenance, and copy strategy/i,
      /visitor-source provenance cannot be verified/i,
      /does not explicitly reference visitor behavior/i,
      /Do not (?:say|claim)[^.]*signal never reached the message/i,
    ],
  },
  {
    path: "plugin/query-recipes.ts",
    patterns: [
      /RB2B, Clay, or another external source/i,
      /Missing keys are source-specific absence/i,
      /not proof that metadata coverage is thin, visitor intent is missing/i,
      /not automatically as a lead-list metadata coverage issue/i,
      /intended template tokens and available payload keys first/i,
    ],
  },
  {
    path: "skills/sendlens-analyst/SKILL.md",
    patterns: [
      /reply_coverage_summary/i,
      /aggregate unique human reply count/i,
      /OOO exclusion/i,
      /fetch_latest_of_thread/i,
      /stored context latest-thread basis/i,
      /per-status fetched\/hydrated counts/i,
    ],
  },
  {
    path: "skills/sendlens-campaign-strategist/references/campaign-design.md",
    patterns: [
      /Do not recommend a new campaign until/i,
      /Campaign Recommendation Contract/i,
      /Do not fabricate customer proof, quantified lift, product capabilities, or reply language/i,
    ],
  },
  {
    path: "agents/synthesis-reviewer.md",
    patterns: [
      /working, winner, scale, or client-safe recommendation/i,
      /copy-path validation/i,
      /setup\/template-resolution risk/i,
    ],
  },
  {
    path: "agents/campaign-analyst.md",
    patterns: [
      /Before calling the campaign working, a winner, or ready to scale/i,
      /reply_context/i,
      /campaign_variants/i,
      /reply hydration/i,
      /mismatch or complaint replies/i,
    ],
  },
  {
    path: "agents/copy-auditor.md",
    patterns: [
      /hydrated reply bodies already present in `reply_context`/i,
      /possible wrong-template delivery/i,
      /intended copy angle was tested/i,
      /rendering integrity, visitor-source provenance, and copy strategy/i,
      /RB2B, Clay, or another external source/i,
      /rendered successfully against the available sampled lead variables/i,
    ],
  },
  {
    path: "agents/icp-auditor.md",
    patterns: [
      /source-specific absence/i,
      /RB2B, Clay, or another external source/i,
      /visitor-source provenance cannot be verified/i,
    ],
  },
  {
    path: "agents/reply-auditor.md",
    patterns: [
      /irrelevant copy, wrong industry, wrong compliance domain/i,
      /setup\/template-resolution risk/i,
      /wrong-template or wrong-topic complaint replies/i,
      /aggregate unique human reply count/i,
      /aggregate-to-hydrated gap/i,
      /maximum depth/i,
    ],
  },
  {
    path: "INSTRUCTIONS.md",
    patterns: [
      /broad aggregates only shortlist candidates/i,
      /Validate `reply_context` and `campaign_variants`/i,
      /fetch_reply_text` has returned exact reply bodies/i,
      /rendering integrity, visitor-source provenance, and copy strategy/i,
      /RB2B, Clay, or another external source/i,
      /Only call personalization data missing or failed/i,
    ],
  },
];

const REQUIRED_ISSUE_TEMPLATES = [
  ".github/ISSUE_TEMPLATE/bug_report.md",
  ".github/ISSUE_TEMPLATE/feature_request.md",
  ".github/ISSUE_TEMPLATE/data_correctness.md",
  ".github/ISSUE_TEMPLATE/mcp_contract_change.md",
  ".github/ISSUE_TEMPLATE/privacy_behavior_change.md",
  ".github/ISSUE_TEMPLATE/host_install_issue.md",
];

const failures = [];

function fail(message) {
  failures.push(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function listFiles(directory, filter) {
  const entries = await readdir(path.join(root, directory), {
    withFileTypes: true,
  });

  return entries
    .filter(filter)
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

async function listSkillFiles() {
  const skillDirs = await listFiles("skills", (entry) => entry.isDirectory());
  return skillDirs.map((dir) => path.join(dir, "SKILL.md"));
}

async function readIfExists(relativePath) {
  try {
    return await readText(relativePath);
  } catch {
    return "";
  }
}

async function readText(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

function parseFrontmatter(relativePath, text) {
  if (!text.startsWith("---\n")) {
    return {
      data: null,
      body: text,
      errors: [`${relativePath}: missing opening frontmatter fence`],
    };
  }

  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    return {
      data: null,
      body: text,
      errors: [`${relativePath}: missing closing frontmatter fence`],
    };
  }

  const raw = text.slice(4, end).trimEnd();
  const body = text.slice(end + "\n---".length).replace(/^\n/, "");
  const errors = [];
  const data = {};
  const stack = [{ indent: -1, value: data }];

  for (const [index, line] of raw.split("\n").entries()) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    const match = line.match(/^(\s*)([^:]+):(.*)$/);
    if (!match) {
      errors.push(
        `${relativePath}:${index + 2}: unsupported frontmatter line "${line}"`,
      );
      continue;
    }

    const indent = match[1].length;
    const key = stripQuotes(match[2].trim());
    const rawValue = match[3].trim();

    while (stack.length > 1 && indent <= stack.at(-1).indent) {
      stack.pop();
    }

    const parent = stack.at(-1).value;
    if (rawValue === "") {
      parent[key] = {};
      stack.push({ indent, value: parent[key] });
    } else {
      parent[key] = parseScalar(rawValue);
    }
  }

  return { data, body, errors };
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseScalar(value) {
  const stripped = stripQuotes(value);
  if (stripped === "true") return true;
  if (stripped === "false") return false;
  if (/^-?\d+$/.test(stripped)) return Number(stripped);
  return stripped;
}

function requireString(data, key, relativePath) {
  const value = data?.[key];
  assert(
    typeof value === "string" && value.trim().length > 0,
    `${relativePath}: required frontmatter field "${key}" must be a non-empty string`,
  );
  return typeof value === "string" ? value.trim() : "";
}

function checkDescription(data, relativePath) {
  const description = requireString(data, "description", relativePath);
  if (!description) return;

  assert(
    description.length >= DESCRIPTION_MIN_LENGTH,
    `${relativePath}: description is too short (${description.length}; minimum ${DESCRIPTION_MIN_LENGTH})`,
  );
  assert(
    description.length <= DESCRIPTION_MAX_LENGTH,
    `${relativePath}: description is too long (${description.length}; maximum ${DESCRIPTION_MAX_LENGTH})`,
  );
  if (relativePath.startsWith("skills/")) {
    assert(
      description.startsWith("Use when"),
      `${relativePath}: skill description must start with "Use when" and describe triggering conditions`,
    );
  }
}

function titleFromCommandBody(body) {
  const heading = body.match(/^#\s+(.+)$/m);
  return heading?.[1]?.trim() ?? "";
}

function commandReferencesSkill(body, skillName) {
  const exactUse = new RegExp(
    String.raw`Use the \`${escapeRegExp(skillName)}\` skill\b`,
    "i",
  );
  return exactUse.test(body);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitToolList(value) {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isDenied(value) {
  return typeof value === "string" && value.toLowerCase() === "deny";
}

function isAllowedAnalysisFallbackLine(line) {
  return ALLOWED_ANALYSIS_FALLBACK_DENIALS.some(({ pattern }) =>
    pattern.test(line),
  );
}

function hasProhibitedAnalysisFallback(line) {
  const lower = line.toLowerCase();
  return PROHIBITED_AGENT_SURFACES.some((surface) =>
    lower.includes(surface.toLowerCase()),
  );
}

async function assertPathExists(relativePath) {
  try {
    await stat(path.join(root, relativePath));
    return true;
  } catch {
    fail(`${relativePath}: expected path to exist`);
    return false;
  }
}

async function collectSkillContracts() {
  const skillFiles = await listSkillFiles();
  assert(skillFiles.length > 0, "skills/: expected at least one skill");

  const skillNames = new Set();

  for (const relativePath of skillFiles) {
    await assertPathExists(relativePath);
    const text = await readText(relativePath);
    const { data, errors } = parseFrontmatter(relativePath, text);
    errors.forEach(fail);
    if (!data) continue;

    for (const field of REQUIRED_SKILL_FRONTMATTER) {
      requireString(data, field, relativePath);
    }

    for (const field of Object.keys(data)) {
      assert(
        ALLOWED_SKILL_FRONTMATTER.has(field),
        `${relativePath}: unsupported Agent Skills frontmatter field "${field}"`,
      );
    }

    const directoryName = path.basename(path.dirname(relativePath));
    const skillName = typeof data.name === "string" ? data.name.trim() : "";
    assert(
      skillName === directoryName,
      `${relativePath}: frontmatter name "${skillName}" must equal directory "${directoryName}"`,
    );
    checkDescription(data, relativePath);

    if (skillName) skillNames.add(skillName);

    const openaiPath = `skills/${skillName}/agents/openai.yaml`;
    await assertPathExists(openaiPath);
    const openaiText = await readText(openaiPath);
    const summaryPattern = OPENAI_AGENT_SKILL_SUMMARIES.get(skillName);
    assert(
      /^interface:\n/m.test(openaiText) &&
        /display_name:\s*".+"/.test(openaiText) &&
        /short_description:\s*".+"/.test(openaiText) &&
        /default_prompt:\s*".+"/.test(openaiText),
      `${openaiPath}: expected display_name, short_description, and default_prompt metadata`,
    );
    assert(
      summaryPattern?.test(openaiText),
      `${openaiPath}: generated OpenAI agent metadata must preserve the canonical ${skillName} trigger boundary`,
    );
  }

  return skillNames;
}

async function collectAgentContracts() {
  const agentFiles = await listFiles(
    "agents",
    (entry) => entry.isFile() && entry.name.endsWith(".md"),
  );
  assert(agentFiles.length > 0, "agents/: expected at least one agent");

  const agentNames = new Set();

  for (const relativePath of agentFiles) {
    const text = await readText(relativePath);
    const { data, body, errors } = parseFrontmatter(relativePath, text);
    errors.forEach(fail);
    if (!data) continue;

    const filenameName = path.basename(relativePath, ".md");
    const agentName = requireString(data, "name", relativePath);
    agentNames.add(agentName);

    assert(
      agentName === filenameName,
      `${relativePath}: frontmatter name "${agentName}" must equal filename "${filenameName}"`,
    );
    checkDescription(data, relativePath);

    assert(
      data.mode === "subagent",
      `${relativePath}: shipped specialist agents must use mode: subagent`,
    );

    const tools = splitToolList(data.tools);
    assert(
      tools.length > 0,
      `${relativePath}: specialist agent must declare SendLens MCP tools`,
    );
    for (const tool of tools) {
      assert(
        tool.startsWith("mcp__sendlens__"),
        `${relativePath}: tool "${tool}" is outside the SendLens MCP surface`,
      );
    }

    const permission = data.permission ?? {};
    assert(
      isDenied(permission.edit),
      `${relativePath}: permission.edit must be deny`,
    );
    assert(
      isDenied(permission.bash),
      `${relativePath}: permission.bash must be deny`,
    );
    assert(
      isDenied(permission.task?.["*"]),
      `${relativePath}: permission.task."*" must be deny`,
    );

    assert(
      /\buse only SendLens MCP tools\b/i.test(body),
      `${relativePath}: body must state that SendLens analysis uses only SendLens MCP tools`,
    );
    for (const pattern of REQUIRED_PRIVACY_PATTERNS) {
      assert(
        pattern.test(body),
        `${relativePath}: missing privacy/evidence boundary matching ${pattern}`,
      );
    }
    assert(
      RELOAD_OR_REINSTALL_PLUGIN_PATTERN.test(body),
      `${relativePath}: body must stop on missing MCP tools and tell the user to reload or reinstall the plugin/MCP server`,
    );

    for (const [index, line] of body.split("\n").entries()) {
      if (!hasProhibitedAnalysisFallback(line)) continue;
      if (isAllowedAnalysisFallbackLine(line)) continue;
      fail(
        `${relativePath}:${index + 1}: prohibited SendLens-analysis fallback instruction mentions restricted surface: ${line.trim()}`,
      );
    }
  }

  return agentNames;
}

async function collectCommandContracts(skillNames, agentNames) {
  const commandFiles = await listFiles(
    "commands",
    (entry) => entry.isFile() && entry.name.endsWith(".md"),
  );
  assert(commandFiles.length > 0, "commands/: expected at least one command");

  const commandNames = new Set();

  for (const relativePath of commandFiles) {
    const text = await readText(relativePath);
    const { data, body, errors } = parseFrontmatter(relativePath, text);
    errors.forEach(fail);

    const commandName = path.basename(relativePath, ".md");
    commandNames.add(commandName);

    const targetSkill = COMMAND_SKILLS.get(commandName) ?? "";
    assert(targetSkill, `${relativePath}: command must map to a public skill or supported legacy analyst route`);
    assert(
      commandReferencesSkill(body, targetSkill),
      `${relativePath}: body must route to the \`${targetSkill}\` skill`,
    );
    assert(
      titleFromCommandBody(body).length > 0,
      `${relativePath}: command body must start with an H1 title`,
    );

    const commandData = data ?? {};

    for (const field of REQUIRED_COMMAND_FRONTMATTER) {
      assert(
        Object.hasOwn(commandData, field),
        `${relativePath}: missing required command routing metadata "${field}"`,
      );
    }

    checkDescription(commandData, relativePath);

    const agent =
      typeof commandData.agent === "string" ? commandData.agent.trim() : "";
    const exception = COMMAND_ROUTING_EXCEPTIONS.get(commandName);
    if (exception) {
      assert(
        agent === exception.agent,
        exception.agent
          ? `${relativePath}: explicit route must use agent "${exception.agent}" (${exception.rationale})`
          : `${relativePath}: setup command must not route to an agent (${exception.rationale})`,
      );
      assert(
        commandData.subtask === false,
        `${relativePath}: explicit route must set subtask: false (${exception.rationale})`,
      );
      assert(
        typeof commandData["argument-hint"] === "string",
        `${relativePath}: explicit route still requires argument-hint metadata (${exception.rationale})`,
      );
    } else {
      const expectedAgent = COMMAND_AGENTS.get(commandName);
      assert(
        expectedAgent === agent && agentNames.has(agent),
        `${relativePath}: command must route to specialist agent "${expectedAgent}"`,
      );
      assert(
        commandData.context === "fork",
        `${relativePath}: analysis command must set context: fork so host clients keep heavy SendLens analysis out of the parent conversation`,
      );
      assert(
        commandData.subtask === true,
        `${relativePath}: command routing metadata must set subtask: true`,
      );
      assert(
        typeof commandData["argument-hint"] === "string" &&
          commandData["argument-hint"].trim().length > 0,
        `${relativePath}: argument-hint must be a non-empty string`,
      );
      const expectedHint = COMMAND_ARGUMENT_HINTS.get(commandName);
      assert(
        commandData["argument-hint"] === expectedHint,
        `${relativePath}: expected canonical argument hint "${expectedHint}"`,
      );
    }
  }

  for (const skillName of skillNames) {
    assert(
      commandNames.has(skillName),
      `commands/: missing command wrapper for skill "${skillName}"`,
    );
  }

  for (const commandName of commandNames) {
    assert(
      skillNames.has(commandName) || COMMAND_SKILLS.has(commandName) || commandName === "using-sendlens",
      `commands/${commandName}.md: no public skill or supported legacy route`,
    );
  }
}

async function assertSendLensAnalystContract(skillNames) {
  assert(
    skillNames.has("sendlens-analyst"),
    "skills/: missing required sendlens-analyst behavior contract",
  );

  const skillPath = "skills/sendlens-analyst/SKILL.md";
  const skillText = await readText(skillPath);
  const { body, errors } = parseFrontmatter(
    skillPath,
    skillText,
  );
  errors.forEach(fail);

  for (const term of REQUIRED_ANALYST_TERMS) {
    assert(
      body.toLowerCase().includes(term.toLowerCase()),
      `${skillPath}: missing required contract term "${term}"`,
    );
  }

  for (const pattern of REQUIRED_ANALYST_DENIAL_PATTERNS) {
    assert(
      pattern.test(body),
      `${skillPath}: missing required no-fallback denial matching ${pattern}`,
    );
  }

  assert(
    /\bUse `analysis_starters` before custom `analyze_data`/i.test(body),
    `${skillPath}: must require analysis_starters before custom analyze_data`,
  );
  assert(
    /\bcontinue through every requested downstream stage/i.test(body),
    `${skillPath}: broad requests must continue through requested downstream stages`,
  );

  for (const reference of [
    "evidence-and-metrics.md",
    "schema-and-joins.md",
    "workspace-and-performance.md",
    "replies-icp-and-copy.md",
  ]) {
    assert(body.includes(`references/${reference}`), `${skillPath}: missing direct reference to ${reference}`);
    await assertPathExists(`skills/sendlens-analyst/references/${reference}`);
  }

  const instructions = await readText("INSTRUCTIONS.md");
  const evidenceContract = await readText(
    "skills/sendlens-analyst/references/evidence-and-metrics.md",
  );
  const catalog = await readText("docs/CATALOG.md");
  assert(
    /\bsendlens-analyst\b/.test(instructions),
    "INSTRUCTIONS.md: must reference sendlens-analyst routing contract",
  );

  for (const [relativePath, contractBody] of [
    [skillPath, body],
    ["INSTRUCTIONS.md", instructions],
    ["skills/sendlens-analyst/references/evidence-and-metrics.md", evidenceContract],
  ]) {
    for (const pattern of REQUIRED_READ_ONLY_PATTERNS) {
      assert(
        pattern.test(contractBody),
        `${relativePath}: missing read-only mutation refusal matching ${pattern}`,
      );
    }
  }

  for (const [relativePath, contractBody] of [
    [skillPath, body],
    ["INSTRUCTIONS.md", instructions],
    ["docs/CATALOG.md", catalog],
  ]) {
    for (const pattern of REQUIRED_PROVIDER_PATTERNS) {
      assert(
        pattern.test(contractBody),
        `${relativePath}: missing provider contract language matching ${pattern}`,
      );
    }
  }

  for (const [relativePath, contractBody] of [
    [skillPath, body],
    ["INSTRUCTIONS.md", instructions],
  ]) {
    for (const agent of REQUIRED_DELEGATION_AGENTS) {
      assert(
        contractBody.includes(`\`${agent}\``),
        `${relativePath}: missing required delegation agent "${agent}"`,
      );
    }
    for (const pattern of REQUIRED_DELEGATION_PATTERNS) {
      assert(
        pattern.test(contractBody),
        `${relativePath}: missing required bounded delegation contract matching ${pattern}`,
      );
    }
  }

  const focusedContracts = [
    {
      name: "sendlens-campaign-strategist",
      references: ["references/campaign-design.md"],
      patterns: [/validated SendLens findings/i, /Do not draft full email bodies/i, /copy_handoff/i, /sendlens-copywriter/i],
    },
    {
      name: "sendlens-copywriter",
      references: ["references/copywriting-system.md"],
      patterns: [/approved audience, offer, angle/i, /meaningful variants/i, /sendlens-launch-operator/i],
    },
    {
      name: "sendlens-launch-operator",
      references: ["references/launch-operations.md"],
      patterns: [/blocked.*ready_with_warnings.*ready/is, /stop\/iterate\/scale/i, /provider operations read-only|provider operations read-only|keep provider operations read-only/i],
    },
  ];

  for (const contract of focusedContracts) {
    assert(skillNames.has(contract.name), `skills/: missing required ${contract.name} contract`);
    const focusedPath = `skills/${contract.name}/SKILL.md`;
    const focusedText = await readText(focusedPath);
    const { body: focusedBody, errors: focusedErrors } = parseFrontmatter(focusedPath, focusedText);
    focusedErrors.forEach(fail);
    for (const pattern of contract.patterns) {
      assert(pattern.test(focusedBody), `${focusedPath}: missing focused boundary matching ${pattern}`);
    }
    for (const reference of contract.references) {
      assert(focusedBody.includes(reference), `${focusedPath}: missing direct reference to ${reference}`);
      await assertPathExists(`skills/${contract.name}/${reference}`);
    }
    assert(
      focusedBody.includes("../sendlens-analyst/references/evidence-and-metrics.md"),
      `${focusedPath}: must reuse the shared evidence contract`,
    );
  }
}

async function assertDocumentationOwnershipContracts() {
  const catalog = await readText("docs/CATALOG.md");
  for (const [command, agent] of COMMAND_AGENTS) {
    const docPath = `docs/skills/${command}.md`;
    const commandPath = `commands/${command}.md`;
    const [docText, commandText] = await Promise.all([
      readIfExists(docPath),
      readText(commandPath),
    ]);
    if (docText) {
      assert(
        new RegExp(`Default agent: \`${escapeRegExp(agent)}\``).test(docText),
        `${docPath}: expected canonical default agent "${agent}"`,
      );
    }
    assert(
      new RegExp(String.raw`\| \`/${escapeRegExp(command)}\` \| [^|]+ \| \`${escapeRegExp(agent)}\` \|`).test(catalog),
      `docs/CATALOG.md: command /${command} must list canonical default agent "${agent}"`,
    );
    if (commandText.includes("provider-tag")) {
      assert(
        /provider tag/i.test(commandText) && !/instantly-tag/i.test(commandText),
        `${commandPath}: provider-neutral command hints must not use instantly-tag`,
      );
    }
  }
}

async function assertSkillEvalContracts(skillNames) {
  for (const skillName of skillNames) {
    const evalPath = `skills/${skillName}/evals/evals.json`;
    const triggerPath = `skills/${skillName}/evals/trigger-queries.json`;
    await assertPathExists(evalPath);
    await assertPathExists(triggerPath);

    let evalPayload;
    let triggerQueries;
    try {
      evalPayload = JSON.parse(await readText(evalPath));
    } catch (error) {
      fail(`${evalPath}: invalid JSON: ${error.message}`);
      continue;
    }
    try {
      triggerQueries = JSON.parse(await readText(triggerPath));
    } catch (error) {
      fail(`${triggerPath}: invalid JSON: ${error.message}`);
      continue;
    }

    const outputInspection = inspectOutputCases(skillName, evalPath, evalPayload);
    for (const error of outputInspection.errors) fail(error);
    assert(Array.isArray(evalPayload.evals) && evalPayload.evals.length >= 3, `${evalPath}: expected at least three realistic output evals`);

    if (skillName === "sendlens-analyst") {
      const evalsById = new Map((evalPayload.evals ?? []).map((testCase) => [testCase.id, testCase]));
      const requiredEvalSemantics = new Map([
        ["direct-fast-path-no-spawn", [/direct MCP fast path/i, /no specialist agent is spawned/i]],
        ["triage-before-campaign-depth", [/workspace-triager is delegated first/i, /exactly one campaign/i, /only the reply and ICP specialist lanes/i, /synthesis-reviewer/i]],
        ["broad-full-chain-orchestration", [/campaign-strategist, campaign-copywriter, and launch-operator/i, /sequentially in that order/i, /synthesis-reviewer/i]],
        ["inline-delegation-fallback", [/executed inline/i, /does not claim or imply that a subagent was spawned/i]],
      ]);
      for (const [requiredId, patterns] of requiredEvalSemantics) {
        const testCase = evalsById.get(requiredId);
        assert(testCase, `${evalPath}: missing delegation eval "${requiredId}"`);
        const semanticText = [testCase?.expected_output, ...(testCase?.assertions ?? [])].join("\n");
        for (const pattern of patterns) {
          assert(pattern.test(semanticText), `${evalPath}: delegation eval "${requiredId}" missing semantic contract matching ${pattern}`);
        }
      }
    }

    const triggerInspection = inspectTriggerCases(skillName, triggerPath, triggerQueries);
    for (const error of triggerInspection.errors) fail(error);
    assert(Array.isArray(triggerQueries) && triggerQueries.length >= 10, `${triggerPath}: expected at least ten trigger queries`);
    const focused = triggerQueries.filter((entry) => entry.suites?.includes("focused"));
    const positive = focused.filter((entry) => entry.should_trigger === true);
    const negative = focused.filter((entry) => entry.should_trigger === false);
    assert(positive.length >= 8 && positive.length <= 10, `${triggerPath}: expected 8-10 focused should-trigger queries`);
    assert(negative.length >= 8 && negative.length <= 10, `${triggerPath}: expected 8-10 focused near-miss should-not-trigger queries`);
    for (const cohort of ["train", "validation"]) {
      const cohortCases = focused.filter((entry) => entry.cohort === cohort);
      assert(cohortCases.filter((entry) => entry.should_trigger).length >= 3, `${triggerPath}: ${cohort} cohort needs at least three focused positives`);
      assert(cohortCases.filter((entry) => !entry.should_trigger).length >= 3, `${triggerPath}: ${cohort} cohort needs at least three focused negatives`);
    }
  }
}

async function assertSkillQualityHardeningContracts(skillNames) {
  assert(skillNames.size === 5, `skills/: expected exactly five public skills, found ${skillNames.size}`);
  for (const skillName of skillNames) {
    const skillPath = `skills/${skillName}/SKILL.md`;
    const skillText = await readText(skillPath);
    assert(
      /^## Final QA Loop$/m.test(skillText),
      `${skillPath}: every public skill needs an explicit final QA loop`,
    );
    assert(
      /^## Example Requests$/m.test(skillText),
      `${skillPath}: every public skill needs realistic request examples`,
    );
    assert(
      /provider (?:operations|actions) (?:remain |are |keep )?read-only|keep provider operations read-only/i.test(skillText),
      `${skillPath}: every public skill must preserve the provider read-only boundary`,
    );
    assert(
      /secret|credential/i.test(skillText) && /raw customer data|raw contact data/i.test(skillText),
      `${skillPath}: every public skill final check must preserve credential and customer-data privacy`,
    );
  }

  const setupSkill = await readText("skills/sendlens-setup/SKILL.md");
  const setupReference = await readText(
    "skills/sendlens-setup/references/recovery-and-clients.md",
  );
  const setupSurface = `${setupSkill}\n${setupReference}`;
  for (const pattern of [
    /setup_doctor[\s\S]*Pluxx[\s\S]*https:\/\/sendlens\.app\/install\.sh/i,
    /curl[\s\S]*bash[\s\S]*mktemp[\s\S]*node[\s\S]*network access/i,
    /does not require a global Pluxx CLI|not a preinstalled global Pluxx CLI/i,
    /blocked: missing installer prerequisite: <exact prerequisite>/i,
    /Never repair an install by manually scattering|never scatter agent, skill, command, or MCP files/i,
    /reload or restart[\s\S]*rerun `setup_doctor`/i,
    /Both keys infer `all`[\s\S]*requires `SENDLENS_CLIENT`/i,
    /distinct `SENDLENS_DB_PATH` and `SENDLENS_STATE_DIR`/i,
    /set -e[\s\S]*--connect-timeout 10[\s\S]*--max-time 120[\s\S]*--retry 3/i,
    /trap 'rm -f "\$installer_file"' EXIT[\s\S]*bash "\$installer_file"/i,
  ]) {
    assert(pattern.test(setupSurface), `sendlens-setup recovery contract missing ${pattern}`);
  }
  assert(
    !/bash\s+<\(curl/i.test(setupReference),
    "sendlens-setup recovery must not lose initial curl failures through process substitution",
  );

  const instructions = await readText("INSTRUCTIONS.md");
  assert(
    /Smartlead Smart Delivery as support-gated/i.test(instructions),
    "INSTRUCTIONS.md: Smart Delivery must remain support-gated",
  );
  assert(
    !/Treat Smartlead inbox placement as `unsupported` in V1/i.test(instructions),
    "INSTRUCTIONS.md: must not restore the stale universally-unsupported Smartlead claim",
  );

  const pluxxConfig = await readText("pluxx.config.ts");
  assert(
    /open-source release connects read-only to Instantly and Smartlead/i.test(pluxxConfig),
    "pluxx.config.ts: public product copy must name both read-only providers",
  );
  assert(
    !/open-source release currently connects to Instantly,/i.test(pluxxConfig),
    "pluxx.config.ts: must not restore the stale Instantly-only product claim",
  );

  const launchSkill = await readText("skills/sendlens-launch-operator/SKILL.md");
  const launchAgent = await readText("agents/launch-operator.md");
  for (const pattern of [
    /passed_checks/i,
    /evidence_coverage/i,
    /threshold[^.\n]*provenance/i,
    /load_campaign_data[\s\S]*prepare_campaign_analysis/i,
    /Smart Delivery[\s\S]*support-gated[\s\S]*missing or empty placement rows as healthy/i,
  ]) {
    assert(
      pattern.test(launchSkill),
      `skills/sendlens-launch-operator/SKILL.md: missing executable closeout contract ${pattern}`,
    );
    assert(
      pattern.test(launchAgent),
      `agents/launch-operator.md: delegated launch contract drifted from the public skill at ${pattern}`,
    );
  }
}

async function assertPromotionGuardContracts() {
  for (const contract of PROMOTION_GUARD_CONTRACTS) {
    const text = await readText(contract.path);
    for (const pattern of contract.patterns) {
      assert(
        pattern.test(text),
        `${contract.path}: missing promotion guard language matching ${pattern}`,
      );
    }
  }
}

async function assertContributionAndDecisionGates() {
  const prTemplate = await readText(".github/PULL_REQUEST_TEMPLATE.md");
  for (const pattern of [
    /This belongs in SendLens OSS/i,
    /routed to Pluxx/i,
    /Evidence And Privacy Impact/i,
    /MCP Contract/i,
    /Behavior Verification/i,
    /Decision record/i,
  ]) {
    assert(
      pattern.test(prTemplate),
      `.github/PULL_REQUEST_TEMPLATE.md: missing required gate matching ${pattern}`,
    );
  }

  for (const relativePath of REQUIRED_ISSUE_TEMPLATES) {
    await assertPathExists(relativePath);
    const text = await readText(relativePath);
    assert(
      /SendLens|MCP|evidence|privacy|host|install/i.test(text),
      `${relativePath}: template should describe its SendLens issue surface`,
    );
  }

  const hostInstall = await readText(".github/ISSUE_TEMPLATE/host_install_issue.md");
  assert(
    /Pluxx-owned portability/i.test(hostInstall),
    ".github/ISSUE_TEMPLATE/host_install_issue.md: must route portability issues to Pluxx",
  );

  const decisionReadme = await readText("docs/decisions/README.md");
  assert(
    /SendLens-vs-Pluxx ownership boundaries/i.test(decisionReadme),
    "docs/decisions/README.md: must describe SendLens-vs-Pluxx decision coverage",
  );

  const boundaryRecord = await readText(
    "docs/decisions/2026-05-07-sendlens-pluxx-ownership-boundary.md",
  );
  assert(
    /SendLens owns product behavior/i.test(boundaryRecord) &&
      /Pluxx owns portability and host mechanics/i.test(boundaryRecord),
    "docs/decisions/2026-05-07-sendlens-pluxx-ownership-boundary.md: must preserve ownership boundary",
  );

  const releasing = await readText("docs/RELEASING.md");
  assert(
    /Behavior-Changing Release Gate/i.test(releasing),
    "docs/RELEASING.md: missing behavior-changing release gate",
  );
}

const skillNames = await collectSkillContracts();
const agentNames = await collectAgentContracts();
await collectCommandContracts(skillNames, agentNames);
await assertSendLensAnalystContract(skillNames);
await assertSkillEvalContracts(skillNames);
await assertSkillQualityHardeningContracts(skillNames);
await assertPromotionGuardContracts();
await assertContributionAndDecisionGates();
await assertDocumentationOwnershipContracts();

if (failures.length > 0) {
  console.error("Prompt/package contract failures:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Prompt/package contracts passed (${skillNames.size} skills, ${agentNames.size} agents).`,
);
