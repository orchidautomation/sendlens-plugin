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

export function assessEligibility(input: EligibilityInput): EligibilityAssessment {
  const maxClaim = maxClaimClassForFrame(input.frame);
  const statAllowed = statisticalClaimsAllowed(input);
  const permitted = input.frame !== "unsupported" && CLAIM_STRENGTH[input.claim] <= CLAIM_STRENGTH[maxClaim];
  // A population_fact claim additionally requires an exhaustive complete frame.
  const populationClaimOk =
    input.claim !== "population_fact" || (input.frame === "complete" && input.cursorExhausted === true);
  const eligible = permitted && populationClaimOk;

  const nearestSafeConclusion = eligible
    ? `Claim permitted at ${input.claim} (frame=${input.frame}).`
    : `Claim ${input.claim} is not supported by frame=${input.frame}; nearest safe conclusion is ${maxClaim}.`;

  const boundedEvidenceAction = eligible
    ? null
    : boundedActionForFrame(input.frame, input.missingSurface ?? null);

  const evidenceDebt: EvidenceDebt | null = eligible
    ? null
    : {
        blocked_question: input.questionFamily ?? "unspecified",
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
