import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Parser } = require("node-sql-parser");
const {
  enforceLocalWorkspaceScope,
  LocalSqlGuardError,
} = require("../build/plugin/sql-guard.js");

const parser = new Parser();
const DIALECT = { database: "postgresql" };
const WORKSPACE_ID = "ws_test";

function assertGuardError(sql, code, messagePattern) {
  assert.throws(
    () => enforceLocalWorkspaceScope(sql, WORKSPACE_ID),
    (err) =>
      err instanceof LocalSqlGuardError
      && err.code === code
      && messagePattern.test(err.message),
    `${sql} should fail with ${code}`,
  );
}

function countWorkspaceFilters(sql) {
  return [...sql.matchAll(/workspace_id = 'ws_test'/g)].length;
}

const tableFunctionFixtures = [
  {
    name: "read_csv_auto",
    sql: "SELECT * FROM read_csv_auto('/tmp/leads.csv')",
  },
  {
    name: "read_parquet",
    sql: "SELECT * FROM read_parquet('/tmp/leads.parquet')",
  },
  {
    name: "read_json_auto",
    sql: "SELECT * FROM read_json_auto('https://example.com/leads.json')",
  },
  {
    name: "query_table",
    sql: "SELECT * FROM query_table('campaigns')",
  },
];

for (const fixture of tableFunctionFixtures) {
  const ast = parser.astify(fixture.sql, DIALECT);
  const fromEntry = ast.from?.[0];

  assert.equal(fromEntry?.type, "expr", `${fixture.name} should parse as a FROM expression`);
  assert.equal(
    fromEntry?.expr?.type,
    "function",
    `${fixture.name} should parse as a function expression`,
  );

  assert.throws(
    () => enforceLocalWorkspaceScope(fixture.sql, WORKSPACE_ID),
    (err) =>
      err instanceof LocalSqlGuardError
      && err.code === "unsupported_shape"
      && /table-valued functions/.test(err.message),
    `${fixture.name} should be blocked by the SQL guard`,
  );
}

const simpleSelect = enforceLocalWorkspaceScope(
  "SELECT c.name FROM sendlens.campaigns c",
  WORKSPACE_ID,
);
assert.match(simpleSelect, /workspace_id = 'ws_test'/);
assert.equal(countWorkspaceFilters(simpleSelect), 1);

const joinedSelect = enforceLocalWorkspaceScope(
  [
    "SELECT c.name, ca.reply_count_unique",
    "FROM sendlens.campaigns c",
    "JOIN sendlens.campaign_analytics ca ON c.id = ca.campaign_id",
  ].join(" "),
  WORKSPACE_ID,
);
assert.match(joinedSelect, /"?c"?\.workspace_id = 'ws_test'/);
assert.match(joinedSelect, /"?ca"?\.workspace_id = 'ws_test'/);
assert.equal(countWorkspaceFilters(joinedSelect), 2);

const cteSelect = enforceLocalWorkspaceScope(
  [
    "WITH active_campaigns AS (",
    "  SELECT id, name FROM sendlens.campaigns WHERE status = 'active'",
    ")",
    "SELECT name FROM active_campaigns",
  ].join(" "),
  WORKSPACE_ID,
);
assert.match(cteSelect, /workspace_id = 'ws_test'/);
assert.equal(countWorkspaceFilters(cteSelect), 1);

const cteJoinSelect = enforceLocalWorkspaceScope(
  [
    "WITH lead_counts AS (",
    "  SELECT campaign_id, count(*) AS lead_count",
    "  FROM sendlens.sampled_leads",
    "  GROUP BY campaign_id",
    ")",
    "SELECT c.name, lead_counts.lead_count",
    "FROM sendlens.campaigns c",
    "JOIN lead_counts ON lead_counts.campaign_id = c.id",
  ].join(" "),
  WORKSPACE_ID,
);
assert.match(cteJoinSelect, /"?c"?\.workspace_id = 'ws_test'/);
assert.match(cteJoinSelect, /"?sampled_leads"?\.workspace_id = 'ws_test'/);
assert.equal(countWorkspaceFilters(cteJoinSelect), 2);

const subquerySelect = enforceLocalWorkspaceScope(
  [
    "SELECT sq.name",
    "FROM (SELECT id, name FROM sendlens.campaigns) sq",
  ].join(" "),
  WORKSPACE_ID,
);
assert.match(subquerySelect, /workspace_id = 'ws_test'/);
assert.equal(countWorkspaceFilters(subquerySelect), 1);

const existsSubquerySelect = enforceLocalWorkspaceScope(
  [
    "SELECT c.id",
    "FROM sendlens.campaigns c",
    "WHERE EXISTS (",
    "  SELECT 1",
    "  FROM sendlens.sampled_leads sl",
    "  WHERE sl.campaign_id = c.id",
    ")",
  ].join(" "),
  WORKSPACE_ID,
);
assert.match(existsSubquerySelect, /"?c"?\.workspace_id = 'ws_test'/);
assert.match(existsSubquerySelect, /"?sl"?\.workspace_id = 'ws_test'/);
assert.equal(countWorkspaceFilters(existsSubquerySelect), 2);

const existingWhereSelect = enforceLocalWorkspaceScope(
  "SELECT c.id FROM sendlens.campaigns c WHERE c.status = 'active'",
  WORKSPACE_ID,
);
assert.match(existingWhereSelect, /status = 'active'/);
assert.match(existingWhereSelect, /"?c"?\.workspace_id = 'ws_test'/);

assertGuardError(
  "DELETE FROM sendlens.campaigns WHERE workspace_id = 'ws_test'",
  "not_select",
  /only SELECT statements/,
);
assertGuardError(
  "SELECT * FROM sendlens.campaigns; SELECT * FROM sendlens.accounts",
  "not_select",
  /only one statement/,
);
assertGuardError(
  "SELECT * FROM campaigns",
  "disallowed_schema",
  /must be qualified/,
);
assertGuardError(
  "SELECT * FROM public.campaigns",
  "disallowed_schema",
  /only sendlens\.\* tables/,
);
assertGuardError(
  "SELECT * FROM sendlens.plugin_state",
  "disallowed_table",
  /not allowed/,
);
assertGuardError(
  "SELECT * FROM sendlens.campaigns UNION SELECT * FROM sendlens.accounts",
  "unsupported_shape",
  /set operations/,
);

console.log("sql guard tests passed");
