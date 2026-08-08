# SendLens

**A local, read-only outbound analyst inside the AI tool you already use.**

SendLens turns Instantly and Smartlead V1 data into evidence-backed answers about campaigns, senders, replies, lead signals, and deliverability. It runs in Claude Code, Cursor, Codex, or OpenCode, keeps its analysis cache in local DuckDB, and labels answers as exact, sampled, or hybrid. No hosted dashboard or SQL is required.

## What SendLens does

- Ranks campaigns by performance, risk, lead runway, and sender health.
- Finds the steps and copy variants that are doing the work.
- Reviews replies, objections, and sampled ICP signals.
- Flags sender, tracking, inbox-placement, and deliverability risks.
- Turns validated findings into experiments, copy recommendations, and client-safe briefs.

SendLens is read-only by design. It does not send email or change campaigns, leads, accounts, webhooks, or provider settings. Smartlead Smart Delivery is support-gated; when access is unavailable, SendLens reports placement as unsupported rather than treating missing rows as healthy.

## Install and quick start

Install all supported hosts:

```bash
bash <(curl -fsSL https://sendlens.app/install.sh) --agents -y
```

For a single host, direct release installers, or raw bundles, see the [install guide](./docs/INSTALL.md) or the [latest release](https://github.com/orchidautomation/sendlens-plugin/releases/latest).

After installing, run setup in your AI host:

```text
/sendlens-setup
```

Setup checks the runtime, configures a provider, and can start a synthetic demo workspace. For local provider configuration, export one or both keys before starting or reloading the host:

```bash
export SENDLENS_INSTANTLY_API_KEY=your_instantly_api_key
export SENDLENS_SMARTLEAD_API_KEY=your_smartlead_api_key
```

One key selects its provider. Both keys select `all` and require `SENDLENS_CLIENT` for a shared named workspace. Set `SENDLENS_PROVIDER` only when you need an explicit `instantly`, `smartlead`, or `all` override. Never paste API keys into chat.

Try the workflow without provider credentials by using the local demo command below. Demo rows are synthetic and are not customer evidence.

## CLI and MCP entry points

From a source checkout:

```bash
git clone https://github.com/orchidautomation/sendlens-plugin.git
cd sendlens-plugin
npm install
cp .env.example .env
```

The current local entry points are:

```bash
npm run doctor                         # setup and runtime checks
SENDLENS_DEMO_MODE=1 npm run demo:seed # seed synthetic data
npm run refresh:plugin                 # refresh a configured provider
npm run start:plugin-mcp               # start the stdio MCP server
```

Inside an installed host, `/sendlens-setup` is the setup entry point. Its MCP tools include `setup_doctor`, `seed_demo_workspace`, `refresh_status`, `refresh_data`, and `workspace_snapshot`. For source changes, the lightweight plugin checks are:

```bash
npm run build:plugin
npm run validate:plugin
npm run lint:plugin
npm run build:hosts
```

## Privacy

The default stdio deployment keeps the cache on the machine running your AI host. SendLens does not upload it to an Orchid-operated service or mutate provider data. Opt-in HTTP deployments keep the cache on that server and return results to authenticated remote MCP clients. Demo mode uses synthetic fixtures. See [Trust and privacy](./docs/TRUST_AND_PRIVACY.md) for the complete data-handling model.

## Documentation

- [Documentation index](./docs/)
- [Install guide](./docs/INSTALL.md)
- [Trust and privacy](./docs/TRUST_AND_PRIVACY.md)
- [Component catalog](./docs/CATALOG.md)
- [Skills and workflows](./docs/skills/README.md)
- [Troubleshooting](./docs/TROUBLESHOOTING.md)
- [Streamable HTTP deployment](./docs/HTTP_TRANSPORT.md)
- [Local customization](./docs/LOCAL_CUSTOMIZATION.md)
- [Release guide](./docs/RELEASING.md)

SendLens is built by **Orchid Labs**, the product division of **Orchid Automation** ([orchidautomation.com](https://orchidautomation.com)). Have an idea or feedback? [Open an issue](https://github.com/orchidautomation/sendlens-plugin/issues).

[MIT License](./LICENSE)
