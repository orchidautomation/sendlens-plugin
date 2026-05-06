import { definePlugin } from "pluxx";

export default definePlugin({
  name: "sendlens",
  version: "0.1.22",
  description:
    "Agentic reasoning over Instantly data with a privacy-first local cache.",
  author: {
    name: "Orchid Labs",
    url: "https://github.com/orchidautomation",
  },
  license: "MIT",
  repository: "https://github.com/orchidautomation/sendlens-plugin",
  keywords: [
    "instantly",
    "duckdb",
    "cold-email",
    "analytics",
    "pluxx",
    "codex",
  ],

  brand: {
    displayName: "SendLens",
    shortDescription:
      "Agentic reasoning over your Instantly data, with privacy-first local analysis.",
    longDescription:
      "Use SendLens to understand what is actually landing with prospects, which campaigns and segments are driving positive replies, and what to change next. SendLens reads from Instantly, stores analysis state in a local DuckDB cache, and keeps campaign-specific enrichment data local to the user's machine.",
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
      "Use SendLens to tell me what is working and not working in this Instantly workspace.",
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
      key: "instantly-api-key",
      title: "Instantly API Key",
      description:
        "Bearer token for read-only Instantly workspace access. Required for real workspace analysis; optional when SENDLENS_DEMO_MODE=1 is enabled.",
      type: "secret",
      required: false,
      envVar: "SENDLENS_INSTANTLY_API_KEY",
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
        SENDLENS_INSTANTLY_API_KEY: "${SENDLENS_INSTANTLY_API_KEY}",
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
