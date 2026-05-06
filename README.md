# SendLens

**An outbound analyst that lives inside the AI tool you already use.**

SendLens turns your Instantly workspace into a queryable, AI-native dataset — campaign metrics, sender health, inbox-placement results, message templates, reconstructed sends, lead payloads, and full reply text — and then lets your AI host (Claude Code, Cursor, Codex, OpenCode) reason over it with grounded, evidence-cited answers.

The result: the analysis a senior growth-ops hire would write, on demand, against your actual workspace, in plain English.

## Why this matters

Outbound teams are sitting on rich data that nobody has time to query. Dashboards show *what* happened. Spreadsheets get stale by Friday. Most "AI for cold email" stops at one-line tips against a generic prompt.

SendLens is different because the heavy lifting is already done locally before the model ever sees a question:

- **A normalized DuckDB warehouse** of your workspace, refreshed in place.
- **18+ semantic views** that pre-join campaigns, accounts, tags, daily metrics, sampled leads, reconstructed outbound copy, and fetched replies.
- **30+ analyst-grade SQL recipes** with built-in verdict columns (`am_attention_reason`, `launch_qa_status`, `recommended_test_lane`, `coverage_status`, `reply_outcome_label`, …) so the model gets ranked, decision-ready rows instead of raw counts.
- **Specialist skills** — workspace health, campaign performance, copy analysis, reply patterns, ICP signals, launch QA, experiment planner, account-manager brief, cold-email best practices — that know which recipe to run, what evidence class it produces (`exact` / `sampled` / `hybrid`), and how to caveat the answer.

You ask one question. SendLens runs the right query, fetches the right reply text, joins the right sampled evidence, and writes the answer with the work shown.

## Who it is for

- **Growth marketers** who need a defensible read on which campaign to scale, kill, or rewrite.
- **GTM engineers** who want a programmable layer over Instantly without standing up Snowflake + dbt.
- **Agencies** running 10–100 client workspaces who need client-safe weekly briefs and an internal action queue from the same data pull.
- **Founders and operators** who want one analyst-quality answer per week instead of ten dashboards.
- **RevOps / sales leaders** trying to understand why positive replies aren't converting, and which step or variant is actually doing the work.

You don't need to know SQL, the schema, or which recipe runs when. You ask in plain language; the skill router picks the recipes.

## What you can actually ask

The current README's question list is the tip of the iceberg. Here is the depth available now.

### Workspace triage and weekly rollups

- "Rank every active campaign by attention reason. Tell me which are at high bounce risk, dry on new prospects, missing sender inventory, or have no recent volume — then write a one-paragraph client-safe brief for each."
- "Build this week's account-manager brief: wins, risks, current actions, asks, and next review date. Sort by attention reason, then by 7-day sent volume."
- "For tag `Q2-CFOs`, give me deduped daily sender volume vs. configured campaign daily limit. Where are we under-utilizing capacity, and which campaigns are starving the others?"
- "Compare campaign-attributed daily volume to sender-attributed daily volume for tag `Series-B-SaaS`. If they diverge, tell me whether the gap is a campaign-side under-send or a sender-side spillover into other campaigns."

### Lead runway and pacing

- "For every active campaign in tag `Mid-market RevOps`, compute new-lead runway in sending days. Flag anything under 5 days of runway and propose a refill order."
- "Which campaigns have we sent on every sending day in the last 30 days, and what's the observed per-campaign daily ceiling vs. the configured `daily_limit`? Where can we safely raise the limit?"
- "Project this tag's runway by weekday — accounting for the fact that sends drop on Saturdays. When do we run dry given the current schedule?"

### Campaign performance, step fatigue, variant winners

- "For the top three active campaigns by 14-day volume, rank step+variant winners by unique reply rate when step coverage is dense, and by opportunity rate when it isn't. Tell me which basis you used."
- "Find step fatigue in our 5-step sequence. Where do replies drop off? Where does the negative reply share start exceeding the positive reply share?"
- "Compare two campaigns with similar audiences. Tell me what's different — daily limit, sender inventory, schedule, copy length, step delays — and which difference best explains the reply-rate gap."

### Copy, personalization, and template QA

- "Audit the last 50 reconstructed outbound samples for unresolved `{{...}}` tokens. Group by step+variant and tell me how many leads were affected."
- "Diff the live template body for Step 0 variant A against the variant that was running last sync. Which words changed, and did the reply-outcome mix change with it?"
- "Take the live templates for campaign X, the rendered outbound samples I actually sent, and the fetched inbound replies. Tell me which sentence in Step 0 is doing the work and which one is killing positive responses."

### Reply patterns, themes, and outcome-aware quoting

- "Run `fetch_reply_text` for campaign X, then summarize positive vs. negative reply themes from the fetched bodies. Quote three representative replies of each, with `reply_email_i_status`."
- "Across all campaigns, what's the share of `wrong_person` replies? Which campaigns over-index, and what's the common job-title pattern in the recipients?"
- "Are auto-replies inflating our reply rate? Show me unique replies excluding `is_auto_reply = TRUE`, and what that does to each campaign's effective reply rate."

### ICP signals from sampled lead payloads

- "For campaign `Demo CFOs - Midwest`, inventory the custom payload keys present on sampled leads. Flag the keys that appear more often in replying or positive leads, and propose the next single-variable test."
- "For payload key `employee_band` in this campaign, which values correlate with positive outcomes in the sample? Treat the result as a hypothesis, not a population claim."
- "Do `finance_stack`-populated leads outperform empty ones in this campaign? If yes, draft an enrichment-or-suppression rule for the next list pull."

### Deliverability, sender health, inbox placement

- "Roll up SPF / DKIM / DMARC failures and blacklist hits per sender across the last 100 inbox-placement rows. Recommend pause / inspect / rotate per inbox."
- "Which senders are landing in spam or category folders? Cross-reference with `accounts.warmup_status` and 30-day bounce rate to decide whether the issue is auth, warmup, or content."
- "For tag `Series-B-SaaS`, list the resolved sender inventory per campaign, flag any account over 5% bounce in the last 30 days, and tell me whether sender coverage is `covered`, `partial`, or `missing`."

### Launch QA and experiment planning

- "Is campaign `Q3 Series-B GTM` ready to turn on? Block on missing senders, missing templates, blank bodies, or open/link tracking; warn on anything else."
- "For every active campaign, recommend the next test lane — copy, ICP, reply quality, lead supply, or deliverability — based on exact metrics plus evidence coverage. Don't recommend copy tests on campaigns with unresolved deliverability blockers."
- "Plan the next experiment for campaign X end-to-end: hypothesis, change, target cohort, success metric, guardrail metric, stop condition, owner, evaluation date — anchored in the evidence you just looked at."

### Tag-scoped multi-client analysis (agencies)

- "Resolve which campaigns belong to tag `Acme Inc`, then run the full weekly brief just for that tag. Output one client-safe page and one internal page."
- "Across all client tags, which clients have the worst sender-coverage gap right now? Sort by `missing_sender_inventory` first, then `partial_account_daily_metrics`."

Every one of these maps to a real, named recipe in [`plugin/query-recipes.ts`](./plugin/query-recipes.ts), backed by a real view in [`plugin/local-db.ts`](./plugin/local-db.ts). The model isn't guessing — it's running ranked SQL and explaining ranked rows.

## End-to-end workflow examples

### Monday-morning agency stand-up (2 minutes of typing, ~10 minutes of agent work)

```text
/sendlens-setup
Refresh the workspace.
Use the account-manager-brief skill. For each client tag, produce:
1) a client-safe weekly update (wins, risks, current actions, asks, next review date),
2) an internal action queue ranked by attention reason,
3) a one-line "do this Monday" recommendation.
Quote sender bounce rates and reply rates exactly. Caveat anything sampled.
```

You get one document per client, ready to paste into Slack or email.

### "Why is this campaign suddenly under-performing?"

```text
Use the campaign-performance skill on "Q3 Series-B GTM".
Pull step+variant winners, step fatigue, and the last 30 days of campaign-attributed daily volume.
Then run fetch_reply_text and pull the reply outcome feed.
Tell me whether the drop is a copy issue, a sender-health issue, an audience issue, or a runway issue — and quote the evidence row that convinced you.
```

The agent walks the layered evidence, picks the right recipe at each step, and writes a verdict you can defend.

### Pre-launch QA before scaling spend

```text
Use the campaign-launch-qa skill on every campaign currently in `paused` status.
Block launches with missing senders, missing templates, blank bodies, or open/link tracking.
Warn on senders over 5% 30-day bounce, missing schedule timezone, or fewer than 5 days of new-lead runway at the configured daily limit.
Output a launch-readiness table sorted worst-first.
```

### One-shot ICP test plan

```text
Use the icp-signals skill on "Demo CFOs - Midwest".
Inventory payload keys on sampled leads. Identify the single key whose presence most correlates with positive outcomes. Pick the top candidate value. Draft the next single-variable test with hypothesis, target cohort, success metric, guardrail, stop condition, and evaluation date.
Treat the analysis as a hypothesis, not a population claim, and say so.
```

## What makes the answer trustworthy

Most "AI for analytics" tools blur exact aggregates with sampled evidence. SendLens labels every recipe `exact`, `sampled`, or `hybrid`, and the skills are required to surface the basis when they answer.

- **Exact**: campaign analytics, daily metrics, account warmup/bounce stats, inbox-placement analytics, tag mappings, fetched inbound reply bodies.
- **Sampled**: lead-level payload signals, reconstructed outbound copy (template + lead variables), payload-key correlations.
- **Hybrid**: anything that joins the two — reply outcome feeds, variant outcomes, tag-scoped lead comparisons.

When the model uses sampled evidence, it says so. When it uses exact aggregates, it says so. When the data isn't there yet, it says *that*, instead of guessing — and tells you which sync or fetch to run.

## Try it without real data

Synthetic demo workspace, no Instantly key required:

```bash
SENDLENS_DEMO_MODE=1 npm run demo:seed
```

Then ask:

```text
Use the workspace-health skill on the demo workspace. Then run the experiment-planner skill against the highest-performing demo campaign.
```

Demo data is synthetic and labeled as such in every output.

## Install

Latest release: [release page](https://github.com/orchidautomation/sendlens-plugin/releases/latest)

Copy-paste installers:

```bash
# Claude Code
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-claude-code.sh | bash

# Cursor
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-cursor.sh | bash

# Codex
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-codex.sh | bash

# OpenCode
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-opencode.sh | bash

# All supported hosts
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-all.sh | bash
```

Direct bundles:

- [Claude Code](https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/sendlens-claude-code-latest.tar.gz)
- [Cursor](https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/sendlens-cursor-latest.tar.gz)
- [Codex](https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/sendlens-codex-latest.tar.gz)
- [OpenCode](https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/sendlens-opencode-latest.tar.gz)

## First run

```text
/sendlens-setup
```

From a local checkout:

```bash
npm run doctor
```

Setup verifies runtime, working folder, and credentials (or demo mode).

## Privacy in plain English

SendLens is built so the core workflow stays on your machine.

- Read-only analysis paths.
- Working data stored locally in DuckDB.
- No Orchid-hosted database is required for normal use.
- Demo mode runs without production credentials.
- When your AI host asks SendLens a question, the answer becomes part of that host session — same as any other tool result.

Local state defaults:

- analysis database: `~/.sendlens/workspace-cache.duckdb`
- refresh status: `~/.sendlens/refresh-status.json`
- setup and refresh logs: `~/.sendlens/session-start-refresh.log`

Full data-handling model: [Trust and privacy](./docs/TRUST_AND_PRIVACY.md).

## Connectors

This release supports **Instantly** as the first data source: campaigns, daily metrics, step analytics, sender accounts, account daily metrics, custom tags, inbox-placement tests + analytics, sampled leads with custom payloads, sampled reconstructed outbound, and on-demand reply-text hydration.

The semantic-view layer is intentionally connector-agnostic, so the same skills keep working as more sources are added.

## Who builds SendLens

SendLens is built by **Orchid Labs**, the product division of **Orchid Automation** ([orchidautomation.com](https://orchidautomation.com)). Have a custom connector idea, an agency use case, or feedback on the analysis layer? Open an issue on this repo.

## What ships in this repo

- installable bundles for Claude Code, Cursor, Codex, OpenCode
- setup, doctor, and demo-mode flows
- nine specialist analysis skills with reference docs
- the local DuckDB warehouse, semantic views, and recipe library
- agents (campaign analyst, copy auditor, ICP auditor, reply auditor, synthesis reviewer, workspace triager)
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

## Developer quickstart

```bash
git clone https://github.com/orchidautomation/sendlens-plugin.git
cd sendlens-plugin
npm install
cp .env.example .env
```

For real workspace analysis:

```bash
SENDLENS_INSTANTLY_API_KEY=your_key
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
pluxx build --target claude-code cursor codex opencode
pluxx verify-install --target claude-code cursor codex opencode
```

Landing page:

```bash
npm run site:install
npm run site:dev
```

## Client-scoped env support

Env loading order supports named client overlays:

1. `.env`
2. `.env.local`
3. `.env.clients/<client>.env`
4. `.env.clients/<client>.local.env`

Use `SENDLENS_CLIENT` to load a client-specific overlay. This is what makes a single laptop usable across many client workspaces.
