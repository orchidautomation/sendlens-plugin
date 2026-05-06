#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const failures = [];
const packageJson = await readJson("package.json");
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

  sameSet(commands, skills, "source command/skill parity");

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
      "scripts/start-mcp.sh",
      "build/plugin/server.js",
      ...commonSkillFiles,
      ...commonAgentFiles,
      ...commonCommandFiles,
    ],
    cursor: [
      ".cursor-plugin/plugin.json",
      "AGENTS.md",
      "mcp.json",
      "hooks/hooks.json",
      "scripts/start-mcp.sh",
      "build/plugin/server.js",
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
      "scripts/start-mcp.sh",
      "build/plugin/server.js",
      ...commonSkillFiles,
      ...commonAgentFiles,
      ...agents.map((name) => `.codex/agents/${name}.toml`),
    ],
    opencode: [
      "package.json",
      "index.ts",
      "scripts/start-mcp.sh",
      "build/plugin/server.js",
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
    assert(
      typeof command.template === "string" &&
        command.template.includes(`\`${command.id}\` skill`),
      `dist/codex/.codex/commands.generated.json: command "${command.id}" must route to its skill in template`,
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

async function assertExplicitHostDegradation() {
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

  const codexCommands = await readJson(
    "dist/codex/.codex/commands.generated.json",
  );
  assert(
    /does not currently document plugin-packaged slash commands/i.test(
      codexCommands.note ?? "",
    ),
    "dist/codex/.codex/commands.generated.json: expected slash-command degradation note",
  );

  const codexHooks = await readJson("dist/codex/.codex/hooks.generated.json");
  assert(
    codexHooks.enforcedByPluginBundle === false,
    "dist/codex/.codex/hooks.generated.json: expected hooks to be marked external to plugin bundle",
  );
  assert(
    codexHooks.featureFlag === "codex_hooks",
    "dist/codex/.codex/hooks.generated.json: expected Codex hooks feature flag guidance",
  );
  assert(
    /outside the plugin bundle/i.test(codexHooks.note ?? ""),
    "dist/codex/.codex/hooks.generated.json: expected explicit external-hook note",
  );
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
      text.includes("${SENDLENS_INSTANTLY_API_KEY}"),
      `${relativePath}: expected placeholder Instantly API key reference`,
    );
    assert(
      !/instly_[A-Za-z0-9_-]{12,}|sk_[A-Za-z0-9_-]{12,}/.test(text),
      `${relativePath}: appears to contain a real credential instead of a placeholder`,
    );
  }
}

async function assertDemoModeContracts() {
  const config = await readText("pluxx.config.ts");
  assert(
    /key:\s*"instantly-api-key"[\s\S]*?required:\s*false/.test(config),
    "pluxx.config.ts: Instantly API key userConfig must remain optional so demo mode can install without production credentials",
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
    /hooks on codex: re-expressed via \.codex\/hooks\.json/i.test(buildOutput),
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
await assertExplicitHostDegradation();
await assertNoCredentialsRequired();
await assertDemoModeContracts();

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
