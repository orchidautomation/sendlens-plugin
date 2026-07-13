import { definePlugin } from "pluxx";
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf8"),
) as { version: string };

const codexAgentDirectory = resolve(
  __dirname,
  "dist",
  "codex",
  ".codex",
  "agents",
);
const conditionalDelegation =
  "- Do not delegate further subtasks unless the parent task explicitly asks for additional specialist work.";
const boundedDelegation =
  "- Do not delegate further subtasks. Return the completed specialist handoff to the parent coordinator.";

function enforceCodexAgentContracts() {
  if (!existsSync(codexAgentDirectory)) return;

  const agentFiles = readdirSync(codexAgentDirectory)
    .filter((fileName) => fileName.endsWith(".toml"))
    .sort();

  if (agentFiles.length === 0) return;

  let changed = 0;
  for (const fileName of agentFiles) {
    const agentPath = resolve(codexAgentDirectory, fileName);
    const current = readFileSync(agentPath, "utf8");
    const enforced = current.replaceAll(
      conditionalDelegation,
      boundedDelegation,
    );

    if (!enforced.includes(boundedDelegation)) {
      throw new Error(
        `${fileName}: generated agent config lacks a delegation contract to enforce`,
      );
    }

    if (enforced !== current) {
      writeFileSync(agentPath, enforced, "utf8");
      changed += 1;
    }
  }

  if (changed > 0) {
    console.log(
      `Enforced coordinator-owned delegation in ${changed} Codex agent configs.`,
    );
  }
}

process.once("beforeExit", enforceCodexAgentContracts);

export default definePlugin({
  name: "sendlens",
  version: pkg.version,
  description:
    "Privacy-first outbound campaign analysis for AI workspaces.",
  author: {
    name: "Orchid Labs",
    url: "https://github.com/orchidautomation",
  },
  license: "MIT",
  repository: "https://github.com/orchidautomation/sendlens-plugin",
  keywords: [
    "instantly",
    "outbound",
    "duckdb",
    "cold-email",
    "analytics",
    "pluxx",
    "codex",
  ],

  brand: {
    displayName: "SendLens",
    shortDescription:
      "Privacy-first outbound campaign analysis inside your AI workspace.",
    longDescription:
      "Use SendLens to understand what is landing with prospects, which campaigns and segments are driving positive replies, and what to change next. The open-source release currently connects to Instantly, stores analysis state locally, and keeps campaign-specific enrichment data on the user's machine.",
    category: "Analytics",
    websiteURL: "https://github.com/orchidautomation/sendlens-plugin",
    privacyPolicyURL:
      "https://github.com/orchidautomation/sendlens-plugin/blob/main/docs/TRUST_AND_PRIVACY.md",
    color: "#0F766E",
    icon: "./assets/sendlens-mark.svg",
    screenshots: ["./assets/sendlens-cover.svg"],
    defaultPrompts: [
      "Run SendLens setup and tell me whether this plugin is ready.",
      "Use SendLens demo mode to show me a synthetic workspace analysis without production credentials.",
      "Use SendLens to diagnose what is working, recommend the next campaign, draft the sequence, and define launch and learning rules.",
    ],
  },

  skills: "./skills/",
  agents: "./agents/",
  commands: "./commands/",
  instructions: "./INSTRUCTIONS.md",
  scripts: "./scripts/",
  passthrough: [
    "./assets/",
    "./build/",
    "./scripts/",
  ],

  userConfig: [
    {
      key: "sendlens-provider",
      title: "Source Provider Mode",
      description:
        "Source data provider mode: instantly, smartlead, or all. Defaults to instantly. This is source identity and is separate from mailbox provider fields in analysis tables.",
      type: "string",
      required: false,
      envVar: "SENDLENS_PROVIDER",
      targets: ["claude-code", "cursor", "codex", "opencode"],
    },
    {
      key: "instantly-api-key",
      title: "Instantly API Key",
      description:
        "Provider value for read-only Instantly workspace access. Pluxx resolves it at MCP runtime from launch-folder env files or the inherited host environment; installers must not store the value.",
      type: "secret",
      required: true,
      envVar: "SENDLENS_INSTANTLY_API_KEY",
      targets: ["claude-code", "cursor", "codex", "opencode"],
    },
    {
      key: "smartlead-api-key",
      title: "Smartlead API Key",
      description:
        "Dedicated Smartlead read-only API key for Smartlead provider setup checks. Smartlead uses query-string access, and SendLens suppresses the value in setup output and errors.",
      type: "secret",
      required: false,
      envVar: "SENDLENS_SMARTLEAD_API_KEY",
      targets: ["claude-code", "cursor", "codex", "opencode"],
    },
    {
      key: "sendlens-client",
      title: "Client Key",
      description:
        "Optional client slug used to load .env.clients/<client>.env and .env.clients/<client>.local.env.",
      type: "string",
      required: false,
      envVar: "SENDLENS_CLIENT",
      targets: ["claude-code", "cursor", "codex", "opencode"],
    },
    {
      key: "sendlens-clients-dir",
      title: "Client Env Directory",
      description:
        "Optional directory containing client-scoped env files. Defaults to .env.clients.",
      type: "string",
      required: false,
      envVar: "SENDLENS_CLIENTS_DIR",
      targets: ["claude-code", "cursor", "codex", "opencode"],
    },
    {
      key: "sendlens-db-path",
      title: "Local DuckDB Path",
      description:
        "Optional path override for the local SendLens DuckDB database. Defaults to ~/.sendlens/workspace-cache.duckdb.",
      type: "string",
      required: false,
      envVar: "SENDLENS_DB_PATH",
      targets: ["claude-code", "cursor", "codex", "opencode"],
    },
    {
      key: "sendlens-demo-mode",
      title: "Demo Mode",
      description:
        "Optional synthetic demo workspace mode. Set to 1 to seed and analyze public-safe fixture data without Instantly credentials.",
      type: "string",
      required: false,
      envVar: "SENDLENS_DEMO_MODE",
      targets: ["claude-code", "cursor", "codex", "opencode"],
    },
  ],

  mcp: {
    sendlens: {
      transport: "stdio",
      command: "bash",
      args: ["./scripts/start-mcp.sh"],
      env: {
        SENDLENS_PROVIDER: "${SENDLENS_PROVIDER}",
        SENDLENS_INSTANTLY_API_KEY: "${SENDLENS_INSTANTLY_API_KEY}",
        SENDLENS_SMARTLEAD_API_KEY: "${SENDLENS_SMARTLEAD_API_KEY}",
        SENDLENS_CLIENT: "${SENDLENS_CLIENT}",
        SENDLENS_CLIENTS_DIR: "${SENDLENS_CLIENTS_DIR}",
        SENDLENS_DB_PATH: "${SENDLENS_DB_PATH}",
        SENDLENS_DEMO_MODE: "${SENDLENS_DEMO_MODE}",
      },
    },
  },

  hooks: {
    sessionStart: [
      {
        command: "bash \"${PLUGIN_ROOT}/scripts/session-start.sh\"",
      },
    ],
  },

  targets: ["claude-code", "cursor", "codex", "opencode"],
  outDir: "./dist",
});
