#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const pluginName = packageJson.name;
const releaseVersion = packageJson.version;
const platforms = ["claude-code", "cursor", "codex", "opencode"];
const tempRoots = [];

async function tempDir(prefix) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(directory);
  return directory;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
    env: {
      ...process.env,
      ...options.env,
    },
  });
}

function assertRun(result, label) {
  assert.equal(
    result.status,
    0,
    `${label} failed with exit ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
}

async function readJson(filepath) {
  return JSON.parse(await readFile(filepath, "utf8"));
}

async function writeJson(filepath, value) {
  await mkdir(path.dirname(filepath), { recursive: true });
  await writeFile(filepath, `${JSON.stringify(value, null, 2)}\n`);
}

async function pathExists(filepath) {
  try {
    await stat(filepath);
    return true;
  } catch {
    return false;
  }
}

function manifestRelativePath(platform) {
  if (platform === "claude-code") return ".claude-plugin/plugin.json";
  if (platform === "cursor") return ".cursor-plugin/plugin.json";
  if (platform === "codex") return ".codex-plugin/plugin.json";
  if (platform === "opencode") return "package.json";
  throw new Error(`Unsupported platform ${platform}`);
}

async function candidateManifest(platform) {
  return readJson(path.join(root, "dist", platform, manifestRelativePath(platform)));
}

function installPaths(platform, runRoot) {
  if (platform === "claude-code") {
    const installRoot = path.join(runRoot, "claude-marketplace");
    return {
      installDir: installRoot,
      pluginInstallDir: path.join(installRoot, "plugins", pluginName),
      env: {
        PLUXX_CLAUDE_MARKETPLACE_DIR: installRoot,
        PLUXX_CLAUDE_SKIP_INSTALL: "1",
      },
    };
  }

  if (platform === "cursor") {
    const installDir = path.join(runRoot, "installed-cursor");
    return {
      installDir,
      pluginInstallDir: installDir,
      env: { PLUXX_CURSOR_INSTALL_DIR: installDir },
    };
  }

  if (platform === "codex") {
    const installDir = path.join(runRoot, "installed-codex");
    return {
      installDir,
      pluginInstallDir: installDir,
      env: {
        PLUXX_CODEX_INSTALL_DIR: installDir,
        PLUXX_CODEX_MARKETPLACE_PATH: path.join(runRoot, "codex-marketplace.json"),
        PLUXX_CODEX_CONFIG_PATH: path.join(runRoot, "codex-config.toml"),
      },
    };
  }

  if (platform === "opencode") {
    const installDir = path.join(runRoot, "installed-opencode");
    return {
      installDir,
      pluginInstallDir: installDir,
      env: {
        PLUXX_OPENCODE_INSTALL_DIR: installDir,
        PLUXX_OPENCODE_ENTRY_PATH: path.join(runRoot, `${pluginName}.ts`),
        PLUXX_OPENCODE_SKILLS_ROOT: path.join(runRoot, "opencode-skills"),
      },
    };
  }

  throw new Error(`Unsupported platform ${platform}`);
}

function ownershipPath(platform, homeDir, pluginInstallDir) {
  const resolvedInstallDir = path.resolve(pluginInstallDir);
  const conventionalRoots = [
    path.join(homeDir, ".claude", "plugins"),
    path.join(homeDir, ".cursor", "plugins"),
    path.join(homeDir, ".codex", "plugins"),
    path.join(homeDir, ".config", "opencode"),
  ];
  const ownershipRoot = conventionalRoots.some(
    (candidateRoot) =>
      resolvedInstallDir === candidateRoot ||
      resolvedInstallDir.startsWith(`${candidateRoot}${path.sep}`),
  )
    ? path.join(homeDir, ".pluxx", "install-ownership")
    : path.join(path.dirname(resolvedInstallDir), ".pluxx-install-ownership");
  return path.join(ownershipRoot, pluginName, `${platform}.json`);
}

async function firstOpenCodeSkillName() {
  const skillRoot = path.join(root, "dist", "opencode", "skills");
  const entries = await readdir(skillRoot, { withFileTypes: true });
  const skill = entries.find((entry) => entry.isDirectory());
  assert.ok(skill, "dist/opencode/skills should include at least one skill");
  return skill.name;
}

function legacyOpenCodeWrapper() {
  const exportName = pluginName
    .replace(/(^|[^A-Za-z0-9])([A-Za-z0-9])/g, (_, _separator, value) => value.toUpperCase())
    .replace(/[^A-Za-z0-9_$]/g, "");

  return [
    'import type { Plugin } from "@opencode-ai/plugin"',
    'import { join } from "path"',
    "",
    `import * as PluginModule from "./${pluginName}/index.ts"`,
    "",
    "// OpenCode auto-loads plugin files placed directly in ~/.config/opencode/plugins.",
    "// Proxy into the installed plugin bundle while preserving its expected root.",
    'const pluginFactory = Object.values(PluginModule).find((value): value is Plugin => typeof value === "function")',
    "",
    "if (!pluginFactory) {",
    `  throw new Error("OpenCode plugin bundle for ${pluginName} did not export a plugin function.")`,
    "}",
    "",
    `export const ${exportName || "SendLens"}: Plugin = async (context) =>`,
    "  pluginFactory({",
    "    ...context,",
    `    directory: join(context.directory, "${pluginName}"),`,
    "  })",
    "",
  ].join("\n");
}

async function createFakeReleaseAssets() {
  const workspace = await tempDir("sendlens-legacy-release-");
  const fakeBin = path.join(workspace, "bin");
  const releaseDir = path.join(workspace, "release-assets");
  await mkdir(fakeBin, { recursive: true });
  await mkdir(releaseDir, { recursive: true });

  const ghPath = path.join(fakeBin, "gh");
  await writeFile(
    ghPath,
    `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const releaseDir = process.env.SENDLENS_FAKE_RELEASE_DIR;
const tagFile = path.join(releaseDir, '.tag');
const assetNames = () => fs.readdirSync(releaseDir).filter((name) => !name.startsWith('.')).sort();
const copyFile = (from, to) => fs.copyFileSync(from, to);

if (args[0] === ('au' + 'th') && args[1] === 'status') process.exit(0);

if (args[0] === 'release' && args[1] === 'view') {
  if (!fs.existsSync(tagFile)) {
    console.error('release not found');
    process.exit(1);
  }
  const tagName = fs.readFileSync(tagFile, 'utf8').trim();
  process.stdout.write(JSON.stringify({
    tagName,
    assets: assetNames().map((name) => ({ name })),
  }));
  process.exit(0);
}

if (args[0] === 'release' && args[1] === 'create') {
  const tagName = args[2];
  const titleIndex = args.indexOf('--title');
  const end = titleIndex === -1 ? args.length : titleIndex;
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(tagFile, tagName + '\\n');
  for (const file of args.slice(3, end)) copyFile(file, path.join(releaseDir, path.basename(file)));
  process.stdout.write('created\\n');
  process.exit(0);
}

if (args[0] === 'release' && args[1] === 'upload') {
  fs.mkdirSync(releaseDir, { recursive: true });
  for (const file of args.slice(4).filter((value) => value !== '--clobber')) {
    copyFile(file, path.join(releaseDir, path.basename(file)));
  }
  process.stdout.write('uploaded\\n');
  process.exit(0);
}

if (args[0] === 'release' && args[1] === 'download') {
  const dir = args[args.indexOf('--dir') + 1];
  fs.mkdirSync(dir, { recursive: true });
  for (const name of assetNames()) copyFile(path.join(releaseDir, name), path.join(dir, name));
  process.exit(0);
}

if (args[0] === 'release' && args[1] === 'delete-asset') {
  fs.rmSync(path.join(releaseDir, args[3]), { force: true });
  process.exit(0);
}

console.error('unexpected fake gh command: ' + args.join(' '));
process.exit(1);
`,
  );
  await chmod(ghPath, 0o755);

  const gitPath = path.join(fakeBin, "git");
  await writeFile(
    gitPath,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "status" && "\${2:-}" == "--porcelain" ]]; then
  exit 0
fi
exec /usr/bin/git "$@"
`,
  );
  await chmod(gitPath, 0o755);

  const result = run(process.execPath, [
    path.join(root, "node_modules", "@orchid-labs", "pluxx", "bin", "pluxx.js"),
    "publish",
    "--github-release",
    "--version",
    releaseVersion,
  ], {
    env: {
      PATH: `${fakeBin}:${process.env.PATH}`,
      SENDLENS_FAKE_RELEASE_DIR: releaseDir,
    },
  });
  assertRun(result, "fake Pluxx release publish");

  for (const expected of [
    "install-claude-code.sh",
    "install-cursor.sh",
    "install-codex.sh",
    "install-opencode.sh",
    "install.sh",
    "install-all.sh",
    "release-manifest.json",
    "SHA256SUMS.txt",
    ...platforms.map((platform) => `${pluginName}-${platform}-latest.tar.gz`),
  ]) {
    assert.ok(await pathExists(path.join(releaseDir, expected)), `missing fake release asset ${expected}`);
  }

  const cursorInstaller = await readFile(path.join(releaseDir, "install-cursor.sh"), "utf8");
  assert.match(cursorInstaller, /installed host manifest identity does not match candidate bundle/);
  assert.match(cursorInstaller, /Refusing to replace unowned install/);

  return releaseDir;
}

async function prepareLegacyInstall(platform, paths, { mismatch = false } = {}) {
  await mkdir(paths.pluginInstallDir, { recursive: true });
  await writeJson(path.join(paths.pluginInstallDir, ".pluxx-user.json"), {
    values: { "instantly-api-key": "sendlens-test-placeholder" },
    env: { SENDLENS_INSTANTLY_API_KEY: "sendlens-test-placeholder" },
  });

  const manifest = await candidateManifest(platform);
  const legacyManifest = {
    ...manifest,
    name: mismatch
      ? platform === "opencode"
        ? "@orchid/other-sendlens-opencode"
        : "other-sendlens"
      : manifest.name,
    version: "0.1.61",
  };
  await writeJson(
    path.join(paths.pluginInstallDir, manifestRelativePath(platform)),
    legacyManifest,
  );
  await writeFile(path.join(paths.pluginInstallDir, "legacy-pre-ownership.txt"), "legacy bundle marker\n");
}

async function prepareTrustedOpenCodeCompanions(paths) {
  const skillName = await firstOpenCodeSkillName();
  await mkdir(path.dirname(paths.env.PLUXX_OPENCODE_ENTRY_PATH), { recursive: true });
  await writeFile(paths.env.PLUXX_OPENCODE_ENTRY_PATH, legacyOpenCodeWrapper());

  const skillDir = path.join(
    paths.env.PLUXX_OPENCODE_SKILLS_ROOT,
    `${pluginName}-${skillName}`,
  );
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${pluginName}/${skillName}\n---\n\n# Legacy ${skillName}\n`,
  );
  return { skillName, skillDir };
}

function installerEnv(platform, runRoot, releaseDir, paths) {
  const homeDir = path.join(runRoot, "home");
  const tempDir = path.join(runRoot, "tmp");
  const archive = path.join(releaseDir, `${pluginName}-${platform}-latest.tar.gz`);
  const bundleEnvName = {
    "claude-code": "PLUXX_CLAUDE_BUNDLE_PATH",
    cursor: "PLUXX_CURSOR_BUNDLE_PATH",
    codex: "PLUXX_CODEX_BUNDLE_PATH",
    opencode: "PLUXX_OPENCODE_BUNDLE_PATH",
  }[platform];

  return {
    PATH: process.env.PATH,
    HOME: homeDir,
    TMPDIR: tempDir,
    TMP: tempDir,
    TEMP: tempDir,
    NODE_PATH: path.join(root, "node_modules"),
    SENDLENS_SKIP_INSTALL_REFRESH: "1",
    PLUXX_CODEX_ENABLE_PLUGIN_HOOKS: "1",
    PLUXX_INSTALL_LOCK_ROOT: path.join(runRoot, "install-locks"),
    [bundleEnvName]: archive,
    ...paths.env,
  };
}

async function runInstaller(platform, releaseDir, { mismatch = false, openCodeSkillCollision = false } = {}) {
  const runRoot = await tempDir(`sendlens-legacy-${platform}-`);
  await mkdir(path.join(runRoot, "home"), { recursive: true });
  await mkdir(path.join(runRoot, "tmp"), { recursive: true });
  const paths = installPaths(platform, runRoot);

  await prepareLegacyInstall(platform, paths, { mismatch });
  let openCodeSkill;
  if (platform === "opencode" && !mismatch) {
    openCodeSkill = await prepareTrustedOpenCodeCompanions(paths);
    if (openCodeSkillCollision) {
      await writeFile(
        path.join(openCodeSkill.skillDir, "SKILL.md"),
        `---\nname: ${pluginName}/unrelated-private-skill\n---\n\n# Private collision\n`,
      );
    }
  }

  const scriptName = platform === "claude-code" ? "install-claude-code.sh" : `install-${platform}.sh`;
  const result = run("bash", [path.join(releaseDir, scriptName)], {
    env: installerEnv(platform, runRoot, releaseDir, paths),
  });

  return { result, runRoot, paths, openCodeSkill };
}

async function testTrustedLegacyUpgrades(releaseDir) {
  for (const platform of platforms) {
    const { result, runRoot, paths, openCodeSkill } = await runInstaller(platform, releaseDir);
    assertRun(result, `${platform} trusted legacy upgrade`);

    assert.equal(
      await pathExists(path.join(paths.pluginInstallDir, "legacy-pre-ownership.txt")),
      false,
      `${platform}: legacy marker should be replaced`,
    );
    assert.ok(
      await pathExists(ownershipPath(platform, path.join(runRoot, "home"), paths.pluginInstallDir)),
      `${platform}: ownership ledger should be written`,
    );
    const installedManifest = await readJson(path.join(paths.pluginInstallDir, manifestRelativePath(platform)));
    const expectedManifest = await candidateManifest(platform);
    assert.equal(installedManifest.name, expectedManifest.name, `${platform}: manifest name`);
    assert.equal(installedManifest.version, releaseVersion, `${platform}: manifest version`);

    if (platform === "opencode") {
      const entry = await readFile(paths.env.PLUXX_OPENCODE_ENTRY_PATH, "utf8");
      assert.match(entry, /OpenCode auto-loads plugin files/);
      assert.ok(openCodeSkill, "OpenCode skill should be prepared");
      const skill = await readFile(path.join(openCodeSkill.skillDir, "SKILL.md"), "utf8");
      assert.match(skill, new RegExp(`name: ${pluginName}/${openCodeSkill.skillName}`));
    }
  }
}

async function testMismatchedIdentitiesFailClosed(releaseDir) {
  for (const platform of platforms) {
    const { result, paths } = await runInstaller(platform, releaseDir, { mismatch: true });
    assert.notEqual(result.status, 0, `${platform}: mismatched legacy identity should fail`);
    assert.match(result.stderr, /Refusing to replace unowned install/, `${platform}: failure reason`);
    assert.equal(
      await readFile(path.join(paths.pluginInstallDir, "legacy-pre-ownership.txt"), "utf8"),
      "legacy bundle marker\n",
      `${platform}: mismatched legacy marker should remain`,
    );
  }
}

async function testOpenCodeUnrelatedSkillCollisionFailsClosed(releaseDir) {
  const { result, paths, openCodeSkill } = await runInstaller("opencode", releaseDir, {
    openCodeSkillCollision: true,
  });
  assert.notEqual(result.status, 0, "OpenCode unrelated legacy skill collision should fail");
  assert.match(result.stderr, /Refusing to replace unowned OpenCode companion/);
  assert.ok(openCodeSkill, "OpenCode collision fixture should include a skill");
  const preserved = await readFile(path.join(openCodeSkill.skillDir, "SKILL.md"), "utf8");
  assert.match(preserved, /sendlens\/unrelated-private-skill/);
  assert.equal(
    await readFile(path.join(paths.pluginInstallDir, "legacy-pre-ownership.txt"), "utf8"),
    "legacy bundle marker\n",
  );
}

try {
  assert.equal(packageJson.devDependencies?.["@orchid-labs/pluxx"], "^0.1.33");

  assertRun(run("npm", ["run", "--silent", "build:plugin"]), "build:plugin");
  assertRun(run("npm", ["run", "--silent", "build:hosts"]), "build:hosts");

  const releaseDir = await createFakeReleaseAssets();
  await testTrustedLegacyUpgrades(releaseDir);
  await testMismatchedIdentitiesFailClosed(releaseDir);
  await testOpenCodeUnrelatedSkillCollisionFailsClosed(releaseDir);

  console.log("OK: generated SendLens installers adopt trusted legacy installs and reject mismatches");
} finally {
  await Promise.all(tempRoots.map((directory) => rm(directory, { recursive: true, force: true })));
}
