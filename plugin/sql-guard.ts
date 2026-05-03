import { Parser } from "node-sql-parser";
import { PUBLIC_TABLES } from "./constants";

const DIALECT = { database: "postgresql" } as const;
const ALLOWED_SCHEMA = "sendlens";
const ALLOWED_TABLES = new Set(PUBLIC_TABLES);

export class LocalSqlGuardError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "parse_failed"
      | "not_select"
      | "disallowed_table"
      | "disallowed_schema"
      | "unsupported_shape",
  ) {
    super(message);
    this.name = "LocalSqlGuardError";
  }
}

type SelectNode = {
  type: "select";
  with: CteNode[] | null;
  from: FromNode[] | null;
  where: ExprNode | null;
  _next?: SelectNode | null;
  set_op?: string | null;
};

type CteNode = {
  name: { value: string };
  stmt: SelectNode | { ast?: SelectNode };
};

type FromNode = {
  type?: string | null;
  db?: string | null;
  table?: string | null;
  as?: string | null;
  expr?: { ast?: SelectNode; type?: string | null };
};

type ExprNode = {
  type: string;
  operator?: string;
  left?: ExprNode;
  right?: ExprNode;
  ast?: SelectNode;
  value?: unknown;
  table?: string | null;
  column?: unknown;
  collate?: unknown;
};

export function enforceLocalWorkspaceScope(sql: string, workspaceId: string) {
  const stripped = sql.replace(/;+\s*$/, "").trim();
  if (!stripped) {
    throw new LocalSqlGuardError("empty query", "parse_failed");
  }

  const parser = new Parser();
  let ast: unknown;
  try {
    ast = parser.astify(stripped, DIALECT);
  } catch (err) {
    throw new LocalSqlGuardError(
      `could not parse query: ${(err as Error).message}`,
      "parse_failed",
    );
  }

  if (Array.isArray(ast)) {
    if (ast.length !== 1) {
      throw new LocalSqlGuardError("only one statement allowed", "not_select");
    }
    ast = ast[0];
  }

  const root = ast as SelectNode;
  if (!root || root.type !== "select") {
    throw new LocalSqlGuardError("only SELECT statements are allowed", "not_select");
  }

  rewriteSelect(root, workspaceId, collectCteNames(root));
  return parser.sqlify(root as unknown as Parameters<Parser["sqlify"]>[0], DIALECT);
}

function collectCteNames(node: SelectNode, inherited = new Set<string>()) {
  const names = new Set(inherited);
  if (Array.isArray(node.with)) {
    for (const cte of node.with) {
      if (cte?.name?.value) names.add(cte.name.value);
    }
  }
  return names;
}

function rewriteSelect(
  node: SelectNode,
  workspaceId: string,
  parentCtes: Set<string>,
) {
  if (node.set_op || node._next) {
    throw new LocalSqlGuardError(
      "set operations are not allowed",
      "unsupported_shape",
    );
  }

  const visibleCtes = new Set(parentCtes);
  if (Array.isArray(node.with)) {
    for (const cte of node.with) {
      if (cte?.name?.value) visibleCtes.add(cte.name.value);
    }
    for (const cte of node.with) {
      const stmt = unwrapSelect(cte.stmt);
      if (stmt) rewriteSelect(stmt, workspaceId, visibleCtes);
    }
  }

  const injections: ExprNode[] = [];
  if (Array.isArray(node.from)) {
    for (const entry of node.from) {
      if (entry?.expr?.ast) {
        rewriteSelect(entry.expr.ast, workspaceId, visibleCtes);
        continue;
      }

      const table = entry?.table;
      if (!table) {
        throw new LocalSqlGuardError(
          "only sendlens.* tables, CTEs, and subqueries are allowed in FROM; table-valued functions and other expression sources are blocked",
          "unsupported_shape",
        );
      }
      if (!entry.db && visibleCtes.has(table)) continue;
      if (!entry.db) {
        throw new LocalSqlGuardError(
          `table "${table}" must be qualified as ${ALLOWED_SCHEMA}.${table}`,
          "disallowed_schema",
        );
      }
      if (entry.db !== ALLOWED_SCHEMA) {
        throw new LocalSqlGuardError(
          `only ${ALLOWED_SCHEMA}.* tables are allowed`,
          "disallowed_schema",
        );
      }
      if (!ALLOWED_TABLES.has(table as (typeof PUBLIC_TABLES)[number])) {
        throw new LocalSqlGuardError(
          `table "${entry.db}.${table}" is not allowed`,
          "disallowed_table",
        );
      }

      const qualifier = entry.as || table;
      injections.push(buildWorkspaceFilter(qualifier, workspaceId));
    }
  }

  if (injections.length > 0) {
    node.where = injections.reduce(
      (acc, filter) => andExpr(acc, filter),
      node.where ?? null,
    );
  }

  if (node.where) {
    walkExprForSubqueries(node.where, workspaceId, visibleCtes);
  }
}

function unwrapSelect(stmt: CteNode["stmt"] | null | undefined) {
  if (!stmt) return null;
  if ("type" in stmt && (stmt as SelectNode).type === "select") {
    return stmt as SelectNode;
  }
  if ("ast" in stmt && stmt.ast) return stmt.ast;
  return null;
}

function walkExprForSubqueries(
  expr: unknown,
  workspaceId: string,
  cteNames: Set<string>,
  seen = new Set<object>(),
) {
  if (!expr || typeof expr !== "object") return;
  if (seen.has(expr)) return;
  seen.add(expr);

  const node = expr as Record<string, unknown>;
  const ast = node.ast;
  if (ast && typeof ast === "object" && (ast as SelectNode).type === "select") {
    rewriteSelect(ast as SelectNode, workspaceId, cteNames);
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === "ast") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        walkExprForSubqueries(item, workspaceId, cteNames, seen);
      }
      continue;
    }
    walkExprForSubqueries(value, workspaceId, cteNames, seen);
  }
}

function buildWorkspaceFilter(qualifier: string, workspaceId: string): ExprNode {
  return {
    type: "binary_expr",
    operator: "=",
    left: {
      type: "column_ref",
      table: qualifier,
      column: { expr: { type: "default", value: "workspace_id" } },
      collate: null,
    } as unknown as ExprNode,
    right: {
      type: "single_quote_string",
      value: workspaceId,
    } as unknown as ExprNode,
  };
}

function andExpr(left: ExprNode | null, right: ExprNode): ExprNode {
  if (!left) return right;
  return {
    type: "binary_expr",
    operator: "AND",
    left,
    right,
  };
}
