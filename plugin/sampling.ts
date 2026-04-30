import {
  FULL_EMAILS_THRESHOLD,
  FULL_LEADS_THRESHOLD,
  MAX_NONREPLY_LEAD_SAMPLE,
  MAX_OUTBOUND_EMAIL_SAMPLE,
} from "./constants";

export type SamplingMode = "full" | "hybrid";

export function shouldUseFullRawIngest(
  totalLeads: number,
  totalSent: number,
): boolean {
  return totalLeads <= FULL_LEADS_THRESHOLD || totalSent <= FULL_EMAILS_THRESHOLD;
}

export function calculateNonReplyLeadSampleSize(
  totalLeads: number,
  repliedLeadCount = 0,
  limit = MAX_NONREPLY_LEAD_SAMPLE,
): number {
  const nonReplyPopulation = Math.max(0, totalLeads - repliedLeadCount);
  return Math.min(limit, nonReplyPopulation);
}

export function allocateVariantEmailCaps(
  activeVariantKeys: string[],
  totalCap = MAX_OUTBOUND_EMAIL_SAMPLE,
): Record<string, number> {
  if (activeVariantKeys.length === 0 || totalCap <= 0) {
    return {};
  }

  const base = Math.floor(totalCap / activeVariantKeys.length);
  const remainder = totalCap % activeVariantKeys.length;
  const caps: Record<string, number> = {};

  activeVariantKeys.forEach((key, index) => {
    caps[key] = base + (index < remainder ? 1 : 0);
  });

  return caps;
}

export function inferSamplingMode(
  totalLeads: number,
  totalSent: number,
): SamplingMode {
  return shouldUseFullRawIngest(totalLeads, totalSent) ? "full" : "hybrid";
}

export function reservoirSample<T>(items: T[], limit: number): T[] {
  if (limit <= 0 || items.length === 0) return [];
  if (items.length <= limit) return [...items];

  const sample = items.slice(0, limit);
  for (let i = limit; i < items.length; i++) {
    const j = Math.floor(Math.random() * (i + 1));
    if (j < limit) {
      sample[j] = items[i];
    }
  }
  return sample;
}
