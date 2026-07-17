import assert from "node:assert/strict";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { seedDemoWorkspace } = require("../build/plugin/demo-workspace.js");
const {
  closeDb,
  getDb,
  query,
  resetDbConnectionForTests,
} = require("../build/plugin/local-db.js");
const {
  buildQueryRecipeResponse,
  getQueryRecipes,
  QUERY_RECIPE_TOPICS,
} = require("../build/plugin/query-recipes.js");
const { enforceLocalWorkspaceScope } = require("../build/plugin/sql-guard.js");

const WORKSPACE_ID = "demo_workspace";
const PLACEHOLDER_FIXTURES = new Map([
  ["account_tag_name", "Demo Sender Pool"],
  ["campaign_id", "demo-alpha"],
  ["campaign_name", "Demo - Healthcare Operators"],
  ["campaign_tag_name", "Priority Demo"],
  ["payload_key", "segment"],
  ["tag_name", "Priority Demo"],
]);
const REGRESSION_RECIPE_IDS = new Set([
  "cross-provider-overlap-risk",
  "duplicate-contact-company-exposure",
  "personalization-leak-audit",
  "personalization-leak-raw-detail",
]);

process.env.SENDLENS_DB_PATH = path.join(
  os.tmpdir(),
  `sendlens-recipes-contract-${Date.now()}.duckdb`,
);
process.env.SENDLENS_STATE_DIR = path.dirname(process.env.SENDLENS_DB_PATH);
process.env.SENDLENS_DEMO_MODE = "1";

await resetDbConnectionForTests();
await seedDemoWorkspace();

const db = await getDb();
try {
  const recipes = QUERY_RECIPE_TOPICS.flatMap((topic) => getQueryRecipes(topic));
  assert.ok(recipes.length > 0, "expected published query recipes to be discovered");

  const recipeIds = recipes.map((recipe) => recipe.id);
  assert.equal(
    new Set(recipeIds).size,
    recipeIds.length,
    "query recipe IDs must be unique",
  );
  for (const regressionId of REGRESSION_RECIPE_IDS) {
    assert.ok(
      recipeIds.includes(regressionId),
      `${regressionId} must stay covered by the exhaustive recipe contract`,
    );
  }

  const routeCardRecipes = recipes.filter((recipe) => recipe.route_card);
  assert.ok(routeCardRecipes.length >= 5, "expected high-risk/common recipes to expose route cards");
  for (const recipe of routeCardRecipes) {
    assertRouteCardComplete(recipe);
  }

  const exactSenderRisk = recipes.find((recipe) => recipe.id === "campaign-sender-inventory-by-tag");
  assert.ok(exactSenderRisk?.route_card, "campaign sender inventory needs a route card");
  assert.match(exactSenderRisk.route_card.preferred_intent, /campaign-tag sender/i);
  assert.match(exactSenderRisk.route_card.tag_role, /campaign_tag_label/);
  assert.match(exactSenderRisk.route_card.provider_scope, /campaign_source_id/);
  assert.match(exactSenderRisk.route_card.time_basis, /30-day/);
  assert.ok(
    exactSenderRisk.route_card.forbidden_adaptations.some((adaptation) => /workspace_snapshot/.test(adaptation)),
    "exact sender-risk route card must forbid broad snapshot before the recipe",
  );

  const summaryResponse = buildQueryRecipeResponse({
    topic: "workspace-health",
    mode: "summary",
    page_size: 5,
  });
  assert.equal(summaryResponse.output_shape, "compact_recipe_index");
  assert.ok(summaryResponse.recipes.every((recipe) => recipe.sql === undefined), "summary mode must omit SQL");
  assert.ok(
    summaryResponse.recipes.some((recipe) => recipe.id === "campaign-sender-inventory-by-tag" && recipe.route_card),
    "route-card recipes should be ranked into bounded summary output",
  );

  const fullLookup = buildQueryRecipeResponse({
    recipe_id: "campaign-sender-inventory-by-tag",
  });
  assert.equal(fullLookup.output_shape, "single_recipe");
  assert.ok(fullLookup.recipes[0].sql.includes("campaign_tag_label"));
  assert.ok(fullLookup.recipes[0].route_card);

  const failures = [];
  for (const recipe of recipes) {
    try {
      const renderedSql = renderRecipeSql(recipe);
      const guardedSql = enforceLocalWorkspaceScope(renderedSql, WORKSPACE_ID);
      await query(db, guardedSql);
    } catch (err) {
      failures.push(`${recipe.id}: ${(err).message}`);
    }
  }

  assert.deepEqual(failures, []);
} finally {
  closeDb(db);
}

console.log("query recipe contract tests passed");

function assertRouteCardComplete(recipe) {
  for (const field of [
    "preferred_intent",
    "grain",
    "time_basis",
    "attribution",
    "provider_scope",
    "population_scope",
    "tag_role",
    "privacy",
  ]) {
    assert.equal(
      typeof recipe.route_card[field],
      "string",
      `${recipe.id} route_card.${field} must be a string`,
    );
    assert.ok(
      recipe.route_card[field].trim().length > 0,
      `${recipe.id} route_card.${field} must be non-empty`,
    );
  }
  for (const field of ["prerequisites", "safe_adaptations", "forbidden_adaptations"]) {
    assert.ok(
      Array.isArray(recipe.route_card[field]) && recipe.route_card[field].length > 0,
      `${recipe.id} route_card.${field} must be a non-empty array`,
    );
  }
  assert.ok(["low", "medium", "high"].includes(recipe.route_card.cost), `${recipe.id} route_card.cost must be bounded`);
}

function renderRecipeSql(recipe) {
  const missing = new Set();
  const rendered = recipe.sql.replaceAll(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, name) => {
    if (!PLACEHOLDER_FIXTURES.has(name)) {
      missing.add(name);
      return `{{${name}}}`;
    }
    return sqlStringLiteralValue(PLACEHOLDER_FIXTURES.get(name));
  });

  assert.deepEqual(
    [...missing].sort(),
    [],
    `${recipe.id} uses placeholders without contract fixtures`,
  );
  assert.doesNotMatch(
    rendered,
    /\{\{[a-zA-Z0-9_]+\}\}/,
    `${recipe.id} still has unsubstituted placeholders`,
  );
  return rendered;
}

function sqlStringLiteralValue(value) {
  return String(value).replaceAll("'", "''");
}
