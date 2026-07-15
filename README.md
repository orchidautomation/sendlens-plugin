# SendLens

**A local, read-only outbound analyst inside the AI tool you already use.**

SendLens turns your outbound provider data into something you can talk to. Ask a question in plain English inside Claude Code, Cursor, Codex, or OpenCode, and you get a clear, evidence-backed answer about your actual campaigns, your actual senders, and what your actual prospects are saying back.

No hosted dashboard to maintain. No SQL required. Just questions, evidence, and a clear next move.

## What SendLens provides

SendLens supports Claude Code, Cursor, Codex, and OpenCode. Every host gets the same local DuckDB analysis layer, read-only MCP tools, specialist workflows, demo workspace, and privacy boundary.

**Matrix legend:** **Included** means the provider exposes the source and SendLens models it directly. **Bounded** means SendLens intentionally fetches or analyzes a limited slice and labels the coverage. **Support-gated** means Smartlead must separately authorize its Smart Delivery service. **Not offered** is an intentional product boundary.

| SendLens capability | Instantly | Smartlead V1 | Evidence exposed to the AI |
| --- | --- | --- | --- |
| Campaign inventory, status, schedule, and settings | Included | Included | Exact provider records |
| Campaign totals and date/range performance | Included | Included | Exact source-native counts; cross-provider denominator caveats stay visible |
| Steps, sequences, variants, and copy | Included | Included | Exact templates and available source-native performance |
| Sender assignments, account metrics, and warmup health | Included | Included | Exact account records and provider-reported health windows |
| Tags and scoped workspace analysis | Included | Included for exposed campaign/account tags | Exact mappings where the provider exposes them |
| Lead fields and ICP-signal analysis | Bounded | Bounded | Sampled rows with coverage labels; never presented as full-population proof |
| Reply text and objection/theme analysis | Exact, fetched on demand | Bounded exact message history | Exact stored reply text with explicit hydration/coverage state |
| Inbox placement and deliverability | Included | **Support-gated Smart Delivery** | Instantly per-email placement; Smartlead test/run, provider, region, sender, authentication, blacklist, IP, and spam-filter aggregates/diagnostics |
| Cross-provider workspace analysis | Included with `SENDLENS_PROVIDER=all` | Included with `SENDLENS_PROVIDER=all` | Provider-qualified IDs, normalized comparisons, and overlap-risk views |
| Campaign QA, performance diagnosis, experiments, ICP/reply analysis, and account briefs | Included | Included where required source evidence exists | Specialist plays that preserve exact, sampled, inferred, and unsupported distinctions |
| Sending email or changing campaigns, leads, accounts, webhooks, or provider settings | **Not offered** | **Not offered** | SendLens V1 is read-only by design |

Smartlead deliverability is not part of the Standard API surface. A valid Smartlead key can power core campaign analysis while Smart Delivery remains unavailable; SendLens records that state as `unsupported` instead of treating missing rows as healthy placement.

## Why this matters

Cold outbound data is scattered across campaign totals, sender health, replies, lead fields, daily volume, tags, and deliverability tests. SendLens pulls that into a local DuckDB cache and gives your AI tool a set of specialist plays for answering the questions that usually take a senior analyst hours.

It can:

- compare campaigns and tell you which one to scale, kill, or rewrite
- rank the steps and copy variants that are actually doing the work
- separate genuine human replies from auto-responders and out-of-office noise
- surface tracking, bounce-protection, sender, and inbox-placement risk before launch
- project how many days of sending you have left before you run out of leads
- read replies and lead fields for patterns, objections, and ICP signals
- turn validated patterns into a new campaign recommendation, evidence-backed copy variants, and a measurable experiment
- write client-safe account-manager briefs

You don't need to know how anything is stored, or what to call any of this. You ask in plain language. SendLens picks the right play and answers.

## What you can actually ask

These are the kinds of questions SendLens can answer today:

- "Rank every active campaign by what most needs attention: bounce risk, lead runway, missing senders, low replies, or stopped sending."
- "For my Q2 CFOs tag, where am I under-using sending capacity, and which campaigns are starving the others?"
- "For every active campaign in this tag, show exact lead-supply evidence when available and recent new-lead contact pace as a caveated proxy."
- "For my top three campaigns, rank the winning steps and copy variants, and tell me how confident the answer is."
- "Audit my sent-email samples for unfilled personalization tokens, blank rendered bodies, and the affected step/variant."
- "Pull the latest replies for this campaign and summarize positive vs. negative themes. Quote representative replies."
- "Which custom lead fields show up more often on prospects who reply positively? Treat it as a hypothesis."
- "Which senders are landing in spam or categories in inbox-placement tests, and is the issue authentication, warmup, or content?"
- "For every campaign, show whether open tracking, link tracking, ESP matching, bounce protection, risky contacts, and unsubscribe headers are on."
- "Build this week's account-manager brief: wins, risks, current actions, client asks, and next review date."
- "Use the strongest validated segment and reply evidence to recommend the next campaign, write two meaningful copy variants, and define the launch and experiment contract."

## The Heavy Hitters

Most of these are not dashboard questions. They require campaign totals, daily pacing, sender assignments, account health, tag scopes, step and variant analytics, live templates, fetched reply text, lead outcomes, lead custom fields, sampled reconstructed outbound copy, and inbox-placement seed-test rows when available.

SendLens keeps those surfaces in one local DuckDB cache and labels the evidence as exact, sampled, or hybrid. Exact totals stay exact. Lead-field and rendered-copy analysis is treated as sample evidence when the cache only has a bounded slice. That is the point: you can ask senior-analyst questions without losing track of what is proven, what is directional, and what needs a follow-up pull.

- **Sentence-level reply attribution:** "Which sentence in my Step 0 email is prospects actually reacting to, and which one is triggering objections?"
- **Meeting-booked field fingerprint:** "Which sampled custom-field values show up disproportionately in booked or won leads?"
- **Inbox vs. conversion crossover:** "Where do seed tests show good placement but the conversation still fails, and where are provider filters hiding likely demand?"
- **Wrong-person referral mining:** "Which job titles are wrong-person replies routing me toward, and should my next list shift there?"
- **Reply-rate forensics:** "Walk back the last 14 days across reply rate, sender volume, bounces, and sampled lead-batch quality. Which shifted first?"
- **Tag-scoped scoreboard:** "For my Series-B SaaS tag, rank campaigns by positive replies, sender coverage, runway, volume utilization, and inbox-placement health."
- **Launch-blocker heatmap:** "Across paused campaigns, show missing senders, blank bodies, tracking risk, relaxed deliverability guardrails, weak runway, and sender bounce risk."

## Why you can trust the answer

Most "AI for analytics" tools blur the difference between exact totals and an educated guess from a sample. SendLens never does. Every answer tells you whether it came from:

- **Exact numbers** — campaign totals, daily metrics, sender bounce stats, deliverability results, and the actual text of replies.
- **A sample** — patterns across a representative slice of your leads, when the full set is too big to look at every row.
- **A mix of the two** — for example, exact reply totals broken down by reconstructed copy.

When the data isn't there yet, SendLens says *that*, instead of guessing — and tells you exactly what to do next.

## Install

Latest release: [release page](https://github.com/orchidautomation/sendlens-plugin/releases/latest)

Preferred installer:

```bash
bash <(curl -fsSL https://sendlens.app/install.sh) --agents -y
```

Single-host installs:

```bash
bash <(curl -fsSL https://sendlens.app/install.sh) --claude-code -y
bash <(curl -fsSL https://sendlens.app/install.sh) --cursor -y
bash <(curl -fsSL https://sendlens.app/install.sh) --codex -y
bash <(curl -fsSL https://sendlens.app/install.sh) --opencode -y
```

Direct GitHub installers also work:

```bash
# Claude Code
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-claude-code.sh | bash

# Cursor
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-cursor.sh | bash

# Codex
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-codex.sh | bash

# OpenCode
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-opencode.sh | bash

# All of the above
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-all.sh | bash
```

The Codex installer checks whether plugin-bundled hooks are enabled and prompts to add `[features].hooks = true` when needed, so session-start refreshes can run after Codex is restarted. The top-level `install.sh -y` path handles that noninteractively through Pluxx-owned installer behavior.

Direct downloads:

- [Claude Code](https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/sendlens-claude-code-latest.tar.gz)
- [Cursor](https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/sendlens-cursor-latest.tar.gz)
- [Codex](https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/sendlens-codex-latest.tar.gz)
- [OpenCode](https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/sendlens-opencode-latest.tar.gz)

## First run

After installing, type this in your AI tool:

```text
/sendlens-setup
```

It will walk you through connecting your account (or starting in demo mode) and confirm everything is ready.
The release curl installers prepare local runtime dependencies. Pluxx-owned runtime launchers resolve provider env when the MCP server starts: first from launch-folder env files for Codex, Claude Code, Cursor, or OpenCode, then from the inherited/global host environment.
If the credential required by the selected provider mode is exported during install, the installer can run the first workspace refresh immediately. In `all` mode, either credential can refresh its provider; when both credentials are configured, `SENDLENS_CLIENT` is required to join them in one local workspace. Otherwise installation still completes, and SendLens uses provider config from the launch folder or host environment when you restart or reload the host.
When you rerun the same curl command to update SendLens, the installer refreshes the global plugin bundle without baking one workspace's provider config into the installed plugin.

For example, an Instantly noninteractive install can run its first refresh when the key is exported first:

```bash
export SENDLENS_INSTANTLY_API_KEY="your_instantly_api_key"
bash <(curl -fsSL https://sendlens.app/install.sh) --codex -y
```


## Connect A Provider

SendLens supports provider-scoped read-only setup modes:

- Instantly-only: provide `SENDLENS_INSTANTLY_API_KEY`.
- Smartlead-only: provide `SENDLENS_SMARTLEAD_API_KEY`.
- Both providers: provide both keys and set `SENDLENS_CLIENT` for the shared local workspace.

When `SENDLENS_PROVIDER` is omitted, SendLens infers `instantly`, `smartlead`, or `all` from the configured keys. Set `SENDLENS_PROVIDER` only when you need an explicit override. Provider config is runtime env, not installed plugin state. For repeat use, put the variables in the folder where you launch your AI tool, or export them in the shell/global environment that starts the host. Smartlead uses query-string access, so SendLens suppresses that value in setup output, logs, traces, and errors.

Smartlead V1 is read-only. SendLens can refresh Smartlead campaign, account, lead, analytics, bounded message-history, and Smart Delivery evidence where the provider authorizes those surfaces. It does not add Smartlead write actions, webhook management, test mutation, campaign mutation, lead mutation, account mutation, or email send paths. Smart Delivery uses a separate support-gated service; SendLens records an explicit unsupported capability when access is absent, and empty rows never prove healthy placement.

For a one-session launch:

```bash
export SENDLENS_INSTANTLY_API_KEY="your_instantly_api_key"
claude
```

Or pass it only to the host process:

```bash
SENDLENS_INSTANTLY_API_KEY="your_instantly_api_key" claude
```

For Smartlead-only local development:

```bash
SENDLENS_SMARTLEAD_API_KEY="your_smartlead_api_key" claude
```

For both providers:

```bash
SENDLENS_CLIENT=acme \
SENDLENS_INSTANTLY_API_KEY="your_instantly_api_key" \
SENDLENS_SMARTLEAD_API_KEY="your_smartlead_api_key" \
claude
```

Both provider keys infer `SENDLENS_PROVIDER=all` and require `SENDLENS_CLIENT`; this keeps the Instantly and Smartlead refreshes in the same named local workspace cache.

For repeat use, put it in the folder where you launch your AI tool:

```bash
# .env
SENDLENS_INSTANTLY_API_KEY=your_instantly_api_key
```

Then start the host from that folder. SendLens loads `.env` and `.env.local` from the launch folder when the plugin starts.

For multiple clients, give each client its own cache path:

```bash
# ~/clients/acme/.env
SENDLENS_INSTANTLY_API_KEY=your_acme_instantly_api_key
SENDLENS_SMARTLEAD_API_KEY=your_acme_smartlead_api_key
SENDLENS_CLIENT=acme
SENDLENS_DB_PATH=$HOME/.sendlens/acme.duckdb
SENDLENS_STATE_DIR=$HOME/.sendlens/acme-state
```

Then launch from that client folder:

```bash
cd ~/clients/acme
claude
```

Do not paste API keys into chat. If you change keys, restart or reload the host before asking SendLens to refresh.

Want to try SendLens without connecting a provider? Demo mode is available from a local/source install or an installed plugin with no API key configured.

Demo results are synthetic. They are useful for seeing the experience, not for judging a real campaign or customer. Seeding demo data does not delete real workspace rows from the local cache; it activates a synthetic workspace named `demo_workspace`, and a real `refresh_data` later switches active analysis back to the configured live provider workspace.

## Privacy in plain English

- SendLens is read-only. It never sends emails or changes campaigns, leads, accounts, webhooks, or provider settings.
- Your data stays on your computer. Nothing is uploaded to a server we run.
- Demo mode works without connecting any real account.
- Whatever question you ask, the answer becomes part of the conversation in your AI tool — same as anything else you type there.

Full data-handling details: [Trust and privacy](./docs/TRUST_AND_PRIVACY.md).

## Provider boundaries

The matrix above is the release contract. The important Smartlead-specific boundaries are:

- No Smartlead write or mutation tools are exposed.
- Smartlead Smart Delivery is support-gated. Authorized keys receive exact Smartlead-specific aggregate/diagnostic evidence; unauthorized keys retain core Smartlead ingest with an explicit unsupported capability.
- Cross-provider rate comparisons use normalized counts and provider caveats because source-native denominators can differ.
- Live Smartlead response-shape risk remains until a real Smartlead key/account is available for bounded validation; the current OSS test posture uses synthetic fixtures and mocked responses only.

## Who builds SendLens

SendLens is built by **Orchid Labs**, the product division of **Orchid Automation** ([orchidautomation.com](https://orchidautomation.com)). Have an idea, an agency use case, or feedback? Open an issue on this repo.

## Helpful docs

- [Install guide](./docs/INSTALL.md)
- [Trust and privacy](./docs/TRUST_AND_PRIVACY.md)
- [Example outputs](./docs/examples/SYNTHETIC_OUTPUTS.md)
- [What's in the box](./docs/CATALOG.md)
- [Plays you can run](./docs/skills/README.md)
- [Troubleshooting](./docs/TROUBLESHOOTING.md)
- [Local customization](./docs/LOCAL_CUSTOMIZATION.md)
- [Release guide](./docs/RELEASING.md)

---

## Developer quickstart

> The rest of this README is for people building on top of SendLens or contributing to the codebase. If you just want to use SendLens, you can stop here.

```bash
git clone https://github.com/orchidautomation/sendlens-plugin.git
cd sendlens-plugin
npm install
cp .env.example .env
```

For real workspace analysis:

```bash
export SENDLENS_INSTANTLY_API_KEY="your_instantly_api_key"
npm run refresh:plugin
```

For Smartlead-only local development:

```bash
SENDLENS_SMARTLEAD_API_KEY="your_smartlead_api_key" npm run refresh:plugin
```

For synthetic local demo data instead:

```bash
SENDLENS_DEMO_MODE=1 npm run demo:seed
```

Then ask your host:

```text
Walk me through what's happening in this workspace, then plan the next experiment on the best-performing campaign.
```

Then:

```bash
npm run ci:plugin
```

Common dev commands:

```bash
npm run build:plugin
npm run refresh:plugin
npm run benchmark:fast-sync
pluxx validate
npm run build:hosts
pluxx verify-install --target claude-code cursor codex opencode
```

Landing page:

```bash
npm run site:install
npm run site:dev
```

### Client-scoped env support

Env loading order supports named client overlays:

1. `.env`
2. `.env.local`
3. `.env.clients/<client>.env`
4. `.env.clients/<client>.local.env`

Use `SENDLENS_CLIENT` to load a client-specific overlay. This is what makes a single laptop usable across many client workspaces.
