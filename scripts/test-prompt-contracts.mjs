#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const COMMAND_ROUTING_EXCEPTIONS = new Map([
  [
    "using-sendlens",
    {
      agent: "campaign-analyst",
      rationale: "Using SendLens is a backward-compatible explicit route into sendlens-analyst.",
    },
  ],
  [
    "sendlens-setup",
    {
      agent: "",
      rationale: "Setup is explicit-invocation and runs the MCP setup doctor workflow without a specialist agent.",
    },
  ],
  [
    "sendlens-analyst",
    {
      agent: "campaign-analyst",
      rationale: "The main analyst command stays in the parent task so it can coordinate the closed-loop workflow.",
    },
  ],
  [
    "sendlens-campaign-strategist",
    {
      agent: "campaign-strategist",
      rationale: "Focused strategy stays in the parent task so its handoff can continue into copy or launch when requested.",
    },
  ],
  [
    "sendlens-copywriter",
    {
      agent: "campaign-copywriter",
      rationale: "Focused copywriting uses the dedicated read-only copywriting specialist.",
    },
  ],
  [
    "sendlens-launch-operator",
    {
      agent: "launch-operator",
      rationale: "Focused launch operation stays in the parent task so the verdict and learning handoff remain coherent.",
    },
  ],
]);

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

const LEGACY_COMMAND_AGENTS = new Map([
  ["account-manager-brief", "workspace-triager"],
  ["campaign-launch-qa", "campaign-analyst"],
  ["campaign-performance", "campaign-analyst"],
  ["cold-email-best-practices", "campaign-analyst"],
  ["copy-analysis", "copy-auditor"],
  ["experiment-planner", "campaign-analyst"],
  ["icp-signals", "icp-auditor"],
  ["reply-patterns", "reply-auditor"],
  ["workspace-health", "workspace-triager"],
]);

const LEGACY_COMMAND_SKILLS = new Map([
  ["account-manager-brief", "sendlens-launch-operator"],
  ["campaign-launch-qa", "sendlens-launch-operator"],
  ["campaign-performance", "sendlens-analyst"],
  ["cold-email-best-practices", "sendlens-copywriter"],
  ["copy-analysis", "sendlens-analyst"],
  ["experiment-planner", "sendlens-campaign-strategist"],
  ["icp-signals", "sendlens-analyst"],
  ["reply-patterns", "sendlens-analyst"],
  ["workspace-health", "sendlens-analyst"],
]);

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
    ],
  },
  {
    path: "skills/sendlens-analyst/references/replies-icp-and-copy.md",
    patterns: [
      /reply_email_context/i,
      /different product, industry, compliance domain, or topic/i,
      /Do not generate generic rewrites/i,
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
    ],
  },
  {
    path: "agents/reply-auditor.md",
    patterns: [
      /irrelevant copy, wrong industry, wrong compliance domain/i,
      /setup\/template-resolution risk/i,
      /wrong-template or wrong-topic complaint replies/i,
    ],
  },
  {
    path: "INSTRUCTIONS.md",
    patterns: [
      /broad aggregates only shortlist candidates/i,
      /Validate `reply_context` and `campaign_variants`/i,
      /fetch_reply_text` has returned exact reply bodies/i,
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

    const targetSkill = skillNames.has(commandName)
      ? commandName
      : LEGACY_COMMAND_SKILLS.get(commandName) ?? (commandName === "using-sendlens"
        ? "sendlens-analyst"
        : "");
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
      const expectedAgent = LEGACY_COMMAND_AGENTS.get(commandName);
      assert(
        expectedAgent === agent && agentNames.has(agent),
        `${relativePath}: legacy analyst command must route to specialist agent "${expectedAgent}"`,
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
      skillNames.has(commandName) || LEGACY_COMMAND_SKILLS.has(commandName) || commandName === "using-sendlens",
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
  assert(
    /\bsendlens-analyst\b/.test(instructions),
    "INSTRUCTIONS.md: must reference sendlens-analyst routing contract",
  );

  const focusedContracts = [
    {
      name: "sendlens-campaign-strategist",
      references: ["references/campaign-design.md"],
      patterns: [/validated SendLens findings/i, /Do not draft full email bodies/i, /sendlens-copywriter/i],
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

    assert(evalPayload.skill_name === skillName, `${evalPath}: skill_name must equal ${skillName}`);
    assert(Array.isArray(evalPayload.evals) && evalPayload.evals.length >= 3, `${evalPath}: expected at least three realistic output evals`);
    for (const testCase of evalPayload.evals ?? []) {
      assert(typeof testCase.id === "string" && testCase.id.length > 0, `${evalPath}: every eval needs a stable id`);
      assert(typeof testCase.prompt === "string" && testCase.prompt.length >= 20, `${evalPath}: every eval needs a realistic prompt`);
      assert(typeof testCase.expected_output === "string" && testCase.expected_output.length >= 40, `${evalPath}: every eval needs a substantive expected_output`);
      assert(Array.isArray(testCase.assertions) && testCase.assertions.length >= 3, `${evalPath}: every eval needs at least three objective assertions`);
      for (const assertion of testCase.assertions ?? []) {
        assert(typeof assertion === "string" && assertion.trim().length > 0, `${evalPath}: every assertion must be non-empty text`);
      }
    }

    assert(Array.isArray(triggerQueries) && triggerQueries.length >= 10, `${triggerPath}: expected at least ten trigger queries`);
    for (const entry of triggerQueries ?? []) {
      assert(typeof entry?.query === "string" && entry.query.trim().length > 0, `${triggerPath}: every query must be non-empty text`);
      assert(typeof entry?.should_trigger === "boolean", `${triggerPath}: every should_trigger value must be boolean`);
    }
    const positive = triggerQueries.filter((entry) => entry.should_trigger === true);
    const negative = triggerQueries.filter((entry) => entry.should_trigger === false);
    assert(positive.length >= 5, `${triggerPath}: expected at least five should-trigger queries`);
    assert(negative.length >= 5, `${triggerPath}: expected at least five near-miss should-not-trigger queries`);
    assert(new Set(triggerQueries.map((entry) => entry.query)).size === triggerQueries.length, `${triggerPath}: trigger queries must be unique`);
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
await assertPromotionGuardContracts();
await assertContributionAndDecisionGates();

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
