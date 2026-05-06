# SendLens

**An outbound analyst that lives inside the AI tool you already use.**

SendLens turns your Instantly workspace into something you can talk to. Ask a question in plain English inside Claude Code, Cursor, Codex, or OpenCode, and you get the kind of grounded, evidence-backed answer a senior growth-ops hire would write — about your actual campaigns, your actual senders, and what your actual prospects are saying back.

## Why this matters

Outbound teams are sitting on rich data that nobody has time to dig through. Dashboards show what happened. Spreadsheets get stale by Friday. Most "AI for cold email" stops at one-line tips against a generic prompt.

SendLens is different because it does the analyst's homework for you before the AI ever sees the question. It already knows how to compare campaigns, rank step and variant winners, surface deliverability risk, separate human replies from auto-noise, project lead runway, and call out when an answer is based on exact numbers vs. a sample. You just ask.

The result: one analyst-quality answer per question, with the work shown, in the time it takes to type the question.

## Who it is for

- **Growth marketers** who need a defensible read on which campaign to scale, kill, or rewrite.
- **GTM engineers** who want a programmable layer over their outbound stack without standing up a data warehouse.
- **Agencies** running 10–100 client workspaces who need client-safe weekly briefs and an internal action queue from the same data pull.
- **Founders and operators** who want one analyst-quality answer per week instead of ten dashboards.
- **RevOps and sales leaders** trying to understand why positive replies aren't converting, and which step or variant is actually doing the work.

You don't need to know anything about how the data is stored or which question maps to which analysis. You ask in plain language; SendLens picks the right play.

## What you can actually ask

The kinds of questions you can ask are far deeper than a typical "AI for outbound" tool. A sample:

### Workspace triage and weekly rollups

- "Rank every active campaign by what most needs my attention. Tell me which are at high bounce risk, dry on new prospects, missing a sender, or have no recent volume — then write a one-paragraph client-safe brief for each."
- "Build this week's account-manager brief: wins, risks, current actions, asks, and next review date."
- "For my Q2 CFOs tag, give me daily sender volume vs. what each campaign is configured to send. Where am I under-utilizing capacity, and which campaigns are starving the others?"
- "Compare campaign-attributed daily volume to sender-attributed daily volume for my Series-B SaaS tag. If they diverge, tell me whether the gap is a campaign-side under-send or a sender-side spillover into other campaigns."

### Lead runway and pacing

- "For every active campaign in my mid-market RevOps tag, project new-lead runway in sending days. Flag anything under 5 days of runway and propose a refill order."
- "Which campaigns have I been sending on every available sending day for the last 30 days, and what is the real per-campaign daily ceiling vs. the limit I configured? Where can I safely raise the limit?"
- "Project this tag's runway by weekday — accounting for the fact that sends drop on weekends. When do I run dry given the current schedule?"

### Campaign performance, step fatigue, and variant winners

- "For my top three active campaigns by recent volume, rank step and variant winners by reply rate when there's enough data, and by opportunity rate when there isn't. Tell me which one you used and why."
- "Find step fatigue in my 5-step sequence. Where do replies drop off? Where does the negative-reply share start exceeding the positive-reply share?"
- "Compare two campaigns with similar audiences. Tell me what's different — daily limit, sender inventory, schedule, copy length, step delays — and which difference best explains the reply-rate gap."

### Copy, personalization, and template QA

- "Audit the last 50 outbound samples for unresolved personalization tokens. Group by step and variant and tell me how many leads were affected."
- "Diff the live template body for Step 0 variant A against the variant that was running last sync. Which words changed, and did the reply mix change with it?"
- "Take the live templates for this campaign, the actual outbound that went out, and the inbound replies. Tell me which sentence in Step 0 is doing the work and which one is killing positive responses."

### Reply patterns, themes, and outcome-aware quoting

- "Pull the latest reply text for this campaign and summarize positive vs. negative themes. Quote three representative replies of each."
- "Across all campaigns, what's the share of wrong-person replies? Which campaigns over-index, and what is the common job-title pattern in the recipients?"
- "Are auto-replies inflating my reply rate? Show me unique replies excluding auto-responders, and what that does to each campaign's effective reply rate."

### ICP signals from sampled lead data

- "For my Demo CFOs Midwest campaign, inventory the custom fields present on sampled leads. Flag the fields that appear more often in replying or positive leads, and propose the next single-variable test."
- "For the employee-band field in this campaign, which values correlate with positive outcomes in the sample? Treat the result as a hypothesis, not a population claim."
- "Do leads with a populated finance-stack field outperform empty ones in this campaign? If yes, draft an enrichment-or-suppression rule for the next list pull."

### Deliverability, sender health, and inbox placement

- "Roll up SPF, DKIM, DMARC failures and blacklist hits per sender across the last 100 inbox-placement rows. Recommend pause, inspect, or rotate per inbox."
- "Which senders are landing in spam or category folders? Cross-reference with warmup status and 30-day bounce rate to decide whether the issue is auth, warmup, or content."
- "For my Series-B SaaS tag, list the senders assigned to each campaign, flag any account over 5% bounce in the last 30 days, and tell me whether sender coverage looks complete, partial, or missing."

### Launch QA and experiment planning

- "Is my Q3 Series-B GTM campaign ready to turn on? Block on missing senders, missing templates, blank bodies, or open and link tracking; warn on anything else."
- "For every active campaign, recommend the next test lane — copy, ICP, reply quality, lead supply, or deliverability — based on the actual numbers and how much evidence we have. Don't recommend copy tests on campaigns with unresolved deliverability blockers."
- "Plan the next experiment for this campaign end-to-end: hypothesis, change, target cohort, success metric, guardrail metric, stop condition, owner, and evaluation date — anchored in the evidence you just looked at."

### Tag-scoped multi-client analysis (agencies)

- "Resolve which campaigns belong to my Acme Inc tag, then run the full weekly brief just for that tag. Output one client-safe page and one internal page."
- "Across all my client tags, which clients have the worst sender-coverage gap right now?"

## End-to-end workflow examples

### Monday-morning agency stand-up (2 minutes of typing, ~10 minutes of agent work)

```text
/sendlens-setup
Refresh the workspace.
Use the account-manager-brief skill. For each client tag, produce:
1) a client-safe weekly update (wins, risks, current actions, asks, next review date),
2) an internal action queue ranked by what most needs attention,
3) a one-line "do this Monday" recommendation.
Quote sender bounce rates and reply rates exactly. Caveat anything that came from a sample.
```

You get one document per client, ready to paste into Slack or email.

### "Why is this campaign suddenly under-performing?"

```text
Use the campaign-performance skill on "Q3 Series-B GTM".
Pull step and variant winners, step fatigue, and the last 30 days of daily volume.
Then pull the latest reply text and the reply-outcome feed.
Tell me whether the drop is a copy issue, a sender-health issue, an audience issue, or a runway issue — and quote the evidence that convinced you.
```

The agent walks the evidence, picks the right play at each step, and writes a verdict you can defend.

### Pre-launch QA before scaling spend

```text
Use the campaign-launch-qa skill on every campaign currently paused.
Block launches with missing senders, missing templates, blank bodies, or open and link tracking.
Warn on senders over 5% 30-day bounce, missing schedule timezone, or fewer than 5 days of new-lead runway at the configured daily limit.
Output a launch-readiness table sorted worst-first.
```

### One-shot ICP test plan

```text
Use the icp-signals skill on "Demo CFOs - Midwest".
Inventory the custom fields on sampled leads. Identify the single field whose presence most correlates with positive outcomes. Pick the top candidate value. Draft the next single-variable test with hypothesis, target cohort, success metric, guardrail, stop condition, and evaluation date.
Treat the analysis as a hypothesis, not a population claim, and say so.
```

## What makes the answer trustworthy

Most "AI for analytics" tools blur exact totals with sampled evidence. SendLens never does. Every answer tells you whether it's based on:

- **Exact numbers** — campaign totals, daily metrics, account warmup and bounce stats, inbox-placement results, tag mappings, and the actual fetched text of inbound replies.
- **A sample** — lead-level signals, custom fields on sampled leads, and outbound copy reconstructed from your templates plus the lead variables.
- **A mix of the two** — like reply outcomes by variant, where the totals are exact but the copy is reconstructed.

When the data isn't there yet, SendLens says *that*, instead of guessing — and tells you exactly which refresh or fetch to run.

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
- Working data is cached locally in your home folder.
- No hosted database is required for normal use.
- Demo mode runs without production credentials.
- When your AI host asks SendLens a question, the answer becomes part of that host session — same as any other tool result.

Local state lives under `~/.sendlens/`.

Full data-handling model: [Trust and privacy](./docs/TRUST_AND_PRIVACY.md).

## Data sources

This release works with **Instantly**: campaigns, daily metrics, step analytics, sender accounts, account daily metrics, custom tags, inbox-placement tests and analytics, sampled leads with custom fields, sampled outbound, and on-demand reply-text fetching.

## Who builds SendLens

SendLens is built by **Orchid Labs**, the product division of **Orchid Automation** ([orchidautomation.com](https://orchidautomation.com)). Have an idea, an agency use case, or feedback on the analysis? Open an issue on this repo.

## What ships in this repo

- installable bundles for Claude Code, Cursor, Codex, OpenCode
- setup, doctor, and demo-mode flows
- nine specialist analysis skills with reference docs
- a library of pre-built analyses covering performance, copy, replies, ICP signals, launch QA, deliverability, and account-manager workflows
- analyst agents (campaign analyst, copy auditor, ICP auditor, reply auditor, synthesis reviewer, workspace triager)
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
