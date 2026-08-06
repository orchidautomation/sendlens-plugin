# SendLens Question/Evidence Parity Contract and Implementation Sequence

- Linear: `SENDOSS-164` (parent `SENDOSS-162`, project *SendLens Analytics System of Record*)
- Route: `ce-plan` → `ce-doc-review`
- Baseline: `main` @ `646364b`, 45 public tables/views, 60 query recipes
- Date: 2026-08-05
- Owner: Codex (only agent host); global config `orchidautomation/blocks-config`

## 1. Purpose and Non-Negotiable Boundaries

Make SendLens the complete local read-only analytics, reporting, and diagnosis layer across Instantly and Smartlead. This contract is the load-bearing input for every remaining child (`SENDOSS-163` → `SENDOSS-171`). No implementation, schema migration, or provider call happens here.

Boundaries inherited from the parent and prior decisions (`docs/orchid/decisions/2026-07-11-sendlens-analyst-front-door.md`, `2026-07-12-deterministic-analysis-workflow-review.md`):

- Read-only. No campaign, lead, account, mailbox, email, warmup, webhook, or configuration mutations.
- No new workflow-planning MCP tool. Deterministic facts stay at their owning tool boundary; workflow selection stays in the tested five-skill layer.
- No credentials, mailbox connection fields, unnecessary raw headers, or unrestricted private message bodies in git, Linear, logs, fixtures, or test output. Smartlead query-string keys are redacted everywhere.
- This contract **extends** the existing `CatalogRecipeRouteCard` and `ColumnSafetyMetadata` structures in `plugin/catalog.ts` / `plugin/analysis-safety.ts`. It does not duplicate them.

## 2. Canonical Question Families

Nine families. Each is answered with provider-qualified, workspace-scoped evidence.

| # | Family | Representative questions |
|---|--------|--------------------------|
| Q1 | Workspace health | Is the workspace reachable? Which providers are connected? What is the freshest cache state and what is stale? |
| Q2 | Campaign performance | Which campaigns are running, paused, completed? What is send/deliver/bounce/reply volume and rate per campaign and per day? |
| Q3 | Sender/domain supply and blast radius | How is sending load distributed across senders/domains? Which senders are shared across campaigns? Which campaigns share a sender/domain (blast radius)? Are any accounts disconnected/quarantined? |
| Q4 | Step/variant and copy | What steps/variants exist per campaign? What is intended vs rendered copy? Which variant is performing best **within one hydrated campaign**? |
| Q5 | Deliverability | What is inbox-placement/smart-delivery health per sender/domain/campaign? Are auth (SPF/DKIM/DMARC) failures concentrated? |
| Q6 | Replies and ICP | What reply volume/category exists? Which leads replied? What ICP traits are present in sampled leads? What is reply-to-lead and reply-to-copy attribution? |
| Q7 | Provider overlap | Which leads/audiences overlap across Instantly and Smartlead? What is the cross-provider collision risk for a sender/domain? |
| Q8 | Experiments and validity | Can variant A vs B be compared? Is the selection frame statistically valid? What is the minimum detectable effect given the sample? |
| Q9 | Reporting reproducibility | Can a report be replayed with the same evidence hash? What coverage/caveats apply to a shared report? |

## 3. Contract Schemas (extensions, not new surfaces)

### 3.1 `metric_contracts`

Extends `CatalogRecipeRouteCard` with explicit denominator and claim semantics. One row per metric per provider.

| Field | Source | Notes |
|-------|--------|-------|
| `metric` | new | e.g. `reply_rate`, `deliverability_rate`, `send_volume` |
| `provider_scope` | existing `provider_scope` | `instantly` \| `smartlead` \| `both` |
| `grain` | existing `grain` | campaign / campaign-day / account / account-day / lead-sample |
| `denominator` | new | exact total, observed total, sampled total, or `not_comparable` |
| `population_scope` | existing `population_scope` | full / fast-500 / incremental-window |
| `freshness` | new | live / cached / stale-greater-than-N |
| `completeness` | new | complete / observed / sampled / partial |
| `attribution` | existing `attribution` | campaign-only / shared-sender / reply-hydrated / inferred |
| `max_claim_strength` | new | `population` \| `observed` \| `sampled` \| `directional` \| `none` |
| `privacy_class` | existing `privacy_class` | aggregate / cohort / sampled-PII / redacted |
| `evidence_class` | new | exact-fact / coverage-summary / hydrated-sample / inferred |

### 3.2 `question_evidence_contracts`

Maps a canonical question to the metric contracts, required tables, and the four answer states.

| Field | Notes |
|-------|-------|
| `question_family` | Q1–Q9 |
| `required_tables` | subset of the 45 public tables |
| `required_metric_contracts` | ids from §3.1 |
| `answer_state` | `answerable` \| `degraded` \| `non_comparable` \| `unsupported` |
| `degradation_trigger` | what moves a question to degraded (stale cache, missing provider surface, sample-only) |
| `minimum_evidence` | the least evidence that may answer at `directional` strength |
| `forbidden_claims` | claims prohibited at this evidence level (e.g. "winner" on broad aggregates) |

### 3.3 `analysis_eligibility`

Reuses `CatalogCorrectionPath` intent. Decides whether a question may be answered, must hydrate first, or must refuse.

| Field | Notes |
|-------|-------|
| `question_family` | Q1–Q9 |
| `eligible` | `now` \| `after_hydration` \| `after_live_validation` \| `never` |
| `blocker` | SENDOSS child that must close first, or `manual:provider-access` |
| `required_recipe_ids` | existing recipes that already answer at `directional` strength |
| `evidence_debt` | what is asserted without complete evidence and must be labeled |

## 4. Question → Evidence Contract

For each family: grain, denominator, provider scope, freshness, completeness, attribution, privacy/evidence class, max claim, answer states, required tables, existing recipes, and the gap a child closes.

### Q1 — Workspace health
- Grain: workspace. Denominator: exact. Provider scope: both. Freshness: cached. Completeness: complete. Attribution: n/a. Privacy: aggregate. Evidence: exact-fact. Max claim: `population`.
- States: answerable when cache fresh; degraded when a provider surface is stale; unsupported when a provider API is unreachable.
- Tables: `campaigns`, `accounts`, `provider_capabilities`, `sampling_runs`. Recipes: `workspace-overview`, `account-health`.
- Gap (SENDOSS-165/166): expose disconnected/quarantined account state as a first-class surface.

### Q2 — Campaign performance
- Grain: campaign / campaign-day. Denominator: exact for send/deliver/bounce; observed for reply. Provider scope: both. Freshness: cached. Completeness: complete for volume, observed for reply. Attribution: campaign-only. Privacy: aggregate. Evidence: exact-fact + coverage-summary. Max claim: `population` for volume, `observed` for reply rate.
- States: answerable; degraded when reply hydration incomplete; non-comparable across providers until provider-qualified.
- Tables: `campaign_overview`, `campaign_analytics`, `campaign_daily_metrics`, `campaigns`. Recipes: `workspace-overview`, `campaign-launch-qa-checklist`.
- Gap (SENDOSS-165/166): provider-qualified daily metrics parity; Smartlead campaign daily/step/variant shapes.

### Q3 — Sender/domain supply and blast radius
- Grain: account / account-day / sender-domain. Denominator: exact for assignment; observed for volume. Provider scope: both. Freshness: cached. Completeness: complete for assignments, observed for volume. Attribution: shared-sender. Privacy: aggregate. Evidence: exact-fact + inferred for blast radius. Max claim: `population` for assignments, `observed` for shared-volume, `directional` for blast-radius ranking.
- States: answerable for inventory; degraded for shared-volume; directional-only for blast-radius (attribution bounds required).
- Tables: `campaign_accounts`, `accounts`, `account_daily_metrics`, `campaign_account_assignments`, `provider_overlap_risk`, `provider_overlap_risk_details`. Recipes: `sender-load-balance-by-campaign-tag`, `campaign-sender-inventory-by-tag`, `account-manager-client-brief`.
- Gap (SENDOSS-169): effective-dated sender/domain lineage and quarantine/blast-radius analysis is missing. Shared-sender metrics cannot be assigned to campaigns without explicit attribution bounds.

### Q4 — Step/variant and copy
- Grain: campaign/step/variant. Denominator: exact for intended; sampled for rendered. Provider scope: both. Freshness: cached. Completeness: complete for variants, sampled for rendered. Attribution: campaign-only. Privacy: redacted for rendered. Evidence: exact-fact for variants, hydrated-sample for rendered. Max claim: `population` for variant inventory, `sampled`/`directional` for rendered-copy comparison.
- States: answerable for variant inventory; degraded for rendered copy; non-comparable for "winner" without one-campaign hydration.
- Tables: `step_analytics`, `campaign_variants`, `rendered_outbound_context`. Recipes: `campaign-lead-state-sample-by-step`.
- Gap (SENDOSS-165/166): Smartlead step/variant shape validation; rendered-outbound sampling coverage semantics.

### Q5 — Deliverability
- Grain: sender/domain/campaign. Denominator: observed (test-based). Provider scope: both. Freshness: cached. Completeness: observed. Attribution: sender. Privacy: aggregate. Evidence: coverage-summary. Max claim: `observed`/`directional`.
- States: answerable where tests exist; degraded where no placement tests; unsupported where provider has no placement surface.
- Tables: `inbox_placement_tests`, `inbox_placement_analytics`, `inbox_placement_analytics_labeled`, `inbox_placement_test_overview`, `sender_deliverability_health`, `smartlead_delivery_tests`, `smartlead_delivery_evidence`, `smartlead_delivery_test_overview`, `smartlead_sender_delivery_health`, `smartlead_delivery_authentication_health`. Recipes: `account-health`.
- Gap (SENDOSS-163/166): live validation of Smartlead Smart Delivery shapes; auth-failure concentration by domain.

### Q6 — Replies and ICP
- Grain: reply / lead-sample. Denominator: observed for replies, sampled for leads. Provider scope: both. Freshness: cached (replies after hydration). Completeness: observed for replies, sampled for leads. Attribution: reply-hydrated / inferred. Privacy: sampled-PII / redacted. Evidence: hydrated-sample. Max claim: `observed` for reply volume, `sampled`/`directional` for ICP traits.
- States: answerable for reply volume after hydration; degraded for ICP (sample); non-comparable for reply-to-copy attribution without one-campaign hydration.
- Tables: `reply_emails`, `reply_email_hydration_state`, `reply_email_context`, `reply_context`, `sampled_leads`, `lead_evidence`, `lead_payload_kv`. Recipes: (reply/ICP references in `skills/sendlens-analyst/references/replies-icp-and-copy.md`).
- Gap (SENDOSS-166/168): reply-category parity; ICP trait coverage and inference eligibility; reply aggregates vs hydrated bodies have different scopes and must not be conflated.

### Q7 — Provider overlap
- Grain: lead / sender-domain. Denominator: observed. Provider scope: both. Freshness: cached. Completeness: observed. Attribution: cross-provider. Privacy: sampled-PII / redacted. Evidence: hydrated-sample. Max claim: `observed`/`directional`.
- States: answerable for collision risk; degraded when lead identity is sampled.
- Tables: `provider_overlap_risk`, `provider_overlap_risk_details`, `sampled_leads`, `lead_evidence`. Recipes: `cross-provider-overlap-risk`, `duplicate-contact-company-exposure`.
- Gap (SENDOSS-169): effective-dated cross-provider lineage; current overlap is point-in-time only.

### Q8 — Experiments and validity
- Grain: campaign/variant. Denominator: observed. Provider scope: both. Freshness: cached. Completeness: observed. Attribution: campaign-only. Privacy: aggregate. Evidence: coverage-summary + inferred. Max claim: `directional` at best; `none` if frame invalid.
- States: `after_hydration` for any A/B claim; `never` for statistical confidence unless the selection frame supports it.
- Tables: `step_analytics`, `campaign_variants`, `campaign_daily_metrics`, `sampling_runs`. Recipes: `campaign-launch-qa-checklist`.
- Gap (SENDOSS-170): experiment-validity checks and minimum-detectable-effect labeling; no statistical confidence unless the frame supports it.

### Q9 — Reporting reproducibility
- Grain: report. Denominator: exact for the report's declared scope. Provider scope: both. Freshness: cached at generation. Completeness: declared. Attribution: as-authored. Privacy: as-authored. Evidence: exact-fact + coverage-summary. Max claim: as the underlying contracts allow.
- States: answerable when evidence hashes exist; degraded when coverage changed since generation; unsupported when source evidence is gone.
- Tables: `sampling_runs`, `provider_capabilities`, plus the report's referenced tables. Recipes: (none yet — receipts are new).
- Gap (SENDOSS-171): replayable receipts, semantic reconciliation, and release proof do not exist.

## 5. Reconciliation Against Current Source

Current source: 45 public tables/views (`plugin/constants.ts` `PUBLIC_TABLES`), 60 recipes (`plugin/query-recipes.ts`). The parent's prior baseline drift (55 recipes / 37 tables) is superseded.

- Every required table in §4 already exists. **No new persisted table is required for the contract itself.** The contract is metadata that references existing surfaces.
- Proposed **new views** (only where a gap is proven, owned by later children, not this issue):
  - `sender_domain_lineage` (SENDOSS-169): effective-dated sender/domain → campaign assignment + quarantine state. Justification: current `campaign_accounts`/`account_daily_metrics` are point-in-time; blast-radius and lineage need effective dates.
  - `cross_provider_lead_overlap_effective` (SENDOSS-169): effective-dated overlap, extending `provider_overlap_risk`.
  - `analysis_receipt` (SENDOSS-171): report receipt + evidence hash + coverage snapshot, for replayability.
- Proposed **metadata additions** (owned by later children, specified here):
  - `metric_contracts`, `question_evidence_contracts`, `analysis_eligibility` as catalog metadata extending `CatalogRecipeRouteCard` / `CatalogCorrectionPath` in `plugin/catalog.ts`.
  - `evidence_debt` and `max_claim_strength` fields on route cards.
- No recipe is duplicated. Existing recipes map to families as listed in §4; gaps are closed by later children adding recipes, not by redefining existing ones.

## 6. Live Validation vs Doc/Fixture Proof

Decides which surfaces `SENDOSS-163` must validate live vs which are provable from official docs/synthetic fixtures.

- **Live validation required** (shapes are partial or live-unvalidated): Smartlead global analytics, campaign daily, step/variant, account-daily, tag, reply-category, history; Instantly additional read surfaces not yet modeled; any denominator that depends on a provider wrapper/envelope.
- **Doc/fixture proof sufficient**: static enumerations (campaign statuses, tag types), documented pagination limits, and fields already covered by existing sanitized fixtures.
- **Manual gate**: live validation requires locally authorized provider access. No credentials belong in Linear. `SENDOSS-163` is `after_live_validation` until Brandon provides that access; an agent cannot self-serve it.

## 7. 500-Lead Boundary Statement

The fixed 500-lead threshold (`sampled_leads`, `sampling_runs`) is a **fast-path latency/coverage choice**, not a statistically representative provider-population sample. Consequences:

- Lead/ICP/reply-copy conclusions from the 500-lead sample are `sampled`/`directional`, never `population`.
- Statistical confidence is prohibited for 500-lead-sourced claims unless the selection frame is proven representative (it is not).
- Deep/incremental sync (`SENDOSS-167`) makes fuller coverage resumable without changing the fast startup path; it raises completeness, not statistical significance, unless the frame is redefined.

## 8. Migration / PR Sequence for Remaining Children

Dependency order (matches the parent Execution Index). Each child is one independently shippable PR on its own branch/worktree.

1. `SENDOSS-164` (this issue) — contract + sequence. Docs only. **Blocks all others.**
2. `SENDOSS-163` — provider response-shape validation harness + sanitized fixtures. Needs 164 + manual live-access gate. Blocks 165, 166.
3. `SENDOSS-165` — Instantly read expansion. Needs 164, 163.
4. `SENDOSS-166` — Smartlead analytics/mailbox/activity/reply expansion. Needs 164, 163.
5. `SENDOSS-167` — progressive deep/incremental sync + truthful sampling frames. Needs 165, 166. Blocks 168, 169, 171.
6. `SENDOSS-168` — inference eligibility, sufficiency, evidence debt. Needs 164, 167. Blocks 170, 171.
7. `SENDOSS-169` — sender/domain lineage + blast-radius. Needs 165, 166, 167. Blocks 170.
8. `SENDOSS-170` — experiment-validity checks + net-new recipes. Needs 168, 169. Blocks 171.
9. `SENDOSS-171` — replayable receipts, reconciliation, release proof. Needs 164, 167, 168, 170. Terminal.

PR boundaries: each child PR links its SENDOSS key, uses one branch, adds `ai:autofix-enabled` only when same-branch repair is safe and no live credentials/private fixtures are in play (off for 163, and for any 165/166 step touching live provider data). After each child merges, update the parent `SENDOSS-162` Execution Index.

## 9. Affected MCP / Recipe / Reference / Test Contracts

- MCP response contract: `docs/MCP_RESPONSE_CONTRACT.md` — add coverage/claim-state fields where responses carry analytical answers.
- Catalog: `plugin/catalog.ts` — extend `CatalogRecipeRouteCard` with `max_claim_strength`, `evidence_class`, `evidence_debt`; add `metric_contracts`/`question_evidence_contracts`/`analysis_eligibility` lookups.
- Recipes: `plugin/query-recipes.ts` — later children add net-new recipes; this issue changes none.
- Safety: `plugin/analysis-safety.ts` — `ColumnSafetyMetadata` already carries privacy class; ensure `evidence_debt` does not weaken the privacy guard.
- Skills: `skills/sendlens-analyst/references/schema-and-joins.md`, `replies-icp-and-copy.md`, `workspace-and-performance.md` — cite the new contract sections.
- Tests: `scripts/test-catalog-route-cards.mjs`, `scripts/test-query-recipes-contract.mjs`, `scripts/test-mcp-response-contract.mjs`, `scripts/test-prompt-contracts.mjs` — later children add contract assertions; this issue adds a plan-acceptance test only if a harness exists for plan docs (none today, so validation is repo preflight + `git diff --check`).

## 10. Acceptance Criteria Mapping

- Canonical questions have Instantly + Smartlead evidence contracts → §4 covers all nine families for both providers.
- Each contract distinguishes answerable/degraded/non-comparable/unsupported → `answer_state` + `degradation_trigger` in §3.2/§4.
- Existing and proposed tables mapped without duplicating semantics → §5 reconciliation; no new table for the contract; new views are justified and owned by later children.
- Child dependency order and migration boundaries explicit → §8.
- 500-lead boundary documented as latency/coverage, not significance → §7.
- Plan identifies every MCP/recipe/reference/test contract affected → §9.

## 11. Risks

- A vague manifest could duplicate current route cards. Mitigation: §5 proves where each new view/metadata field is necessary and references existing recipes by id.
- Provider live responses may differ from docs/fixtures. Mitigation: §6 routes those to `SENDOSS-163` live validation.
- Deep sync creates rate/latency/storage/migration pressure. Mitigation: `SENDOSS-167` owns resumable incremental sync; this contract only frames completeness semantics.
- Shared sender metrics cannot be assigned to campaigns without attribution bounds. Mitigation: §4 Q3 caps blast-radius at `directional` and requires explicit attribution bounds (SENDOSS-169).
- Statistical confidence overclaiming. Mitigation: §7 + §4 Q8 prohibit confidence unless the frame supports it.

## 12. Out of Scope

- Provider calls, schema migrations, runtime implementation (later children).
- A new workflow-planning MCP tool or public skill.
- Campaign/lead/account/email/webhook mutations.
- Storing credentials, mailbox connection fields, unnecessary raw headers, or unrestricted private message bodies.

## 13. Closeout Notes for Parent Execution Index

- This issue (`SENDOSS-164`) produces the contract above and changes no source.
- Next action after merge: `SENDOSS-163` (provider shape validation) — but it is gated on Brandon's locally authorized provider access; an agent cannot self-serve live validation.
- `SENDOSS-165`/`SENDOSS-166` may begin design from this contract immediately after 163, in parallel where provider surfaces are independent.
- Update `SENDOSS-162` Execution Index with the PR link, validation tier run, and the 163 manual-gate status once this PR merges.
