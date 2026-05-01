import {
  FULL_EMAILS_THRESHOLD,
  FULL_LEADS_THRESHOLD,
  MAX_SIGNAL_REPLY_LEADS,
  MAX_REPLY_LEAD_PAGES,
  MIN_NONREPLY_LEAD_SAMPLE,
  MIN_SIGNAL_REPLY_LEADS,
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

export function calculateAdaptiveNonReplyLeadSampleSize(
  totalLeads: number,
  repliedLeadCount = 0,
  floor = MIN_NONREPLY_LEAD_SAMPLE,
  limit = MAX_NONREPLY_LEAD_SAMPLE,
): number {
  const nonReplyPopulation = Math.max(0, totalLeads - repliedLeadCount);
  if (nonReplyPopulation <= 0) return 0;
  const target = Math.ceil(Math.sqrt(Math.max(totalLeads, 1)));
  return Math.min(limit, nonReplyPopulation, Math.max(floor, target));
}

export function calculateAdaptiveSignalReplyTarget(
  totalLeads: number,
  floor = MIN_SIGNAL_REPLY_LEADS,
  limit = MAX_SIGNAL_REPLY_LEADS,
): number {
  const target = Math.ceil(Math.sqrt(Math.max(totalLeads, 1)) / 3);
  return Math.min(limit, Math.max(floor, target));
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
