import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  CATALOG_ROUTE_CARD_RESPONSE_BUDGET_BYTES,
  buildCatalogSearchGuidance,
} = require("../build/plugin/catalog.js");
const {
  buildQueryRecipeResponse,
} = require("../build/plugin/query-recipes.js");

const REQUIRED_CARD_FIELDS = [
  "recipe_id",
  "intent",
  "grain",
  "time_basis",
  "attribution",
  "provider_scope",
  "population_scope",
  "tag_role",
  "cost_class",
  "privacy_class",
  "prerequisites",
  "safe_adaptations",
  "forbidden_adaptations",
];
const FORBIDDEN_SUMMARY_FRAGMENTS = [
  "demo_workspace",
  "Priority Demo",
  "/Users/",
  "/home/",
  "\"rows\":",
  "\"sql\":",
];
const FORBIDDEN_SUMMARY_SQL_PATTERNS = [
  /\bselect\s+/i,
  /\bwith\s+(?:recursive\s+)?[\w"`]+\s+as\s*\(/i,
  /\bsendlens\./i,
];

const senderRiskQuery = "show sender account deliverability and bounce risk for an exact campaign tag";
const first = buildCatalogSearchGuidance(senderRiskQuery, []);
const second = buildCatalogSearchGuidance(senderRiskQuery, []);

assert.deepEqual(second, first, "catalog route-card ordering must be deterministic");
assert.match(first.message, /compact route cards/i);
assert.match(first.message, /zero-row correction path/i);
assert.match(first.message, /reads no campaign evidence rows/i);
assert.match(first.message, /four-call follow-up budget starts at primary recipe lookup/i);
const senderRiskSuggestion = first.analysis_starter_suggestions[0];
assert.equal(senderRiskSuggestion?.concept, "campaign-tag sender risk");
assert.equal(senderRiskSuggestion?.recipe_ids[0], "campaign-sender-inventory-by-tag");
assert.deepEqual(
  senderRiskSuggestion?.route_cards?.map((card) => card.recipe_id),
  ["campaign-sender-inventory-by-tag", "tag-scope-audit"],
  "the canonical recipe and its directly linked correction recipe are the only sender-risk cards",
);
assert.deepEqual(
  senderRiskSuggestion?.correction_path,
  {
    from_recipe_id: "campaign-sender-inventory-by-tag",
    on_status: "zero_rows",
    correction_recipe_id: "tag-scope-audit",
    after_correction: "stop",
    max_follow_up_calls: 4,
    follow_up_starts_at: "primary_recipe_lookup",
    catalog_discovery_included: false,
  },
);

for (const query of [
  "bounce risk by tag for inboxes",
  "tag inbox deliverability",
  "tag account deliverability",
  "sender risk tagged",
]) {
  const guidance = buildCatalogSearchGuidance(query, []);
  assert.equal(
    guidance.analysis_starter_suggestions[0]?.concept,
    "campaign-tag sender risk",
    `reordered or shorthand composite intent must preserve canonical priority: ${query}`,
  );
  assert.equal(
    guidance.analysis_starter_suggestions[0]?.recipe_ids[0],
    "campaign-sender-inventory-by-tag",
  );
}

for (const card of senderRiskSuggestion.route_cards) {
  assert.deepEqual(Object.keys(card).sort(), [...REQUIRED_CARD_FIELDS].sort());
  for (const field of REQUIRED_CARD_FIELDS.slice(0, 10)) {
    assert.equal(typeof card[field], "string", `${card.recipe_id}.${field} must be a string`);
    assert.ok(card[field].trim().length > 0, `${card.recipe_id}.${field} must be non-empty`);
  }
  for (const field of REQUIRED_CARD_FIELDS.slice(10)) {
    assert.ok(Array.isArray(card[field]) && card[field].length > 0, `${card.recipe_id}.${field} must be non-empty`);
    assert.ok(card[field].length <= 3, `${card.recipe_id}.${field} must stay compact`);
    assert.ok(card[field].every((value) => value.length <= 180), `${card.recipe_id}.${field} entries must stay short`);
  }
}

assert.match(senderRiskSuggestion.route_cards[0].provider_scope, /source_provider/);
assert.match(senderRiskSuggestion.route_cards[0].provider_scope, /campaign_source_id/);
assert.match(senderRiskSuggestion.route_cards[0].population_scope, /active tagged campaigns/);
assert.match(senderRiskSuggestion.route_cards[0].tag_role, /campaign_tag_label/);
assert.match(senderRiskSuggestion.route_cards[1].tag_role, /campaign tags.*assignment\/account tags/i);
const correctionCard = senderRiskSuggestion.route_cards[1];
assert.match(correctionCard.safe_adaptations.join(" "), /\bstop\b/i);
assert.doesNotMatch(
  correctionCard.safe_adaptations.join(" "),
  /\bfollow\b|\bfurther\b|\b(?:campaign|account)-tag\b|\brecipe\b/i,
  "the packaged stop-only correction card must not authorize another recipe",
);

const encodedSuggestions = JSON.stringify(first.analysis_starter_suggestions);
assert.ok(
  Buffer.byteLength(encodedSuggestions, "utf8") <= CATALOG_ROUTE_CARD_RESPONSE_BUDGET_BYTES,
  "catalog route cards must remain within their documented response-size budget",
);
for (const fragment of FORBIDDEN_SUMMARY_FRAGMENTS) {
  assert.equal(encodedSuggestions.includes(fragment), false, `catalog summaries must not expose ${fragment}`);
}
for (const pattern of FORBIDDEN_SUMMARY_SQL_PATTERNS) {
  assert.equal(
    pattern.test(encodedSuggestions),
    false,
    `catalog summaries must not expose SQL/body fragment ${pattern}`,
  );
}

const allCardIds = first.analysis_starter_suggestions
  .flatMap((suggestion) => suggestion.route_cards ?? [])
  .map((card) => card.recipe_id);
assert.deepEqual(
  [...new Set(allCardIds)].sort(),
  ["campaign-sender-inventory-by-tag", "tag-scope-audit"],
  "catalog cards must stay limited to the proof route and its direct correction recipe",
);

const novelGuidance = buildCatalogSearchGuidance("provider opportunities by active campaign", []);
assert.deepEqual(
  novelGuidance.analysis_starter_suggestions.flatMap((suggestion) => suggestion.route_cards ?? []),
  [],
  "novel supported questions must retain the bounded custom-SQL escalation path",
);

const exactLookup = buildQueryRecipeResponse({
  recipe_id: "campaign-sender-inventory-by-tag",
});
assert.equal(exactLookup.output_shape, "single_recipe");
assert.equal(typeof exactLookup.recipes[0].sql, "string");
assert.deepEqual(exactLookup.recipes[0].zero_row_fallback, {
  on_status: "zero_rows",
  correction_recipe_id: "tag-scope-audit",
  after_correction: "stop",
  max_follow_up_calls: 4,
  follow_up_starts_at: "primary_recipe_lookup",
  catalog_discovery_included: false,
});

const compactIndex = buildQueryRecipeResponse({
  topic: "workspace-health",
  mode: "summary",
  page_size: 25,
});
const compactSenderRecipe = compactIndex.recipes.find(
  (recipe) => recipe.id === "campaign-sender-inventory-by-tag",
);
assert.ok(compactSenderRecipe);
assert.equal(compactSenderRecipe.sql, undefined);
assert.equal(compactSenderRecipe.zero_row_fallback, undefined);

console.log("catalog route-card contract tests passed");
