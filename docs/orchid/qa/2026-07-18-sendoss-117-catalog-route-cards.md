# SENDOSS-117 compact catalog route-card proof

## Scope

SENDOSS-117 adds compact catalog route cards and one packaged exact-tag miss correction path. It does not add a planner, typed execution, provider mutation, runtime receipts, schema changes, or SENDOSS-118 behavior.

## Result

- Exact campaign-tag plus sender/account plus deliverability/bounce intent ranks `campaign-sender-inventory-by-tag` first.
- The catalog exposes two cards only for this proof route: the canonical recipe and directly linked `tag-scope-audit` correction recipe.
- The correction envelope is `campaign-sender-inventory-by-tag` lookup -> primary zero rows -> `tag-scope-audit` lookup -> correction result -> stop, with four follow-up calls maximum.
- The four-call follow-up budget begins at primary recipe lookup; prior `search_catalog` discovery is outside that count.
- Exact `analysis_starters` recipe lookup still returns full recipe SQL and detailed guidance.
- Compact `analysis_starters` indexes and `search_catalog` cards contain no SQL, detailed notes, result rows, customer literals, private identifiers, or local paths.
- Novel supported questions retain catalog-first bounded SQL against public views after the recipe ladder is exhausted.

## Sanitized shape change

Before SENDOSS-117, a catalog workflow suggestion returned only:

```json
{
  "concept": "campaign-tag sender risk",
  "topics": ["workspace-health"],
  "recipe_ids": ["campaign-sender-inventory-by-tag"],
  "reason": "canonical recipe first"
}
```

After SENDOSS-117, the same suggestion retains those fields and adds:

```json
{
  "route_cards": [
    {
      "recipe_id": "campaign-sender-inventory-by-tag",
      "intent": "exact campaign-tag sender inventory",
      "grain": "active campaign and assigned sender",
      "time_basis": "current assignments plus stored account aggregates",
      "attribution": "campaign selection with sender-scoped account evidence",
      "provider_scope": "provider-qualified campaign identity",
      "population_scope": "active tagged campaigns and assigned senders",
      "tag_role": "campaign tag selects campaigns; assignment tags explain assignment",
      "cost_class": "low",
      "privacy_class": "operational_identifiers",
      "prerequisites": ["known campaign tag"],
      "safe_adaptations": ["exact provider filter"],
      "forbidden_adaptations": ["scope broadening after a miss"]
    },
    {
      "recipe_id": "tag-scope-audit",
      "intent": "exact tag-scope correction",
      "grain": "tag mapping scope and counts",
      "time_basis": "current cached tag mappings",
      "attribution": "tag metadata only",
      "provider_scope": "provider-qualified mappings",
      "population_scope": "exact normalized tag",
      "tag_role": "campaign versus assignment/account tag disambiguation",
      "cost_class": "low",
      "privacy_class": "metadata_counts_only",
      "prerequisites": ["known tag label"],
      "safe_adaptations": ["report inferred tag scope and stop"],
      "forbidden_adaptations": ["broadening to every tag"]
    }
  ],
  "correction_path": {
    "from_recipe_id": "campaign-sender-inventory-by-tag",
    "on_status": "zero_rows",
    "correction_recipe_id": "tag-scope-audit",
    "after_correction": "stop",
    "max_follow_up_calls": 4,
    "follow_up_starts_at": "primary_recipe_lookup",
    "catalog_discovery_included": false
  }
}
```

The example is structural and sanitized. It contains no live response values.

## Size and privacy proof

- Exact sender-risk `analysis_starter_suggestions` size: 3,514 UTF-8 bytes.
- Enforced budget: 8,192 UTF-8 bytes.
- Card order is deterministic and duplicate cards are removed.
- A focused contract rejects SQL fields, row arrays, customer literals, private identifiers, and local path fragments.
- The final SENDOSS-117 proof run reported six cases, 15 user-analysis calls, seven excluded setup calls, 58 recipes, and privacy canaries absent. The added setup receipts cover registered stdio catalog delivery and the account-only tag correction invariant without changing per-case analysis budgets.

## Route proof

- Exact route: `analysis_starters:campaign-sender-inventory-by-tag` -> `analyze_data:campaign-sender-inventory-by-tag` in two calls.
- Equivalent, reordered, and shorthand tag + sender/account/inbox + deliverability/bounce/risk phrasing: same canonical route in two calls, without requiring the literal word `campaign`.
- Missing exact tag: primary lookup -> zero rows -> `tag-scope-audit` lookup -> zero rows -> stop in four calls.
- Novel analysis: `search_catalog` -> `analyze_data:custom_sql` in two calls, within the three-call budget.
- No broad snapshot, schema discovery, placement path, daily aggregate, or ad hoc tag aggregate appears in the exact-tag correction route.

## Local validation

| Check | Result |
|---|---|
| `npm run test:catalog-route-cards` | Passed |
| `npm run test:agentic-routing-proof` | Passed: 6 cases, 15 analysis calls, 7 excluded setup calls |
| `npm run test:skill-routing` | Passed: 16 cases across 5 skills |
| `npm run test:query-recipes` | Passed |
| `npm run test:mcp-response-contract` | Passed |
| `npm run test:plugin` | Passed, including the focused card contract and agentic proof in the normal gate |
| `npm run eval:plugin` | Passed with the existing 54/100 semantic warning and no errors |
| `npm run validate:plugin` | Passed for `sendlens@0.1.67` |
| `npm run lint:plugin` | Passed with 0 errors and 46 existing host-translation warnings |
| `npm run test:host-bundles` | Passed: 5 skills, 15 commands, 9 agents |
| `git diff --check` | Passed |

The host-bundle check initially hit the sandbox's npm registry restriction, then passed unchanged with approved network access for its temporary runtime dependency install.

## Proof limits

This proves deterministic local demo/CI route metadata, response-size bounds, exact correction sequencing, compatibility, and privacy assertions. It does not prove natural-language runtime enforcement, installed-host latency, provider network behavior, query interruption, compute limits, typed execution, or SENDOSS-118 receipts.
