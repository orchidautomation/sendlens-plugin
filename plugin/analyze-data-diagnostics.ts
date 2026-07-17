import { performance } from "node:perf_hooks";
import { PUBLIC_TABLES } from "./constants";
import type { RefreshStatus } from "./refresh-status";

export const ANALYZE_DATA_DIAGNOSTICS_SCHEMA_VERSION = "analyze_data_diagnostics.v1";

export type AnalyzeDataDiagnosticStatus =
  | "ok"
  | "zero_rows"
  | "guard_rejected"
  | "query_error"
  | "cache_unavailable"
  | "unknown";

export type AnalyzeDataDiagnostics = {
  schema_version: typeof ANALYZE_DATA_DIAGNOSTICS_SCHEMA_VERSION;
  status: AnalyzeDataDiagnosticStatus;
  elapsed_ms: number;
  referenced_surfaces: string[];
  row_count: number;
  result_truncated: boolean;
  cache_status: RefreshStatus["status"];
  cache_generation: string | null;
};

export function buildAnalyzeDataDiagnostics(options: {
  status: AnalyzeDataDiagnosticStatus;
  startedAt: number;
  refreshStatus: RefreshStatus;
  sql: string | null;
  rowCount?: number;
  resultTruncated?: boolean;
}): AnalyzeDataDiagnostics {
  return {
    schema_version: ANALYZE_DATA_DIAGNOSTICS_SCHEMA_VERSION,
    status: options.status,
    elapsed_ms: Math.max(0, Math.round(performance.now() - options.startedAt)),
    referenced_surfaces: referencedPublicSurfaces(options.sql),
    row_count: options.rowCount ?? 0,
    result_truncated: options.resultTruncated ?? false,
    cache_status: options.refreshStatus.status,
    cache_generation: options.refreshStatus.lastSuccessAt ?? options.refreshStatus.endedAt ?? null,
  };
}

export function referencedPublicSurfaces(sql: string | null) {
  if (!sql) return [];
  const publicTables = new Set(PUBLIC_TABLES as readonly string[]);
  const surfaces: string[] = [];
  const surfacePattern = /\bsendlens\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
  let match: RegExpExecArray | null;
  while ((match = surfacePattern.exec(sql)) !== null) {
    const tableName = match[1];
    if (publicTables.has(tableName) && !surfaces.includes(tableName)) {
      surfaces.push(tableName);
    }
    if (surfaces.length >= 12) break;
  }
  return surfaces;
}
