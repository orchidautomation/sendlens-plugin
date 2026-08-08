import { performance } from "node:perf_hooks";
import { PUBLIC_TABLES } from "./constants";
import type { RefreshStatus } from "./refresh-status";
import {
  assessEligibility,
  maxClaimClassForFrame,
  normalizeQuestionFamily,
  type ClaimClass,
  type EvidenceDebt,
  type EvidenceFrame,
  type EligibilityInput,
} from "./analysis-eligibility";

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
  analysis_eligibility?: AnalyzeDataEligibility;
};

export type AnalyzeDataEligibility = {
  schema_version: "analysis_eligibility.v1";
  question_family: string | null;
  requested_claim: ClaimClass;
  evidence_frame: EvidenceFrame;
  completeness: EligibilityInput["completeness"];
  cursor_exhausted: boolean;
  source_provider: string;
  eligible: boolean;
  max_claim_class: ClaimClass;
  statistical_claims_allowed: boolean;
  nearest_safe_conclusion: string;
  bounded_evidence_action: string | null;
  evidence_debt: EvidenceDebt | null;
};

const PUBLIC_TABLE_SET = new Set(PUBLIC_TABLES as readonly string[]);

export function buildAnalyzeDataDiagnostics(options: {
  status: AnalyzeDataDiagnosticStatus;
  startedAt: number;
  refreshStatus: RefreshStatus;
  sql: string | null;
  rowCount?: number;
  resultTruncated?: boolean;
  analysisEligibility?: AnalyzeDataEligibility;
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
    ...(options.analysisEligibility
      ? { analysis_eligibility: options.analysisEligibility }
      : {}),
  };
}

const FRAME_STRENGTH: Record<EvidenceFrame, number> = {
  complete: 5,
  observed: 4,
  sampled: 3,
  enriched_tail: 2,
  unsupported: 0,
};

const SURFACE_FRAME: Record<string, EvidenceFrame> = {
  // These surfaces are bounded or selected evidence and cannot support
  // provider-population claims without an explicit complete frame.
  lead_evidence: "sampled",
  sampled_leads: "sampled",
  lead_payload_kv: "sampled",
  provider_overlap_risk: "sampled",
  provider_overlap_risk_details: "sampled",
  rendered_outbound_context: "enriched_tail",
  population_snapshots: "complete",
  sync_partitions: "complete",
  // Hydrated reply rows are observed evidence, but aggregate/body scope still
  // requires family-specific sufficiency before attribution claims.
  reply_context: "observed",
  reply_email_context: "observed",
  reply_emails: "observed",
};

const METADATA_FRAME_SURFACES = new Set([
  "population_snapshots",
  "sync_partitions",
  "sync_runs",
  "sampling_runs",
  "lead_evidence",
  "sampled_leads",
  "lead_payload_kv",
  "provider_overlap_risk",
  "provider_overlap_risk_details",
  "rendered_outbound_context",
  "reply_context",
  "reply_email_context",
  "reply_emails",
]);

const CLAIM_STRENGTH: Record<ClaimClass, number> = {
  population_fact: 5,
  finite_frame_estimate: 4,
  observed_pattern: 3,
  enriched_tail: 2,
  reconstructed_content: 1,
  anecdote: 0,
};

const CLAIM_PHRASES: Array<{ claim: ClaimClass; pattern: RegExp }> = [
  {
    claim: "population_fact",
    pattern: /\b(population|provider[- ]wide|prevalence|statistical|confidence|all leads|every lead|across the provider)\b/i,
  },
  {
    claim: "finite_frame_estimate",
    pattern: /\b(estimate|estimated|confidence interval|finite frame)\b/i,
  },
  {
    claim: "observed_pattern",
    pattern: /\b(winner|best|outperform|compare|comparison|lift|impact|attribut|pattern|trend)\b/i,
  },
];

function inferClaimClass(rationale: string): ClaimClass | null {
  for (const candidate of CLAIM_PHRASES) {
    if (candidate.pattern.test(rationale)) return candidate.claim;
  }
  return null;
}

function inferQuestionFamily(rationale: string) {
  const value = rationale.toLowerCase();
  if (/(reply[- _]?to[- _]?copy|reply.*copy|copy.*reply|attribution)/i.test(value)) return "reply_to_copy";
  if (/(provider[- _]?overlap|cross[- _]?provider|collision)/i.test(value)) return "provider_overlap";
  if (/(experiment|a\/?b|variant.*test|test.*variant)/i.test(value)) return "experiment";
  if (/(replay|receipt|reproduc|report run)/i.test(value)) return "reporting";
  if (/(icp|segment|audience|payload|lead trait)/i.test(value)) return "icp";
  if (/(copy|subject|template|rendered|personalization)/i.test(value)) return "copy";
  if (/(variant|step)/i.test(value)) return "variant";
  if (/(deliverability|inbox placement|sender|domain|warmup)/i.test(value)) return "deliverability";
  if (/(reply|objection|interest|response)/i.test(value)) return "reply";
  if (/(campaign|sequence|performance|runway|volume)/i.test(value)) return "campaign_performance";
  if (/(workspace|account|health)/i.test(value)) return "workspace";
  return null;
}

function normalizedFrame(value: unknown): EvidenceFrame | null {
  const frame = String(value ?? "").trim().toLowerCase();
  if (
    frame === "complete"
    || frame === "observed"
    || frame === "sampled"
    || frame === "enriched_tail"
    || frame === "unsupported"
  ) {
    return frame;
  }
  if (frame === "enriched-tail" || frame === "reconstructed") return "enriched_tail";
  return null;
}

function frameFromRow(row: Record<string, unknown>): EvidenceFrame | null {
  const explicit = normalizedFrame(
    row.evidence_frame ?? row.frame ?? row.coverage_mode ?? row.evidence_lane,
  );
  if (explicit) return explicit;
  if (String(row.support_status ?? "").toLowerCase() === "unsupported") return "unsupported";
  if (String(row.coverage_status ?? "").toLowerCase() === "unsupported") return "unsupported";
  return null;
}

function lowestStrengthFrame(frames: EvidenceFrame[]) {
  return frames.reduce<EvidenceFrame>(
    (lowest, frame) => FRAME_STRENGTH[frame] < FRAME_STRENGTH[lowest] ? frame : lowest,
    "complete",
  );
}

function sourceProviderFromRows(
  rows: Array<Record<string, unknown>>,
  metadataRows: Array<Record<string, unknown>>,
  fallback?: string | null,
) {
  const rowProviders = new Set(
    rows
      .map((row) => String(row.source_provider ?? "").trim().toLowerCase())
      .filter((provider) => provider === "instantly" || provider === "smartlead"),
  );
  if (rowProviders.size > 1) return "mixed";
  if (rowProviders.size === 1) return [...rowProviders][0];
  const providers = new Set(
    metadataRows
      .map((row) => String(row.source_provider ?? "").trim().toLowerCase())
      .filter((provider) => provider === "instantly" || provider === "smartlead"),
  );
  if (providers.size > 1) return "mixed";
  if (providers.size === 1) return [...providers][0];
  const normalizedFallback = fallback?.trim().toLowerCase();
  return normalizedFallback === "instantly" || normalizedFallback === "smartlead"
    ? normalizedFallback
    : "unknown";
}

function evidenceFrameForAnalysis(options: {
  surfaces: string[];
  rows: Array<Record<string, unknown>>;
  metadataRows: Array<Record<string, unknown>>;
  resultTruncated: boolean;
}) {
  const surfaceFrames = options.surfaces
    .map((surface) => SURFACE_FRAME[surface] ?? "observed")
    .filter(Boolean);
  const rowFrames = options.rows.map(frameFromRow).filter((frame): frame is EvidenceFrame => Boolean(frame));
  const latestMetadata = options.metadataRows[0];
  const metadataFrame = latestMetadata ? normalizedFrame(latestMetadata.frame) : null;
  const metadataCursorExhausted = latestMetadata?.cursor_exhausted === true;
  const frames = [...surfaceFrames, ...rowFrames];
  if (metadataFrame && options.surfaces.some((surface) => METADATA_FRAME_SURFACES.has(surface))) {
    frames.push(metadataFrame);
  }
  if (frames.length === 0) frames.push("observed");

  let frame = lowestStrengthFrame(frames);
  if (options.resultTruncated && frame === "complete") frame = "observed";

  const directComplete = options.rows.some((row) =>
    normalizedFrame(row.evidence_frame ?? row.frame) === "complete"
    && (row.cursor_exhausted === true || row.exhausted === true),
  );
  const cursorExhausted = frame === "complete"
    && !options.resultTruncated
    && (metadataCursorExhausted || directComplete);
  const completeness: EligibilityInput["completeness"] = frame === "complete"
    ? cursorExhausted ? "complete" : "partial"
    : frame === "sampled"
      ? "sampled"
      : frame === "unsupported"
        ? "unsupported"
        : frame === "enriched_tail"
          ? "partial"
          : "observed";

  return { frame, completeness, cursorExhausted };
}

function missingSurfaceForFrame(frame: EvidenceFrame) {
  switch (frame) {
    case "sampled":
      return "full-population evidence for the referenced analytical surface";
    case "enriched_tail":
      return "representative population evidence for reconstructed outbound content";
    case "unsupported":
      return "a supported provider surface";
    default:
      return "completeness and cursor-exhaustion proof";
  }
}

export function buildAnalyzeDataEligibility(options: {
  sql: string | null;
  rationale: string;
  rows?: Array<Record<string, unknown>>;
  metadataRows?: Array<Record<string, unknown>>;
  resultTruncated?: boolean;
  questionFamily?: string | null;
  claimClass?: ClaimClass;
  sourceProvider?: string | null;
}): AnalyzeDataEligibility {
  const rows = options.rows ?? [];
  const metadataRows = options.metadataRows ?? [];
  const surfaces = referencedPublicSurfaces(options.sql);
  const inferredClaim = inferClaimClass(options.rationale);
  const requestedClaim = options.claimClass
    ? inferredClaim && CLAIM_STRENGTH[inferredClaim] > CLAIM_STRENGTH[options.claimClass]
      ? inferredClaim
      : options.claimClass
    : inferredClaim ?? "observed_pattern";
  const requestedFamily = options.questionFamily?.trim() || inferQuestionFamily(options.rationale);
  const normalizedFamily = normalizeQuestionFamily(requestedFamily);
  const evidence = evidenceFrameForAnalysis({
    surfaces,
    rows,
    metadataRows,
    resultTruncated: options.resultTruncated ?? false,
  });
  const sourceProvider = sourceProviderFromRows(rows, metadataRows, options.sourceProvider);
  const assessment = assessEligibility({
    frame: evidence.frame,
    completeness: evidence.completeness,
    cursorExhausted: evidence.cursorExhausted,
    claim: requestedClaim,
    questionFamily: requestedFamily ?? undefined,
    missingSurface: missingSurfaceForFrame(evidence.frame),
    sourceProvider,
  });

  return {
    schema_version: "analysis_eligibility.v1",
    question_family: normalizedFamily ?? (requestedFamily ? "unrecognized" : null),
    requested_claim: requestedClaim,
    evidence_frame: evidence.frame,
    completeness: evidence.completeness,
    cursor_exhausted: evidence.cursorExhausted,
    source_provider: sourceProvider,
    eligible: assessment.eligible,
    max_claim_class: maxClaimClassForFrame(evidence.frame),
    statistical_claims_allowed: assessment.statisticalClaimsAllowed,
    nearest_safe_conclusion: assessment.nearestSafeConclusion,
    bounded_evidence_action: assessment.boundedEvidenceAction,
    evidence_debt: assessment.evidenceDebt,
  };
}


export function referencedPublicSurfaces(sql: string | null) {
  if (!sql) return [];
  const surfaces: string[] = [];
  const seen = new Set<string>();
  const surfacePattern = /\bsendlens\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
  let match: RegExpExecArray | null;
  while ((match = surfacePattern.exec(sql)) !== null) {
    const tableName = match[1];
    if (PUBLIC_TABLE_SET.has(tableName) && !seen.has(tableName)) {
      seen.add(tableName);
      surfaces.push(tableName);
    }
    if (surfaces.length >= 12) break;
  }
  return surfaces;
}
