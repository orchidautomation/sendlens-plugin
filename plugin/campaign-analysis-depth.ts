export type CampaignAnalysisDepth = "fast" | "balanced" | "maximum";

export type CampaignAnalysisDepthConfig = {
  depth: CampaignAnalysisDepth;
  maxPagesPerStatus: number;
  targetStoredRowsPerStatus: number;
  contextSampleLimit: number;
};

export const DEFAULT_CAMPAIGN_ANALYSIS_STATUSES = [1, -1, -2] as const;
export const OOO_REPLY_STATUS = 0;

const DEPTH_CONFIGS: Record<CampaignAnalysisDepth, CampaignAnalysisDepthConfig> = {
  fast: {
    depth: "fast",
    maxPagesPerStatus: 1,
    targetStoredRowsPerStatus: 10,
    contextSampleLimit: 30,
  },
  balanced: {
    depth: "balanced",
    maxPagesPerStatus: 3,
    targetStoredRowsPerStatus: 30,
    contextSampleLimit: 75,
  },
  maximum: {
    depth: "maximum",
    maxPagesPerStatus: 5,
    targetStoredRowsPerStatus: 50,
    contextSampleLimit: 125,
  },
};

export function resolveCampaignAnalysisDepth(
  depth: CampaignAnalysisDepth | undefined,
) {
  return DEPTH_CONFIGS[depth ?? "balanced"];
}

export function normalizeCampaignAnalysisStatuses(
  statuses: number[] | undefined,
  includeOoo = false,
) {
  const base = statuses?.length
    ? statuses
    : [...DEFAULT_CAMPAIGN_ANALYSIS_STATUSES];
  const normalized = [...new Set(base.filter(Number.isInteger))];
  if (includeOoo && !normalized.includes(OOO_REPLY_STATUS)) {
    normalized.push(OOO_REPLY_STATUS);
  }
  return normalized;
}

export function classifyHydrationCoverage(
  rowsStored: number,
  targetStoredRows: number,
  exhausted: boolean,
) {
  if (rowsStored >= targetStoredRows) return "target_met";
  if (exhausted) return "exhausted_below_target";
  return "partial_cap_reached";
}
