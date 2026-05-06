# Generic Operator Playbooks

These initial playbooks are public-safe and generic. They are meant to guide SendLens operators without storing customer data.

Related: [schema](./SCHEMA.md), [catalog](../CATALOG.md), [skill docs](../skills/README.md), and [trust and privacy](../TRUST_AND_PRIVACY.md).

## Setup Friction

```yaml
id: sendlens-om-20260506-setup-friction
title: Tools missing after install usually means host reload, key, or bundle mismatch
status: active
visibility: public-oss
workflow: setup-friction
summary: When SendLens tools do not appear or return sparse data, first verify host reload, API key, installed target, refresh status, and local build health.
applies_when:
  - A user installed SendLens but does not see MCP tools.
  - A user sees an empty or stale workspace snapshot.
signals:
  - Missing `workspace_snapshot` or `refresh_status`.
  - `refresh_status` shows running, stale, or failed.
  - The active host does not match the installed bundle target.
do:
  - Run `/sendlens-setup` or `bash scripts/sendlens-doctor.sh` when setup tooling is available.
  - Reload or restart the host.
  - Confirm `SENDLENS_INSTANTLY_API_KEY` is set in the active environment.
  - Confirm the installed bundle target matches the host.
  - Use `refresh_status` before asking for another refresh.
  - Use the existing install and troubleshooting docs for exact commands.
avoid:
  - Do not paste private env values into public issues.
  - Do not inspect DuckDB rows as a substitute for MCP tool behavior in user-facing guidance.
evidence_basis:
  exact:
    - `refresh_status`
  operator_judgment:
    - host reload and install-target checks
caveats:
  - A running startup refresh is normal at session start.
safe_examples:
  - "Tools are not visible in Codex after install; reload Codex and verify the Codex bundle was installed."
related_docs:
  - ../CATALOG.md
  - ../TRUST_AND_PRIVACY.md
  - ../skills/sendlens-setup.md
last_reviewed: 2026-05-06
```

## Evidence Classification

```yaml
id: sendlens-om-20260506-evidence-classification
title: Classify every claim by exact, sampled, hybrid, reconstructed, fetched, or operator judgment
status: active
visibility: public-oss
workflow: evidence-classification
summary: SendLens answers should preserve the evidence class so operators do not turn samples or reconstructed copy into exact claims.
applies_when:
  - A response uses campaign metrics, lead evidence, reply evidence, payload variables, or rendered copy.
signals:
  - The answer mixes `campaign_overview`, `lead_evidence`, `reply_context`, and `rendered_outbound_context`.
do:
  - Call campaign/account/step/tag/inbox-placement aggregates exact only when they come from exact local surfaces.
  - Call non-reply lead evidence sampled.
  - Call rendered outbound copy reconstructed.
  - Call reply body text fetched only after `fetch_reply_text`.
  - Include caveats only when they affect the recommendation.
avoid:
  - Do not project full-population totals from sampled lead rows.
  - Do not imply reconstructed outbound copy is exact delivered email.
  - Do not infer deliverability health from reply rate alone.
evidence_basis:
  exact:
    - `campaign_analytics`
    - `step_analytics`
    - `accounts`
    - `custom_tags`
    - `inbox_placement_analytics`
  sampled:
    - `lead_evidence`
    - `lead_payload_kv`
  hybrid:
    - `campaign_overview`
    - `reply_context`
  reconstructed:
    - `rendered_outbound_context`
  fetched:
    - `reply_emails`
  operator_judgment:
    - evidence labeling discipline
caveats:
  - Exactness depends on which table or view is queried.
safe_examples:
  - "This is a sampled ICP signal, not a workspace-wide conclusion."
related_docs:
  - ../TRUST_AND_PRIVACY.md
  - ../skills/README.md
last_reviewed: 2026-05-06
```

## Copy Analysis

```yaml
id: sendlens-om-20260506-copy-analysis
title: Copy analysis should pick one campaign before judging templates
status: active
visibility: public-oss
workflow: copy-analysis
summary: Useful copy analysis depends on one campaign's intended templates, reconstructed outbound samples, and reply outcomes.
applies_when:
  - A user asks what to change in subject lines, body copy, or personalization.
signals:
  - The question mentions a campaign, step, variant, subject, body, or unresolved variable.
do:
  - Scope to one campaign.
  - Use `campaign_variants` for intended templates.
  - Use `rendered_outbound_context` for personalization QA.
  - Use `reply_context` and `lead_evidence` to tie recommendations to outcomes.
  - Apply cold-email best-practice rules after evidence is gathered.
avoid:
  - Do not turn broad workspace averages into copy conclusions.
  - Do not treat reconstructed copy as byte-for-byte delivered text.
evidence_basis:
  exact:
    - `campaign_variants`
  sampled:
    - `lead_evidence`
  hybrid:
    - `reply_context`
  reconstructed:
    - `rendered_outbound_context`
  operator_judgment:
    - cold-email best-practice policy
caveats:
  - Personalization rendering may differ from provider-specific syntax.
safe_examples:
  - "Demo Step 0 variant A keeps the specific pain point; variant C asks for the meeting too early."
related_docs:
  - ../skills/copy-analysis.md
  - ../skills/cold-email-best-practices.md
last_reviewed: 2026-05-06
```

## ICP Signals

```yaml
id: sendlens-om-20260506-icp-signals
title: ICP analysis is campaign-scoped until proven otherwise
status: active
visibility: public-oss
workflow: icp-signals
summary: Campaign payload keys are not global schema. Inspect keys and values inside one campaign before making segment hypotheses.
applies_when:
  - A user asks which roles, industries, countries, company sizes, or uploaded lead metadata variables respond best.
signals:
  - The question mentions segments, ICP, payloads, uploaded lead metadata, or who is replying.
do:
  - Pick one campaign first.
  - Inventory available payload keys.
  - Compare value-level patterns only after selecting one key.
  - Frame sampled patterns as hypotheses for the next test.
avoid:
  - Do not assume two campaigns use the same payload keys.
  - Do not describe sampled payload findings as statistically decisive.
evidence_basis:
  exact:
    - `campaign_overview`
  sampled:
    - `lead_evidence`
    - `lead_payload_kv`
  operator_judgment:
    - hypothesis framing and test design
caveats:
  - Sparse payload keys can create misleading apparent winners.
  - Missing role/title/custom fields usually mean the uploaded list metadata was thin; recommend improving future uploaded lead metadata rather than blaming Instantly enrichment.
safe_examples:
  - "In this demo sample, employee_band appears more useful than geography."
related_docs:
  - ../skills/icp-signals.md
last_reviewed: 2026-05-06
```

## Reply Patterns

```yaml
id: sendlens-om-20260506-reply-patterns
title: Reply patterns start with outcome state, not invented sentiment
status: active
visibility: public-oss
workflow: reply-patterns
summary: Separate positive, negative, neutral, wrong-person, and OOO outcomes using Instantly lead state before summarizing themes.
applies_when:
  - A user asks what prospects are saying or which objections recur.
signals:
  - The question asks for reply themes, objections, positive replies, negative replies, or wrong-person routing.
do:
  - Query `reply_context` first.
  - Fetch exact reply text for one campaign only when actual wording is needed.
  - Exclude OOO replies unless the user asks for them.
  - Say whether actual reply bodies were fetched.
avoid:
  - Do not quote reply wording without fetched `reply_body_text`.
  - Do not run broad reply text hydration during routine triage.
evidence_basis:
  hybrid:
    - `reply_context`
  fetched:
    - `reply_emails`
  operator_judgment:
    - theme grouping after evidence is loaded
caveats:
  - `fetch_reply_text` is intentionally one-campaign and rate-conscious.
safe_examples:
  - "Demo replies skew positive around workflow pain but negative around timing."
related_docs:
  - ../skills/reply-patterns.md
last_reviewed: 2026-05-06
```

## Deliverability Caveats

```yaml
id: sendlens-om-20260506-deliverability-caveats
title: Missing inbox-placement evidence is not proof of clean sender health
status: active
visibility: public-oss
workflow: deliverability-caveats
summary: Deliverability diagnosis should use account health and inbox-placement evidence when available, and should not infer placement from reply rate alone.
applies_when:
  - A user asks why reply rate is low, whether senders are healthy, or whether campaigns are landing in spam.
signals:
  - Empty inbox-placement tables.
  - Bounce rate above operator thresholds.
  - Open or link tracking enabled on cold outbound.
  - Disabled bounce protection or allowed risky contacts.
do:
  - Check account health, sender coverage, campaign tracking/deliverability settings, inbox-placement tests, sender deliverability health, and authentication failures when available.
  - Use `inbox_placement_analytics_labeled` for provider, geography, and recipient-type grouped placement analysis.
  - Treat bounce rate above 2% as attention-worthy and above 5% as a red flag.
  - Describe tracking warnings as best-practice guidance.
avoid:
  - Do not say senders are healthy because inbox-placement data is missing.
  - Do not blame copy or targeting before checking available deliverability evidence.
  - Do not infer SPF, DKIM, DMARC, spam, or category placement from reply rates alone.
evidence_basis:
  exact:
    - `accounts`
    - `account_daily_metrics`
    - `inbox_placement_tests`
    - `inbox_placement_analytics`
    - `inbox_placement_analytics_labeled`
    - `campaign_overview`
  hybrid:
    - `sender_deliverability_health`
    - `inbox_placement_test_overview`
  operator_judgment:
    - cold-email tracking and bounce thresholds
caveats:
  - Empty inbox-placement views mean no local test evidence was available.
safe_examples:
  - "The demo campaign has no inbox-placement evidence, so placement risk remains unknown."
related_docs:
  - ../skills/workspace-health.md
  - ../skills/campaign-launch-qa.md
  - ../skills/cold-email-best-practices.md
last_reviewed: 2026-05-06
```
