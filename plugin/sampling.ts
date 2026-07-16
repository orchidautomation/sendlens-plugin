import { createHash } from "node:crypto";
import {
  FULL_LEADS_THRESHOLD,
  MAX_SIGNAL_REPLY_LEADS,
  MAX_REPLY_LEAD_PAGES,
  MIN_NONREPLY_LEAD_SAMPLE,
  MIN_SIGNAL_REPLY_LEADS,
  MAX_NONREPLY_LEAD_SAMPLE,
  MAX_OUTBOUND_EMAIL_SAMPLE,
} from "./constants";

export type SamplingMode = "full" | "hybrid";
export const DETERMINISTIC_SAMPLING_ALGORITHM_VERSION = "stable-hash-v1";

export type SamplingProvenance = {
  algorithmVersion: string;
  seed: string;
  requestedWindowStartAt: string | null;
  requestedWindowEndAt: string | null;
  effectivePopulationSize: number;
  selectedRecordCount: number;
  populationFingerprint: string;
  provenanceStatus: "known";
};

export function shouldUseFullRawIngest(
  totalLeads: number,
  _totalSent: number,
): boolean {
  // Lead pagination completeness is bounded by the lead population, not
  // send volume. A large draft/low-volume campaign must still use hybrid
  // coverage instead of claiming a capped lead pull is full.
  return totalLeads <= FULL_LEADS_THRESHOLD;
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

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableToken(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function deriveSamplingSeed(parts: Array<unknown>) {
  return sha256Hex(parts.map(stableToken).join("\x1f"));
}

export function populationFingerprint(recordIds: Array<unknown>) {
  const hashedIds = recordIds
    .map(stableToken)
    .filter(Boolean)
    .map((id) => sha256Hex(id))
    .sort();
  return sha256Hex(hashedIds.join("\n"));
}

export function deterministicSample<T>(
  items: T[],
  limit: number,
  options: {
    seed: string;
    identity: (item: T) => unknown;
  },
): T[] {
  if (limit <= 0 || items.length === 0) return [];
  if (items.length <= limit) return [...items];

  return [...items]
    .map((item) => {
      const identity = stableToken(options.identity(item));
      return {
        item,
        identity,
        rank: sha256Hex(`${options.seed}\x1f${identity}`),
      };
    })
    .sort((a, b) => a.rank.localeCompare(b.rank) || a.identity.localeCompare(b.identity))
    .slice(0, limit)
    .map(({ item }) => item);
}

export function buildSamplingProvenance(options: {
  workspaceId: string;
  campaignId: string;
  sourceProvider: string;
  ingestMode: string;
  sampleSource: string;
  recordIds: Array<unknown>;
  selectedRecordIds: Array<unknown>;
  requestedWindowStartAt?: string | null;
  requestedWindowEndAt?: string | null;
}): SamplingProvenance {
  const seed = deriveSamplingSeed([
    DETERMINISTIC_SAMPLING_ALGORITHM_VERSION,
    options.workspaceId,
    options.sourceProvider,
    options.campaignId,
    options.ingestMode,
    options.sampleSource,
    options.requestedWindowStartAt ?? "",
    options.requestedWindowEndAt ?? "",
  ]);
  return {
    algorithmVersion: DETERMINISTIC_SAMPLING_ALGORITHM_VERSION,
    seed,
    requestedWindowStartAt: options.requestedWindowStartAt ?? null,
    requestedWindowEndAt: options.requestedWindowEndAt ?? null,
    effectivePopulationSize: options.recordIds.length,
    selectedRecordCount: options.selectedRecordIds.length,
    populationFingerprint: populationFingerprint(options.recordIds),
    provenanceStatus: "known",
  };
}
