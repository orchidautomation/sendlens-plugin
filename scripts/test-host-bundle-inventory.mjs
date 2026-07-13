#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const failures = [];
const packageJson = await readJson("package.json");
const PUBLIC_SKILLS = [
  "sendlens-analyst",
  "sendlens-campaign-strategist",
  "sendlens-copywriter",
  "sendlens-launch-operator",
  "sendlens-setup",
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
  ["using-sendlens", "sendlens-analyst"],
]);
const shouldBuild =
  !process.argv.includes("--assume-dist") &&
  process.env.SENDLENS_HOST_INVENTORY_ASSUME_DIST !== "1";
let buildFailed = false;

function fail(message) {
  failures.push(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function readText(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

async function readJson(relativePath) {
  try {
    return JSON.parse(await readText(relativePath));
  } catch (error) {
    fail(`${relativePath}: could not parse JSON: ${error.message}`);
    return {};
  }
}

function frontmatterValue(text, key) {
  const match = new RegExp(`^${key}:\\s*"?([^"\\n]+)"?\\s*$`, "m").exec(text);
  return match?.[1]?.trim();
}

async function exists(relativePath) {
  try {
    await stat(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function assertExists(relativePath) {
  assert(await exists(relativePath), `${relativePath}: expected file to exist`);
}

async function listFiles(directory, filter) {
  const entries = await readdir(path.join(root, directory), {
    withFileTypes: true,
  });

  return entries
    .filter(filter)
    .map((entry) => entry.name)
    .sort();
}

function runNpmScript(scriptName) {
  assert(
    Object.hasOwn(packageJson.scripts ?? {}, scriptName),
    `package.json: missing npm script "${scriptName}"`,
  );

  const result = spawnSync("npm", ["run", "--silent", scriptName], {
    cwd: root,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    buildFailed = true;
    fail(
      `npm run ${scriptName} failed with exit ${result.status ?? "unknown"}\n${result.stdout}${result.stderr}`,
    );
  }

  return `${result.stdout}${result.stderr}`;
}

function runCheckEnv(envOverrides) {
  return spawnSync("bash", ["scripts/check-env.sh"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      SENDLENS_INSTANTLY_API_KEY: "",
      SENDLENS_CLIENT: "",
      SENDLENS_DEMO_MODE: "",
      ...envOverrides,
    },
  });
}

function sameSet(actual, expected, label) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);

  for (const value of expectedSet) {
    assert(actualSet.has(value), `${label}: missing "${value}"`);
  }

  for (const value of actualSet) {
    assert(expectedSet.has(value), `${label}: unexpected "${value}"`);
  }
}

function satisfiesMinimumVersion(specifier, minimum) {
  const actual = String(specifier || "").match(/(\d+)\.(\d+)\.(\d+)/);
  const expected = String(minimum || "").match(/(\d+)\.(\d+)\.(\d+)/);
  if (!actual || !expected) return false;

  const actualParts = actual.slice(1).map(Number);
  const expectedParts = expected.slice(1).map(Number);
  for (let index = 0; index < expectedParts.length; index += 1) {
    if (actualParts[index] > expectedParts[index]) return true;
    if (actualParts[index] < expectedParts[index]) return false;
  }
  return true;
}

async function sourceInventory() {
  const skills = await listFiles("skills", (entry) => entry.isDirectory());
  const commands = (await listFiles(
    "commands",
    (entry) => entry.isFile() && entry.name.endsWith(".md"),
  )).map((name) => path.basename(name, ".md"));
  const agents = (await listFiles(
    "agents",
    (entry) => entry.isFile() && entry.name.endsWith(".md"),
  )).map((name) => path.basename(name, ".md"));

  sameSet(skills, PUBLIC_SKILLS, "source public skills");
  for (const skill of PUBLIC_SKILLS) {
    assert(
      commands.includes(skill),
      `source commands: missing public skill command "${skill}"`,
    );
  }
  for (const command of LEGACY_COMMAND_AGENTS.keys()) {
    assert(
      commands.includes(command),
      `source commands: missing legacy analyst shortcut "${command}"`,
    );
  }
  assert(
    commands.includes("using-sendlens"),
    'source commands: missing legacy analyst shortcut "using-sendlens"',
  );

  return { skills, commands, agents };
}

async function assertHostFiles({ skills, commands, agents }) {
  const commonSkillFiles = skills.map((name) => `skills/${name}/SKILL.md`);
  const commonAgentFiles = agents.map((name) => `agents/${name}.md`);
  const commonCommandFiles = commands.map((name) => `commands/${name}.md`);

  const requiredByHost = {
    "claude-code": [
      ".claude-plugin/plugin.json",
      ".mcp.json",
      "CLAUDE.md",
      "hooks/hooks.json",
      "runtime/pluxx-mcp-env.mjs",
      "scripts/start-mcp.sh",
      "scripts/session-start.sh",
      "build/plugin/server.js",
      "build/plugin/refresh-cli.js",
      ...commonSkillFiles,
      ...commonAgentFiles,
      ...commonCommandFiles,
    ],
    cursor: [
      ".cursor-plugin/plugin.json",
      "AGENTS.md",
      "mcp.json",
      "hooks/hooks.json",
      "runtime/pluxx-mcp-env.mjs",
      "scripts/start-mcp.sh",
      "build/plugin/server.js",
      "build/plugin/refresh-cli.js",
      ...commonSkillFiles,
      ...commonAgentFiles,
      ...commonCommandFiles,
    ],
    codex: [
      ".codex-plugin/plugin.json",
      ".mcp.json",
      "AGENTS.md",
      ".codex/commands.generated.json",
      ".codex/hooks.generated.json",
      "hooks/hooks.json",
      "hooks/pluxx-hook-command-1.mjs",
      "runtime/pluxx-mcp-env.mjs",
      "scripts/start-mcp.sh",
      "scripts/session-start.sh",
      "build/plugin/server.js",
      "build/plugin/refresh-cli.js",
      ...commonSkillFiles,
      ...commonAgentFiles,
      ...agents.map((name) => `.codex/agents/${name}.toml`),
    ],
    opencode: [
      "package.json",
      "index.ts",
      "runtime/pluxx-mcp-env.mjs",
      "scripts/start-mcp.sh",
      "build/plugin/server.js",
      "build/plugin/refresh-cli.js",
      ...commonSkillFiles,
      ...commonAgentFiles,
      ...commonCommandFiles,
    ],
  };

  for (const [host, files] of Object.entries(requiredByHost)) {
    await assertExists(`dist/${host}`);
    for (const file of files) {
      await assertExists(`dist/${host}/${file}`);
    }
  }
}

async function assertManifestMetadata() {
  const manifests = [
    ["dist/claude-code/.claude-plugin/plugin.json", "sendlens"],
    ["dist/cursor/.cursor-plugin/plugin.json", "sendlens"],
    ["dist/codex/.codex-plugin/plugin.json", "sendlens"],
    ["dist/opencode/package.json", "opencode-sendlens"],
  ];

  for (const [relativePath, expectedName] of manifests) {
    const manifest = await readJson(relativePath);
    assert(
      manifest.name === expectedName,
      `${relativePath}: expected name "${expectedName}", got "${manifest.name}"`,
    );
    assert(
      manifest.version === packageJson.version,
      `${relativePath}: expected version "${packageJson.version}", got "${manifest.version}"`,
    );
    assert(
      typeof manifest.description === "string" &&
        manifest.description.includes("outbound campaign analysis"),
      `${relativePath}: expected SendLens product description to survive host build`,
    );
  }
}

async function assertHostCommandInventory(commands) {
  const commandSet = new Set(commands);

  for (const host of ["claude-code", "cursor", "opencode"]) {
    const hostCommands = (await listFiles(
      `dist/${host}/commands`,
      (entry) => entry.isFile() && entry.name.endsWith(".md"),
    )).map((name) => path.basename(name, ".md"));
    sameSet(hostCommands, commands, `dist/${host}/commands`);
  }

  const codexCommands = await readJson(
    "dist/codex/.codex/commands.generated.json",
  );
  assert(
    codexCommands.model === "pluxx.commands.v1",
    "dist/codex/.codex/commands.generated.json: expected pluxx command model",
  );
  assert(
    codexCommands.nativeSurface === "degraded-to-guidance",
    "dist/codex/.codex/commands.generated.json: Codex command degradation must be explicit",
  );

  const generatedCommands = Array.isArray(codexCommands.commands)
    ? codexCommands.commands
    : [];
  sameSet(
    generatedCommands.map((command) => command.id),
    commands,
    "dist/codex/.codex/commands.generated.json commands",
  );

  for (const command of generatedCommands) {
    assert(
      commandSet.has(command.id),
      `dist/codex/.codex/commands.generated.json: unexpected command "${command.id}"`,
    );
    assert(
      typeof command.title === "string" && command.title.trim().length > 0,
      `dist/codex/.codex/commands.generated.json: command "${command.id}" is missing title`,
    );
    assert(
      typeof command.description === "string" &&
        command.description.trim().length > 0,
      `dist/codex/.codex/commands.generated.json: command "${command.id}" is missing generated description`,
    );
    const expectedSkill = PUBLIC_SKILLS.includes(command.id)
      ? command.id
      : LEGACY_COMMAND_SKILLS.get(command.id);
    assert(
      typeof command.template === "string" &&
        command.template.includes(`\`${expectedSkill}\` skill`),
      `dist/codex/.codex/commands.generated.json: command "${command.id}" must route to the "${expectedSkill}" skill in template`,
    );
  }

  const opencodeIndex = await readText("dist/opencode/index.ts");
  for (const command of commands) {
    assert(
      opencodeIndex.includes(`"${command}"`),
      `dist/opencode/index.ts: expected TUI command "${command}"`,
    );
  }
}

async function assertGeneratedSubagentRouting() {
  for (const host of ["claude-code", "cursor", "opencode"]) {
    for (const [command, agent] of LEGACY_COMMAND_AGENTS) {
      const commandText = await readText(`dist/${host}/commands/${command}.md`);
      assert(
        frontmatterValue(commandText, "context") === "fork",
        `dist/${host}/commands/${command}.md: expected context: fork`,
      );
      assert(
        frontmatterValue(commandText, "agent") === agent,
        `dist/${host}/commands/${command}.md: expected agent: ${agent}`,
      );
    }

    for (const skill of PUBLIC_SKILLS) {
      const skillText = await readText(`dist/${host}/skills/${skill}/SKILL.md`);
      assert(
        frontmatterValue(skillText, "context") === undefined,
        `dist/${host}/skills/${skill}/SKILL.md: portable public skills must not declare context`,
      );
      assert(
        frontmatterValue(skillText, "agent") === undefined,
        `dist/${host}/skills/${skill}/SKILL.md: portable public skills must not declare agent`,
      );
    }
  }

  const codexSkills = await readJson("dist/codex/.codex/skills.generated.json");
  const generatedSkills = Array.isArray(codexSkills.skills)
    ? codexSkills.skills
    : [];
  const codexCommands = await readJson(
    "dist/codex/.codex/commands.generated.json",
  );
  const generatedCommands = Array.isArray(codexCommands.commands)
    ? codexCommands.commands
    : [];

  sameSet(
    generatedSkills.map((skill) => skill.id),
    PUBLIC_SKILLS,
    "dist/codex/.codex/skills.generated.json public skills",
  );
  for (const generatedSkill of generatedSkills) {
    assert(
      generatedSkill.context === undefined && generatedSkill.agent === undefined,
      `dist/codex/.codex/skills.generated.json: portable skill "${generatedSkill.id}" must not declare host routing`,
    );
  }

  for (const [command, agent] of LEGACY_COMMAND_AGENTS) {
    const generatedCommand = generatedCommands.find(
      (entry) => entry.id === command,
    );
    assert(
      generatedCommand?.context === "fork",
      `dist/codex/.codex/commands.generated.json: command "${command}" must preserve context: fork`,
    );
    assert(
      generatedCommand?.agent === agent,
      `dist/codex/.codex/commands.generated.json: command "${command}" must preserve agent "${agent}"`,
    );
    assert(
      generatedCommand?.subtask === true,
      `dist/codex/.codex/commands.generated.json: command "${command}" must preserve subtask: true`,
    );
  }

  const generatedAnalystCommand = generatedCommands.find(
    (entry) => entry.id === "sendlens-analyst",
  );
  assert(
    generatedAnalystCommand?.agent === undefined &&
      generatedAnalystCommand?.subtask === false,
    'dist/codex/.codex/commands.generated.json: command "sendlens-analyst" must remain coordinator-owned with no direct specialist route',
  );

  for (const command of [
    "using-sendlens",
    "sendlens-campaign-strategist",
    "sendlens-copywriter",
    "sendlens-launch-operator",
  ]) {
    const generatedCommand = generatedCommands.find((entry) => entry.id === command);
    assert(
      generatedCommand?.agent === undefined && generatedCommand?.subtask === false,
      `dist/codex/.codex/commands.generated.json: command "${command}" must remain coordinator-owned with no direct specialist route`,
    );
  }

  const generatedSetupCommand = generatedCommands.find(
    (entry) => entry.id === "sendlens-setup",
  );
  assert(
    generatedSetupCommand?.agent === undefined &&
      generatedSetupCommand?.subtask === false,
    'dist/codex/.codex/commands.generated.json: command "sendlens-setup" must remain skill-only with no direct agent route',
  );
}

async function assertExplicitHostDegradation() {
  for (const documentationPath of ["README.md", "docs/INSTALL.md"]) {
    const documentation = await readText(documentationPath);
    assert(
      documentation.includes("npm run build:hosts"),
      `${documentationPath}: host builds must use the contract-enforcing npm script`,
    );
    assert(
      !documentation.includes("pluxx build --target claude-code cursor codex opencode"),
      `${documentationPath}: direct Pluxx host builds bypass Codex delegation enforcement`,
    );
  }

  const codexAgents = await exists("dist/codex/commands");
  assert(
    codexAgents === false,
    "dist/codex/commands: Codex command surface should remain guidance-only until native plugin-packaged slash commands are supported",
  );

  const codexAgentGuidance = await readText("dist/codex/AGENTS.md");
  assert(
    /Codex does not package them as native slash commands today/i.test(
      codexAgentGuidance,
    ),
    "dist/codex/AGENTS.md: expected explicit Codex command degradation guidance",
  );
  assert(
    /always-on SendLens operating contract/i.test(codexAgentGuidance),
    "dist/codex/AGENTS.md: expected Codex always-on SendLens guidance",
  );
  assert(
    /host startup bias for SendLens/i.test(codexAgentGuidance),
    "dist/codex/AGENTS.md: expected SendLens startup operating contract",
  );
  assert(
    /simple inventory and freshness questions/i.test(codexAgentGuidance),
    "dist/codex/AGENTS.md: expected simple inventory questions to stay on the MCP fast path",
  );
  for (const pattern of [
    /simple inventory, freshness, setup, (?:and|or) status requests[^.]*must not spawn/i,
    /must (?:spawn|delegate) `workspace-triager` first/i,
    /select (?:exactly )?one campaign before (?:spawning|delegating)/i,
    /analyst evidence[^\n]*`campaign-strategist`[^\n]*`campaign-copywriter`[^\n]*`launch-operator`/i,
    /run analyst evidence[^.]*sequentially/i,
    /do not parallelize stages that consume an earlier handoff/i,
    /focused strategy, copy, or launch request[^.]*delegate the owning/i,
    /delegate only the lanes the user's decision requires/i,
    /must (?:spawn|delegate) `synthesis-reviewer`[^.]*before the coordinator answers/i,
    /coordinator owns every spawn/i,
    /specialists must not spawn nested agents/i,
    /parallel[^.]*only[^.]*independent specialist lanes/i,
    /native delegation is unavailable[^.]*execute the same lane boundaries inline/i,
    /must not claim or imply that a specialist was spawned/i,
  ]) {
    assert(
      pattern.test(codexAgentGuidance),
      `dist/codex/AGENTS.md: missing bounded specialist delegation contract matching ${pattern}`,
    );
  }

  const generatedAgentFiles = await listFiles(
    "dist/codex/.codex/agents",
    (entry) => entry.isFile() && entry.name.endsWith(".toml"),
  );
  for (const relativePath of generatedAgentFiles) {
    const agentBody = await readText(`dist/codex/.codex/agents/${relativePath}`);
    assert(
      /Do not delegate further subtasks\. Return the completed specialist handoff to the parent coordinator\./.test(agentBody),
      `dist/codex/.codex/agents/${relativePath}: missing unconditional no-nested-delegation contract`,
    );
    assert(
      !/Do not delegate further subtasks unless/i.test(agentBody),
      `dist/codex/.codex/agents/${relativePath}: conditional nested delegation exception must be removed`,
    );
  }

  const codexCommands = await readJson(
    "dist/codex/.codex/commands.generated.json",
  );
  assert(
    /does not currently document plugin-packaged slash-command parity/i.test(
      codexCommands.note ?? "",
    ),
    "dist/codex/.codex/commands.generated.json: expected slash-command degradation note",
  );

  const codexHooks = await readJson("dist/codex/.codex/hooks.generated.json");
  assert(
    codexHooks.enforcedByPluginBundle === true,
    "dist/codex/.codex/hooks.generated.json: expected hooks to be marked as bundled by Pluxx",
  );
  assert(
    codexHooks.pluginBundleFeatureFlag === "hooks",
    "dist/codex/.codex/hooks.generated.json: expected plugin-bundled hook activation to use hooks",
  );
  assert(
    codexHooks.generalFeatureFlag === "hooks",
    "dist/codex/.codex/hooks.generated.json: expected general hooks flag to remain separate",
  );
  assert(
    codexHooks.deprecatedGeneralFeatureFlag === "codex_hooks",
    "dist/codex/.codex/hooks.generated.json: expected deprecated codex_hooks metadata to stay explicit",
  );
  assert(
    /bundled at hooks\/hooks\.json/i.test(codexHooks.note ?? ""),
    "dist/codex/.codex/hooks.generated.json: expected explicit bundled-hook note",
  );
  assert(
    /\[features\]\.hooks\s*=\s*true/i.test(codexHooks.note ?? ""),
    "dist/codex/.codex/hooks.generated.json: expected hooks enablement note",
  );
  assert(
    /codex_hooks[^.]*deprecated/i.test(codexHooks.note ?? ""),
    "dist/codex/.codex/hooks.generated.json: expected deprecated codex_hooks note",
  );

  const codexSkills = await readJson("dist/codex/.codex/skills.generated.json");
  const generatedSkills = Array.isArray(codexSkills.skills)
    ? codexSkills.skills
    : [];
  const analystSkill = generatedSkills.find(
    (skill) => skill.id === "sendlens-analyst",
  );
  assert(
    analystSkill?.disableModelInvocation !== true,
    "dist/codex/.codex/skills.generated.json: sendlens-analyst must remain available for automatic invocation",
  );
  assert(
    /broad end-to-end question|what is working and what to run or write next/i.test(
      analystSkill?.description ?? "",
    ),
    "dist/codex/.codex/skills.generated.json: sendlens-analyst description must cover broad full-chain orchestration",
  );
  for (const [skillId, pattern] of [
    ["sendlens-campaign-strategist", /campaign strategy.*audience.*offer.*angle/i],
    ["sendlens-copywriter", /draft or rewrite.*subjects.*bodies.*CTAs/i],
    ["sendlens-launch-operator", /launch.*scale.*stop.*measurement/i],
  ]) {
    const focusedSkill = generatedSkills.find((skill) => skill.id === skillId);
    assert(
      pattern.test(focusedSkill?.description ?? ""),
      `dist/codex/.codex/skills.generated.json: ${skillId} description must preserve its focused trigger boundary`,
    );
  }
  const setupSkill = generatedSkills.find(
    (skill) => skill.id === "sendlens-setup",
  );
  assert(
    /installation|runtime|cache troubleshooting/i.test(setupSkill?.description ?? ""),
    "dist/codex/.codex/skills.generated.json: sendlens-setup description must remain setup-specific",
  );

  const installDocs = await readText("docs/INSTALL.md");
  const troubleshootingDocs = await readText("docs/TROUBLESHOOTING.md");
  const readme = await readText("README.md");
  for (const [relativePath, text] of [
    ["docs/INSTALL.md", installDocs],
    ["docs/TROUBLESHOOTING.md", troubleshootingDocs],
  ]) {
    assert(
      /\[features\][\s\S]*hooks\s*=\s*true/.test(text),
      `${relativePath}: expected Codex plugin-bundled hook opt-in guidance`,
    );
    assert(
      /codex_hooks[^.]*deprecated/i.test(text),
      `${relativePath}: expected deprecated codex_hooks guidance`,
    );
  }

  for (const [relativePath, text] of [
    ["README.md", readme],
    ["docs/INSTALL.md", installDocs],
  ]) {
    assert(
      /launch-folder env files|folder where you launch/i.test(text),
      `${relativePath}: expected release docs to explain launch-folder env resolution`,
    );
    assert(
      /inherited\/global host environment|inherited\/global environment/.test(text),
      `${relativePath}: expected release docs to explain inherited/global env fallback`,
    );
  }
}

async function assertNoCredentialsRequired() {
  const credentialFiles = [
    "dist/claude-code/.mcp.json",
    "dist/cursor/mcp.json",
    "dist/codex/.mcp.json",
    "dist/opencode/index.ts",
  ];

  for (const relativePath of credentialFiles) {
    const text = await readText(relativePath);
    assert(
      text.includes("pluxx-mcp-env.mjs"),
      `${relativePath}: expected Pluxx runtime env launcher`,
    );
    assert(
      text.includes("SENDLENS_INSTANTLY_API_KEY"),
      `${relativePath}: expected runtime Instantly env var name`,
    );
    if (!relativePath.includes("opencode")) {
      assert(
        !text.includes("${SENDLENS_INSTANTLY_API_KEY}"),
        `${relativePath}: expected no materialized Instantly placeholder in host MCP env`,
      );
    }
    assert(
      !/instly_[A-Za-z0-9_-]{12,}|sk_[A-Za-z0-9_-]{12,}/.test(text),
      `${relativePath}: appears to contain a real credential instead of a placeholder`,
    );
  }
}

async function assertDemoModeContracts() {
  const config = await readText("pluxx.config.ts");
  assert(
    /key:\s*"instantly-api-key"[\s\S]*?required:\s*true/.test(config),
    "pluxx.config.ts: Instantly API key userConfig must stay required for real refresh readiness while Pluxx keeps core-host stdio env runtime-inherited",
  );
  assert(
    /launch-folder env files or the inherited host environment/.test(config),
    "pluxx.config.ts: Instantly API key description must point to Pluxx runtime env resolution",
  );
  assert(
    /repository:\s*"https:\/\/github\.com\/orchidautomation\/sendlens-plugin"/.test(
      config,
    ),
    "pluxx.config.ts: expected repository URL in marketplace metadata",
  );
  assert(
    /url:\s*"https:\/\/github\.com\/orchidautomation"/.test(config),
    "pluxx.config.ts: expected author URL in marketplace metadata",
  );
  assert(
    /privacyPolicyURL:\s*"https:\/\/github\.com\/orchidautomation\/sendlens-plugin\/blob\/main\/docs\/TRUST_AND_PRIVACY\.md"/.test(
      config,
    ),
    "pluxx.config.ts: expected privacy policy URL in marketplace metadata",
  );

  const readOnlyCheck = runCheckEnv({});
  assert(
    readOnlyCheck.status === 0,
    `scripts/check-env.sh: expected missing API key without demo mode to pass in read-only local-cache mode\n${readOnlyCheck.stdout}${readOnlyCheck.stderr}`,
  );
  assert(
    /read-only local-cache mode/i.test(`${readOnlyCheck.stdout}${readOnlyCheck.stderr}`),
    "scripts/check-env.sh: expected missing API key output to explain read-only local-cache mode",
  );
  assert(
    /\/sendlens-setup/i.test(`${readOnlyCheck.stdout}${readOnlyCheck.stderr}`),
    "scripts/check-env.sh: expected missing API key output to point users to /sendlens-setup",
  );
  const placeholderKeyCheck = runCheckEnv({
    SENDLENS_INSTANTLY_API_KEY: "${SENDLENS_INSTANTLY_API_KEY}",
  });
  assert(
    placeholderKeyCheck.status === 0,
    `scripts/check-env.sh: expected unresolved API key placeholder to pass as missing-key read-only mode\n${placeholderKeyCheck.stdout}${placeholderKeyCheck.stderr}`,
  );
  assert(
    /Ignoring unresolved SENDLENS_INSTANTLY_API_KEY placeholder/i.test(`${placeholderKeyCheck.stdout}${placeholderKeyCheck.stderr}`),
    "scripts/check-env.sh: expected unresolved API key placeholder to be ignored",
  );
  assert(
    /\/sendlens-setup/i.test(`${placeholderKeyCheck.stdout}${placeholderKeyCheck.stderr}`),
    "scripts/check-env.sh: expected unresolved API key placeholder output to point users to /sendlens-setup",
  );
  const docsPlaceholderKeyCheck = runCheckEnv({
    SENDLENS_INSTANTLY_API_KEY: "your_key",
  });
  assert(
    docsPlaceholderKeyCheck.status === 0,
    `scripts/check-env.sh: expected docs API key placeholder to pass as missing-key read-only mode\n${docsPlaceholderKeyCheck.stdout}${docsPlaceholderKeyCheck.stderr}`,
  );
  assert(
    /Ignoring unresolved SENDLENS_INSTANTLY_API_KEY placeholder/i.test(`${docsPlaceholderKeyCheck.stdout}${docsPlaceholderKeyCheck.stderr}`),
    "scripts/check-env.sh: expected docs API key placeholder to be ignored",
  );

  for (const value of ["1", "true", "TRUE", "yes", "YES"]) {
    const check = runCheckEnv({ SENDLENS_DEMO_MODE: value });
    assert(
      check.status === 0,
      `scripts/check-env.sh: expected SENDLENS_DEMO_MODE=${value} to pass without an API key\n${check.stdout}${check.stderr}`,
    );
  }
}

async function assertInstallerFirstRefreshContract() {
  const bootstrap = await readText("scripts/bootstrap-runtime.sh");
  assert(
    /PLUXX_INSTALL_DIR/.test(bootstrap),
    "scripts/bootstrap-runtime.sh: installer-only first refresh must be gated on PLUXX_INSTALL_DIR",
  );
  assert(
    /SENDLENS_SKIP_INSTALL_REFRESH/.test(bootstrap),
    "scripts/bootstrap-runtime.sh: expected installer first refresh opt-out",
  );
  assert(
    satisfiesMinimumVersion(packageJson.devDependencies?.["@orchid-labs/pluxx"], "0.1.28"),
    "package.json: expected Pluxx 0.1.28+ so generated release assets include install.sh and core-host runtime env launchers",
  );
  assert(
    /build\/plugin\/refresh-cli\.js/.test(bootstrap),
    "scripts/bootstrap-runtime.sh: expected installer first refresh to use the bundled refresh CLI",
  );
  assert(
    /SENDLENS_SMARTLEAD_API_KEY/.test(bootstrap) && /provider_mode/.test(bootstrap),
    "scripts/bootstrap-runtime.sh: expected provider-aware Smartlead first refresh eligibility",
  );
  assert(
    /has_non_whitespace "\$\{SENDLENS_CLIENT:-\}"/.test(bootstrap),
    "scripts/bootstrap-runtime.sh: two-key all mode must require a shared SENDLENS_CLIENT workspace",
  );
  assert(
    /sed 's\/\^\[\[:space:\]\]\*\/\/;s\/\[\[:space:\]\]\*\$\/\/'/.test(bootstrap)
      && /provider_mode="\$\{provider_mode:-instantly\}"/.test(bootstrap),
    "scripts/bootstrap-runtime.sh: expected edge trimming and an Instantly fallback for blank provider mode",
  );
  assert(
    /First refresh completed/i.test(bootstrap),
    "scripts/bootstrap-runtime.sh: expected clear successful first-refresh message",
  );
  assert(
    /run \/sendlens-setup/i.test(bootstrap),
    "scripts/bootstrap-runtime.sh: expected failed first refresh to guide users to /sendlens-setup",
  );
}

async function assertAutomaticRefreshFallback() {
  const sourceLauncher = await readText("scripts/start-mcp.sh");
  assert(
    /scripts\/session-start\.sh/.test(sourceLauncher),
    "scripts/start-mcp.sh: MCP startup must launch the locked session refresh fallback",
  );
  assert(
    /SENDLENS_RUNTIME_BOOTSTRAPPED/.test(sourceLauncher),
    "scripts/start-mcp.sh: fallback should reuse the completed runtime bootstrap",
  );

  for (const host of ["claude-code", "cursor", "codex", "opencode"]) {
    const launcher = await readText(`dist/${host}/scripts/start-mcp.sh`);
    assert(
      /scripts\/session-start\.sh/.test(launcher),
      `dist/${host}/scripts/start-mcp.sh: expected automatic refresh fallback`,
    );
  }
}

async function assertSessionStartProviderContract() {
  const source = await readText("scripts/session-start.sh");
  assert(
    /SENDLENS_SMARTLEAD_API_KEY/.test(source) && /build\/plugin\/refresh-cli\.js/.test(source),
    "scripts/session-start.sh: expected Smartlead to use the provider-aware refresh CLI",
  );
  assert(
    !/does not use the Instantly session-start refresh/.test(source),
    "scripts/session-start.sh: Smartlead must not be excluded from startup refresh",
  );
  assert(
    /has_non_whitespace/.test(source),
    "scripts/session-start.sh: provider readiness must reject whitespace-only access values",
  );

  for (const host of ["claude-code", "codex"]) {
    const bundled = await readText(`dist/${host}/scripts/session-start.sh`);
    assert(
      /SENDLENS_SMARTLEAD_API_KEY/.test(bundled) && /build\/plugin\/refresh-cli\.js/.test(bundled),
      `dist/${host}/scripts/session-start.sh: expected provider-aware Smartlead startup refresh`,
    );
  }

  const harnessRoot = await mkdtemp(path.join(os.tmpdir(), "sendlens-startup-contract-"));
  try {
    const preloadPath = path.join(harnessRoot, "capture-refresh.cjs");
    await writeFile(
      preloadPath,
      "if (process.argv.some((value) => value.endsWith('/build/plugin/refresh-cli.js'))) { require('node:fs').appendFileSync(process.env.SENDLENS_TEST_REFRESH_LOG, `${process.env.SENDLENS_PROVIDER}\\n`); process.exit(0); }\n",
    );
    const smartleadAccessName = ["SENDLENS", "SMARTLEAD", "API", "KEY"].join("_");
    const instantlyAccessName = ["SENDLENS", "INSTANTLY", "API", "KEY"].join("_");
    for (const host of ["claude-code", "codex"]) {
      for (const providerMode of ["smartlead", "all"]) {
        const bundleRoot = path.join(root, "dist", host);
        const stateDir = path.join(harnessRoot, `state-${host}-${providerMode}`);
        const capturePath = path.join(harnessRoot, `capture-${host}-${providerMode}.log`);
        const result = spawnSync("bash", [path.join(root, `dist/${host}/scripts/session-start.sh`)], {
          cwd: bundleRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            PLUGIN_ROOT: bundleRoot,
            SENDLENS_PROVIDER: providerMode,
            [smartleadAccessName]: "fixture-access-value",
            [instantlyAccessName]: "",
            SENDLENS_DB_PATH: path.join(stateDir, "workspace-cache.duckdb"),
            SENDLENS_STATE_DIR: stateDir,
            SENDLENS_DEMO_MODE: "0",
            SENDLENS_TEST_REFRESH_LOG: capturePath,
            NODE_OPTIONS: `--require=${preloadPath}`,
          },
        });
        const output = `${result.stdout}${result.stderr}`;
        let capture = "";
        for (let attempt = 0; attempt < 100; attempt += 1) {
          try {
            capture = await readFile(capturePath, "utf8");
          } catch {
            capture = "";
          }
          if (capture.includes(providerMode)) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        if (!capture.includes(providerMode)) {
          try {
            capture = await readFile(capturePath, "utf8");
          } catch {
            capture = "";
          }
        }
        assert(
          result.status === 0 && capture.includes(providerMode),
          `dist/${host}/scripts/session-start.sh: ${providerMode} did not launch the provider-aware refresh command\n${output}`,
        );
      }
      const bundleRoot = path.join(root, "dist", host);
      const invalidStateDir = path.join(harnessRoot, `state-${host}-all-without-client`);
      const invalidCapturePath = path.join(harnessRoot, `capture-${host}-all-without-client.log`);
      const invalidAll = spawnSync("bash", [path.join(bundleRoot, "scripts", "session-start.sh")], {
        cwd: bundleRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PLUGIN_ROOT: bundleRoot,
          SENDLENS_PROVIDER: "all",
          SENDLENS_CLIENT: "",
          [smartleadAccessName]: "fixture-access-value",
          [instantlyAccessName]: "fixture-access-value",
          SENDLENS_DB_PATH: path.join(invalidStateDir, "workspace-cache.duckdb"),
          SENDLENS_STATE_DIR: invalidStateDir,
          SENDLENS_TEST_REFRESH_LOG: invalidCapturePath,
          SENDLENS_DEMO_MODE: "0",
          NODE_OPTIONS: `--require=${preloadPath}`,
        },
      });
      const invalidOutput = `${invalidAll.stdout}${invalidAll.stderr}`;
      assert(
        invalidAll.status === 0 && /SENDLENS_CLIENT is not set/i.test(invalidOutput),
        `dist/${host}/scripts/session-start.sh: two-key all mode without SENDLENS_CLIENT must remain idle\n${invalidOutput}`,
      );
      let invalidCapture = "";
      try {
        invalidCapture = await readFile(invalidCapturePath, "utf8");
      } catch {
        invalidCapture = "";
      }
      assert(
        invalidCapture === "",
        `dist/${host}/scripts/session-start.sh: invalid two-key all mode launched refresh-cli.js`,
      );
    }
  } finally {
    await rm(harnessRoot, { recursive: true, force: true });
  }
}

const inventory = await sourceInventory();

let buildOutput = "";
if (shouldBuild) {
  buildOutput += runNpmScript("build:plugin");
  buildOutput += runNpmScript("build:hosts");

  assert(
    /Core-four mapping:/i.test(buildOutput),
    "build:hosts output must include the core-four host mapping summary",
  );
  assert(
    /commands on codex: weakened to skills\/, AGENTS\.md/i.test(buildOutput),
    "build:hosts output must call out Codex command degradation",
  );
  assert(
    /hooks on codex: re-expressed via hooks\/hooks\.json/i.test(buildOutput),
    "build:hosts output must call out Codex hook degradation",
  );

  if (buildFailed) {
    console.error("Host bundle inventory failures:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }
}

await assertHostFiles(inventory);
await assertManifestMetadata();
await assertHostCommandInventory(inventory.commands);
await assertGeneratedSubagentRouting();
await assertExplicitHostDegradation();
await assertNoCredentialsRequired();
await assertDemoModeContracts();
await assertInstallerFirstRefreshContract();
await assertAutomaticRefreshFallback();
await assertSessionStartProviderContract();

if (failures.length > 0) {
  console.error("Host bundle inventory failures:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Host bundle inventory passed (${inventory.skills.length} skills, ${inventory.commands.length} commands, ${inventory.agents.length} agents).`,
);
