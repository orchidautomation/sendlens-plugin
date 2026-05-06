# Synthetic Example Outputs

All examples on this page are synthetic. Campaign names, metrics, copy, segments, and replies are demo placeholders and are not customer data. Use these examples for output shape and evidence language only, not as performance benchmarks.

Related: [catalog](../CATALOG.md), [skill docs](../skills/README.md), [trust and privacy](../TRUST_AND_PRIVACY.md).

## Workspace Health

```text
Current read
The Demo CFO workspace has 4 active campaigns. Two are producing most positive replies, one has a bounce risk, and one is too new to judge. The best next deep dive is "Demo CFOs - Midwest" because it has the highest unique reply rate and enough recent volume to inspect steps.

Top risks
1. "Demo Finance Ops - Q2" has a synthetic bounce rate of 3.4%, above the 2% attention threshold.
2. Sender coverage is missing for one active campaign, so capacity and deliverability conclusions are limited there.
3. Inbox-placement tables are empty in this demo cache, which means no local inbox-placement evidence is available.

Next actions
1. QA sender assignments on "Demo Finance Ops - Q2" before scaling.
2. Load "Demo CFOs - Midwest" for step and copy analysis.
3. Run a tag-scoped snapshot after the next refresh if this workspace recently changed tags.

Caveat
Campaign/account metrics are synthetic exact aggregates in this example. Lead-level evidence would still need sampled-evidence caveats.
```

## Campaign Performance

```text
Verdict
"Demo CFOs - Midwest" is the current winner by synthetic unique reply rate. Step ranking uses opportunity rate because step-level unique replies are sparse in this demo surface.

Winners
- Step 0 variant A has the strongest opportunity rate at 4.8%.
- Step 2 still contributes positive outcomes, so the sequence should not be shortened before testing the opener.

Underperformers
- Variant C has similar send volume but lower opportunity rate and more negative outcomes.

Runway
The campaign is not out of send volume. It has limited new-prospect runway, but follow-up volume continues for contacts already in sequence.

Caveat
Headline campaign metrics are synthetic exact aggregates. Variant interpretation depends on available step analytics and template joins.
```

## Copy Analysis

```text
What is helping
The synthetic opener that references a specific finance workflow has stronger positive outcomes than the generic growth opener.

What is hurting
The third sentence asks for a meeting before the value is clear. Negative replies cluster around the variant that uses that ask earliest.

Personalization QA
One rendered sample includes "{{company_category}}" unresolved. This is locally reconstructed copy, not guaranteed delivered email text, but it is enough to QA the variable path.

Change to test
Keep the workflow-specific first line. Replace the early meeting ask with a one-sentence relevance check.

Caveat
Copy samples are reconstructed from demo templates and demo lead variables.
```

## ICP Signals

```text
Directional signal
In the synthetic sampled evidence, finance teams at 200-800 employee companies show more positive outcomes than smaller companies.

Weak signal
Geography does not look meaningful in this sample. The difference is too small to use as a targeting rule.

Payload keys to inspect next
- employee_band
- finance_stack
- hiring_signal

Suggested test
Run the next segment test on companies with employee_band = "200-800" and a populated finance_stack field.

Caveat
This is sampled campaign-scoped evidence. It is a hypothesis for the next test, not a full-population ICP conclusion.
```

## Reply Patterns

```text
Outcome mix
The demo campaign has positive, negative, and wrong-person outcomes. Out-of-office replies are excluded from this read.

Positive themes
- The workflow pain is recognizable.
- The requested next step feels lightweight.

Negative themes
- Some leads say the timing is wrong.
- A few wrong-person replies point to finance operations rather than the CFO owner.

Next action
Test a routing line that lets recipients forward the note to the finance-ops owner without creating a hard bounce in the conversation.

Caveat
This example uses synthetic reply outcome labels. Do not quote actual reply wording unless `fetch_reply_text` has fetched `reply_body_text`.
```

## Campaign Launch QA

```text
Verdict
ready_with_warnings

Blockers
None in this synthetic example.

Warnings
1. Link tracking is enabled. For cold outbound, keep it off unless there is a specific reason.
2. Inbox-placement evidence is missing, so sender placement has not been validated locally.

Ready checks
- Active sender assignment exists.
- Lead supply is present.
- Step templates are populated.
- Schedule and timezone are configured.

Next actions
1. Disable link tracking before launch.
2. Run or import inbox-placement evidence if sender placement risk matters for this launch.
```

## Experiment Planner

```text
Recommended test lane
Copy test on Step 0 variant A versus a revised relevance-check opener.

Hypothesis
Reducing the early meeting ask will improve positive reply rate without increasing neutral replies.

Change
Keep the first-line personalization, remove the meeting ask, and add one relevance-check sentence.

Target cohort
New leads in the synthetic "Demo CFOs - Midwest" campaign.

Success metric
Unique positive reply rate.

Guardrail metric
Negative reply rate and bounce rate.

Stop condition
Evaluate after the campaign reaches the minimum agreed send volume or after two full sending weeks, whichever comes later.

Evidence basis
Synthetic exact campaign aggregates plus reconstructed outbound samples and sampled reply outcomes.
```

## Account Manager Brief

```text
Current read
The demo workspace has one clear winner, one campaign with bounce risk, and one campaign that needs more volume before interpretation.

Client-safe update
We are seeing the strongest response from the CFO-focused campaign and are tightening the next test around the opener. Before scaling the finance-ops campaign, we are checking sender setup and bounce risk so the next increase does not add avoidable deliverability pressure.

Internal action queue
1. Fix tracking and sender warnings on "Demo Finance Ops - Q2".
2. Load "Demo CFOs - Midwest" and prepare the Step 0 copy test.
3. Re-check workspace health after the next refresh.

Caveat
This is synthetic demo language. Real briefs should preserve only the evidence limitations that affect the client recommendation.
```
