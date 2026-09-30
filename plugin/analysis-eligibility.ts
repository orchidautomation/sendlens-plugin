// SENDOSS-168 — Inference eligibility, decision sufficiency, and evidence-debt.
// Read-only analytical guardrail: type what each answer may claim, stop when
// evidence is insufficient, and name the missing evidence most likely to
// change a decision. Never upgrade sampled/reconstructed/hydrated evidence.

export type ClaimClass =
  | "population_fact"
  | "finite_frame_estimate"
  | "observed_pattern"
  | "enriched_tail"
  | "reconstructed_content"
  | "anecdote";

export const CLAIM_CLASSES = [
  "population_fact",
  "finite_frame_estimate",
  "observed_pattern",
  "enriched_tail",
  "reconstructed_content",
  "anecdote",
] as const satisfies readonly ClaimClass[];

export type EvidenceFrame =
  | "complete"
  | "observed"
  | "sampled"
  | "enriched_tail"
  | "unsupported";

export type EligibilityInput = {
  frame: EvidenceFrame;
  cursorExhausted: boolean;
  completeness: "complete" | "observed" | "sampled" | "partial" | "unsupported";
  claim: ClaimClass;
  questionFamily?: string;
  missingSurface?: string | null;
  sourceProvider?: string | null;
};

export type EvidenceDebt = {
  blocked_question: string;
  blocked_claim: ClaimClass;
  missing_surface: string;
  source_provider: string;
  freshness_completeness: string;
  decision_impact: string;
  nearest_safe_conclusion: string;
  bounded_evidence_action: string;
};

export type EligibilityAssessment = {
  eligible: boolean;
  maxClaimClass: ClaimClass;
  statisticalClaimsAllowed: boolean;
  evidenceDebt: EvidenceDebt | null;
  nearestSafeConclusion: string;
  boundedEvidenceAction: string | null;
};

// Ordered claim strength: a claim is permitted only if it is <= the frame's max.
const CLAIM_STRENGTH: Record<ClaimClass, number> = {
  population_fact: 5,
  finite_frame_estimate: 4,
  observed_pattern: 3,
  enriched_tail: 2,
  reconstructed_content: 1,
  anecdote: 0,
};

// Maximum defensible claim class per evidence frame.
const FRAME_MAX_CLAIM: Record<EvidenceFrame, ClaimClass> = {
  complete: "population_fact",
  observed: "observed_pattern",
  sampled: "observed_pattern",
  enriched_tail: "enriched_tail",
  unsupported: "anecdote",
};

export function maxClaimClassForFrame(frame: EvidenceFrame): ClaimClass {
  return FRAME_MAX_CLAIM[frame] ?? "anecdote";
}

// Statistical / population-percentage claims require a provably exhaustive
// full-population frame. A partial cursor scan blocks them.
export function statisticalClaimsAllowed(input: EligibilityInput): boolean {
  return input.frame === "complete" && input.completeness === "complete" && input.cursorExhausted === true;
}

// Per-family minimum-evidence sufficiency: distinct families require distinct
// minimum frames before their claims can be marked eligible, so non-comparable
// requests (e.g. reply-to-copy attribution) cannot pass without their evidence.
const FRAME_STRENGTH: Record<EvidenceFrame, number> = {
  complete: 5,
  observed: 4,
  sampled: 3,
  enriched_tail: 2,
  unsupported: 0,
};

const FAMILY_MIN_FRAME: Record<string, EvidenceFrame> = {
  workspace: "observed",
  campaign_performance: "observed",
  // Reply/copy attribution requires hydrated reply + copy evidence (observed).
  reply: "observed",
  reply_to_copy: "observed",
  // ICP traits are sampled; a sampled frame is sufficient for directional ICP.
  icp: "sampled",
  // Copy/variant winner claims require one-campaign hydration (observed).
  copy: "observed",
  copy_variant: "observed",
  variant: "observed",
  // Deliverability is observed (test-based), not population.
  deliverability: "observed",
  // Cross-provider overlap uses sampled lead evidence.
  overlap: "sampled",
  provider_overlap: "sampled",
  // Provider comparison requires provider-qualified observed evidence.
  provider_comparison: "observed",
  experiment: "observed",
  reporting: "observed",
  observed: "observed",
};

const FAMILY_ALIASES: Record<string, string> = {
  workspace_health: "workspace",
  campaign: "campaign_performance",
  campaigns: "campaign_performance",
  replies_icp: "reply",
  reply_rate: "reply",
  replies: "reply",
  reply_quality: "reply",
  icp_signals: "icp",
  copy_auditor: "copy",
  copy_analysis: "copy",
  rendered_outbound: "copy",
  variants: "variant",
  step_variant: "variant",
  senders: "deliverability",
  sender: "deliverability",
  sender_domain: "deliverability",
  blast_radius: "deliverability",
  deliverability_health: "deliverability",
  inbox_placement: "deliverability",
  provider_compare: "provider_comparison",
  cross_provider_comparison: "provider_comparison",
  experiments: "experiment",
  experiment_validity: "experiment",
  report: "reporting",
  reporting_reproducibility: "reporting",
};

type FamilySufficiency = {
  met: boolean;
  required: EvidenceFrame | null;
  recognized: boolean;
};

function normalizedFamilyKey(raw: string) {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function canonicalFamily(raw: string): string {
  const key = normalizedFamilyKey(raw);
  if (FAMILY_MIN_FRAME[key]) return key;
  if (FAMILY_ALIASES[key]) return FAMILY_ALIASES[key];
  // Substring match for compound family labels.
  for (const alias of Object.keys(FAMILY_ALIASES).sort((a, b) => b.length - a.length)) {
    if (key.includes(alias)) return FAMILY_ALIASES[alias];
  }
  return key;
}

export function normalizeQuestionFamily(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const canonical = canonicalFamily(trimmed);
  return FAMILY_MIN_FRAME[canonical] ? canonical : null;
}

function minimumFrameForFamilyClaim(
  family: string,
  claim: ClaimClass,
): EvidenceFrame {
  // Reconstructed copy can support a reconstructed-content finding without
  // being upgraded to an observed winner claim. Stronger copy claims still
  // require one-campaign observed/hydrated evidence.
  if (
    (family === "copy" || family === "copy_variant")
    && (claim === "reconstructed_content" || claim === "enriched_tail")
  ) {
    return "enriched_tail";
  }
  return FAMILY_MIN_FRAME[family];
}

export function familySufficiencyMet(
  questionFamily: string | null,
  frame: EvidenceFrame,
  claim: ClaimClass = "observed_pattern",
): FamilySufficiency {
  if (!questionFamily?.trim()) return { met: true, required: null, recognized: true };
  const family = canonicalFamily(questionFamily);
  if (!FAMILY_MIN_FRAME[family]) {
    return { met: false, required: null, recognized: false };
  }
  const required = minimumFrameForFamilyClaim(family, claim);
  return {
    met: FRAME_STRENGTH[frame] >= FRAME_STRENGTH[required],
    required,
    recognized: true,
  };
}

export function assessEligibility(input: EligibilityInput): EligibilityAssessment {
  const maxClaim = maxClaimClassForFrame(input.frame);
  const statAllowed = statisticalClaimsAllowed(input);
  const permitted = input.frame !== "unsupported" && CLAIM_STRENGTH[input.claim] <= CLAIM_STRENGTH[maxClaim];
  // Statistical / population-percentage claims (population_fact and finite_frame_estimate)
  // require a complete, cursor-exhausted frame; apply the gate to both.
  const requiresStat = input.claim === "population_fact" || input.claim === "finite_frame_estimate";
  const statOk = !requiresStat || statAllowed;
  // Per-family minimum-evidence sufficiency.
  const familyOk = familySufficiencyMet(input.questionFamily ?? null, input.frame, input.claim);
  const eligible = permitted && statOk && familyOk.met;

  const blockedReasons: string[] = [];
  if (!permitted) blockedReasons.push(`frame=${input.frame} supports at most ${maxClaim}`);
  if (requiresStat && !statAllowed) blockedReasons.push("statistical/population claim requires a complete, cursor-exhausted frame");
  if (!familyOk.recognized) {
    blockedReasons.push(`question family ${safeFamilyLabel(input.questionFamily)} is not recognized; normalize it before claiming sufficiency`);
  } else if (!familyOk.met) {
    blockedReasons.push(`question family ${safeFamilyLabel(input.questionFamily)} requires ${familyOk.required}`);
  }
  // Nearest safe claim = strongest claim that satisfies frame + stat + family gates.
  const claimOrder: ClaimClass[] = ["population_fact", "finite_frame_estimate", "observed_pattern", "enriched_tail", "reconstructed_content", "anecdote"];
  const nearestSafeClaim =
    claimOrder.find((candidate) => {
      const candPermitted = input.frame !== "unsupported" && CLAIM_STRENGTH[candidate] <= CLAIM_STRENGTH[maxClaim];
      const candRequiresStat = candidate === "population_fact" || candidate === "finite_frame_estimate";
      const candStatOk = !candRequiresStat || statAllowed;
      const candFamilyOk = familySufficiencyMet(input.questionFamily ?? null, input.frame, candidate);
      return candPermitted && candStatOk && candFamilyOk.recognized && candFamilyOk.met;
    }) ?? null;
  const nearestSafeConclusion = eligible
    ? `Claim permitted at ${input.claim} (frame=${input.frame}).`
    : !familyOk.recognized
      ? `No claim is safe for ${safeFamilyLabel(input.questionFamily)} until the question family is normalized to a supported family.`
      : !familyOk.met && nearestSafeClaim == null
        ? `No claim is safe for ${safeFamilyLabel(input.questionFamily)} until the required ${familyOk.required} evidence frame is available.`
        : `Claim ${input.claim} is not supported: ${blockedReasons.join("; ")}. Nearest safe conclusion is ${nearestSafeClaim ?? "anecdote"}.`;

  const boundedEvidenceAction = eligible
    ? null
    : boundedActionForFrame(input.frame, input.missingSurface ?? null);

  const evidenceDebt: EvidenceDebt | null = eligible
    ? null
    : {
        blocked_question: safeFamilyLabel(input.questionFamily),
        blocked_claim: input.claim,
        missing_surface: input.missingSurface ?? missingSurfaceForFrame(input.frame),
        source_provider: input.sourceProvider ?? "unknown",
        freshness_completeness: `${input.completeness}|cursor_exhausted=${input.cursorExhausted}`,
        decision_impact: decisionImpactFor(input.claim),
        nearest_safe_conclusion: nearestSafeConclusion,
        bounded_evidence_action: boundedEvidenceAction ?? "stop; do not upgrade the claim",
      };

  return {
    eligible,
    maxClaimClass: maxClaim,
    statisticalClaimsAllowed: statAllowed,
    evidenceDebt,
    nearestSafeConclusion,
    boundedEvidenceAction,
  };
}

function safeFamilyLabel(questionFamily: string | null | undefined) {
  const normalized = questionFamily ? normalizedFamilyKey(questionFamily) : "unspecified";
  return normalized.slice(0, 80) || "unspecified";
}

function boundedActionForFrame(frame: EvidenceFrame, missingSurface: string | null): string {
  switch (frame) {
    case "complete":
      return "re-run the provider cursor to exhaustion before any population claim";
    case "observed":
      return "hydrate one campaign or complete the provider cursor before population claims";
    case "sampled":
      return "label as observed/sample; do not generalize to the population";
    case "enriched_tail":
      return "keep the finding in the enriched-tail lane; exclude from prevalence";
    case "unsupported":
      return "record the surface as unsupported; route to a corrective recipe";
    default:
      return "stop; do not upgrade the claim";
  }
}

function missingSurfaceForFrame(frame: EvidenceFrame): string {
  switch (frame) {
    case "sampled":
      return "full-population lead/message evidence";
    case "enriched_tail":
      return "representative population frame for the enriched tail";
    case "unsupported":
      return "provider surface";
    default:
      return "cursor exhaustion / completeness proof";
  }
}

function decisionImpactFor(claim: ClaimClass): string {
  if (claim === "population_fact") return "prevents population-level percentage/winner claims";
  if (claim === "finite_frame_estimate") return "prevents finite-frame rate estimates";
  if (claim === "observed_pattern") return "limits claims to observed patterns";
  return "limits claims to anecdotal/reconstructed evidence";
}
