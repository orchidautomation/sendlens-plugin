# SendLens

**A local, read-only outbound analyst inside the AI tool you already use.**

SendLens connects Instantly or Smartlead V1 to Claude Code, Cursor, Codex, or OpenCode. Ask questions in plain English and get evidence-backed answers about campaigns, senders, replies, lead signals, and deliverability.

No hosted dashboard or SQL required. SendLens keeps its analysis cache in local DuckDB and labels answers as exact, sampled, or hybrid.

## What it does

- Ranks campaigns by performance, risk, lead runway, and sender health.
- Finds the steps and copy variants that are doing the work.
- Reviews replies, objections, and sampled ICP signals.
- Flags sender, inbox-placement, tracking, and deliverability risks.
- Turns validated findings into experiments, copy recommendations, and client-safe briefs.

SendLens is read-only by design. It does not send email or change campaigns, leads, accounts, webhooks, or provider settings.

## Example questions

```text
What is working and not working in this workspace, and what should I inspect first?

Rank my active campaigns by what needs attention: bounce risk, lead runway, missing senders, low replies, or stopped sending.

Audit the rendered outbound sample for personalization tokens, blank bodies, and the affected step or variant.

Pull the latest replies for this campaign, separate human replies from auto-responders, and summarize the themes.

Use the strongest validated evidence to recommend the next campaign experiment.
```

## Install

Install all supported hosts:

```bash
bash <(curl -fsSL https://sendlens.app/install.sh) --agents -y
```

For a single host, raw bundles, local development, and troubleshooting, see the [install guide](./docs/INSTALL.md). The [latest release](https://github.com/orchidautomation/sendlens-plugin/releases/latest) includes direct host installers and bundles.

## First run

After installing, run this command in your AI tool:

```text
/sendlens-setup
```

Setup can connect a provider, check the local runtime, or start a synthetic demo workspace. Demo data is safe for trying the workflow but is not customer evidence.

For provider setup, use one or both of these credentials in the environment where you launch your host:

```bash
# Instantly
export SENDLENS_INSTANTLY_API_KEY=your_instantly_api_key

# Smartlead
export SENDLENS_SMARTLEAD_API_KEY=your_smartlead_api_key
```

Runtime launchers read provider settings from launch-folder env files first, then from the inherited/global host environment. When both providers are configured, set `SENDLENS_CLIENT` to keep them in one named local workspace. SendLens infers the provider mode from the available keys; `SENDLENS_PROVIDER` can override it with `instantly`, `smartlead`, or `all`. Smartlead Smart Delivery is support-gated; missing placement rows are reported as unsupported, not as healthy placement. Never paste API keys into chat.

## Privacy in plain English

- The default stdio setup keeps the cache on the machine running your AI host.
- SendLens does not require an Orchid-hosted database for the core workflow.
- Opt-in HTTP deployments return results to authenticated remote MCP clients.
- Anything returned to your AI host becomes part of that host's conversation and may be processed under the host or model provider's policies.

See [Trust and privacy](./docs/TRUST_AND_PRIVACY.md) for the complete data-handling model.

## Helpful docs

- [Install guide](./docs/INSTALL.md)
- [Trust and privacy](./docs/TRUST_AND_PRIVACY.md)
- [Component catalog](./docs/CATALOG.md)
- [Skills and workflows](./docs/skills/README.md)
- [Synthetic example outputs](./docs/examples/SYNTHETIC_OUTPUTS.md)
- [Troubleshooting](./docs/TROUBLESHOOTING.md)
- [Streamable HTTP deployment](./docs/HTTP_TRANSPORT.md)
- [Release guide](./docs/RELEASING.md)

## Developer quickstart

```bash
git clone https://github.com/orchidautomation/sendlens-plugin.git
cd sendlens-plugin
npm install
cp .env.example .env
```

For a local demo:

```bash
SENDLENS_DEMO_MODE=1 npm run demo:seed
```

Useful checks:

```bash
npm run build:plugin
npm run build:hosts
npm run test:plugin:smoke
npm run validate:plugin
npm run lint:plugin
```

For the full development workflow, run `npm run ci:plugin`. Client-specific environment overlays are supported through `SENDLENS_CLIENT`; see the [local customization guide](./docs/LOCAL_CUSTOMIZATION.md).

## Who builds SendLens

SendLens is built by **Orchid Labs**, the product division of **Orchid Automation** ([orchidautomation.com](https://orchidautomation.com)). Have an idea or feedback? [Open an issue](https://github.com/orchidautomation/sendlens-plugin/issues).
