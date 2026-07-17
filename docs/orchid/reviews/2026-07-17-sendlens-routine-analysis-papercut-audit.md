# SendLens Routine Analysis Papercut Audit

- Status: living backlog
- First audited: 2026-07-17
- Last updated: 2026-07-17
- Baseline: `v0.1.63` / `d9aa17e`
Scope: analyst guidance, query routing, `analysis_starters`, SQL recipes, public schema/view naming, validation, and local query observability

Implementation plan: `docs/orchid/plans/2026-07-17-sendlens-local-agentic-analytics-routing.md`

## Goal

Make routine SendLens campaign analysis fast, bounded, semantically safe, and difficult to derail through avoidable schema discovery or raw-row recomputation. This audit records papercuts and acceptance criteria; it does not authorize product implementation.

The desired default is:

1. preserve the user's exact provider, campaign, tag, and time scope;
2. route to one known semantic surface or exact recipe;
3. use precomputed aggregates at the grain the question requires;
4. escalate only when the first result exposes a specific evidence gap;
5. stop with an explicit unknown instead of wandering across schemas.

## Sanitized Seed Incident

A request for sender deliverability risk under one exact campaign tag took several minutes. The analysis first ran a workspace-wide query, inspected multiple schema and placement surfaces, filtered `campaign_accounts.tag_label` directly and got zero rows, then rebuilt 30-day sender metrics from `account_daily_metrics`.

The semantic mistake was that `campaign_accounts.tag_label` describes the account tag used by a tag-based sender assignment, not the campaign's tag. The fast path was to resolve exact campaign IDs through `campaign_tags`, join those IDs to `campaign_accounts`, and use the existing `total_sent_30d`, `total_replies_30d`, `total_bounces_30d`, and `bounce_rate_30d_pct` aggregates. No customer, campaign, sender, or tag identifiers are retained here.

Repository evidence confirms all three conditions:

- `campaign_tags.tag_label` is populated from campaign tag mappings, while `campaign_accounts.tag_label` is null for direct assignments and becomes the account tag label for tag-based assignments (`plugin/local-db.ts:1222-1261`, `plugin/local-db.ts:1262-1337`).
- `campaign_accounts` already exposes the required 30-day account aggregates (`plugin/local-db.ts:1282-1286`, `plugin/local-db.ts:1318-1322`).
- The current `sender-load-balance-by-campaign-tag` recipe scopes through `campaign_tags` correctly but still scans and aggregates `account_daily_metrics` (`plugin/query-recipes.ts:98-215`). The adjacent `campaign-sender-inventory-by-tag` recipe already demonstrates the simpler aggregate path (`plugin/query-recipes.ts:219-249`).

## Prioritized Backlog

| ID | Recommendation | Category | Priority | Effort | Class |
| --- | --- | --- | --- | --- | --- |
| SLP-001 | Route exact-scope questions directly and enforce a query-budget ladder | Skill/routing guidance | P0 | S | Quick win |
| SLP-002 | Reuse and enrich the campaign-sender inventory recipe as the sender-risk fast path | Reusable SQL recipes | P0 | S | Quick win |
| SLP-013 | Remove raw SQL and literals from `analyze_data` failures | Observability/performance | P0 | S | Safety fix |
| SLP-003 | Disambiguate campaign-tag and assignment-account-tag fields | Schema/view/tool ergonomics | P0 | M | Deeper change |
| SLP-004 | Make provider-qualified joins a recipe contract | Reusable SQL recipes | P1 | M | Deeper change |
| SLP-005 | Add structured grain, attribution, prerequisites, and preference metadata to recipes | Schema/view/tool ergonomics | P1 | M | Deeper change |
| SLP-006 | Canonicalize overlapping campaign-tag daily-volume paths | Reusable SQL recipes | P1 | M | Deeper change |
| SLP-007 | Add combined-concept routing for tag + sender + deliverability | Skill/routing guidance | P1 | S | Quick win |
| SLP-008 | Replace syntax-only confidence with semantic regression fixtures | Validation/tests | P1 | M | Deeper change |
| SLP-009 | Correct active-campaign and provider scope in sender-sharing counts | Reusable SQL recipes | P1 | S | Quick win |
| SLP-010 | Make schema discovery one-pass and semantically enriched | Schema/view/tool ergonomics | P2 | M | Deeper change |
| SLP-011 | Return privacy-safe query timing and route diagnostics | Observability/performance | P2 | M | Deeper change |
| SLP-012 | Rank starter summaries so common recipes are not hidden by pagination | Skill/routing guidance | P2 | S | Quick win |

Priority meanings: P0 removes a demonstrated slow or incorrect path; P1 prevents a likely recurring correctness failure; P2 improves scale, diagnosis, or maintainability after the core fast paths are safe.

## Skill And Routing Guidance

### SLP-001 — Direct exact-scope routing plus a query-budget ladder

- **Evidence:** The analyst skill correctly says `workspace_snapshot` is for broad or ambiguous requests and to prefer `analysis_starters` (`skills/sendlens-analyst/SKILL.md:21-26`). The legacy workspace-health guide is stronger and says to start every flow with `workspace_snapshot` (`docs/skills/workspace-health.md:21-28`). `INSTRUCTIONS.md` has a direct fast-path concept for simple inventory, but no corresponding exact-tag diagnostic fast path or zero-row escalation rule (`INSTRUCTIONS.md:46-60`, `INSTRUCTIONS.md:85-98`).
- **User impact:** A narrow question can inherit workspace-wide triage, extra tool calls, irrelevant placement inspection, and several minutes of latency before the requested scope is applied.
- **Proposed fix:** Add an explicit decision table to the analyst skill and `workspace-and-performance.md`: broad/ambiguous -> `workspace_snapshot`; exact campaign/tag + known routine decision -> exact recipe; one-campaign deep reply/copy/ICP -> `load_campaign_data`; schema discovery only after no matching recipe exists. Adopt the query-budget ladder below.
- **Likely files/surfaces:** `skills/sendlens-analyst/SKILL.md`, `skills/sendlens-analyst/references/workspace-and-performance.md`, `INSTRUCTIONS.md`, `docs/skills/workspace-health.md`, analyst evals.
- **Priority / effort:** P0 / S.
- **Acceptance:** A behavioral eval for “show sender deliverability risk for exact campaign tag X” reaches the canonical `campaign-sender-inventory-by-tag` fast path without `workspace_snapshot`, `list_tables`, `search_catalog`, or `list_columns`; it completes in at most two recipe/query calls when the tag exists and at most four when one tag-scope correction is needed.

### SLP-007 — Combined-concept routing

- **Evidence:** `search_catalog` has independent hints for deliverability, sender, and tag. The deliverability hint recommends placement/account recipes but not a tag-scoped sender recipe; the sender hint includes tag recipes; the tag hint starts with tag catalog/audit (`plugin/catalog.ts:73-164`). A combined “sender deliverability by campaign tag” intent therefore produces several possible routes without one canonical choice.
- **User impact:** The analyst can bounce between catalog matches, placement tables, tag inspection, and sender tables even though the exact routine path is known.
- **Proposed fix:** Add a deterministic combined-concept hint or routing matrix entry for `{campaign tag + sender/account + deliverability/bounce}` that returns `campaign-sender-inventory-by-tag` first, with tag-scope audit only as its zero-row fallback. Keep this bounded mapping; do not add a second free-form workflow planner.
- **Likely files/surfaces:** `plugin/catalog.ts`, analyst references, `skills/sendlens-analyst/evals/evals.json`, catalog/MCP response tests.
- **Priority / effort:** P1 / S.
- **Acceptance:** `search_catalog("sender deliverability risk for campaign tag")` returns the fast recipe as the first suggested recipe with a reason that distinguishes campaign tags from account-assignment tags.

### SLP-012 — Ranked starter summaries

- **Evidence:** `analysis_starters` returns ten recipes by default in source order (`plugin/query-recipes.ts:3348-3395`). The current source has 12 workspace-health recipes and 17 campaign-performance recipes; later recipes require another page even when they are the best match. There is no `preferred`, `fallback`, or intent-rank field in `QueryRecipe`.
- **User impact:** Models must page, guess an exact recipe ID, or write custom SQL despite a suitable recipe already existing.
- **Proposed fix:** Keep topic compatibility, but rank summaries by explicit preference and combined-concept matches. Include a direct exact-recipe suggestion from `search_catalog`; mark provider-specific or fallback recipes so they do not compete as undifferentiated peers.
- **Likely files/surfaces:** `plugin/query-recipes.ts`, `plugin/catalog.ts`, `plugin/server.ts`, MCP response contract docs/tests.
- **Priority / effort:** P2 / S.
- **Acceptance:** Every supported routine intent in a routing fixture returns its canonical recipe on the first summary page or through one exact recipe suggestion; Smartlead-specific deliverability recipes remain discoverable without paging an unrelated Instantly list.

## Reusable SQL Recipes And Templates

### SLP-002 — Sender deliverability risk by exact campaign tag

- **Evidence:** The current load-balance recipe already obtains precomputed 30-day metrics from `campaign_accounts`, then independently rebuilds them from `account_daily_metrics` and uses the rebuilt values (`plugin/query-recipes.ts:104-211`). The inventory recipe uses the faster fields directly (`plugin/query-recipes.ts:225-244`).
- **User impact:** Avoidable raw-row work increases latency and creates two possible 30-day definitions in the same recipe. It also encourages analysts to treat sender-level daily facts as campaign-attributed.
- **Proposed fix:** Reuse and enrich the existing `campaign-sender-inventory-by-tag` recipe as the canonical account-health fast path instead of adding a near-duplicate recipe ID. Resolve the campaign tag through `campaign_tags`, join on workspace plus provider-qualified campaign identity, use `campaign_accounts` aggregates, and return campaign IDs plus a bounded risk classification so evidence scope is obvious. Keep `sender-load-balance-by-campaign-tag` as the deeper trend/capacity path and reach it only when the user explicitly asks for trend, peak utilization, or day-level attribution.
- **Likely files/surfaces:** `plugin/query-recipes.ts`, `plugin/catalog.ts`, `skills/sendlens-analyst/references/workspace-and-performance.md`, demo fixture, query-recipe tests.
- **Priority / effort:** P0 / S.
- **Acceptance:** On a fixture where the campaign tag and assignment account tag deliberately differ, the recipe returns only senders assigned to the tagged campaigns, uses the stored account 30-day totals exactly, and its SQL/plan contains no `account_daily_metrics` reference.

Proposed recipe SQL shape:

```sql
WITH tagged_campaigns AS (
  SELECT DISTINCT
    workspace_id,
    source_provider,
    campaign_source_id,
    campaign_id,
    campaign_name,
    tag_id,
    tag_label AS campaign_tag_label
  FROM sendlens.campaign_tags
  WHERE lower(trim(tag_label)) = lower(trim('{{tag_name}}'))
)
SELECT
  tc.campaign_tag_label,
  tc.source_provider,
  tc.campaign_source_id,
  tc.campaign_id,
  tc.campaign_name,
  ca.account_email,
  ca.assignment_source,
  ca.tag_label AS assignment_account_tag_label,
  ca.status,
  ca.warmup_status,
  ca.warmup_score,
  ca.daily_limit AS account_daily_limit,
  ca.total_sent_30d,
  ca.total_replies_30d,
  ca.total_bounces_30d,
  ca.bounce_rate_30d_pct,
  CASE
    WHEN ca.status IS NULL THEN 'missing_account_health'
    WHEN COALESCE(ca.total_sent_30d, 0) = 0 THEN 'no_recent_send_volume'
    WHEN ca.bounce_rate_30d_pct >= 5 THEN 'high_30d_bounce_risk'
    ELSE 'monitor'
  END AS sender_risk_status
FROM tagged_campaigns tc
JOIN sendlens.campaign_accounts ca
  ON tc.workspace_id = ca.workspace_id
 AND tc.source_provider = ca.source_provider
 AND tc.campaign_source_id = ca.campaign_source_id
ORDER BY
  CASE sender_risk_status
    WHEN 'high_30d_bounce_risk' THEN 1
    WHEN 'missing_account_health' THEN 2
    WHEN 'no_recent_send_volume' THEN 3
    ELSE 4
  END,
  ca.bounce_rate_30d_pct DESC NULLS LAST,
  ca.total_sent_30d DESC NULLS LAST;
```

Evidence caveat returned with the recipe: these are exact cached 30-day **sender/account** aggregates attached to exact tagged campaign assignments. They are not campaign-attributed daily sends and do not substitute for inbox-placement or authentication evidence when the user explicitly asks for those surfaces.

### SLP-004 — Provider-qualified joins as a recipe contract

- **Evidence:** The shared join rules require `workspace_id`, `source_provider`, and provider-qualified campaign identity (`skills/sendlens-analyst/references/schema-and-joins.md:17-25`). Multiple tag recipes join only on workspace and `campaign_id`, including sender inventory and sender-scoped daily-volume recipes (`plugin/query-recipes.ts:239-243`, `plugin/query-recipes.ts:401-424`, `plugin/query-recipes.ts:461-497`). The scoped `workspace_snapshot` implementation shows the safer provider join (`plugin/server.ts:1865-1875`).
- **User impact:** Mixed-provider workspaces can produce cross-provider collisions, duplicated rows, or apparently valid but incorrectly attributed metrics.
- **Proposed fix:** Audit every multi-surface recipe and require `source_provider` plus `campaign_source_id` where both exist. Prefer semantic views that already enforce the join. Add a static recipe assertion for provider-qualified join keys where relevant.
- **Likely files/surfaces:** `plugin/query-recipes.ts`, semantic views in `plugin/local-db.ts`, schema/join reference, query-recipe and provider-workspace tests.
- **Priority / effort:** P1 / M.
- **Acceptance:** A fixture with the same native campaign/account identifiers under two providers never cross-joins; every affected recipe returns provider-isolated counts and a contract test fails if its required provider key is removed.

### SLP-006 — Canonical tag daily-volume paths

- **Evidence:** `campaign-tag-true-daily-volume` says it is preferred because it uses campaign/day analytics (`plugin/query-recipes.ts:327-353`). `campaign-tag-daily-volume-deduped` later says it is the safest default while explicitly returning sender-scoped, non-campaign-attributed volume (`plugin/query-recipes.ts:448-509`). Both are classified only as `exact`. The public schema repeats similar names for campaign-attributed and sender-scoped views (`plugin/constants.ts:43-49`, `plugin/constants.ts:107-120`).
- **User impact:** Analysts can answer a campaign-volume question with sender-account volume, especially when senders are shared, and still describe the result as exact without stating the attribution grain.
- **Proposed fix:** Establish one canonical campaign-attributed path and clearly named sender-scoped fallback paths. Add additive compatibility aliases or deprecation metadata rather than breaking existing recipe IDs. Suggested naming: `campaign_tag_campaign_daily_volume` versus `campaign_tag_assigned_sender_daily_volume`.
- **Likely files/surfaces:** `plugin/query-recipes.ts`, `plugin/local-db.ts`, `plugin/constants.ts`, catalog/docs, migration and recipe tests.
- **Priority / effort:** P1 / M.
- **Acceptance:** “Daily volume for campaign tag X” selects the campaign-attributed recipe. The sender-scoped fallback is used only after a declared campaign-daily coverage gap, and every returned summary states its attribution grain.

### SLP-009 — Correct sender-sharing scope

- **Evidence:** `sender-load-balance-by-campaign-tag` names `all_active_campaigns_using_sender` but counts every row in `campaign_accounts` without joining campaign status or filtering active campaigns (`plugin/query-recipes.ts:128-135`). It also groups only by workspace and email, not provider.
- **User impact:** Inactive or cross-provider assignments can create false “shared with other campaigns” warnings and send the analyst into unnecessary capacity investigation.
- **Proposed fix:** Join `campaign_overview`/`campaigns`, filter active campaigns, and group by workspace, provider, and normalized account identity; otherwise rename the field to accurately say it includes all cached assignments.
- **Likely files/surfaces:** `plugin/query-recipes.ts`, potential sender-sharing semantic view, targeted recipe tests.
- **Priority / effort:** P1 / S.
- **Acceptance:** An inactive assignment does not increase the active-sharing count, and identical sender emails under different providers remain isolated.

## Schema, View, And Tool Ergonomics

### SLP-003 — Explicit tag-role names

- **Evidence:** `campaign_tags` and `account_tags` both expose a generic `tag_label`; `campaign_accounts.tag_label` is specifically the assignment account tag and is null for direct assignments (`plugin/local-db.ts:1222-1337`). `TABLE_DESCRIPTIONS.campaign_accounts` describes resolved sender inventory but does not explain this column-level distinction (`plugin/constants.ts:89-104`). `list_columns` returns only column names and types (`plugin/catalog.ts:165-179`).
- **User impact:** A reasonable filter can return zero rows while appearing syntactically correct, which then triggers repeated schema inspection or incorrect “no data” conclusions.
- **Proposed fix:** Add explicit additive aliases such as `campaign_tag_label` on `campaign_tags` and `assignment_account_tag_label` on `campaign_accounts`; expose column descriptions/roles through schema tools; update recipes and guidance to use explicit names. Keep legacy `tag_label` through a documented compatibility window.
- **Likely files/surfaces:** `plugin/local-db.ts`, `plugin/constants.ts`, `plugin/catalog.ts`, `docs/CATALOG.md`, schema migration/tests, recipes.
- **Priority / effort:** P0 / M.
- **Acceptance:** `list_columns("campaign_accounts")` explains that the assignment tag is not a campaign tag; a regression fixture proves filtering the explicit campaign-tag field selects the intended campaigns while the account-assignment tag remains independently queryable.

### SLP-005 — Structured recipe semantics

- **Evidence:** `QueryRecipe` carries only `topic`, `question`, `exactness`, prose rationale, SQL, and notes (`plugin/query-recipes.ts:1-18`). Summary mode omits `notes`, so the default response loses caveats such as “sender-scoped, not campaign-attributed” (`plugin/query-recipes.ts:3331-3340`).
- **User impact:** “Exact” can describe the source rows while obscuring the attribution grain, population scope, preferred use, or prerequisites. The analyst may select a technically exact but decision-inappropriate recipe.
- **Proposed fix:** Add structured fields such as `grain`, `attribution_scope`, `population_scope`, `provider_scope`, `prerequisites`, `preferred_for`, `fallback_for`, `estimated_cost`, and `privacy_class`; include the compact semantic fields in summary mode.
- **Likely files/surfaces:** `plugin/query-recipes.ts`, `plugin/server.ts`, MCP response contract docs/tests, catalog guidance.
- **Priority / effort:** P1 / M.
- **Acceptance:** Summary mode alone distinguishes campaign-attributed versus sender-scoped metrics and identifies the preferred recipe, without loading full SQL or raw-row notes.

### SLP-010 — One-pass schema discovery

- **Evidence:** `search_catalog` loops through every public table and awaits `listColumns` once per table; `listColumns` executes a separate `information_schema.columns` query each time (`plugin/catalog.ts:165-226`). The catalog currently exposes 45 public surfaces (`plugin/constants.ts:28-74`). Column responses have no semantic descriptions.
- **User impact:** A discovery fallback can itself become dozens of local queries and still leave the analyst to infer grain and field meaning.
- **Proposed fix:** Fetch all public columns in one `information_schema` query, cache the static schema per connection/schema version, and enrich high-risk columns with role/grain descriptions. Prefer `describe_surface(table_name)` or an enriched `list_columns` response over repeated table probing.
- **Likely files/surfaces:** `plugin/catalog.ts`, `plugin/constants.ts`, schema tool responses, catalog tests/benchmarks.
- **Priority / effort:** P2 / M.
- **Acceptance:** One catalog search performs at most one schema query, returns field semantics for ambiguous tag/ID/aggregate columns, and meets a local fixture p95 target agreed before implementation (proposed initial target: under 100 ms after DB readiness).

## Validation And Tests

### SLP-008 — Semantic and performance regression fixtures

- **Evidence:** The exhaustive query-recipe contract proves that every recipe renders, passes the SQL guard, and executes on the demo workspace, but it does not assert returned rows, values, route choice, query plan, or time (`scripts/test-query-recipes-contract.mjs:43-80`). Its named regression set covers overlap and personalization, not sender/tag semantics (`scripts/test-query-recipes-contract.mjs:29-34`). Analyst evals cover broad diagnosis and orchestration but no exact-tag sender risk or zero-row correction case (`skills/sendlens-analyst/evals/evals.json`).
- **User impact:** Syntax-safe recipes can remain slow, choose the wrong semantic field, silently return zero rows, or cross providers without failing CI.
- **Proposed fix:** Add a focused fixture with different campaign and assignment account tags, direct plus tag-based sender assignments, provider-ID collisions, an inactive shared assignment, deliberately different `accounts` 30-day aggregates and `account_daily_metrics` sums, and missing optional placement data. Assert route, values, nonempty output, evidence caveat, and forbidden-table absence for the fast recipe.
- **Likely files/surfaces:** `scripts/test-query-recipes-contract.mjs` or a focused new test, demo/fixture seeding, analyst evals, prompt/routing tests.
- **Priority / effort:** P1 / M.
- **Acceptance:** CI fails for each seeded regression: filtering assignment tag as campaign tag, recomputing the fast path from daily rows, omitting provider keys, counting inactive sharing, or interpreting missing placement as healthy.

## Observability And Performance

### SLP-013 — Remove raw SQL from analysis failures

- **Evidence:** The outer `analyze_data` catch returns `sql: rewritten ?? sql` with the engine error (`plugin/server.ts:1753-1765`). Exact tags, campaign identifiers, addresses, or other model-authored literals can therefore leave the local query boundary in a failure response.
- **User impact:** A routine failed filter can expose customer or sender context to the host/model and any copied diagnostic even though the plugin is designed to keep durable evidence sanitized.
- **Proposed fix:** Remove submitted and rewritten SQL plus nested engine/row previews from every failure family. Preserve a stable error, additive bounded code, and safe correction hint. Do not add query hashing, persistence, or expanded telemetry in the same slice.
- **Likely files/surfaces:** `plugin/server.ts`, `docs/MCP_RESPONSE_CONTRACT.md`, `docs/TRUST_AND_PRIVACY.md`, MCP response/runtime tests.
- **Priority / effort:** P0 / S.
- **Acceptance:** Synthetic SQL, tag, email, and row canaries are absent from guard, parser, binder, runtime, cache, and outer failure responses and captured logs; current successful response fields remain unchanged.

### SLP-011 — Privacy-safe query and routing diagnostics

- **Evidence:** `analyze_data` returns row count, truncation, and output limits, but not elapsed time, referenced semantic surfaces, recipe ID, route, or a failure class (`plugin/server.ts:1663-1744`). Its outer `LIMIT` caps returned rows after the submitted subquery runs, so it is not a computational query budget (`plugin/server.ts:1710-1717`).
- **User impact:** Slow paths and duplicate queries are difficult to identify from receipts; living papercuts depend on anecdotal timing rather than comparable local evidence.
- **Proposed fix:** Return privacy-safe diagnostics: `elapsed_ms`, normalized referenced public surfaces, `recipe_id` when applicable, result status (`ok`, `zero_rows`, `truncated`, `guard_rejected`, `timeout`), and a local-only query fingerprint. Add soft warnings when the recommended call budget is exceeded. Do not log SQL literals, identifiers, customer names, emails, reply bodies, or raw rows.
- **Likely files/surfaces:** `plugin/server.ts`, `plugin/query-recipes.ts`, debug/telemetry helpers, MCP response contract docs/tests, optional local benchmark script.
- **Priority / effort:** P2 / M.
- **Acceptance:** A synthetic workflow receipt can prove call count, route, surfaces, zero-row retries, and elapsed time without containing any fixture identifier or SQL literal; a deliberately slow query produces a bounded warning or timeout under an agreed threshold.

## Query-Budget And Escalation Ladder

Count both metadata calls and data-query calls. Do not count a user clarification as a tool call.

| Level | When | Allowed path | Cumulative budget | Stop/escalate condition |
| --- | --- | --- | --- | --- |
| 0 — resolve scope | User supplied exact provider/campaign/tag/time scope | Parse and preserve it; do not broaden | 0 calls | Ask only if two materially different scopes remain possible |
| 1 — canonical fast path | A known routine recipe matches | `analysis_starters(recipe_id=...)` then one `analyze_data` execution | <=2 calls | Answer if evidence is sufficient |
| 2 — semantic correction | Canonical path returns zero rows or explicit coverage gap | Run one scope/coverage recipe such as `tag-scope-audit`, then retry exactly one corrected path | <=4 calls | After the second zero-row/failed filter, stop and report the unresolved semantic gap |
| 3 — evidence-specific depth | User explicitly asks for trend, peak load, placement, authentication, or a day-level breakdown | Add one specialized recipe lookup and one focused query; constrain date/provider/senders before touching daily or placement rows | <=6 calls | Stop if the new surface is unsupported, unavailable, or still not attributable to the requested scope |
| 4 — deliberate investigation | The answer truly requires custom schema work | One `search_catalog`, one `list_columns` for the selected surface, one focused custom query | Exception with stated reason | Do not inspect multiple schemas speculatively; return an implementation/data-gap recommendation instead |

Additional guardrails:

- Never begin a narrow exact-tag question with an unscoped workspace query.
- Never use `campaign_accounts.tag_label` as a campaign-tag filter.
- Never rebuild an available aggregate from daily/raw rows unless the user asks for a different window or grain, or the aggregate's coverage is explicitly insufficient.
- Do not run more than two materially equivalent queries with different syntax.
- Proposed operational stop target: six total calls, two failed filters, or 60 seconds of cumulative local query time, whichever comes first. If query timing is not yet available, enforce call and failure counts and record timing as unknown.
- On stop, return the scope attempted, recipes/surfaces used, exact failure or coverage gap, evidence still available, and the smallest follow-up needed. Do not silently broaden scope.

## Living Audit Workflow

### Add a newly observed papercut

Append an entry to the backlog using this template:

```markdown
### SLP-NNN — Short title

- Date observed:
- Status: observed | triaged | accepted | in-progress | shipped | verified | archived
- Sanitized prompt shape:
- Sanitized symptom:
- Decision scope supplied by user:
- Actual route: tool/recipe/surface sequence only; no customer literals
- Query evidence: call count, elapsed time if available, zero-row/failed count, referenced surfaces
- Repository evidence: file and line references
- User impact:
- Proposed fix:
- Likely files/surfaces:
- Priority / effort:
- Acceptance test or measurable success criterion:
- Linear / PR / release links:
- Privacy check: confirm no customer, contact, campaign, sender, reply, or raw query literal is retained
```

Do not copy raw diagnostics into this document.

### Promote an item into implementation work

Promote when any one condition holds:

- the failure can produce a materially wrong or cross-scope answer;
- the same route papercut is observed twice;
- the fast path misses the proposed call/time target by at least 2x;
- a common intent has no canonical recipe or test;
- a privacy, provider-isolation, or evidence-classification boundary is at risk.

Before implementation:

1. update the item to `accepted` with current reproduction evidence;
2. create or link the scoped Linear issue, keeping customer context out of public OSS artifacts;
3. define one behavior slice and its regression fixture—avoid bundling unrelated cleanup;
4. route implementation through the repo's normal plan/worktree/PR flow;
5. preserve existing recipe IDs, MCP response contracts, provider behavior, demo mode, and read-only boundaries unless the issue explicitly approves a migration.

After shipping, record the PR/release and verify the original sanitized prompt against the call budget. Mark `verified` only when the measurable acceptance criterion passes; otherwise return the item to `triaged` with the new evidence.

## Recommended Implementation Order

1. **Independent safety fix:** SLP-013 removes confirmed SQL echo before any diagnostic expansion.
2. **Quick route-first release:** SLP-001, SLP-002, SLP-007, and SLP-009 create the exact-tag sender-risk path and bound the common failure loop without schema or runtime prerequisites.
3. **Correctness foundation:** SLP-003, SLP-004, and SLP-008 make the semantic distinction durable across providers and CI.
4. **Recipe semantics:** SLP-005, SLP-006, and SLP-012 reduce ambiguous choices without adding a competing planner.
5. **Performance proof:** SLP-010 and SLP-011 make discovery and future mining measurable while preserving local privacy.

## Audit Boundary

This document proposes work only. No provider mutations, product fixes, schema migrations, recipe changes, or runtime telemetry were implemented as part of the audit.
