import type { DuckDBConnection } from "@duckdb/node-api";
import { query } from "./local-db";
import { PUBLIC_TABLES, TABLE_DESCRIPTIONS, type PublicTableName } from "./constants";

export type TableInfo = {
  name: string;
  description: string;
};

export type ColumnInfo = {
  name: string;
  type: string;
};

export async function listTables(): Promise<TableInfo[]> {
  return PUBLIC_TABLES.map((name) => ({
    name,
    description: TABLE_DESCRIPTIONS[name],
  }));
}

export async function listColumns(
  conn: DuckDBConnection,
  tableName: string,
): Promise<ColumnInfo[]> {
  const clean = tableName.replace(/^sendlens\./i, "").trim();
  const rows = await query(
    conn,
    `SELECT column_name AS name, data_type AS type
     FROM information_schema.columns
     WHERE table_schema = 'sendlens' AND table_name = '${clean.replace(/'/g, "''")}'
     ORDER BY ordinal_position`,
  );
  return rows.map((row) => ({
    name: String(row.name),
    type: String(row.type),
  }));
}

export async function searchCatalog(
  conn: DuckDBConnection,
  search: string,
): Promise<Array<{ kind: "table" | "column"; table: string; column?: string; description: string }>> {
  const needle = search.trim().toLowerCase();
  if (!needle) return [];

  const matches: Array<{ kind: "table" | "column"; table: string; column?: string; description: string }> = [];

  for (const table of PUBLIC_TABLES) {
    const description = TABLE_DESCRIPTIONS[table as PublicTableName];
    if (table.includes(needle) || description.toLowerCase().includes(needle)) {
      matches.push({ kind: "table", table, description });
    }
  }

  for (const table of PUBLIC_TABLES) {
    const columns = await listColumns(conn, table);
    for (const column of columns) {
      if (column.name.toLowerCase().includes(needle) || column.type.toLowerCase().includes(needle)) {
        matches.push({
          kind: "column",
          table,
          column: column.name,
          description: `${column.name} (${column.type})`,
        });
      }
    }
  }

  return matches.slice(0, 25);
}
