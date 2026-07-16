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
