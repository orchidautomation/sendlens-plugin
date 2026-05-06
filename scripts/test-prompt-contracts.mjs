#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const DESCRIPTION_MIN_LENGTH = 24;
const DESCRIPTION_MAX_LENGTH = 180;

const REQUIRED_SKILL_FRONTMATTER = ["name", "description"];
const REQUIRED_COMMAND_FRONTMATTER = [
  "description",
  "argument-hint",
  "agent",
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
    "sendlens-setup",
    "Setup is explicit-invocation and runs the MCP setup doctor workflow; it is not a SendLens analysis subtask and should not route to an MCP-only specialist agent.",
  ],
]);

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

    assert(
      skillNames.has(commandName),
      `${relativePath}: command filename must map to an existing skill named "${commandName}"`,
    );
    assert(
      commandReferencesSkill(body, commandName),
      `${relativePath}: body must route to the matching \`${commandName}\` skill`,
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
        agent === commandName,
        `${relativePath}: setup exception must route agent metadata to its explicit skill name (${exception})`,
      );
      assert(
        commandData.subtask === false,
        `${relativePath}: setup exception must set subtask: false (${exception})`,
      );
      assert(
        typeof commandData["argument-hint"] === "string",
        `${relativePath}: setup exception still requires argument-hint metadata (${exception})`,
      );
    } else {
      assert(
        agentNames.has(agent),
        `${relativePath}: command agent "${agent}" must map to an existing specialist agent`,
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
      skillNames.has(commandName),
      `commands/${commandName}.md: no matching skill directory`,
    );
  }
}

const skillNames = await collectSkillContracts();
const agentNames = await collectAgentContracts();
await collectCommandContracts(skillNames, agentNames);

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
