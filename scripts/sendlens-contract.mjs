export const PUBLIC_SKILLS = [
  "sendlens-analyst",
  "sendlens-campaign-strategist",
  "sendlens-copywriter",
  "sendlens-launch-operator",
  "sendlens-setup",
];

export const COMMAND_ROUTING_EXCEPTIONS = new Map([
  [
    "using-sendlens",
    {
      skill: "sendlens-analyst",
      agent: "",
      rationale:
        "Using SendLens is a backward-compatible coordinator-owned route into sendlens-analyst.",
    },
  ],
  [
    "sendlens-setup",
    {
      skill: "sendlens-setup",
      agent: "",
      rationale:
        "Setup is explicit-invocation and runs the MCP setup doctor workflow without a specialist agent.",
    },
  ],
  [
    "sendlens-analyst",
    {
      skill: "sendlens-analyst",
      agent: "",
      rationale:
        "The main analyst command stays coordinator-owned so it can spawn bounded specialists instead of entering one specialist directly.",
    },
  ],
  [
    "sendlens-campaign-strategist",
    {
      skill: "sendlens-campaign-strategist",
      agent: "",
      rationale:
        "Focused strategy stays coordinator-owned so the parent can delegate the specialist and retain the final handoff.",
    },
  ],
  [
    "sendlens-copywriter",
    {
      skill: "sendlens-copywriter",
      agent: "",
      rationale:
        "Focused copy stays coordinator-owned so the parent can delegate the specialist and retain the final handoff.",
    },
  ],
  [
    "sendlens-launch-operator",
    {
      skill: "sendlens-launch-operator",
      agent: "",
      rationale:
        "Focused launch operation stays coordinator-owned so the parent can delegate the specialist and retain the final verdict.",
    },
  ],
]);

export const COMMAND_OWNERS = [
  {
    command: "workspace-health",
    skill: "sendlens-analyst",
    primaryAgent: "workspace-triager",
    argumentHint: "[campaign-name-or-provider-tag]",
  },
  {
    command: "campaign-performance",
    skill: "sendlens-analyst",
    primaryAgent: "campaign-analyst",
    argumentHint: "[campaign-name] [provider-tag]",
  },
  {
    command: "copy-analysis",
    skill: "sendlens-analyst",
    primaryAgent: "copy-auditor",
    argumentHint: "[campaign-name] [provider-tag]",
  },
  {
    command: "icp-signals",
    skill: "sendlens-analyst",
    primaryAgent: "icp-auditor",
    argumentHint: "[campaign-name] [provider-tag]",
  },
  {
    command: "reply-patterns",
    skill: "sendlens-analyst",
    primaryAgent: "reply-auditor",
    argumentHint: "[campaign-name] [provider-tag]",
  },
  {
    command: "cold-email-best-practices",
    skill: "sendlens-copywriter",
    primaryAgent: "campaign-copywriter",
    argumentHint: "[approved-strategy-or-campaign]",
  },
  {
    command: "account-manager-brief",
    skill: "sendlens-launch-operator",
    primaryAgent: "launch-operator",
    allowedHandoffs: ["workspace-triager", "campaign-analyst", "synthesis-reviewer"],
    argumentHint: "[campaign-name-or-provider-tag]",
  },
  {
    command: "campaign-launch-qa",
    skill: "sendlens-launch-operator",
    primaryAgent: "launch-operator",
    allowedHandoffs: ["campaign-analyst", "copy-auditor", "synthesis-reviewer"],
    argumentHint: "[campaign-name]",
  },
  {
    command: "experiment-planner",
    skill: "sendlens-campaign-strategist",
    primaryAgent: "campaign-strategist",
    allowedHandoffs: ["campaign-analyst", "launch-operator", "synthesis-reviewer"],
    argumentHint: "[campaign-name-or-provider-tag]",
  },
];

export const COMMAND_AGENTS = new Map(
  COMMAND_OWNERS.map(({ command, primaryAgent }) => [command, primaryAgent]),
);

export const COMMAND_SKILLS = new Map([
  ...PUBLIC_SKILLS.map((skill) => [skill, skill]),
  ...COMMAND_OWNERS.map(({ command, skill }) => [command, skill]),
  ["using-sendlens", "sendlens-analyst"],
]);

export const COMMAND_ARGUMENT_HINTS = new Map(
  COMMAND_OWNERS.map(({ command, argumentHint }) => [command, argumentHint]),
);

export const REQUIRED_PRIVACY_PATTERNS = [
  /do not paste raw contact data/i,
  /full reply bodies/i,
  /external artifacts/i,
];

export const REQUIRED_READ_ONLY_PATTERNS = [
  /provider operations read-only/i,
  /never (?:create, edit, send, or mutate|mutate provider resources)/i,
];

export const REQUIRED_PROVIDER_PATTERNS = [
  /Preserve `source_provider`, `provider_campaign_id`, and `campaign_source_id`/i,
  /provider-qualified/i,
  /Smartlead V1 support is read-only/i,
];

export const OPENAI_AGENT_SKILL_SUMMARIES = new Map([
  ["sendlens-analyst", /diagnose.*orchestrate/i],
  ["sendlens-campaign-strategist", /strategy|audience|offer|angle|experiment/i],
  ["sendlens-copywriter", /evidence-backed|subjects|bodies|sequence/i],
  ["sendlens-launch-operator", /launch|scale|measurement|learning/i],
  ["sendlens-setup", /install|diagnose|configured|ready/i],
]);
