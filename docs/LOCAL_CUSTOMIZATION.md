# Local Customization

SendLens OSS is intentionally local and editable. Users can customize prompts, skills, commands, and specialist guidance in a cloned repo, then rebuild and reinstall the plugin into their agent host.

## What You Can Customize Locally

- `INSTRUCTIONS.md`: global tool routing and operating rules
- `skills/*/SKILL.md`: workflow-specific guidance such as copy analysis or ICP signals
- `commands/*.md`: host command entrypoints
- `agents/*.md`: specialist reviewer prompts
- `.env` and `.env.clients/*`: local API-key and client-profile selection

After editing, run:

```bash
npm run test:plugin
npm run validate:plugin
npm run build:hosts
pluxx install --target codex claude-code cursor opencode --trust
```

Use only the targets you actually need during development.

## What Belongs In Cloud Later

These are not OSS features:

- team-managed methodology packs
- scheduled cloud agents
- approval workflows
- managed workspaces
- shared warehouse credentials
- proactive alerts
- enterprise SSO, SCIM, or role policy
- cross-tenant network insights

For OSS, customization should stay local, explicit, and under the user's control.

## Safe Customization Pattern

1. Start from the existing skill closest to your workflow.
2. Keep the one-campaign-at-a-time analysis shape unless you are only ranking campaigns.
3. Preserve exactness language for exact, sampled, hybrid, and reconstructed evidence.
4. Keep private customer strategy out of public skills, docs, and issue threads.
5. Reinstall the plugin after changes and verify tools still mount in your host.

## First Useful Local Prompts

After install, try:

```text
Use SendLens to summarize what is working and not working in this workspace.
```

```text
Use SendLens to find the active campaign I should inspect first, then load that one campaign.
```

```text
Use SendLens to inspect one campaign's rendered outbound sample for personalization issues.
```

If those fail because the cache is empty or locked, ask:

```text
Use SendLens refresh_status and tell me what is blocking analysis.
```

