# SendLens

**The outbound analyst that lives inside the AI tool you already use.**

SendLens turns your Instantly account into something you can talk to. Ask a question in plain English inside Claude Code, Cursor, Codex, or OpenCode, and you get a clear, evidence-backed answer about your actual campaigns, your actual senders, and what your actual prospects are saying back.

No spreadsheets. No dashboards. No SQL. Just answers.

## Why this matters

Cold outbound data is scattered across campaign totals, sender health, replies, lead fields, daily volume, tags, and deliverability tests. SendLens pulls that into a local DuckDB cache and gives your AI tool a set of specialist plays for answering the questions that usually take a senior analyst hours.

It can:

- compare campaigns and tell you which one to scale, kill, or rewrite
- rank the steps and copy variants that are actually doing the work
- separate genuine human replies from auto-responders and out-of-office noise
- surface tracking, bounce-protection, sender, and inbox-placement risk before launch
- project how many days of sending you have left before you run out of leads
- read replies and lead fields for patterns, objections, and ICP signals
- write client-safe account-manager briefs

You don't need to know how anything is stored, or what to call any of this. You ask in plain language. SendLens picks the right play and answers.

## What you can actually ask

These are the kinds of questions SendLens can answer today:

- "Rank every active campaign by what most needs attention: bounce risk, lead runway, missing senders, low replies, or stopped sending."
- "For my Q2 CFOs tag, where am I under-using sending capacity, and which campaigns are starving the others?"
- "For every active campaign in this tag, tell me how many days of new prospects I have left before I run dry."
- "For my top three campaigns, rank the winning steps and copy variants, and tell me how confident the answer is."
- "Audit my sent-email samples for unfilled personalization tokens, blank rendered bodies, and the affected step/variant."
- "Pull the latest replies for this campaign and summarize positive vs. negative themes. Quote representative replies."
- "Which custom lead fields show up more often on prospects who reply positively? Treat it as a hypothesis."
- "Which senders are landing in spam or categories in inbox-placement tests, and is the issue authentication, warmup, or content?"
- "For every campaign, show whether open tracking, link tracking, ESP matching, bounce protection, risky contacts, and unsubscribe headers are on."
- "Build this week's account-manager brief: wins, risks, current actions, client asks, and next review date."

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

Copy-paste installers — pick the AI tool you use:

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

Want to try SendLens without connecting Instantly? Choose demo mode during `/sendlens-setup`. If you are developing from a cloned repo, use the demo seed command in the developer quickstart below.

## Privacy in plain English

- SendLens is read-only. It never sends emails or changes anything in your Instantly account.
- Your data stays on your computer. Nothing is uploaded to a server we run.
- Demo mode works without connecting any real account.
- Whatever question you ask, the answer becomes part of the conversation in your AI tool — same as anything else you type there.

Full data-handling details: [Trust and privacy](./docs/TRUST_AND_PRIVACY.md).

## What it works with today

This release works with **Instantly** — campaigns, daily metrics, senders, custom tags, deliverability tests, lead details, and reply text.

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
SENDLENS_INSTANTLY_API_KEY=your_key
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
pluxx build --target claude-code cursor codex opencode
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
