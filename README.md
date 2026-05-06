# SendLens

SendLens helps teams understand why outbound campaigns are winning or losing.

It turns campaign results, replies, message copy, sender health, and lead details into plain-English analysis inside the AI tools your team already uses.

## What SendLens Does

SendLens helps you answer the questions that matter after campaigns start sending:

- Which campaigns are working best?
- Which campaigns need attention?
- What messages are getting positive replies?
- What do good responders have in common?
- Which senders or inbox tests show deliverability risk?
- What should we test next?

Instead of digging through exports, dashboards, and scattered notes, you can ask your AI workspace for a grounded read on what is happening and what to change.

## Who It Is For

SendLens is for people who run outbound programs and need faster feedback:

- founders checking whether a campaign is worth scaling
- growth teams comparing messages and audiences
- agencies managing client campaigns
- sales teams trying to understand positive replies
- operators looking for deliverability or sender-health issues

You do not need to understand the internal data model to use it. The normal workflow is to install the plugin, run setup, refresh data, and ask questions in plain language.

## What You Can Ask

Examples:

- "What is working and not working in this workspace?"
- "Which campaign should we scale first?"
- "Why is this campaign getting replies but few positive outcomes?"
- "What do the best responders have in common?"
- "Compare these two campaigns and tell me what to test next."
- "Show me the reply themes prospects keep mentioning."
- "Do any senders or inbox placement tests look risky?"

SendLens is designed to separate evidence from opinion. When it uses exact campaign metrics, sampled lead evidence, fetched reply text, or synthetic demo data, the output should say so.

## Try It Without Real Data

You can evaluate SendLens without connecting a production workspace.

From a local checkout:

```bash
SENDLENS_DEMO_MODE=1 npm run demo:seed
```

Then ask:

```text
Use SendLens to summarize what is working and not working in the demo workspace.
```

Demo results are synthetic. They are useful for seeing the experience, not for judging a real campaign or customer.

## Download And Install

Latest release:

- [Latest release page](https://github.com/orchidautomation/sendlens-plugin/releases/latest)

Copy-paste installers:

Claude Code

```bash
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-claude-code.sh | bash
```

Cursor

```bash
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-cursor.sh | bash
```

Codex

```bash
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-codex.sh | bash
```

OpenCode

```bash
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-opencode.sh | bash
```

All supported hosts

```bash
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-all.sh | bash
```

Direct bundle downloads:

- [Claude Code bundle](https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/sendlens-claude-code-latest.tar.gz)
- [Cursor bundle](https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/sendlens-cursor-latest.tar.gz)
- [Codex bundle](https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/sendlens-codex-latest.tar.gz)
- [OpenCode bundle](https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/sendlens-opencode-latest.tar.gz)

## First Run

After install, run setup before deep analysis:

```text
/sendlens-setup
```

From a local checkout:

```bash
npm run doctor
```

Setup checks whether the plugin can run, whether the local working folder is writable, and whether credentials or demo mode are configured.

## Privacy In Plain English

SendLens is built to keep the core workflow local.

- It uses read-only analysis paths.
- It stores its working data on your machine.
- It does not require an Orchid-hosted cloud database for normal use.
- Demo mode works without production credentials.
- When your AI host asks SendLens a question, the answer becomes part of that host session.

Current local state defaults:

- local analysis database: `~/.sendlens/workspace-cache.duckdb`
- refresh status: `~/.sendlens/refresh-status.json`
- setup and refresh logs: `~/.sendlens/session-start-refresh.log`

For the full data-handling model, read [Trust and privacy](./docs/TRUST_AND_PRIVACY.md).

## Current Connector

SendLens is built around outbound performance analysis. This release supports Instantly as its first data source.

With that connector, SendLens can read campaign metrics, message templates, sender health, inbox placement results, lead evidence, and reply text for analysis.

## What Ships In This Repo

This repo is the open-source home for the SendLens plugin.

It includes:

- installable bundles for Claude Code, Cursor, Codex, and OpenCode
- setup and doctor flows
- demo mode with synthetic proof data
- specialist analysis skills for performance, replies, copy, ICP signals, launch QA, and workspace health
- local-first runtime code
- public docs, examples, and release tooling

Helpful docs:

- [Install guide](./docs/INSTALL.md)
- [Trust and privacy](./docs/TRUST_AND_PRIVACY.md)
- [Synthetic example outputs](./docs/examples/SYNTHETIC_OUTPUTS.md)
- [Component catalog](./docs/CATALOG.md)
- [Skill docs](./docs/skills/README.md)
- [Troubleshooting guide](./docs/TROUBLESHOOTING.md)
- [Local customization](./docs/LOCAL_CUSTOMIZATION.md)
- [Release guide](./docs/RELEASING.md)

## Developer Quickstart

```bash
git clone https://github.com/orchidautomation/sendlens-plugin.git
cd sendlens-plugin
npm install
cp .env.example .env
```

Set a data-source API key for real workspace analysis:

```bash
SENDLENS_INSTANTLY_API_KEY=your_key
```

Then:

```bash
npm run ci:plugin
```

Useful development commands:

```bash
npm run build:plugin
npm run refresh:plugin
npm run benchmark:fast-sync
pluxx validate
pluxx build --target claude-code cursor codex opencode
pluxx verify-install --target claude-code cursor codex opencode
```

Landing page:

```bash
npm run site:install
npm run site:dev
```

## Client-Scoped Env Support

Env loading order supports named client overlays:

1. `.env`
2. `.env.local`
3. `.env.clients/<client>.env`
4. `.env.clients/<client>.local.env`

Use `SENDLENS_CLIENT` when you want to load a client-specific env overlay.
