# `sendlens-setup`

Runs first-run setup and doctor checks for env, runtime dependencies, local state, host bundle context, and synthetic demo mode.

Related: [catalog](../CATALOG.md), [trust and privacy](../TRUST_AND_PRIVACY.md), [operator setup playbook](../operator-memory/PLAYBOOKS.md), and [synthetic examples](../examples/SYNTHETIC_OUTPUTS.md).

## Use When

- The user installed SendLens for the first time.
- MCP tools are missing or a host bundle needs verification.
- The API key, runtime dependencies, local cache path, refresh status, or session-start lock needs diagnosis.
- The user wants a proof path with synthetic demo data instead of production Instantly credentials.

## Primary Surfaces

- Skill source: `skills/sendlens-setup/SKILL.md`
- Command: `/sendlens-setup`
- MCP tool: `setup_doctor`
- Script fallback for source developers only: `scripts/sendlens-doctor.sh`

## Expected Flow

1. Call the SendLens MCP `setup_doctor` tool.
2. Show the relevant setup status, failures, warnings, and next steps.
3. If no usable Instantly API key and no local cache are present, call `seed_demo_workspace` immediately as the quick-start path unless the user explicitly wants real data only.
4. Use the tool output as the source of truth for setup checks.
5. Guide the user through the exact next command or doc link shown by the tool.
6. After setup succeeds, switch to SendLens MCP tools for analysis instead of local file, shell, or DuckDB inspection.

## Output Shape

- Setup status: `ready`, `ready_with_warnings`, or `blocked`.
- Blocking failures.
- Warnings.
- Next command to run.
- Relevant docs links.
- Whether demo mode is enabled.
- Whether demo seeding is available because credentials are missing, rejected, unreachable, or `SENDLENS_DEMO_MODE=1` is enabled.

## Privacy Boundaries

The doctor tool should never print secrets. Do not ask users to paste API keys into chat. When demo mode is enabled, keep every answer clearly labeled as synthetic demo evidence. If production credentials are already configured, keep the default path on real workspace analysis and mention demo only when explicitly requested.
