# SendLens

**The outbound analyst that lives inside the AI tool you already use.**

SendLens turns your Instantly account into something you can talk to. Ask a question in plain English inside Claude Code, Cursor, Codex, or OpenCode, and you get a clear, evidence-backed answer about your actual campaigns, your actual senders, and what your actual prospects are saying back.

No spreadsheets. No dashboards. No SQL. Just answers.

## Why this matters

If you run cold outbound, you already know the problem. The numbers exist, but pulling them together to get a real answer takes hours — and by the time the answer is ready, the week has already moved on.

SendLens is different because it does the analyst's homework before you ever ask the question. It already knows how to:

- compare campaigns and tell you which one to scale, kill, or rewrite
- rank the steps and copy variants that are actually doing the work
- separate genuine human replies from auto-responders and out-of-office noise
- spot deliverability problems before they tank a launch
- project how many days of sending you have left before you run out of leads
- read the replies your prospects are sending and tell you the patterns
- write a client-safe weekly update for every account you manage

You ask one question. You get one analyst-quality answer, with the work shown, in the time it takes to type the question.

## Who it is for

- **Growth marketers** who need a defensible read on which campaign to scale, kill, or rewrite.
- **Sales leaders** who want to know why positive replies aren't converting and which step or variant is actually doing the work.
- **Founders and operators** who want one good answer per week instead of ten dashboards.
- **Agencies** running 10–100 client accounts who need a client-safe weekly update for each one without burning a day building it.
- **Anyone running cold outbound** who is tired of staring at numbers and is ready to just have a conversation about them.

You don't need to know how anything is stored, or what to call any of this. You ask in plain language. SendLens picks the right play and answers.

## What you can actually ask

These are the kinds of questions SendLens can answer today. Read a few — most outbound tools can't touch this depth.

### Weekly triage and account-manager briefs

- "Rank every active campaign by what most needs my attention. Tell me which are at risk of bouncing, dry on new prospects, missing a sender, or have stopped sending — then write a one-paragraph client-safe update for each."
- "Build this week's account-manager brief: wins, risks, what we're doing now, what we need from the client, and the next review date."
- "For my Q2 CFOs tag, where am I under-using my sending capacity, and which campaigns are starving the others?"

### Lead runway and pacing

- "For every active campaign in my mid-market RevOps tag, tell me how many days of new prospects I have left before I run dry. Flag anything under 5 days and propose a refill order."
- "Which campaigns have I been sending on every available day for the last 30 days? Where can I safely raise the daily limit?"
- "Project my runway by weekday — accounting for the fact that sends drop on weekends. When do I run out of leads?"

### Campaign performance, step fatigue, and copy winners

- "For my top three campaigns, rank the winning steps and copy variants — and tell me how confident the answer is."
- "Find step fatigue in my 5-step sequence. Where do replies drop off? Where do the negative replies start outweighing the positive ones?"
- "Compare two campaigns with similar audiences. Tell me what's different — daily limit, senders, schedule, copy length, step delays — and which difference best explains the reply-rate gap."

### Copy and personalization QA

- "Audit my last 50 sent emails for unfilled personalization tokens. Group by step and tell me how many leads were affected."
- "Diff the live opener for Step 0 against the version that was running last week. Which words changed, and did the reply mix change with it?"
- "Take the live templates, the actual emails I sent, and the replies that came back. Tell me which sentence in Step 0 is doing the work and which one is killing positive responses."

### Reply themes and patterns

- "Pull the latest replies for this campaign and summarize positive vs. negative themes. Quote three representative replies for each."
- "Across all my campaigns, what's the share of wrong-person replies? Which campaigns over-index, and what is the common job-title pattern?"
- "Are auto-replies inflating my reply rate? Show me unique replies excluding auto-responders, and what that does to each campaign's effective number."

### ICP signals — who actually replies

- "For my Demo CFOs Midwest campaign, look at the custom fields on my leads. Which fields appear more often on the prospects who replied positively? Propose the next single-variable test."
- "For the employee-band field in this campaign, which values are correlating with positive outcomes? Treat the result as a hypothesis, not a final verdict."
- "Do leads with a populated finance-stack field outperform empty ones? If yes, draft an enrichment-or-suppression rule for the next list pull."

### Deliverability and sender health

- "Roll up email authentication failures and blacklist hits per sender across my last 100 inbox-placement results. Recommend pause, inspect, or rotate for each inbox."
- "Which senders are landing in spam or the Promotions tab? Cross-reference with warmup status and 30-day bounce rate to decide whether the issue is authentication, warmup, or content."
- "For my Series-B SaaS tag, list the senders assigned to each campaign, flag any account over 5% bounce in the last 30 days, and tell me whether sender coverage looks complete, partial, or missing."

### Launch QA and experiment planning

- "Is my Q3 Series-B GTM campaign ready to turn on? Block the launch if it's missing senders, missing templates, has blank bodies, or has open and link tracking on. Warn on anything else."
- "For every active campaign, recommend the next test — copy, audience, reply handling, lead supply, or deliverability — based on the actual numbers. Don't recommend a copy test on a campaign with deliverability problems."
- "Plan the next experiment for this campaign end-to-end: hypothesis, change, target audience, success metric, guardrail, stop condition, owner, evaluation date — anchored in the evidence you just looked at."

### Multi-client analysis (agencies)

- "Resolve which campaigns belong to my Acme Inc tag, then run the full weekly brief just for that tag. Output one client-safe page and one internal page."
- "Across all my client tags, which clients have the worst sender-coverage gap right now?"

## The heavy hitters — questions only this dataset can answer

Most of these are genuinely impossible to answer in the Instantly UI, in a generic dashboard, or by handing a CSV to ChatGPT. They work in SendLens because SendLens has the templates you wrote, the actual personalized emails that went out, the replies that came back with the prospect's full text and outcome (positive, negative, wrong-person, out-of-office, won, meeting-booked), the deliverability seed-test results, the senders behind every email, and every custom field on every lead — all joined at the lead level.

### Sentence-level reply attribution

"Take my top variant by positive reply rate. Read the actual replies it earned. Tell me which sentence in my email each prospect referenced or responded to — what's working at the line level. Then read the negative replies for the same variant and tell me which sentence triggered each objection. Output two ranked lists: sentences pulling their weight, sentences that need to go."

### Meeting-booked field fingerprint

"Look at every lead with a meeting-booked or won outcome. Compare their custom fields against the leads who replied negatively. Find the smallest combination of 2 or 3 field values that's present in 80%+ of meeting-booked leads but in less than 20% of leads who replied negatively. That's the fingerprint of a buyer in my pipeline — draft my next list spec around it."

### Inbox vs. conversion crossover by mailbox provider

"For each recipient mailbox provider — Gmail, Outlook, Yahoo, work domains — compare my positive reply rate against how my senders are actually placing in seed tests for that same provider. Where am I winning the inbox but losing the conversation? Where am I getting filtered by a provider whose users would have replied positively if I'd reached them? That second bucket is hidden lost revenue. Quantify it."

### Wrong-person referral mining

"Read every reply marked 'wrong person' from the last 90 days. Extract who they're referring me to — the job title, the team, sometimes a name. Tell me the top 5 referral targets I'm being routed to most often, then compare that to the job titles of leads who replied positively. Should my next list pull shift to the referral title, or are the wrong-person replies a sign my list is broken at a deeper level?"

### Personalization break cost

"Compare reply rate and positive-reply rate between leads who got a fully personalized opener and leads where the personalization fell back to a default or leaked an unfilled token. Quantify the gap in real numbers. Then tell me which personalization fields actually drive the lift and which are decorative — so I know which enrichment to keep paying for and which to drop."

### Per-sender placement-test vs. real-world divergence

"For each of my senders, line up their inbox-placement spam rate against their actual reply rate over the last 30 days. Tell me which senders pass placement but still earn no replies — that's a copy or audience problem, not deliverability. Tell me which senders fail placement and I never connected the dots — that's deliverability silently bleeding me out. Recommend pause, inspect, or rotate per sender."

### Auto-reply contamination diagnosis

"Find the campaigns where stripping out auto-replies and out-of-office responses drops the reply rate by more than 30%. For each, tell me whether the inflation is a *targeting* problem (lots of wrong-person replies hiding in the noise) or a *timing* problem (lots of out-of-office replies suggesting I'm sending during their industry's vacation cycle). Then tell me what to fix per campaign."

### Reply-rate forensics — day-by-day timeline rewind

"My reply rate dropped from 4.2% to 1.8% over the last 14 days. Walk back the timeline day by day across four dimensions: campaign-level reply rate, per-sender daily volume and bounce, copy-variant changes, and lead-batch quality (look at the custom-field shape of the leads contacted each day). Tell me which dimension shifted first, on which exact day, and quote the evidence that proves it. Don't tell me 'it could be any of these' — pick one and defend it."

### Objection-to-step-to-variant triangulation

"Read every negative reply from the last 30 days and cluster the objections — timing, budget, wrong person, already using a competitor, value unclear. For each cluster, tell me which step in the sequence it comes from most, which copy variant triggers it most, and the job-title and company-size pattern of the prospects sending it. Then split the objections into two buckets: ones I can fix with a copy change vs. ones that signal a list problem. Output a fix plan ranked by impact."

### Send-window analysis with volume normalization

"Map every positive reply to the day-of-week and hour-of-day the original email was sent. Do the same for negative replies. Then normalize against how much volume I sent in each window so I'm measuring conversion rate, not absolute count. Tell me my golden send window, my dead send window, and how much reply rate I'd gain by reallocating the dead window's volume into the golden window."

### Interest-status pipeline anatomy

"Bucket every lead by their final outcome — won, meeting completed, meeting booked, interested, neutral, out-of-office, not interested, wrong person, lost, no-show. For each bucket, tell me the median step at which they replied, the median length of their reply, and the most common job-title pattern. Tell me at which step my pipeline actually generates revenue — not just opens or replies — and whether shortening my sequence would cost me real bookings."

### Tag-scoped composite scoreboard

"For my Series-B SaaS tag, build a single scoreboard for every active campaign that combines positive reply rate, sender-coverage health, days of new-lead runway, recent volume vs. configured capacity, and inbox-placement clean rate. Weight them however makes sense and explain the weights. Rank the campaigns. Tell me my one campaign to scale, my one to pause, and my one to rebuild — with the evidence that drove each verdict."

## Real workflow examples

### Monday-morning agency stand-up (2 minutes of typing, ~10 minutes of work for SendLens)

Type something like this into your AI tool:

```text
Refresh my workspace. For each client tag, give me:
1) a client-safe weekly update (wins, risks, current actions, asks, next review date),
2) an internal action queue ranked by what most needs attention,
3) a one-line "do this Monday" recommendation.
Quote bounce rates and reply rates exactly. Caveat anything that came from a sample.
```

You get one document per client, ready to paste into Slack or email.

### "Why is this campaign suddenly under-performing?"

```text
Look at "Q3 Series-B GTM". Pull the winning steps and copy variants, where in the sequence replies are dropping off, and the last 30 days of daily volume. Then pull the latest replies and read them.
Tell me whether the drop is a copy issue, a sender-health issue, an audience issue, or a runway issue — and quote the evidence that convinced you.
```

SendLens walks the evidence, picks the right move at each step, and writes a verdict you can defend.

### Pre-launch QA before scaling spend

```text
Look at every campaign currently paused. Block any launch with missing senders, missing templates, blank bodies, or open and link tracking on. Warn me about senders over 5% bounce in the last 30 days, missing schedule timezone, or fewer than 5 days of new-lead runway.
Output a launch-readiness table sorted worst-first.
```

### One-shot ICP test plan

```text
For "Demo CFOs - Midwest", look at the custom fields on the leads who replied positively. Pick the single field most correlated with positive outcomes. Pick the top value within that field. Draft the next test: hypothesis, target audience, success metric, guardrail, stop condition, evaluation date.
Treat it as a hypothesis, not a final answer, and say so.
```

## Why you can trust the answer

Most "AI for analytics" tools blur the difference between exact totals and an educated guess from a sample. SendLens never does. Every answer tells you whether it came from:

- **Exact numbers** — campaign totals, daily metrics, sender bounce stats, deliverability results, and the actual text of replies.
- **A sample** — patterns across a representative slice of your leads, when the full set is too big to look at every row.
- **A mix of the two** — for example, exact reply totals broken down by reconstructed copy.

When the data isn't there yet, SendLens says *that*, instead of guessing — and tells you exactly what to do next.

## Try it without real data

Want to see the experience before connecting your account? There's a synthetic demo built in:

```bash
SENDLENS_DEMO_MODE=1 npm run demo:seed
```

Then ask:

```text
Walk me through what's happening in this workspace, then plan the next experiment on the best-performing campaign.
```

The demo data is made up, and SendLens labels it as such in every answer.

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
