#!/usr/bin/env node

import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentDirectory = path.join(root, "dist", "codex", ".codex", "agents");
const conditionalDelegation =
  "- Do not delegate further subtasks unless the parent task explicitly asks for additional specialist work.";
const boundedDelegation =
  "- Do not delegate further subtasks. Return the completed specialist handoff to the parent coordinator.";

const agentFiles = (await readdir(agentDirectory))
  .filter((fileName) => fileName.endsWith(".toml"))
  .sort();

if (agentFiles.length === 0) {
  throw new Error(`No generated Codex agent configs found in ${agentDirectory}`);
}

for (const fileName of agentFiles) {
  const agentPath = path.join(agentDirectory, fileName);
  const current = await readFile(agentPath, "utf8");
  const enforced = current.replaceAll(conditionalDelegation, boundedDelegation);

  if (!enforced.includes(boundedDelegation)) {
    throw new Error(`${fileName}: generated agent config lacks a delegation contract to enforce`);
  }

  if (enforced !== current) {
    await writeFile(agentPath, enforced, "utf8");
  }
}

console.log(`Enforced coordinator-owned delegation in ${agentFiles.length} Codex agent configs.`);
