# Operator Memory Schema

Use this schema for public-safe SendLens operator-memory entries. Entries can live as standalone markdown files later; for now, the initial generic entries are in [PLAYBOOKS.md](./PLAYBOOKS.md).

## Required Fields

```yaml
id: sendlens-om-YYYYMMDD-short-slug
title: Short public-safe title
status: draft | active | retired
visibility: public-oss
workflow: setup-friction | evidence-classification | copy-analysis | icp-signals | reply-patterns | deliverability-caveats | launch-qa | experiment-planning | account-manager-brief
summary: One or two sentences describing the reusable lesson.
applies_when:
  - Public-safe condition where this memory applies.
signals:
  - Observable generic signal.
do:
  - Recommended action.
avoid:
  - Common mistake or overclaim to avoid.
evidence_basis:
  exact:
    - Exact aggregate or API-derived surface used, if any.
  sampled:
    - Sampled surface used, if any.
  hybrid:
    - Semantic mixed surface used, if any.
  reconstructed:
    - Reconstructed surface used, if any.
  fetched:
    - Fetched reply-body surface used, if any.
  operator_judgment:
    - Policy or heuristic used, if any.
caveats:
  - Limitation that must travel with the memory.
safe_examples:
  - Synthetic or generic example only.
related_docs:
  - ../CATALOG.md
  - ../TRUST_AND_PRIVACY.md
last_reviewed: YYYY-MM-DD
```

## Field Rules

`id`
: Stable slug. Do not encode customer names, domains, campaigns, or issue IDs that point to private context.

`visibility`
: Must be `public-oss` for files committed to this repo.

`workflow`
: Pick the closest workflow. Add a new value only when the existing set cannot describe the memory.

`evidence_basis`
: Preserve the distinction between exact aggregate metrics, sampled lead evidence, hybrid semantic views, reconstructed outbound copy, fetched reply text, and operator judgment.

`safe_examples`
: Use placeholders such as `Demo Campaign`, `example.com`, `finance leaders`, or rounded synthetic metrics. Do not include real customer wording.

`related_docs`
: Prefer links to public docs over copied detail.

## Redaction Checklist

- No real workspace, customer, company, lead, sender, or campaign identifiers.
- No exact private metrics or time windows unless labeled synthetic.
- No raw reply text unless synthetic.
- No env values, API keys, cache paths containing customer names, or local logs.
- No private pricing, GTM, enterprise, or customer-discovery context.
- No claims that exceed the evidence classification.
