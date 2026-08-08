export const QUERY_RECIPE_TOPICS = [
  "workspace-health",
  "campaign-performance",
  "account-manager-brief",
  "campaign-launch-qa",
  "experiment-planner",
  "copy-analysis",
  "reply-patterns",
  "icp-signals",
  "tags",
] as const;

export type QueryRecipeTopic = (typeof QUERY_RECIPE_TOPICS)[number];

export type QueryRecipe = {
  id: string;
  topic: QueryRecipeTopic;
  title: string;
  question: string;
  exactness: "exact" | "sampled" | "hybrid";
  rationale: string;
  route_card?: QueryRecipeRouteCard;
  zero_row_fallback?: QueryRecipeZeroRowFallback;
  sql: string;
  notes: string[];
};

export type QueryRecipeRouteCard = {
  preferred_intent: string;
  grain: string;
  time_basis: string;
  attribution: string;
  provider_scope: string;
  population_scope: string;
  tag_role: string;
  prerequisites: string[];
  cost: "low" | "medium" | "high";
  privacy: string;
  privacy_class: string;
  safe_adaptations: string[];
  forbidden_adaptations: string[];
};

export type QueryRecipeZeroRowFallback = {
  on_status: "zero_rows";
  correction_recipe_id: string;
  after_correction: "stop";
  max_follow_up_calls: 4;
  follow_up_starts_at: "primary_recipe_lookup";
  catalog_discovery_included: false;
};

export type QueryRecipeSummary = Omit<QueryRecipe, "sql" | "notes" | "zero_row_fallback"> & {
  sql_available: true;
};

export type QueryRecipeMode = "summary" | "full";

export type QueryRecipeResponseOptions = {
  topic?: string;
  recipe_id?: string;
  mode?: QueryRecipeMode;
  page?: number;
  page_size?: number;
};

const DEFAULT_RECIPE_PAGE_SIZE = 10;
const MAX_RECIPE_PAGE_SIZE = 25;

const QUERY_RECIPES: QueryRecipe[] = [
  {
    id: "experiment-validity-audit",
    topic: "experiment-planner",
    title: "Experiment validity audit",
    question: "Can I compare these campaign variants, and what evidence is still missing?",
    exactness: "hybrid",
    rationale: "Make spillover, frame, hydration, denominator, and variant-mapping risk explicit before interpreting an experiment result.",
    route_card: {
      preferred_intent: "variant comparison validity and evidence-readiness audit",
      grain: "one row per campaign, step, and variant arm",
      time_basis: "current cached step analytics plus sampling-run evidence frame",
      attribution: "campaign-step-variant only; shared infrastructure and overlap are surfaced as risk",
      provider_scope: "provider-qualified campaign_source_id and provider-specific semantics",
      population_scope: "observed campaign arms; population claims require a complete frame and compatible denominator",
      tag_role: "none; resolve campaign or tag scope before this audit",
      prerequisites: ["experiment_validity_checks public view", "resolved campaign-step-variant metrics"],
      cost: "low",
      privacy: "aggregate validity fields only; no lead identity, reply body, or rendered copy",
      privacy_class: "aggregate_only",
      safe_adaptations: ["filter to one campaign or step", "sort by comparison_state or evidence_action"],
      forbidden_adaptations: ["call an arm a winner when state is not decision_eligible", "treat minimum_detectable_effect_pct as statistical confidence", "promote sampled rows to population prevalence"],
    },
    sql: `SELECT
  workspace_id,
  source_provider,
  campaign_id,
  campaign_source_id,
  campaign_name,
  step,
  variant,
  comparison_grain,
  variant_count,
  variant_mapping_status,
  sent,
  unique_replies,
  observed_reply_rate_pct,
  comparison_sent,
  comparison_unique_replies,
  comparison_reply_rate_pct,
  frame_status,
  hydration_status,
  shared_sender_count,
  shared_domain_count,
  sampled_overlap_count,
  comparison_state,
  evidence_action,
  minimum_detectable_effect_status,
  minimum_detectable_effect_pct,
  provider_experiment_semantics
FROM sendlens.experiment_validity_checks
ORDER BY
  CASE comparison_state
    WHEN 'spillover_risk' THEN 1
    WHEN 'measurement_gap' THEN 2
    WHEN 'non_comparable' THEN 3
    ELSE 4
  END,
  campaign_name,
  step,
  variant;`,
    notes: [
      "Run this before choosing a winner, calculating lift, or recommending a follow-up test.",
      "decision_eligible means the cached directional comparison passes the local contract; it does not grant statistical significance.",
      "Rows marked spillover_risk, measurement_gap, or non_comparable need the evidence_action before interpretation.",
    ],
  },
  {
    id: "relative-sender-quality",
    topic: "experiment-planner",
    title: "Relative sender quality for a controlled comparison",
    question: "How does sender quality differ across campaign, list, copy, time, or experiment arms?",
    exactness: "sampled",
    rationale: "Compare sampled outbound and reply signals by sender while preserving sender/domain spillover and sample-only limits.",
    route_card: {
      preferred_intent: "relative sender quality controlling campaign, list, copy, and time",
      grain: "sender, campaign, sent date, step, and variant aggregate",
      time_basis: "sampled outbound sent_at date and current lead evidence",
      attribution: "sender-scoped observed evidence; campaign attribution requires the outbound campaign_source_id",
      provider_scope: "provider-qualified sender and campaign identity",
      population_scope: "sampled outbound contacts only; not sender-account population performance",
      tag_role: "none; use exact tag recipes to define the campaign set first",
      prerequisites: ["sampled_outbound_emails", "lead_evidence", "campaign_asset_edges for spillover checks"],
      cost: "medium",
      privacy: "sender address and aggregate rates; no lead address, reply body, or message body",
      privacy_class: "operational_identifiers",
      safe_adaptations: ["filter to one provider or campaign", "group a bounded date window or step"],
      forbidden_adaptations: ["claim sender causality from unbalanced campaigns or lists", "treat sampled reply rates as inbox-wide prevalence", "hide shared sender/domain risk"],
    },
    sql: `WITH known_edges AS (
  SELECT DISTINCT workspace_id, source_provider, campaign_source_id, sender_email, sender_domain
  FROM sendlens.campaign_asset_edges
  WHERE edge_status = 'known'
),
sender_usage AS (
  SELECT workspace_id, source_provider, sender_email, COUNT(DISTINCT campaign_source_id) AS campaign_count
  FROM known_edges
  WHERE sender_email IS NOT NULL
  GROUP BY 1, 2, 3
),
domain_usage AS (
  SELECT workspace_id, source_provider, sender_domain, COUNT(DISTINCT campaign_source_id) AS campaign_count
  FROM known_edges
  WHERE sender_domain IS NOT NULL
  GROUP BY 1, 2, 3
),
asset_risk AS (
  SELECT
    e.workspace_id,
    e.source_provider,
    e.campaign_source_id,
    COUNT(DISTINCT CASE WHEN su.campaign_count > 1 THEN e.sender_email END) AS shared_sender_count,
    COUNT(DISTINCT CASE WHEN du.campaign_count > 1 THEN e.sender_domain END) AS shared_domain_count
  FROM known_edges e
  LEFT JOIN sender_usage su
    ON e.workspace_id = su.workspace_id
   AND e.source_provider = su.source_provider
   AND e.sender_email = su.sender_email
  LEFT JOIN domain_usage du
    ON e.workspace_id = du.workspace_id
   AND e.source_provider = du.source_provider
   AND e.sender_domain = du.sender_domain
  GROUP BY 1, 2, 3
)
SELECT
  so.workspace_id,
  COALESCE(so.source_provider, 'instantly') AS source_provider,
  so.campaign_id,
  so.campaign_source_id,
  so.from_email AS sender_email,
  CAST(so.sent_at AS DATE) AS sent_date,
  CAST(so.step_resolved AS INTEGER) AS step,
  CAST(so.variant_resolved AS INTEGER) AS variant,
  COUNT(DISTINCT so.id) AS sampled_outbound_rows,
  COUNT(DISTINCT lower(trim(so.to_email))) AS sampled_contacts,
  COUNT(DISTINCT CASE WHEN COALESCE(le.has_reply_signal, FALSE) THEN lower(trim(so.to_email)) END) AS sampled_replying_contacts,
  COUNT(DISTINCT CASE WHEN le.reply_outcome_label = 'positive' THEN lower(trim(so.to_email)) END) AS sampled_positive_contacts,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN COALESCE(le.has_reply_signal, FALSE) THEN lower(trim(so.to_email)) END) / NULLIF(COUNT(DISTINCT lower(trim(so.to_email))), 0), 2) AS sampled_reply_rate_pct,
  COALESCE(MAX(ar.shared_sender_count), 0) AS shared_sender_count,
  COALESCE(MAX(ar.shared_domain_count), 0) AS shared_domain_count,
  'sampled' AS evidence_frame,
  CASE
    WHEN COALESCE(MAX(ar.shared_sender_count), 0) > 0 OR COALESCE(MAX(ar.shared_domain_count), 0) > 0 THEN 'spillover_risk'
    WHEN COUNT(DISTINCT lower(trim(so.to_email))) = 0 THEN 'measurement_gap'
    ELSE 'measurement_gap'
  END AS comparison_state
FROM sendlens.sampled_outbound_emails so
LEFT JOIN sendlens.lead_evidence le
  ON so.workspace_id = le.workspace_id
 AND so.campaign_id = le.campaign_id
 AND COALESCE(so.source_provider, 'instantly') = le.source_provider
 AND lower(trim(so.to_email)) = le.normalized_email
LEFT JOIN asset_risk ar
  ON so.workspace_id = ar.workspace_id
 AND COALESCE(so.source_provider, 'instantly') = ar.source_provider
 AND so.campaign_source_id = ar.campaign_source_id
WHERE so.from_email IS NOT NULL
  AND trim(so.from_email) <> ''
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
ORDER BY comparison_state, sent_date DESC NULLS LAST, sampled_reply_rate_pct DESC NULLS LAST;`,
    notes: [
      "This is intentionally sampled: it is a directional sender-quality view, not an inbox-account benchmark.",
      "Control campaign, list, copy, and time outside this recipe only when those dimensions are actually balanced and provider-qualified.",
      "A shared sender or domain is a spillover risk even when the observed reply rate looks favorable.",
    ],
  },
  {
    id: "sequence-marginal-yield",
    topic: "experiment-planner",
    title: "Sequence marginal yield",
    question: "What marginal reply yield does each sequence step add?",
    exactness: "exact",
    rationale: "Compare provider-reported step aggregates in order while flagging missing prior steps and template truncation.",
    route_card: {
      preferred_intent: "sequence marginal reply yield by campaign and step",
      grain: "one row per provider-qualified campaign and sequence step",
      time_basis: "cached step analytics sync snapshot",
      attribution: "provider campaign-step analytics; not a lead-level causal attribution",
      provider_scope: "provider-qualified campaign_source_id",
      population_scope: "cached step analytics rows; missing or truncated steps are measurement gaps",
      tag_role: "none; filter to a campaign set before comparing sequences",
      prerequisites: ["step_analytics", "campaign_variants for configured-step coverage"],
      cost: "low",
      privacy: "aggregate step counts and derived rates only",
      privacy_class: "aggregate_only",
      safe_adaptations: ["filter to one campaign or provider", "compare adjacent steps only"],
      forbidden_adaptations: ["interpret a missing prior step as zero yield", "claim sequence completion from analytics rows alone", "use step rates as a randomized experiment result"],
    },
    sql: `WITH step_rollup AS (
  SELECT
    workspace_id,
    COALESCE(source_provider, 'instantly') AS source_provider,
    campaign_id,
    campaign_source_id,
    step,
    SUM(COALESCE(sent, 0)) AS step_sent,
    SUM(COALESCE(unique_replies, 0)) AS step_unique_replies,
    SUM(COALESCE(replies, 0)) AS step_replies,
    SUM(COALESCE(bounces, 0)) AS step_bounces
  FROM sendlens.step_analytics
  GROUP BY 1, 2, 3, 4, 5
),
defined_steps AS (
  SELECT
    workspace_id,
    COALESCE(source_provider, 'instantly') AS source_provider,
    campaign_id,
    MAX(step) AS max_defined_step,
    COUNT(DISTINCT step) AS defined_step_count
  FROM sendlens.campaign_variants
  GROUP BY 1, 2, 3
),
ordered AS (
  SELECT
    sr.*,
    LAG(sr.step) OVER (PARTITION BY sr.workspace_id, sr.source_provider, sr.campaign_id ORDER BY sr.step) AS prior_step,
    LAG(sr.step_sent) OVER (PARTITION BY sr.workspace_id, sr.source_provider, sr.campaign_id ORDER BY sr.step) AS prior_step_sent,
    LAG(sr.step_unique_replies) OVER (PARTITION BY sr.workspace_id, sr.source_provider, sr.campaign_id ORDER BY sr.step) AS prior_step_unique_replies,
    ds.max_defined_step,
    ds.defined_step_count
  FROM step_rollup sr
  LEFT JOIN defined_steps ds
    ON sr.workspace_id = ds.workspace_id
   AND sr.source_provider = ds.source_provider
   AND sr.campaign_id = ds.campaign_id
)
SELECT
  workspace_id,
  source_provider,
  campaign_id,
  campaign_source_id,
  step,
  step_sent,
  step_unique_replies,
  step_replies,
  step_bounces,
  ROUND(100.0 * step_unique_replies / NULLIF(step_sent, 0), 2) AS step_reply_rate_pct,
  prior_step,
  prior_step_sent,
  prior_step_unique_replies,
  ROUND(100.0 * prior_step_unique_replies / NULLIF(prior_step_sent, 0), 2) AS prior_step_reply_rate_pct,
  ROUND(
    100.0 * step_unique_replies / NULLIF(step_sent, 0)
      - 100.0 * prior_step_unique_replies / NULLIF(prior_step_sent, 0),
    2
  ) AS change_vs_prior_step_pct_points,
  max_defined_step,
  defined_step_count,
  CASE
    WHEN step_sent <= 0 THEN 'non_comparable'
    WHEN step > 1 AND (prior_step IS NULL OR prior_step <> step - 1) THEN 'measurement_gap'
    WHEN max_defined_step IS NULL OR step > max_defined_step THEN 'measurement_gap'
    ELSE 'decision_eligible'
  END AS comparison_state
FROM ordered
ORDER BY campaign_id, step;`,
    notes: [
      "The marginal field is a rate change versus the prior observed step, not an incremental causal effect.",
      "A missing prior step is a measurement gap rather than a zero-reply baseline.",
    ],
  },
  {
    id: "first-reply-step",
    topic: "reply-patterns",
    title: "First reply step and variant",
    question: "At which step and variant do sampled leads first reply?",
    exactness: "sampled",
    rationale: "Summarize sampled first-reply step and variant signals without presenting a small cohort as population prevalence.",
    route_card: {
      preferred_intent: "first reply step and variant distribution",
      grain: "one row per campaign, reply step, and reply variant",
      time_basis: "sampled lead provider reply fields and sampling-run frame",
      attribution: "provider-qualified sampled lead evidence",
      provider_scope: "provider-qualified campaign_source_id",
      population_scope: "sampled replying leads; prevalence is not available unless the frame is complete",
      tag_role: "none; resolve campaign scope before reading step distribution",
      prerequisites: ["lead_evidence", "sampling_runs"],
      cost: "low",
      privacy: "aggregate reply counts and labels only; no contact or body output",
      privacy_class: "aggregate_only",
      safe_adaptations: ["filter to one campaign", "group variants only after step is fixed"],
      forbidden_adaptations: ["call the most common step the causal winner", "claim population prevalence from a sampled frame", "combine providers without provider-qualified keys"],
    },
    sql: `WITH frame_rollup AS (
  SELECT
    workspace_id,
    campaign_id,
    COALESCE(source_provider, 'instantly') AS source_provider,
    CASE
      WHEN lead_cursor_exhausted = TRUE AND lower(COALESCE(provenance_status, '')) IN ('complete', 'exact') THEN 'complete'
      WHEN lead_cursor_exhausted = FALSE THEN 'partial'
      WHEN lower(COALESCE(provenance_status, '')) IN ('sampled', 'enriched_tail') OR lower(COALESCE(ingest_mode, '')) LIKE '%sample%' THEN 'sampled'
      ELSE 'observed'
    END AS frame_status
  FROM sendlens.sampling_runs
)
SELECT
  le.workspace_id,
  le.source_provider,
  le.campaign_id,
  le.campaign_source_id,
  le.email_replied_step AS first_reply_step,
  COALESCE(le.email_replied_variant, 0) AS first_reply_variant,
  COUNT(*) AS sampled_replying_leads,
  SUM(CASE WHEN le.reply_outcome_label = 'positive' THEN 1 ELSE 0 END) AS sampled_positive_leads,
  SUM(CASE WHEN le.reply_outcome_label = 'negative' THEN 1 ELSE 0 END) AS sampled_negative_leads,
  COALESCE(fr.frame_status, 'unsupported') AS frame_status,
  CASE WHEN COALESCE(fr.frame_status, 'unsupported') = 'complete' THEN 'decision_eligible' ELSE 'measurement_gap' END AS comparison_state
FROM sendlens.lead_evidence le
LEFT JOIN frame_rollup fr
  ON le.workspace_id = fr.workspace_id
 AND le.campaign_id = fr.campaign_id
 AND le.source_provider = fr.source_provider
WHERE le.has_reply_signal = TRUE
  AND le.email_replied_step IS NOT NULL
GROUP BY 1, 2, 3, 4, 5, 6, 10
ORDER BY sampled_replying_leads DESC, first_reply_step, first_reply_variant;`,
    notes: [
      "This is a sampled distribution of observed first-reply fields; it does not prove the step caused the reply.",
      "Keep rare cohorts descriptive and report the frame status with every comparison.",
    ],
  },
  {
    id: "follow-up-yield",
    topic: "experiment-planner",
    title: "Follow-up marginal yield",
    question: "Do follow-up steps add enough reply yield to justify keeping them?",
    exactness: "exact",
    rationale: "Expose follow-up step volume and reply yield with explicit configured-step and truncation checks.",
    route_card: {
      preferred_intent: "follow-up step yield and truncation risk",
      grain: "one row per campaign and follow-up step",
      time_basis: "cached provider step analytics snapshot",
      attribution: "campaign-step aggregate; no lead-level causal attribution",
      provider_scope: "provider-qualified campaign_source_id",
      population_scope: "observed follow-up analytics rows; frame completeness remains separate",
      tag_role: "none; use a bounded campaign set",
      prerequisites: ["step_analytics", "campaign_variants"],
      cost: "low",
      privacy: "aggregate follow-up counts and derived rates only",
      privacy_class: "aggregate_only",
      safe_adaptations: ["filter to steps greater than one", "compare follow-up steps within one campaign"],
      forbidden_adaptations: ["treat an absent step as a zero-yield follow-up", "ignore configured-step truncation", "claim a follow-up caused a reply"],
    },
    sql: `WITH step_rollup AS (
  SELECT
    workspace_id,
    COALESCE(source_provider, 'instantly') AS source_provider,
    campaign_id,
    campaign_source_id,
    step,
    SUM(COALESCE(sent, 0)) AS follow_up_sent,
    SUM(COALESCE(unique_replies, 0)) AS follow_up_unique_replies,
    SUM(COALESCE(bounces, 0)) AS follow_up_bounces
  FROM sendlens.step_analytics
  WHERE step > 1
  GROUP BY 1, 2, 3, 4, 5
),
configured AS (
  SELECT
    workspace_id,
    COALESCE(source_provider, 'instantly') AS source_provider,
    campaign_id,
    MAX(step) AS max_configured_step,
    COUNT(DISTINCT step) AS configured_step_count
  FROM sendlens.campaign_variants
  GROUP BY 1, 2, 3
)
SELECT
  sr.workspace_id,
  sr.source_provider,
  sr.campaign_id,
  sr.campaign_source_id,
  sr.step,
  sr.follow_up_sent,
  sr.follow_up_unique_replies,
  sr.follow_up_bounces,
  ROUND(100.0 * sr.follow_up_unique_replies / NULLIF(sr.follow_up_sent, 0), 2) AS follow_up_yield_pct,
  c.max_configured_step,
  c.configured_step_count,
  CASE
    WHEN sr.follow_up_sent <= 0 THEN 'non_comparable'
    WHEN c.max_configured_step IS NULL OR sr.step > c.max_configured_step THEN 'measurement_gap'
    ELSE 'decision_eligible'
  END AS comparison_state
FROM step_rollup sr
LEFT JOIN configured c
  ON sr.workspace_id = c.workspace_id
 AND sr.source_provider = c.source_provider
 AND sr.campaign_id = c.campaign_id
ORDER BY comparison_state, follow_up_yield_pct DESC NULLS LAST, sr.campaign_id, sr.step;`,
    notes: [
      "Follow-up yield is directional provider analytics, not an incremental causal estimate.",
      "If analytics extends beyond configured variants or skips a step, fix the frame before making a keep/remove decision.",
    ],
  },
  {
    id: "reply-objection-cohorts",
    topic: "reply-patterns",
    title: "Reply objection cohorts",
    question: "Which objection cohorts appear by ICP payload, list, step, and variant?",
    exactness: "sampled",
    rationale: "Classify hydrated reply text into bounded objection labels and join only safe aggregate cohort dimensions.",
    route_card: {
      preferred_intent: "reply objection cohorts by list, payload family, step, and variant",
      grain: "campaign, list, payload-family, step, variant, and objection aggregate",
      time_basis: "hydrated sampled reply context and sampled lead metadata",
      attribution: "provider-qualified reply cohort; message text is used only for a derived label",
      provider_scope: "provider-qualified campaign_source_id",
      population_scope: "hydrated sampled replies; no prevalence claim for all replies",
      tag_role: "none; scope campaigns or lists before interpreting cohorts",
      prerequisites: ["reply_context with hydrated replies", "lead_evidence", "lead_payload_kv"],
      cost: "medium",
      privacy: "derived objection labels and aggregate dimensions; reply body, email, and payload values are suppressed",
      privacy_class: "aggregate_only",
      safe_adaptations: ["filter to one campaign or list", "group rare labels into other"],
      forbidden_adaptations: ["return reply bodies or contact identifiers", "treat a small objection cohort as population prevalence", "infer ICP performance from payload values without a balanced frame"],
    },
    sql: `WITH payload_presence AS (
  SELECT
    workspace_id,
    campaign_id,
    normalized_email,
    string_agg(DISTINCT payload_key_family, ', ' ORDER BY payload_key_family) AS payload_key_families
  FROM sendlens.lead_payload_kv
  WHERE payload_key_family IS NOT NULL
  GROUP BY 1, 2, 3
),
reply_rows AS (
  SELECT
    rc.workspace_id,
    rc.source_provider,
    rc.campaign_id,
    rc.campaign_source_id,
    le.list_id,
    COALESCE(CAST(rc.step_resolved AS VARCHAR), 'unresolved_step') AS step,
    COALESCE(CAST(rc.variant_resolved AS VARCHAR), 'unresolved_variant') AS variant,
    rc.reply_email_id,
    rc.reply_outcome_label,
    COALESCE(pp.payload_key_families, 'no_mapped_payload') AS payload_key_families,
    CASE
      WHEN regexp_matches(lower(COALESCE(rc.reply_body_text, rc.reply_content_preview, '')), '(current vendor|happy with|satisfied with|not looking to change|cannot change|already use)') THEN 'status_quo'
      WHEN regexp_matches(lower(COALESCE(rc.reply_body_text, rc.reply_content_preview, '')), '(budget|too expensive|price|cost)') THEN 'budget'
      WHEN regexp_matches(lower(COALESCE(rc.reply_body_text, rc.reply_content_preview, '')), '(later|next quarter|timing|not now|circle back)') THEN 'timing'
      WHEN regexp_matches(lower(COALESCE(rc.reply_body_text, rc.reply_content_preview, '')), '(not a fit|no need|not relevant)') THEN 'not_a_fit'
      WHEN regexp_matches(lower(COALESCE(rc.reply_body_text, rc.reply_content_preview, '')), '(wrong person|not responsible|different team)') THEN 'wrong_person'
      WHEN rc.reply_outcome_label = 'positive' THEN 'positive_interest'
      ELSE 'other'
    END AS objection_type
  FROM sendlens.reply_context rc
  LEFT JOIN sendlens.lead_evidence le
    ON rc.workspace_id = le.workspace_id
   AND rc.campaign_id = le.campaign_id
   AND rc.source_provider = le.source_provider
   AND rc.normalized_email = le.normalized_email
  LEFT JOIN payload_presence pp
    ON le.workspace_id = pp.workspace_id
   AND le.campaign_id = pp.campaign_id
   AND le.normalized_email = pp.normalized_email
  WHERE rc.reply_email_id IS NOT NULL
),
cohorts AS (
  SELECT
    workspace_id,
    source_provider,
    campaign_id,
    campaign_source_id,
    COALESCE(list_id, 'missing_list_id') AS list_id,
    payload_key_families,
    step,
    variant,
    objection_type,
    reply_outcome_label,
    COUNT(DISTINCT reply_email_id) AS hydrated_reply_rows
  FROM reply_rows
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
),
frame_rollup AS (
  SELECT
    workspace_id,
    campaign_id,
    COALESCE(source_provider, 'instantly') AS source_provider,
    CASE
      WHEN lead_cursor_exhausted = TRUE AND lower(COALESCE(provenance_status, '')) IN ('complete', 'exact') THEN 'complete'
      WHEN lead_cursor_exhausted = FALSE THEN 'partial'
      WHEN lower(COALESCE(provenance_status, '')) IN ('sampled', 'enriched_tail') OR lower(COALESCE(ingest_mode, '')) LIKE '%sample%' THEN 'sampled'
      ELSE 'observed'
    END AS frame_status
  FROM sendlens.sampling_runs
)
SELECT
  c.*,
  COALESCE(fr.frame_status, 'unsupported') AS frame_status,
  CASE WHEN COALESCE(fr.frame_status, 'unsupported') = 'complete' THEN 'decision_eligible' ELSE 'measurement_gap' END AS comparison_state
FROM cohorts c
LEFT JOIN frame_rollup fr
  ON c.workspace_id = fr.workspace_id
 AND c.campaign_id = fr.campaign_id
 AND c.source_provider = fr.source_provider
ORDER BY hydrated_reply_rows DESC, campaign_id, objection_type, list_id;`,
    notes: [
      "Objection labels are bounded derived classifications, not verbatim reply content or a semantic guarantee.",
      "Payload output contains only mapped key families; payload values and contact identifiers never leave the query.",
      "Use the frame and cohort size to keep rare observations descriptive rather than turning them into prevalence claims.",
    ],
  },
  {
    id: "list-freshness-decay",
    topic: "icp-signals",
    title: "List freshness and decay",
    question: "Does reply quality decay as sampled list contacts get older?",
    exactness: "sampled",
    rationale: "Bucket sampled leads by observed contact freshness and report reply outcomes without pretending sampled list rows are the whole list.",
    route_card: {
      preferred_intent: "list or import freshness decay by reply outcome",
      grain: "campaign, provider, list, and freshness bucket",
      time_basis: "sampled_at compared with provider last-contact timestamp",
      attribution: "provider-qualified sampled lead evidence",
      provider_scope: "provider-qualified campaign_source_id and list_id",
      population_scope: "sampled leads only; list-wide prevalence is unavailable without a complete frame",
      tag_role: "none; resolve campaign/list scope before comparing freshness",
      prerequisites: ["lead_evidence", "sampling_runs", "list_id coverage"],
      cost: "low",
      privacy: "list identifiers, freshness buckets, and aggregate outcomes only",
      privacy_class: "operational_identifiers",
      safe_adaptations: ["use bounded freshness buckets", "compare one provider or campaign at a time"],
      forbidden_adaptations: ["expose lead email or payload values", "call a stale bucket a population decay rate", "compare lists with incompatible sampling frames"],
    },
    sql: `WITH frame_rollup AS (
  SELECT
    workspace_id,
    campaign_id,
    COALESCE(source_provider, 'instantly') AS source_provider,
    CASE
      WHEN lead_cursor_exhausted = TRUE AND lower(COALESCE(provenance_status, '')) IN ('complete', 'exact') THEN 'complete'
      WHEN lead_cursor_exhausted = FALSE THEN 'partial'
      WHEN lower(COALESCE(provenance_status, '')) IN ('sampled', 'enriched_tail') OR lower(COALESCE(ingest_mode, '')) LIKE '%sample%' THEN 'sampled'
      ELSE 'observed'
    END AS frame_status
  FROM sendlens.sampling_runs
),
freshness AS (
  SELECT
    le.workspace_id,
    le.source_provider,
    le.campaign_id,
    le.campaign_source_id,
    COALESCE(le.list_id, 'missing_list_id') AS list_id,
    CASE
      WHEN le.timestamp_last_contact IS NULL THEN 'unknown_freshness'
      WHEN date_diff('day', CAST(le.timestamp_last_contact AS DATE), CAST(le.sampled_at AS DATE)) <= 7 THEN 'fresh_0_7d'
      WHEN date_diff('day', CAST(le.timestamp_last_contact AS DATE), CAST(le.sampled_at AS DATE)) <= 30 THEN 'aging_8_30d'
      ELSE 'stale_31d_plus'
    END AS freshness_bucket,
    CASE
      WHEN le.timestamp_last_contact IS NULL THEN NULL
      ELSE CAST(date_diff('day', CAST(le.timestamp_last_contact AS DATE), CAST(le.sampled_at AS DATE)) AS INTEGER)
    END AS freshness_days,
    le.has_reply_signal,
    le.reply_outcome_label
  FROM sendlens.lead_evidence le
)
SELECT
  f.workspace_id,
  f.source_provider,
  f.campaign_id,
  f.campaign_source_id,
  f.list_id,
  f.freshness_bucket,
  MIN(f.freshness_days) AS minimum_freshness_days,
  MAX(f.freshness_days) AS maximum_freshness_days,
  COUNT(*) AS sampled_leads,
  SUM(CASE WHEN f.has_reply_signal THEN 1 ELSE 0 END) AS sampled_replying_leads,
  SUM(CASE WHEN f.reply_outcome_label = 'positive' THEN 1 ELSE 0 END) AS sampled_positive_leads,
  SUM(CASE WHEN f.reply_outcome_label = 'negative' THEN 1 ELSE 0 END) AS sampled_negative_leads,
  ROUND(100.0 * SUM(CASE WHEN f.has_reply_signal THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) AS sampled_reply_rate_pct,
  COALESCE(fr.frame_status, 'unsupported') AS frame_status,
  CASE WHEN COALESCE(fr.frame_status, 'unsupported') = 'complete' THEN 'decision_eligible' ELSE 'measurement_gap' END AS comparison_state
FROM freshness f
LEFT JOIN frame_rollup fr
  ON f.workspace_id = fr.workspace_id
 AND f.campaign_id = fr.campaign_id
 AND f.source_provider = fr.source_provider
GROUP BY 1, 2, 3, 4, 5, 6, 14
ORDER BY comparison_state, sampled_reply_rate_pct DESC NULLS LAST, list_id, freshness_bucket;`,
    notes: [
      "Freshness is measured from provider last-contact evidence to the local sampled_at observation date.",
      "Unknown freshness and sampled frames must remain visible; do not impute them as fresh or stale.",
    ],
  },
  {
    id: "matched-provider-cohort-comparison",
    topic: "experiment-planner",
    title: "Matched provider cohort comparison guard",
    question: "Which cross-provider cohorts overlap, and are they compatible to compare?",
    exactness: "sampled",
    rationale: "Surface cross-provider matched identities as a guarded comparison input; provider semantics must be explicitly compatible before any lift claim.",
    route_card: {
      preferred_intent: "matched cross-provider cohort compatibility check",
      grain: "cross-provider overlap identity type and hashed cohort key",
      time_basis: "sampled lead exposure and provider frame snapshots",
      attribution: "provider-qualified overlap evidence only",
      provider_scope: "multiple providers are shown separately; semantic equivalence is not assumed",
      population_scope: "sampled overlapping cohorts; no cross-provider prevalence claim",
      tag_role: "none; provider scope is the primary boundary",
      prerequisites: ["provider_overlap_risk_details", "sampling_runs", "explicit provider semantics review"],
      cost: "medium",
      privacy: "hashed overlap keys and aggregate provider counts; no contact identity or body",
      privacy_class: "aggregate_only",
      safe_adaptations: ["filter to one overlap_type", "require complete frames before a human compatibility review"],
      forbidden_adaptations: ["treat provider names as semantic compatibility", "compare rates across providers from this guard alone", "reverse hashed overlap keys"],
    },
    sql: `WITH overlaps AS (
  SELECT
    workspace_id,
    overlap_type,
    overlap_key,
    COUNT(DISTINCT source_provider) AS source_provider_count,
    string_agg(DISTINCT source_provider, ', ' ORDER BY source_provider) AS source_providers,
    COUNT(DISTINCT campaign_source_id) AS campaign_count,
    COUNT(DISTINCT normalized_email) AS sampled_contacts,
    MIN(evidence_sampled_at) AS first_sampled_at,
    MAX(evidence_sampled_at) AS last_sampled_at
  FROM sendlens.provider_overlap_risk_details
  GROUP BY 1, 2, 3
  HAVING COUNT(DISTINCT source_provider) > 1
),
provider_frames AS (
  SELECT
    workspace_id,
    campaign_id,
    campaign_source_id,
    COALESCE(source_provider, 'instantly') AS source_provider,
    CASE
      WHEN lead_cursor_exhausted = TRUE AND lower(COALESCE(provenance_status, '')) IN ('complete', 'exact') THEN 'complete'
      WHEN lead_cursor_exhausted = FALSE THEN 'partial'
      WHEN lower(COALESCE(provenance_status, '')) IN ('sampled', 'enriched_tail') OR lower(COALESCE(ingest_mode, '')) LIKE '%sample%' THEN 'sampled'
      ELSE 'observed'
    END AS frame_status
  FROM sendlens.sampling_runs
),
overlap_frames AS (
  SELECT
    d.workspace_id,
    d.overlap_type,
    d.overlap_key,
    COUNT(DISTINCT d.source_provider) AS providers_with_rows,
    COUNT(DISTINCT CASE WHEN pf.frame_status = 'complete' THEN d.source_provider END) AS complete_provider_count
  FROM sendlens.provider_overlap_risk_details d
  LEFT JOIN provider_frames pf
    ON d.workspace_id = pf.workspace_id
   AND d.campaign_id = pf.campaign_id
   AND d.campaign_source_id = pf.campaign_source_id
   AND d.source_provider = pf.source_provider
  GROUP BY 1, 2, 3
)
SELECT
  o.workspace_id,
  o.overlap_type,
  o.overlap_key,
  o.source_provider_count,
  o.source_providers,
  o.campaign_count,
  o.sampled_contacts,
  o.first_sampled_at,
  o.last_sampled_at,
  COALESCE(ofr.providers_with_rows, 0) AS providers_with_rows,
  COALESCE(ofr.complete_provider_count, 0) AS complete_provider_count,
  CASE
    WHEN COALESCE(ofr.complete_provider_count, 0) = o.source_provider_count THEN 'complete_frames_require_semantics_review'
    ELSE 'incomplete_or_sampled_frames'
  END AS compatibility_status,
  'non_comparable' AS comparison_state,
  'Do not compare provider rates until metric definitions, exposure windows, denominator rules, and frame completeness are explicitly compatible.' AS evidence_action
FROM overlaps o
LEFT JOIN overlap_frames ofr
  ON o.workspace_id = ofr.workspace_id
 AND o.overlap_type = ofr.overlap_type
 AND o.overlap_key = ofr.overlap_key
ORDER BY sampled_contacts DESC, overlap_type, overlap_key;`,
    notes: [
      "This recipe is a guardrail and intentionally returns non_comparable rather than assuming Instantly and Smartlead metrics mean the same thing.",
      "A human or approved compatibility contract must establish matching exposure windows, denominators, and outcome semantics before comparison.",
    ],
  },
  {
    id: "decision-risk-evidence-gaps",
    topic: "experiment-planner",
    title: "Decision-risk evidence gaps",
    question: "Which experiment comparisons are blocked by evidence or spillover risk?",
    exactness: "hybrid",
    rationale: "Provide a compact remediation queue for comparisons that are not decision eligible.",
    route_card: {
      preferred_intent: "experiment decision-risk remediation queue",
      grain: "one row per blocked campaign-step-variant comparison",
      time_basis: "current validity view and sampling-run evidence frame",
      attribution: "same campaign-step-variant contract as the validity audit",
      provider_scope: "provider-qualified campaign_source_id",
      population_scope: "observed blocked comparisons; no prevalence or significance claim",
      tag_role: "none; resolve tags before selecting a remediation cohort",
      prerequisites: ["experiment_validity_checks public view"],
      cost: "low",
      privacy: "aggregate blocker fields and remediation text only",
      privacy_class: "aggregate_only",
      safe_adaptations: ["filter to spillover or measurement gaps", "sort by sent volume after state"],
      forbidden_adaptations: ["skip the evidence_action", "treat missing evidence as neutral evidence", "promote blocked rows into winner recommendations"],
    },
    sql: `SELECT
  workspace_id,
  source_provider,
  campaign_id,
  campaign_source_id,
  campaign_name,
  step,
  variant,
  comparison_state,
  frame_status,
  hydration_status,
  variant_mapping_status,
  sent,
  comparison_sent,
  shared_sender_count,
  shared_domain_count,
  sampled_overlap_count,
  evidence_action,
  minimum_detectable_effect_status
FROM sendlens.experiment_validity_checks
WHERE comparison_state <> 'decision_eligible'
ORDER BY
  CASE comparison_state
    WHEN 'spillover_risk' THEN 1
    WHEN 'measurement_gap' THEN 2
    ELSE 3
  END,
  sent DESC NULLS LAST,
  campaign_name,
  step,
  variant;`,
    notes: [
      "Use this as the remediation queue after the validity audit and before experiment interpretation.",
      "The evidence_action is the minimum next step; do not silently downgrade a blocker to a caveat.",
    ],
  },
  {
    id: "analysis-receipt-semantic-diff",
    topic: "account-manager-brief",
    title: "Analysis receipt semantic diff",
    question: "What changed between two report runs, and was the change caused by data, dependencies, or an incompatible metric contract?",
    exactness: "hybrid",
    rationale: "Compare two bounded local analysis receipts by contract, provider capability, freshness, sampling, dependencies, and result hashes without replaying or exposing SQL.",
    route_card: {
      preferred_intent: "replay a report run and explain a bounded semantic diff",
      grain: "one before/after receipt pair",
      time_basis: "receipt creation timestamps plus captured source-freshness metadata",
      attribution: "receipt-level change classification; no causal claim beyond recorded contract differences",
      provider_scope: "provider capability and source-provider metadata captured by each receipt",
      population_scope: "the exact bounded result scope represented by the two receipts",
      tag_role: "none; receipt IDs are supplied by the prior report response",
      prerequisites: ["before_receipt_id", "after_receipt_id", "analysis_receipts public table"],
      cost: "low",
      privacy: "hashes and bounded status metadata only; SQL, contacts, bodies, and paths are excluded",
      privacy_class: "aggregate_only",
      safe_adaptations: ["compare only receipt IDs returned by SendLens", "treat contract changes as non-replayable", "inspect reconciliation rows for scope residuals"],
      forbidden_adaptations: ["infer a business change from a result hash alone", "treat changed freshness as outcome lift", "supply raw SQL or contact fields as receipt identifiers"],
    },
    sql: `WITH before_receipt AS (
  SELECT
    receipt_id,
    status,
    question_hash,
    rationale_hash,
    question_family,
    recipe_id,
    recipe_hash,
    metric_contract_hash,
    provider_capability_snapshot_hash,
    source_freshness_hash,
    sampling_fingerprint_hash,
    dependency_set_hash,
    result_hash,
    result_row_count,
    result_truncated,
    evidence_frame,
    source_provider,
    max_claim_class,
    statistical_claims_allowed,
    created_at
  FROM sendlens.analysis_receipts
  WHERE receipt_id = '{{before_receipt_id}}'
), after_receipt AS (
  SELECT
    receipt_id,
    status,
    question_hash,
    rationale_hash,
    question_family,
    recipe_id,
    recipe_hash,
    metric_contract_hash,
    provider_capability_snapshot_hash,
    source_freshness_hash,
    sampling_fingerprint_hash,
    dependency_set_hash,
    result_hash,
    result_row_count,
    result_truncated,
    evidence_frame,
    source_provider,
    max_claim_class,
    statistical_claims_allowed,
    created_at
  FROM sendlens.analysis_receipts
  WHERE receipt_id = '{{after_receipt_id}}'
)
SELECT
  b.receipt_id AS before_receipt_id,
  a.receipt_id AS after_receipt_id,
  COALESCE(a.question_family, b.question_family) AS question_family,
  COALESCE(a.recipe_id, b.recipe_id) AS recipe_id,
  b.question_hash IS DISTINCT FROM a.question_hash AS question_changed,
  b.rationale_hash IS DISTINCT FROM a.rationale_hash AS rationale_changed,
  b.recipe_hash IS DISTINCT FROM a.recipe_hash AS recipe_changed,
  CASE
    WHEN b.receipt_id IS NULL THEN 'before_receipt_missing'
    WHEN a.receipt_id IS NULL THEN 'after_receipt_missing'
    WHEN b.metric_contract_hash IS DISTINCT FROM a.metric_contract_hash THEN 'incompatible_metric_contract'
    WHEN b.question_hash IS DISTINCT FROM a.question_hash THEN 'question_changed'
    WHEN b.rationale_hash IS DISTINCT FROM a.rationale_hash THEN 'rationale_changed'
    WHEN b.recipe_hash IS DISTINCT FROM a.recipe_hash THEN 'recipe_changed'
    WHEN b.provider_capability_snapshot_hash IS DISTINCT FROM a.provider_capability_snapshot_hash THEN 'provider_capability_changed'
    WHEN b.sampling_fingerprint_hash IS DISTINCT FROM a.sampling_fingerprint_hash THEN 'sampling_frame_changed'
    WHEN b.source_freshness_hash IS DISTINCT FROM a.source_freshness_hash THEN 'source_freshness_changed'
    WHEN b.dependency_set_hash IS DISTINCT FROM a.dependency_set_hash THEN 'dependency_set_changed'
    WHEN b.status IS DISTINCT FROM a.status THEN 'run_status_changed'
    WHEN b.evidence_frame IS DISTINCT FROM a.evidence_frame THEN 'evidence_frame_changed'
    WHEN b.max_claim_class IS DISTINCT FROM a.max_claim_class
      OR b.statistical_claims_allowed IS DISTINCT FROM a.statistical_claims_allowed THEN 'claim_limit_changed'
    WHEN b.result_hash IS DISTINCT FROM a.result_hash THEN 'material_result_change'
    ELSE 'unchanged'
  END AS semantic_diff_status,
  b.metric_contract_hash = a.metric_contract_hash AS metric_contract_compatible,
  b.provider_capability_snapshot_hash IS DISTINCT FROM a.provider_capability_snapshot_hash AS provider_capability_changed,
  b.source_freshness_hash IS DISTINCT FROM a.source_freshness_hash AS source_freshness_changed,
  b.sampling_fingerprint_hash IS DISTINCT FROM a.sampling_fingerprint_hash AS sampling_frame_changed,
  b.dependency_set_hash IS DISTINCT FROM a.dependency_set_hash AS dependency_set_changed,
  b.result_hash IS DISTINCT FROM a.result_hash AS result_hash_changed,
  b.result_row_count AS before_result_row_count,
  a.result_row_count AS after_result_row_count,
  b.result_truncated AS before_result_truncated,
  a.result_truncated AS after_result_truncated,
  COALESCE(a.evidence_frame, b.evidence_frame) AS evidence_frame,
  COALESCE(a.source_provider, b.source_provider) AS source_provider,
  COALESCE(a.max_claim_class, b.max_claim_class) AS max_claim_class,
  COALESCE(a.statistical_claims_allowed, b.statistical_claims_allowed) AS statistical_claims_allowed,
  b.created_at AS before_created_at,
  a.created_at AS after_created_at,
  CASE
    WHEN b.receipt_id IS NULL OR a.receipt_id IS NULL THEN FALSE
    WHEN b.metric_contract_hash IS DISTINCT FROM a.metric_contract_hash THEN FALSE
    WHEN b.question_hash IS DISTINCT FROM a.question_hash THEN FALSE
    WHEN b.rationale_hash IS DISTINCT FROM a.rationale_hash THEN FALSE
    WHEN b.recipe_hash IS DISTINCT FROM a.recipe_hash THEN FALSE
    ELSE TRUE
  END AS replay_contract_compatible,
  'A compatible question, recipe, and metric contract are required before treating a changed result hash as a business change.' AS interpretation_guardrail
FROM before_receipt b
FULL OUTER JOIN after_receipt a ON TRUE;`,
    notes: [
      "Replace both placeholders with receipt IDs returned by analyze_data or prepare_campaign_analysis.",
      "This is a semantic diff of local receipt metadata; it never replays SQL or exposes stored report rows.",
      "If replay_contract_compatible is false, report the incompatibility and stop before interpreting result changes.",
    ],
  },
  {
    id: "metric-reconciliation-audit",
    topic: "account-manager-brief",
    title: "Metric reconciliation audit",
    question: "Which metric decompositions were reconciled, scope-limited, non-comparable, unsupported, or retrieval-defective?",
    exactness: "hybrid",
    rationale: "Review explicit metric reconciliation receipts and residuals before explaining aggregate-versus-hydrated differences.",
    route_card: {
      preferred_intent: "audit metric reconciliation status and residual causes",
      grain: "one row per recorded metric reconciliation",
      time_basis: "reconciliation creation time and source surfaces captured by the receipt",
      attribution: "authoritative-versus-decomposition surface contract; incompatible scopes remain explicitly non-comparable",
      provider_scope: "provider scope inherited from the linked analysis receipt",
      population_scope: "only the bounded surfaces and result scope named by the linked receipt",
      tag_role: "none; use the linked receipt ID for a report-specific audit",
      prerequisites: ["metric_reconciliations public table", "analysis receipt returned by the prior run"],
      cost: "low",
      privacy: "surface names, values, hashes, statuses, and semantic causes only; no contacts, bodies, or SQL",
      privacy_class: "aggregate_only",
      safe_adaptations: ["filter to one receipt_id", "sort high-severity residuals first", "treat unsupported rows as evidence gaps"],
      forbidden_adaptations: ["force a reconciliation when compatibility is false", "call a scope residual a retrieval defect without failure evidence", "hide the unsupported reason from the final explanation"],
    },
    sql: `SELECT
  reconciliation_id,
  receipt_id,
  metric_key,
  authoritative_surface,
  decomposition_surface,
  authoritative_value,
  decomposed_value,
  residual,
  status,
  severity,
  expected_semantic_causes,
  unsupported_reason,
  created_at
FROM sendlens.metric_reconciliations
ORDER BY
  CASE severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
  created_at DESC
LIMIT 100;`,
    notes: [
      "expected_scope_difference means the surfaces are intentionally not treated as compatible decompositions.",
      "retrieval_defect requires retrieval failure evidence; otherwise report the residual with its expected semantic causes.",
      "Use the linked receipt and analysis-receipt-semantic-diff for replay context.",
    ],
  },
  {
    id: "workspace-overview",
    topic: "workspace-health",
    title: "Workspace overview",
    question: "What is working and not working across the workspace?",
    exactness: "exact",
    rationale: "Rank campaigns by exact reply and bounce performance before diving into deeper diagnosis.",
    route_card: {
      preferred_intent: "broad workspace triage and campaign shortlist",
      grain: "one row per active campaign",
      time_basis: "provider aggregate lifetime/current cached campaign state",
      attribution: "campaign-level provider aggregates plus sampling coverage counts",
      provider_scope: "provider-qualified when mixed-provider columns are present",
      population_scope: "active campaigns only",
      tag_role: "none; use tag recipes when the prompt names a tag",
      prerequisites: ["active local cache"],
      cost: "low",
      privacy: "aggregate rows only; no contact, reply body, or rendered body detail",
      privacy_class: "aggregate_only",
      safe_adaptations: ["add a provider or campaign-name filter", "change ordering among returned aggregate fields"],
      forbidden_adaptations: ["use as proof a campaign is a winner without one-campaign reply/copy validation", "project sampled evidence to full-population totals"],
    },
    sql: `SELECT
  campaign_id,
  campaign_name AS name,
  status,
  daily_limit,
  emails_sent_count,
  reply_count_unique,
  unique_reply_rate_pct,
  bounced_count,
  bounce_rate_pct,
  total_opportunities,
  ingest_mode,
  reply_lead_rows,
  nonreply_rows_sampled,
  reply_outbound_rows
FROM sendlens.campaign_overview
WHERE status = 'active'
ORDER BY unique_reply_rate_pct DESC NULLS LAST, bounce_rate_pct ASC NULLS LAST, emails_sent_count DESC;`,
    notes: [
      "This is an exact aggregate query.",
      "Use it first for a broad prioritization pass.",
    ],
  },
  {
    id: "account-health",
    topic: "workspace-health",
    title: "Account health and warmup risk",
    question: "Which sending accounts look unhealthy?",
    exactness: "exact",
    rationale: "Review exact recent account performance before blaming copy.",
    route_card: {
      preferred_intent: "workspace sender account health and bounce/warmup risk",
      grain: "one row per sender account",
      time_basis: "stored provider account 30-day aggregates",
      attribution: "sender-account scoped, not campaign-attributed",
      provider_scope: "provider-qualified account identity where available",
      population_scope: "all cached sender accounts",
      tag_role: "none; join account_tags only for account-tag questions",
      prerequisites: ["cached account health surface"],
      cost: "low",
      privacy: "sender account emails are returned as operational evidence; no lead or reply bodies",
      privacy_class: "operational_identifiers",
      safe_adaptations: ["filter to one provider", "sort by warmup score or bounce rate"],
      forbidden_adaptations: ["attribute account totals to one campaign without campaign assignment evidence", "treat missing inbox-placement rows as healthy placement"],
    },
    sql: `SELECT
  email,
  status,
  warmup_status,
  warmup_score,
  total_sent_30d,
  total_replies_30d,
  total_bounces_30d,
  ROUND(100.0 * total_bounces_30d / NULLIF(total_sent_30d, 0), 2) AS bounce_rate_30d_pct
FROM sendlens.accounts
ORDER BY bounce_rate_30d_pct DESC NULLS LAST, warmup_score ASC NULLS LAST, total_sent_30d DESC;`,
    notes: [
      "Use this when the workspace has elevated bounce or low reply rates.",
      "Join to campaign data only after you identify risky accounts.",
    ],
  },
  {
    id: "sender-domain-lineage",
    topic: "workspace-health",
    title: "Sender and domain lineage",
    question: "Which sender accounts and domains are shared across active campaigns, and which assignments or health edges are unknown?",
    exactness: "hybrid",
    rationale: "Trace provider-qualified direct and tag-expanded sender assignments through effective snapshot windows before assessing shared-domain blast radius or capacity risk.",
    route_card: {
      preferred_intent: "sender/domain lineage, shared assignments, disconnected accounts, and unknown edges",
      grain: "one row per provider-qualified sender domain",
      time_basis: "effective current assignment snapshot with bounded health windows",
      attribution: "assignment edges are exact; sender volume is observed and never campaign-attributed",
      provider_scope: "provider-qualified by source_provider, campaign_source_id, and provider-qualified account identity",
      population_scope: "cached sender assignment inventory and active campaign edges",
      tag_role: "direct versus tag-expanded assignment source remains visible",
      prerequisites: ["campaign account assignments", "sender account snapshot", "account tag mappings when used"],
      cost: "low",
      privacy: "sender/domain operational identifiers and aggregate health/capacity fields only; no leads or message bodies",
      privacy_class: "operational_identifiers",
      safe_adaptations: ["filter to one provider or domain", "inspect campaign_asset_edges for one assignment path", "treat unknown edges as unresolved"],
      forbidden_adaptations: ["attribute sender volume to one campaign", "treat a missing health row as healthy", "collapse Instantly and Smartlead health semantics"],
    },
    sql: `SELECT
  source_provider,
  sender_domain,
  sender_count,
  campaign_count,
  active_campaign_count,
  healthy_sender_count,
  degraded_sender_count,
  disconnected_sender_count,
  unknown_sender_count,
  unknown_edge_count,
  assignment_sources,
  domain_health_status,
  health_evidence,
  capacity_evidence,
  effective_from,
  effective_to,
  effective_window_status,
  provider_health_semantics
FROM sendlens.sender_domain_lineage
ORDER BY disconnected_sender_count DESC, degraded_sender_count DESC, active_campaign_count DESC, sender_domain;`,
    notes: [
      "This is an exact assignment lineage view with observed health/capacity evidence where available.",
      "Unknown tag edges remain visible and block a confident quarantine outcome.",
    ],
  },
  {
    id: "campaign-blast-radius",
    topic: "workspace-health",
    title: "Campaign sender/domain blast radius",
    question: "Which active campaigns would stop, degrade, or retain redundancy if a sender or domain were quarantined?",
    exactness: "hybrid",
    rationale: "Simulate read-only sender/domain quarantine from provider-qualified assignment edges while preserving unknown edges, configured capacity, measured volume, and shared-sender attribution bounds.",
    route_card: {
      preferred_intent: "sender/domain quarantine simulation and affected active campaign blast radius",
      grain: "one row per quarantined sender/domain asset and affected active campaign",
      time_basis: "effective current assignment snapshot plus cached account health",
      attribution: "quarantine impact is a bound; shared sender/domain volume is never campaign-attributed",
      provider_scope: "provider-qualified; do not combine sender assets across Instantly and Smartlead",
      population_scope: "active campaigns connected by known sender/domain edges",
      tag_role: "tag-expanded assignments remain separate from direct assignments in the lineage source",
      prerequisites: ["sender/domain lineage", "provider-qualified account health", "campaign assignment cache"],
      cost: "medium",
      privacy: "bounded sender/domain and campaign operational fields; no leads, reply text, or raw provider payloads",
      privacy_class: "operational_identifiers",
      safe_adaptations: ["filter to one asset_type, provider, domain, or campaign", "report unknown as unresolved rather than stop", "separate configured capacity from measured sender volume"],
      forbidden_adaptations: ["claim exact campaign sends from sender metrics", "treat unknown edges as redundant capacity", "apply one provider's deliverability semantics to another"],
    },
    sql: `SELECT
  source_provider,
  asset_type,
  asset_key,
  sender_domain,
  campaign_id,
  campaign_source_id,
  campaign_name,
  current_asset_status,
  active_campaigns_using_asset,
  assigned_sender_count,
  current_healthy_sender_count,
  remaining_healthy_sender_count,
  unknown_edge_count,
  quarantine_outcome,
  configured_daily_capacity_at_risk,
  measured_sent_30d_at_risk,
  capacity_evidence,
  attribution_status,
  attribution_bounds,
  effective_from,
  effective_to,
  effective_window_status,
  provider_health_semantics
FROM sendlens.campaign_blast_radius
WHERE lower(COALESCE(campaign_status, '')) = 'active'
ORDER BY
  CASE quarantine_outcome WHEN 'stop' THEN 0 WHEN 'degrade' THEN 1 WHEN 'unknown' THEN 2 ELSE 3 END,
  configured_daily_capacity_at_risk DESC,
  source_provider,
  asset_type,
  asset_key,
  campaign_id;`,
    notes: [
      "stop/degrade/retain_redundancy are quarantine outcomes, not observed campaign performance claims.",
      "A shared sender or domain produces an attribution bound rather than a point contribution.",
    ],
  },
  {
    id: "sender-load-balance-by-campaign-tag",
    topic: "workspace-health",
    title: "Sender load balance by campaign tag",
    question: "Are the inboxes assigned to a campaign tag unevenly loaded or risky?",
    exactness: "exact",
    rationale: "Use resolved campaign sender assignments, sender daily limits, and account daily metrics to spot overloaded, underused, or risky inboxes.",
    sql: `WITH tagged_campaign_senders AS (
  SELECT
    ct.workspace_id,
    ct.source_provider,
    ct.campaign_source_id,
    ct.campaign_tag_label AS campaign_tag,
    ca.campaign_id,
    ca.campaign_name,
    ca.account_email,
    regexp_extract(ca.account_email, '@(.+)$', 1) AS sender_domain,
    ca.assignment_source,
    ca.assignment_account_tag_label AS assignment_account_tag,
    ca.daily_limit AS account_daily_limit,
    ca.status,
    ca.warmup_status,
    ca.warmup_score,
    ca.total_sent_30d,
    ca.total_replies_30d,
    ca.total_bounces_30d,
    ca.bounce_rate_30d_pct
  FROM sendlens.campaign_tags ct
  JOIN sendlens.campaign_accounts ca
    ON ct.workspace_id = ca.workspace_id
   AND ct.source_provider = ca.source_provider
   AND ct.campaign_source_id = ca.campaign_source_id
   AND ct.campaign_id = ca.campaign_id
  JOIN sendlens.campaign_overview co
    ON ct.workspace_id = co.workspace_id
   AND ct.source_provider = co.source_provider
   AND ct.campaign_source_id = co.campaign_source_id
   AND ct.campaign_id = co.campaign_id
  WHERE lower(trim(ct.campaign_tag_label)) = lower(trim('{{tag_name}}'))
    AND lower(COALESCE(co.status, '')) = 'active'
),
sender_campaign_counts AS (
  SELECT
    ca.workspace_id,
    ca.source_provider,
    lower(ca.account_email) AS account_email,
    COUNT(DISTINCT ca.campaign_source_id) AS active_campaigns_using_sender
  FROM sendlens.campaign_accounts ca
  JOIN sendlens.campaign_overview co
    ON ca.workspace_id = co.workspace_id
   AND ca.source_provider = co.source_provider
   AND ca.campaign_source_id = co.campaign_source_id
   AND ca.campaign_id = co.campaign_id
  WHERE lower(COALESCE(co.status, '')) = 'active'
  GROUP BY 1, 2, 3
),
recent_account_daily AS (
  SELECT
    workspace_id,
    COALESCE(source_provider, 'instantly') AS source_provider,
    lower(email) AS account_email,
    COUNT(*) FILTER (WHERE COALESCE(sent, 0) > 0) AS sending_days_30d,
    ROUND(AVG(sent) FILTER (WHERE COALESCE(sent, 0) > 0), 2) AS avg_sent_per_sending_day_30d,
    MAX(sent) AS peak_sent_single_day_30d,
    SUM(COALESCE(sent, 0)) AS account_sent_30d,
    SUM(COALESCE(unique_replies, 0)) AS account_unique_replies_30d,
    SUM(COALESCE(bounced, 0)) AS account_bounces_30d
  FROM sendlens.account_daily_metrics
  WHERE date >= CURRENT_DATE - INTERVAL 30 DAY
  GROUP BY 1, 2, 3
)
SELECT
  tcs.campaign_tag,
  tcs.source_provider,
  tcs.account_email,
  tcs.sender_domain,
  MIN(tcs.campaign_name) AS tagged_campaign_example,
  COUNT(DISTINCT tcs.campaign_source_id) AS tagged_campaign_count,
  COALESCE(scc.active_campaigns_using_sender, 0) AS all_active_campaigns_using_sender,
  tcs.account_daily_limit,
  rad.sending_days_30d,
  rad.avg_sent_per_sending_day_30d,
  rad.peak_sent_single_day_30d,
  rad.account_sent_30d,
  rad.account_unique_replies_30d,
  rad.account_bounces_30d,
  ROUND(100.0 * rad.account_bounces_30d / NULLIF(rad.account_sent_30d, 0), 2) AS observed_account_bounce_rate_30d_pct,
  ROUND(100.0 * rad.avg_sent_per_sending_day_30d / NULLIF(tcs.account_daily_limit, 0), 2) AS avg_daily_limit_utilization_pct,
  ROUND(100.0 * rad.peak_sent_single_day_30d / NULLIF(tcs.account_daily_limit, 0), 2) AS peak_daily_limit_utilization_pct,
  tcs.status,
  tcs.warmup_status,
  tcs.warmup_score,
  CASE
    WHEN tcs.account_email IS NULL THEN 'missing_sender'
    WHEN tcs.status IS NULL THEN 'missing_account_health'
    WHEN COALESCE(rad.account_sent_30d, 0) = 0 THEN 'no_recent_observed_send_volume'
    WHEN ROUND(100.0 * rad.account_bounces_30d / NULLIF(rad.account_sent_30d, 0), 2) >= 5 THEN 'high_bounce_risk'
    WHEN ROUND(100.0 * rad.peak_sent_single_day_30d / NULLIF(tcs.account_daily_limit, 0), 2) >= 90 THEN 'near_daily_limit_peak'
    WHEN COALESCE(scc.active_campaigns_using_sender, 0) > COUNT(DISTINCT tcs.campaign_id) THEN 'shared_with_other_campaigns'
    ELSE 'balanced_or_monitor'
  END AS sender_load_status
FROM tagged_campaign_senders tcs
LEFT JOIN sender_campaign_counts scc
  ON tcs.workspace_id = scc.workspace_id
 AND tcs.source_provider = scc.source_provider
 AND lower(tcs.account_email) = scc.account_email
LEFT JOIN recent_account_daily rad
  ON tcs.workspace_id = rad.workspace_id
 AND tcs.source_provider = rad.source_provider
 AND lower(tcs.account_email) = rad.account_email
GROUP BY
  tcs.campaign_tag,
  tcs.source_provider,
  tcs.account_email,
  tcs.sender_domain,
  scc.active_campaigns_using_sender,
  tcs.account_daily_limit,
  rad.sending_days_30d,
  rad.avg_sent_per_sending_day_30d,
  rad.peak_sent_single_day_30d,
  rad.account_sent_30d,
  rad.account_unique_replies_30d,
  rad.account_bounces_30d,
  tcs.status,
  tcs.warmup_status,
  tcs.warmup_score
ORDER BY
  CASE sender_load_status
    WHEN 'high_bounce_risk' THEN 1
    WHEN 'near_daily_limit_peak' THEN 2
    WHEN 'shared_with_other_campaigns' THEN 3
    WHEN 'missing_account_health' THEN 4
    WHEN 'no_recent_observed_send_volume' THEN 5
    ELSE 6
  END,
  peak_daily_limit_utilization_pct DESC NULLS LAST,
  account_sent_30d DESC NULLS LAST;`,
    notes: [
      "Replace '{{tag_name}}' with a real campaign tag.",
      "Account daily metrics are sender-scoped, not campaign-attributed; shared inboxes can make campaign-level attribution ambiguous.",
      "Sender sharing and daily metrics are provider-qualified; only active provider-qualified campaigns contribute to the sharing count.",
      "Use this before capacity or burn-rate claims that depend on sender availability.",
    ],
  },
  {
    id: "campaign-sender-inventory-by-tag",
    topic: "workspace-health",
    title: "Campaign sender inventory by tag",
    question: "Which inboxes are assigned to active campaigns with a given campaign tag, and which senders look risky?",
    exactness: "exact",
    rationale: "Use campaign-tagged active campaigns, resolved sender assignments, and stored account 30-day aggregates before workspace scans, placement checks, or day-level sender recomputation.",
    route_card: {
      preferred_intent: "exact campaign-tag sender assignment, sharing, and sender-risk inventory",
      grain: "one row per active campaign and assigned sender account",
      time_basis: "current active campaign assignments plus stored account 30-day aggregates",
      attribution: "campaign tag selects campaigns; account aggregates stay sender-scoped",
      provider_scope: "source_provider and campaign_source_id prevent cross-provider collisions",
      population_scope: "active tagged campaigns; assigned senders retained regardless of account status",
      tag_role: "requested tag is campaign_tag_label; assignment_account_tag_label only explains tag-based sender assignment",
      prerequisites: ["known campaign tag", "resolved campaign_accounts sender inventory"],
      cost: "low",
      privacy: "returns sender account operational fields only; no leads, reply text, payloads, or row previews",
      privacy_class: "operational_identifiers",
      safe_adaptations: ["add an exact provider filter", "escape single quotes in the tag literal by doubling them", "run the declared tag-scope audit after a zero-row check"],
      forbidden_adaptations: ["start with workspace_snapshot for this exact route", "scan placement or account_daily_metrics before the inventory result", "broaden provider, campaign, tag, time, or population after a miss"],
    },
    zero_row_fallback: {
      on_status: "zero_rows",
      correction_recipe_id: "tag-scope-audit",
      after_correction: "stop",
      max_follow_up_calls: 4,
      follow_up_starts_at: "primary_recipe_lookup",
      catalog_discovery_included: false,
    },
    sql: `WITH tagged_active_campaign_senders_raw AS (
  SELECT
    ct.workspace_id,
    ct.source_provider,
    ct.campaign_id,
    ct.campaign_source_id,
    COALESCE(ct.campaign_name, co.campaign_name) AS campaign_name,
    ct.campaign_tag_label,
    co.status AS campaign_status,
    ca.account_email,
    ca.provider_account_id,
    regexp_extract(ca.account_email, '@(.+)$', 1) AS sender_domain,
    ca.assignment_source,
    ca.assignment_account_tag_label,
    ca.status AS account_status,
    ca.warmup_status,
    ca.warmup_score,
    ca.daily_limit AS account_daily_limit,
    ca.total_sent_30d AS stored_account_sent_30d,
    ca.total_replies_30d AS stored_account_replies_30d,
    ca.total_bounces_30d AS stored_account_bounces_30d,
    ca.bounce_rate_30d_pct AS stored_account_bounce_rate_30d_pct
  FROM sendlens.campaign_tags ct
  JOIN sendlens.campaign_overview co
    ON ct.workspace_id = co.workspace_id
   AND ct.source_provider = co.source_provider
   AND ct.campaign_id = co.campaign_id
  JOIN sendlens.campaign_accounts ca
    ON ct.workspace_id = ca.workspace_id
   AND ct.source_provider = ca.source_provider
   AND ct.campaign_id = ca.campaign_id
  WHERE lower(trim(ct.campaign_tag_label)) = lower(trim('{{tag_name}}'))
    AND lower(COALESCE(co.status, '')) = 'active'
),
tagged_active_campaign_senders AS (
  SELECT
    workspace_id,
    source_provider,
    campaign_id,
    campaign_source_id,
    campaign_name,
    campaign_tag_label,
    campaign_status,
    account_email,
    provider_account_id,
    sender_domain,
    CASE
      WHEN MAX(CASE WHEN lower(COALESCE(assignment_source, '')) = 'email' THEN 1 ELSE 0 END) = 1 THEN 'email'
      ELSE MIN(assignment_source)
    END AS assignment_source,
    string_agg(DISTINCT assignment_account_tag_label, ', ' ORDER BY assignment_account_tag_label)
      FILTER (WHERE assignment_account_tag_label IS NOT NULL AND trim(assignment_account_tag_label) <> '') AS assignment_account_tag_label,
    MAX(account_status) AS account_status,
    MAX(warmup_status) AS warmup_status,
    MAX(warmup_score) AS warmup_score,
    MAX(account_daily_limit) AS account_daily_limit,
    MAX(stored_account_sent_30d) AS stored_account_sent_30d,
    MAX(stored_account_replies_30d) AS stored_account_replies_30d,
    MAX(stored_account_bounces_30d) AS stored_account_bounces_30d,
    MAX(stored_account_bounce_rate_30d_pct) AS stored_account_bounce_rate_30d_pct
  FROM tagged_active_campaign_senders_raw
  GROUP BY
    workspace_id,
    source_provider,
    campaign_id,
    campaign_source_id,
    campaign_name,
    campaign_tag_label,
    campaign_status,
    account_email,
    provider_account_id,
    sender_domain
),
active_sender_campaign_counts AS (
  SELECT
    ca.workspace_id,
    ca.source_provider,
    lower(ca.account_email) AS account_email,
    COUNT(DISTINCT ca.campaign_source_id) AS active_provider_campaigns_using_sender
  FROM sendlens.campaign_accounts ca
  JOIN sendlens.campaign_overview co
    ON ca.workspace_id = co.workspace_id
   AND ca.source_provider = co.source_provider
   AND ca.campaign_id = co.campaign_id
  WHERE lower(COALESCE(co.status, '')) = 'active'
  GROUP BY 1, 2, 3
)
SELECT
  tacs.campaign_tag_label,
  tacs.source_provider,
  tacs.campaign_id,
  tacs.campaign_source_id,
  tacs.campaign_name,
  tacs.campaign_status,
  tacs.account_email,
  tacs.provider_account_id,
  tacs.sender_domain,
  tacs.assignment_source,
  tacs.assignment_account_tag_label,
  tacs.account_status,
  tacs.warmup_status,
  tacs.warmup_score,
  tacs.account_daily_limit,
  tacs.stored_account_sent_30d,
  tacs.stored_account_replies_30d,
  tacs.stored_account_bounces_30d,
  tacs.stored_account_bounce_rate_30d_pct,
  COALESCE(ascs.active_provider_campaigns_using_sender, 0) AS active_provider_campaigns_using_sender,
  CASE
    WHEN tacs.account_email IS NULL THEN 'missing_sender'
    WHEN tacs.account_status IS NULL OR trim(tacs.account_status) = '' THEN 'missing_account_health'
    WHEN lower(trim(tacs.account_status)) IN ('active', 'connected') THEN
      CASE
        WHEN COALESCE(tacs.stored_account_sent_30d, 0) = 0 THEN 'no_stored_30d_send_volume'
        WHEN COALESCE(tacs.stored_account_bounce_rate_30d_pct, 0) >= 5 THEN 'high_bounce_risk'
        WHEN COALESCE(ascs.active_provider_campaigns_using_sender, 0) > 1 THEN 'shared_active_sender'
        ELSE 'monitor'
      END
    WHEN lower(COALESCE(tacs.source_provider, '')) = 'instantly'
      AND trim(tacs.account_status) = '1' THEN
      CASE
        WHEN COALESCE(tacs.stored_account_sent_30d, 0) = 0 THEN 'no_stored_30d_send_volume'
        WHEN COALESCE(tacs.stored_account_bounce_rate_30d_pct, 0) >= 5 THEN 'high_bounce_risk'
        WHEN COALESCE(ascs.active_provider_campaigns_using_sender, 0) > 1 THEN 'shared_active_sender'
        ELSE 'monitor'
      END
    WHEN lower(COALESCE(tacs.source_provider, '')) = 'instantly'
      AND trim(tacs.account_status) IN ('2', '3', '-1', '-2', '-3') THEN 'disabled_or_inactive_sender'
    WHEN lower(trim(tacs.account_status)) IN ('disabled', 'inactive', 'disconnected', 'paused', 'error') THEN 'disabled_or_inactive_sender'
    ELSE 'unknown_account_status'
  END AS sender_risk_signal
FROM tagged_active_campaign_senders tacs
LEFT JOIN active_sender_campaign_counts ascs
  ON tacs.workspace_id = ascs.workspace_id
 AND tacs.source_provider = ascs.source_provider
 AND lower(tacs.account_email) = ascs.account_email
ORDER BY
  CASE sender_risk_signal
    WHEN 'high_bounce_risk' THEN 1
    WHEN 'disabled_or_inactive_sender' THEN 2
    WHEN 'shared_active_sender' THEN 3
    WHEN 'missing_account_health' THEN 4
    WHEN 'unknown_account_status' THEN 5
    WHEN 'no_stored_30d_send_volume' THEN 6
    ELSE 7
  END,
  tacs.stored_account_bounce_rate_30d_pct DESC NULLS LAST,
  tacs.stored_account_sent_30d DESC NULLS LAST,
  tacs.campaign_name,
  tacs.account_email;`,
    notes: [
      "Replace '{{tag_name}}' with a real campaign tag such as 'The Kiln'.",
      "When inserting the tag literal manually, escape each single quote by doubling it before execution.",
      "This filters by campaign tag, not assignment account tag; `assignment_account_tag_label` is returned only to explain tag-based sender assignments.",
      "The route is provider-qualified through `source_provider` and `campaign_source_id`, and only active campaigns contribute to the sender-sharing count.",
      "Instantly account status 1 is active; 2, 3, -1, -2, and -3 are paused or error states. Unmapped provider statuses are returned as unknown_account_status rather than guessed inactive.",
      "Disabled or inactive sender accounts remain visible because account status is risk evidence, not a population filter.",
      "Stored account 30-day aggregates come from `campaign_accounts`; do not recompute this route from `account_daily_metrics` unless the user asks for day-level history.",
      "If this returns no rows, use at most one targeted tag/provider/trim/case coverage check before retrying; do not broaden campaign, provider, tag, time, or population scope silently.",
    ],
  },
  {
    id: "campaign-tag-sender-coverage",
    topic: "workspace-health",
    title: "Campaign tag sender coverage",
    question: "Which campaigns with a given Instantly tag are missing resolved sender assignments or daily metric coverage?",
    exactness: "exact",
    rationale: "Check coverage before trusting tag-scoped sender volume, deliverability, or utilization rollups.",
    sql: `WITH tagged_campaigns AS (
  SELECT
    ct.workspace_id,
    ct.source_provider,
    ct.campaign_source_id,
    co.campaign_id,
    co.campaign_name,
    co.status,
    co.daily_limit AS campaign_daily_limit,
    co.emails_sent_count
  FROM sendlens.campaign_tags ct
  JOIN sendlens.campaign_overview co
    ON ct.workspace_id = co.workspace_id
   AND ct.source_provider = co.source_provider
   AND ct.campaign_source_id = co.campaign_source_id
   AND ct.campaign_id = co.campaign_id
  WHERE lower(trim(ct.campaign_tag_label)) = lower(trim('{{tag_name}}'))
    AND co.status = 'active'
),
sender_coverage AS (
  SELECT
    tc.workspace_id,
    tc.campaign_id,
    COUNT(DISTINCT ca.account_email) AS resolved_sender_accounts,
    COUNT(DISTINCT CASE WHEN adm.email IS NOT NULL THEN ca.account_email END) AS sender_accounts_with_daily_metrics,
    MIN(adm.date) AS first_metric_date,
    MAX(adm.date) AS last_metric_date
  FROM tagged_campaigns tc
  LEFT JOIN sendlens.campaign_accounts ca
    ON tc.workspace_id = ca.workspace_id
   AND tc.source_provider = ca.source_provider
   AND tc.campaign_source_id = ca.campaign_source_id
   AND tc.campaign_id = ca.campaign_id
  LEFT JOIN sendlens.account_daily_metrics adm
    ON ca.workspace_id = adm.workspace_id
   AND ca.source_provider = adm.source_provider
   AND lower(ca.account_email) = lower(adm.email)
  GROUP BY 1, 2
)
SELECT
  tc.campaign_id,
  tc.campaign_name,
  tc.status,
  tc.campaign_daily_limit,
  tc.emails_sent_count AS campaign_total_sent,
  COALESCE(sc.resolved_sender_accounts, 0) AS resolved_sender_accounts,
  COALESCE(sc.sender_accounts_with_daily_metrics, 0) AS sender_accounts_with_daily_metrics,
  sc.first_metric_date,
  sc.last_metric_date,
  CASE
    WHEN COALESCE(sc.resolved_sender_accounts, 0) = 0 THEN 'missing_sender_inventory'
    WHEN COALESCE(sc.sender_accounts_with_daily_metrics, 0) = 0 THEN 'missing_account_daily_metrics'
    WHEN sc.sender_accounts_with_daily_metrics < sc.resolved_sender_accounts THEN 'partial_account_daily_metrics'
    ELSE 'covered'
  END AS coverage_status
FROM tagged_campaigns tc
LEFT JOIN sender_coverage sc
  ON tc.workspace_id = sc.workspace_id
 AND tc.campaign_id = sc.campaign_id
ORDER BY
  CASE coverage_status
    WHEN 'missing_sender_inventory' THEN 1
    WHEN 'missing_account_daily_metrics' THEN 2
    WHEN 'partial_account_daily_metrics' THEN 3
    ELSE 4
  END,
  tc.emails_sent_count DESC,
  tc.campaign_name;`,
    notes: [
      "Replace '{{tag_name}}' with a real campaign tag.",
      "Run this before daily-volume or utilization rollups when the user is asking for tag-scoped sender volume.",
      "A missing sender inventory row means SendLens cannot connect that campaign to sender accounts from the cached Instantly surfaces.",
      "A covered campaign can still use senders shared with other campaigns, so account-level observed volume remains sender-scoped.",
    ],
  },
  {
    id: "campaign-tag-true-daily-volume",
    topic: "campaign-performance",
    title: "Campaign tag true daily volume",
    question: "What is the true campaign-attributed daily sending volume for campaigns with a given Instantly tag?",
    exactness: "exact",
    rationale: "Use campaign_daily_metrics joined to exact campaign tags so daily sends are attributed to campaigns, not inferred from sender accounts.",
    sql: `SELECT
  date,
  tag_label,
  active_campaigns_with_daily_metrics,
  configured_campaign_daily_limit_total,
  campaign_total_sent,
  campaign_attributed_sent,
  campaign_attributed_contacted,
  campaign_attributed_new_leads_contacted,
  campaign_attributed_unique_replies,
  campaign_attributed_replies,
  campaign_attributed_opportunities,
  campaign_limit_utilization_pct
FROM sendlens.campaign_tag_true_daily_volume
WHERE normalized_tag_label = lower(trim('{{tag_name}}'))
ORDER BY date DESC;`,
    notes: [
      "Replace '{{tag_name}}' with a real campaign tag.",
      "This is the preferred recipe for tag-level daily volume because it uses exact campaign/day analytics.",
      "If this returns no rows, the cache has not ingested campaign_daily_metrics for matching tagged campaigns; use campaign-tag-sender-coverage and sender-scoped fallback recipes to diagnose coverage.",
      "The view includes active campaigns only, matching the default SendLens active-campaign scope.",
    ],
  },
  {
    id: "campaign-tag-true-daily-volume-trend",
    topic: "campaign-performance",
    title: "Campaign tag true daily volume trend",
    question: "What is the true campaign-attributed daily volume trend for campaigns with a given Instantly tag?",
    exactness: "exact",
    rationale: "Summarize true campaign/day analytics with rolling averages, peaks, weekday context, and cached date range.",
    sql: `SELECT
  date,
  weekday_number,
  weekday_name,
  campaign_attributed_sent,
  rolling_7_day_avg_sent,
  peak_daily_sent,
  avg_daily_sent_all_cached_days,
  cached_sending_days,
  first_cached_send_date,
  last_cached_send_date,
  campaign_attributed_unique_replies,
  campaign_attributed_replies,
  campaign_attributed_opportunities
FROM sendlens.campaign_tag_true_daily_volume_trend
WHERE normalized_tag_label = lower(trim('{{tag_name}}'))
ORDER BY date DESC;`,
    notes: [
      "Replace '{{tag_name}}' with a real campaign tag.",
      "Use this for broad 'what does daily volume look like' questions because it is true campaign-attributed volume plus trend context.",
      "Missing dates are not automatically zero-send days; this view reports cached dates returned by Instantly campaign daily analytics.",
    ],
  },
  {
    id: "campaign-tag-daily-volume",
    topic: "campaign-performance",
    title: "Campaign tag daily volume",
    question: "What does daily sending volume look like for campaigns with a given Instantly tag?",
    exactness: "exact",
    rationale: "Use exact campaign tags, configured campaign limits, resolved campaign sender assignments, and exact account daily metrics before answering tag-scoped volume questions.",
    sql: `WITH tagged_campaigns AS (
  SELECT
    ct.workspace_id,
    ct.source_provider,
    ct.campaign_source_id,
    co.campaign_id,
    co.campaign_name,
    co.status,
    co.daily_limit AS campaign_daily_limit,
    co.emails_sent_count
  FROM sendlens.campaign_tags ct
  JOIN sendlens.campaign_overview co
    ON ct.workspace_id = co.workspace_id
   AND ct.source_provider = co.source_provider
   AND ct.campaign_source_id = co.campaign_source_id
   AND ct.campaign_id = co.campaign_id
  WHERE lower(trim(ct.campaign_tag_label)) = lower(trim('{{tag_name}}'))
    AND co.status = 'active'
),
campaign_days AS (
  SELECT
    assigned.campaign_id,
    assigned.campaign_name,
    adm.date,
    COUNT(DISTINCT assigned.account_email) AS assigned_accounts_with_metrics,
    SUM(COALESCE(adm.sent, 0)) AS sender_scoped_sent,
    SUM(COALESCE(adm.unique_replies, 0)) AS sender_scoped_unique_replies,
    SUM(COALESCE(adm.bounced, 0)) AS sender_scoped_bounces
  FROM (
    SELECT DISTINCT
      tc.workspace_id,
      tc.source_provider,
      tc.campaign_source_id,
      tc.campaign_id,
      tc.campaign_name,
      ca.account_email
    FROM tagged_campaigns tc
    JOIN sendlens.campaign_accounts ca
    ON tc.workspace_id = ca.workspace_id
   AND tc.source_provider = ca.source_provider
   AND tc.campaign_source_id = ca.campaign_source_id
   AND tc.campaign_id = ca.campaign_id
    WHERE ca.account_email IS NOT NULL
  ) assigned
  JOIN sendlens.account_daily_metrics adm
    ON assigned.workspace_id = adm.workspace_id
   AND assigned.source_provider = adm.source_provider
   AND lower(assigned.account_email) = lower(adm.email)
  GROUP BY 1, 2, 3
)
SELECT
  cd.date,
  cd.campaign_id,
  cd.campaign_name,
  tc.campaign_daily_limit,
  tc.emails_sent_count AS campaign_total_sent,
  cd.assigned_accounts_with_metrics,
  cd.sender_scoped_sent,
  cd.sender_scoped_unique_replies,
  cd.sender_scoped_bounces
FROM campaign_days cd
JOIN tagged_campaigns tc
  ON cd.campaign_id = tc.campaign_id
ORDER BY cd.date DESC, cd.sender_scoped_sent DESC, cd.campaign_name;`,
    notes: [
      "Replace '{{tag_name}}' with a real campaign tag.",
      "This reports observed daily sends from the accounts assigned to each tagged campaign. Instantly's cached account_daily_metrics are exact at the account/day level, but not campaign-attributed.",
      "If one sender account is assigned to multiple campaigns, account-level daily sends can appear under more than one campaign; use campaign_daily_limit for exact configured capacity.",
      "If this returns no rows, either no sender inventory is resolved for the tag or no account daily metrics are cached for those senders.",
    ],
  },
  {
    id: "campaign-tag-daily-volume-deduped",
    topic: "campaign-performance",
    title: "Campaign tag daily volume deduped",
    question: "What is the deduped daily sending volume for campaigns with a given Instantly tag?",
    exactness: "exact",
    rationale: "Use one row per assigned sender account per day so tag-level daily volume does not double count shared inboxes assigned to multiple tagged campaigns.",
    sql: `WITH tagged_campaigns AS (
  SELECT
    ct.workspace_id,
    ct.source_provider,
    ct.campaign_source_id,
    co.campaign_id,
    co.campaign_name,
    co.daily_limit AS campaign_daily_limit,
    co.emails_sent_count
  FROM sendlens.campaign_tags ct
  JOIN sendlens.campaign_overview co
    ON ct.workspace_id = co.workspace_id
   AND ct.source_provider = co.source_provider
   AND ct.campaign_source_id = co.campaign_source_id
   AND ct.campaign_id = co.campaign_id
  WHERE lower(trim(ct.campaign_tag_label)) = lower(trim('{{tag_name}}'))
    AND co.status = 'active'
),
assigned_accounts AS (
  SELECT DISTINCT
    tc.workspace_id,
    tc.source_provider,
    ca.account_email
  FROM tagged_campaigns tc
  JOIN sendlens.campaign_accounts ca
    ON tc.workspace_id = ca.workspace_id
   AND tc.source_provider = ca.source_provider
   AND tc.campaign_source_id = ca.campaign_source_id
   AND tc.campaign_id = ca.campaign_id
  WHERE ca.account_email IS NOT NULL
),
capacity AS (
  SELECT
    COUNT(DISTINCT campaign_id) AS active_campaigns,
    COALESCE(SUM(campaign_daily_limit), 0) AS configured_campaign_daily_limit_total,
    COALESCE(SUM(emails_sent_count), 0) AS campaign_total_sent
  FROM tagged_campaigns
)
SELECT
  adm.date,
  capacity.active_campaigns,
  capacity.configured_campaign_daily_limit_total,
  capacity.campaign_total_sent,
  COUNT(DISTINCT adm.email) AS assigned_accounts_with_metrics,
  SUM(COALESCE(adm.sent, 0)) AS deduped_sender_sent,
  SUM(COALESCE(adm.unique_replies, 0)) AS deduped_sender_unique_replies,
  SUM(COALESCE(adm.bounced, 0)) AS deduped_sender_bounces
FROM assigned_accounts aa
JOIN sendlens.account_daily_metrics adm
  ON aa.workspace_id = adm.workspace_id
 AND aa.source_provider = adm.source_provider
 AND lower(aa.account_email) = lower(adm.email)
CROSS JOIN capacity
GROUP BY
  adm.date,
  capacity.active_campaigns,
  capacity.configured_campaign_daily_limit_total,
  capacity.campaign_total_sent
ORDER BY adm.date DESC;`,
    notes: [
      "Replace '{{tag_name}}' with a real campaign tag.",
      "This is the safest default for broad tag-level daily volume questions because each assigned sender account contributes at most once per date.",
      "The daily send counts come from exact account_daily_metrics, so they are observed sender volume, not campaign-attributed sends.",
      "Use campaign-tag-daily-volume when the user wants a campaign-by-campaign view and this deduped recipe when they want the tag total.",
    ],
  },
  {
    id: "campaign-tag-daily-volume-utilization",
    topic: "campaign-performance",
    title: "Campaign tag daily volume utilization",
    question: "How does observed daily sending volume compare with configured campaign and sender capacity for a given Instantly tag?",
    exactness: "exact",
    rationale: "Compare observed sender-scoped sends against both campaign daily limits and resolved account daily limits before diagnosing under- or over-utilization.",
    sql: `WITH tagged_campaigns AS (
  SELECT
    ct.workspace_id,
    ct.source_provider,
    ct.campaign_source_id,
    co.campaign_id,
    co.campaign_name,
    co.daily_limit AS campaign_daily_limit,
    co.emails_sent_count
  FROM sendlens.campaign_tags ct
  JOIN sendlens.campaign_overview co
    ON ct.workspace_id = co.workspace_id
   AND ct.source_provider = co.source_provider
   AND ct.campaign_source_id = co.campaign_source_id
   AND ct.campaign_id = co.campaign_id
  WHERE lower(trim(ct.campaign_tag_label)) = lower(trim('{{tag_name}}'))
    AND co.status = 'active'
),
assigned_accounts AS (
  SELECT DISTINCT
    tc.workspace_id,
    tc.source_provider,
    ca.account_email,
    ca.daily_limit AS account_daily_limit
  FROM tagged_campaigns tc
  JOIN sendlens.campaign_accounts ca
    ON tc.workspace_id = ca.workspace_id
   AND tc.source_provider = ca.source_provider
   AND tc.campaign_source_id = ca.campaign_source_id
   AND tc.campaign_id = ca.campaign_id
  WHERE ca.account_email IS NOT NULL
),
capacity AS (
  SELECT
    COUNT(DISTINCT campaign_id) AS active_campaigns,
    COALESCE(SUM(campaign_daily_limit), 0) AS configured_campaign_daily_limit_total,
    COALESCE(SUM(emails_sent_count), 0) AS campaign_total_sent
  FROM tagged_campaigns
),
sender_capacity AS (
  SELECT
    COUNT(DISTINCT account_email) AS resolved_sender_accounts,
    COALESCE(SUM(account_daily_limit), 0) AS resolved_account_daily_limit_total
  FROM assigned_accounts
),
daily_volume AS (
  SELECT
    adm.date,
    COUNT(DISTINCT adm.email) AS assigned_accounts_with_metrics,
    SUM(COALESCE(adm.sent, 0)) AS deduped_sender_sent,
    SUM(COALESCE(adm.unique_replies, 0)) AS deduped_sender_unique_replies,
    SUM(COALESCE(adm.bounced, 0)) AS deduped_sender_bounces
  FROM assigned_accounts aa
  JOIN sendlens.account_daily_metrics adm
    ON aa.workspace_id = adm.workspace_id
   AND aa.source_provider = adm.source_provider
   AND lower(aa.account_email) = lower(adm.email)
  GROUP BY 1
)
SELECT
  dv.date,
  c.active_campaigns,
  sc.resolved_sender_accounts,
  dv.assigned_accounts_with_metrics,
  c.configured_campaign_daily_limit_total,
  sc.resolved_account_daily_limit_total,
  dv.deduped_sender_sent,
  ROUND(100.0 * dv.deduped_sender_sent / NULLIF(c.configured_campaign_daily_limit_total, 0), 2) AS campaign_limit_utilization_pct,
  ROUND(100.0 * dv.deduped_sender_sent / NULLIF(sc.resolved_account_daily_limit_total, 0), 2) AS account_limit_utilization_pct,
  dv.deduped_sender_unique_replies,
  dv.deduped_sender_bounces,
  c.campaign_total_sent
FROM daily_volume dv
CROSS JOIN capacity c
CROSS JOIN sender_capacity sc
ORDER BY dv.date DESC;`,
    notes: [
      "Replace '{{tag_name}}' with a real campaign tag.",
      "Observed sends are exact account/day metrics for resolved assigned senders, not exact campaign-attributed sends.",
      "Campaign limit utilization compares observed sender volume with summed active campaign daily limits.",
      "Account limit utilization compares observed sender volume with summed daily limits for resolved assigned accounts.",
      "If utilization looks impossible or too high, inspect sender sharing and run campaign-tag-sender-coverage.",
    ],
  },
  {
    id: "campaign-tag-daily-volume-trend",
    topic: "campaign-performance",
    title: "Campaign tag daily volume trend",
    question: "What are the recent daily volume trend, average, peak, and consistency for campaigns with a given Instantly tag?",
    exactness: "exact",
    rationale: "Summarize deduped sender-scoped daily volume with rolling averages and weekday context so the model can answer trend questions without dumping raw rows.",
    sql: `WITH tagged_campaigns AS (
  SELECT
    ct.workspace_id,
    ct.source_provider,
    ct.campaign_source_id,
    co.campaign_id
  FROM sendlens.campaign_tags ct
  JOIN sendlens.campaign_overview co
    ON ct.workspace_id = co.workspace_id
   AND ct.source_provider = co.source_provider
   AND ct.campaign_source_id = co.campaign_source_id
   AND ct.campaign_id = co.campaign_id
  WHERE lower(trim(ct.campaign_tag_label)) = lower(trim('{{tag_name}}'))
    AND co.status = 'active'
),
assigned_accounts AS (
  SELECT DISTINCT
    tc.workspace_id,
    tc.source_provider,
    ca.account_email
  FROM tagged_campaigns tc
  JOIN sendlens.campaign_accounts ca
    ON tc.workspace_id = ca.workspace_id
   AND tc.source_provider = ca.source_provider
   AND tc.campaign_source_id = ca.campaign_source_id
   AND tc.campaign_id = ca.campaign_id
  WHERE ca.account_email IS NOT NULL
),
daily_volume AS (
  SELECT
    adm.date,
    strftime(adm.date, '%w') AS weekday_number,
    strftime(adm.date, '%A') AS weekday_name,
    SUM(COALESCE(adm.sent, 0)) AS deduped_sender_sent,
    SUM(COALESCE(adm.unique_replies, 0)) AS deduped_sender_unique_replies,
    SUM(COALESCE(adm.bounced, 0)) AS deduped_sender_bounces
  FROM assigned_accounts aa
  JOIN sendlens.account_daily_metrics adm
    ON aa.workspace_id = adm.workspace_id
   AND aa.source_provider = adm.source_provider
   AND lower(aa.account_email) = lower(adm.email)
  GROUP BY 1, 2, 3
),
scored AS (
  SELECT
    date,
    weekday_number,
    weekday_name,
    deduped_sender_sent,
    deduped_sender_unique_replies,
    deduped_sender_bounces,
    ROUND(AVG(deduped_sender_sent) OVER (ORDER BY date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 2) AS rolling_7_day_avg_sent,
    MAX(deduped_sender_sent) OVER () AS peak_daily_sent,
    AVG(deduped_sender_sent) OVER () AS avg_daily_sent_all_cached_days,
    COUNT(*) OVER () AS cached_sending_days,
    MIN(date) OVER () AS first_cached_send_date,
    MAX(date) OVER () AS last_cached_send_date
  FROM daily_volume
)
SELECT
  date,
  weekday_number,
  weekday_name,
  deduped_sender_sent,
  rolling_7_day_avg_sent,
  peak_daily_sent,
  ROUND(avg_daily_sent_all_cached_days, 2) AS avg_daily_sent_all_cached_days,
  cached_sending_days,
  first_cached_send_date,
  last_cached_send_date,
  deduped_sender_unique_replies,
  deduped_sender_bounces
FROM scored
ORDER BY date DESC;`,
    notes: [
      "Replace '{{tag_name}}' with a real campaign tag.",
      "This uses all cached account daily metrics for resolved assigned senders; add an explicit date predicate if the user asks for a specific window.",
      "Use this when the user asks how volume looks, whether it is trending up/down, or what the normal daily pace is.",
      "Because only dates with observed account metrics appear, missing dates should not automatically be treated as zero-send days.",
    ],
  },
  {
    id: "campaign-tag-runway-inputs",
    topic: "campaign-performance",
    title: "Campaign tag runway inputs",
    question: "How much runway remains before campaigns with a given Instantly tag run out of new leads and follow-up volume?",
    exactness: "exact",
    rationale: "Combine exact campaign totals, daily campaign-attributed pace, observed weekday schedule, step distribution, and configured sequence delays before estimating runway.",
    sql: `WITH tagged_campaigns AS (
  SELECT
    ct.workspace_id,
    ct.source_provider,
    ct.campaign_source_id,
    ct.campaign_tag_label,
    co.campaign_id,
    co.campaign_name,
    co.status,
    co.daily_limit AS campaign_daily_limit,
    co.leads_count,
    co.contacted_count,
    CAST(NULL AS INTEGER) AS exact_uncontacted_leads,
    'unknown_no_exact_uncontacted_lead_field' AS lead_supply_exactness,
    COALESCE(co.emails_sent_count, 0) AS emails_sent_count,
    co.reply_count_unique,
    co.unique_reply_rate_pct,
    c.schedule_timezone,
    c.step_count
  FROM sendlens.campaign_tags ct
  JOIN sendlens.campaign_overview co
    ON ct.workspace_id = co.workspace_id
   AND ct.source_provider = co.source_provider
   AND ct.campaign_source_id = co.campaign_source_id
   AND ct.campaign_id = co.campaign_id
  JOIN sendlens.campaigns c
    ON co.workspace_id = c.workspace_id
   AND co.source_provider = c.source_provider
   AND co.campaign_id = c.id
  WHERE lower(trim(ct.campaign_tag_label)) = lower(trim('{{tag_name}}'))
    AND co.status = 'active'
),
recent_daily AS (
  SELECT
    tc.workspace_id,
    tc.campaign_id,
    cdm.date,
    strftime(cdm.date, '%w') AS weekday_number,
    strftime(cdm.date, '%A') AS weekday_name,
    COALESCE(cdm.sent, 0) AS sent,
    COALESCE(cdm.new_leads_contacted, 0) AS new_leads_contacted
  FROM tagged_campaigns tc
  LEFT JOIN sendlens.campaign_daily_metrics cdm
    ON tc.workspace_id = cdm.workspace_id
   AND tc.source_provider = cdm.source_provider
   AND tc.campaign_source_id = cdm.campaign_source_id
   AND tc.campaign_id = cdm.campaign_id
   AND cdm.date >= CURRENT_DATE - INTERVAL 30 DAY
),
pace AS (
  SELECT
    workspace_id,
    campaign_id,
    COUNT(*) FILTER (WHERE sent > 0) AS observed_sending_days_30d,
    MIN(CASE WHEN sent > 0 THEN weekday_name ELSE NULL END) AS observed_sending_weekday_example,
    ROUND(AVG(sent) FILTER (WHERE sent > 0), 2) AS avg_sent_per_observed_sending_day_30d,
    MAX(sent) AS peak_sent_single_day_30d,
    ROUND(AVG(new_leads_contacted) FILTER (WHERE new_leads_contacted > 0), 2) AS avg_new_leads_contacted_per_active_day_30d,
    MAX(new_leads_contacted) AS peak_new_leads_contacted_single_day_30d
  FROM recent_daily
  GROUP BY 1, 2
),
step_totals AS (
  SELECT
    workspace_id,
    campaign_id,
    step,
    SUM(COALESCE(sent, 0)) AS sent
  FROM sendlens.step_analytics
  GROUP BY 1, 2, 3
),
step_rollup AS (
  SELECT
    workspace_id,
    campaign_id,
    MIN(step) AS first_step_seen,
    MAX(step) AS last_step_seen,
    SUM(sent) AS step_analytics_sent_total,
    MAX(step) AS max_step_seen
  FROM step_totals
  GROUP BY 1, 2
),
sequence_rollup AS (
  SELECT
    workspace_id,
    campaign_id,
    COUNT(DISTINCT step) AS configured_steps_with_templates,
    MIN(step) AS first_configured_step,
    MAX(step) AS last_configured_step
  FROM (
    SELECT DISTINCT
      workspace_id,
      campaign_id,
      step,
      delay_value,
      delay_unit
    FROM sendlens.campaign_variants
  ) cv
  GROUP BY 1, 2
)
SELECT
  tc.campaign_tag_label,
  tc.campaign_id,
  tc.campaign_name,
  tc.campaign_daily_limit,
  tc.schedule_timezone,
  tc.leads_count,
  tc.contacted_count,
  tc.exact_uncontacted_leads,
  tc.lead_supply_exactness,
  tc.emails_sent_count,
  tc.reply_count_unique,
  tc.unique_reply_rate_pct,
  tc.step_count,
  sr.configured_steps_with_templates,
  sr.first_configured_step,
  sr.last_configured_step,
  st.first_step_seen,
  st.last_step_seen,
  st.step_analytics_sent_total,
  p.observed_sending_days_30d,
  p.observed_sending_weekday_example,
  p.avg_sent_per_observed_sending_day_30d,
  p.peak_sent_single_day_30d,
  p.avg_new_leads_contacted_per_active_day_30d,
  p.peak_new_leads_contacted_single_day_30d,
  CAST(NULL AS DOUBLE) AS new_lead_runway_observed_sending_days,
  CASE
    WHEN p.avg_new_leads_contacted_per_active_day_30d IS NOT NULL THEN 'recent_new_lead_contacting_observed_runway_unknown'
    ELSE 'lead_runway_unknown_missing_recent_new_lead_pace'
  END AS new_lead_runway_status
FROM tagged_campaigns tc
LEFT JOIN pace p
  ON tc.workspace_id = p.workspace_id
 AND tc.campaign_id = p.campaign_id
LEFT JOIN step_rollup st
  ON tc.workspace_id = st.workspace_id
 AND tc.campaign_id = st.campaign_id
LEFT JOIN sequence_rollup sr
  ON tc.workspace_id = sr.workspace_id
 AND tc.campaign_id = sr.campaign_id
ORDER BY
  CASE new_lead_runway_status
    WHEN 'lead_runway_unknown_missing_recent_new_lead_pace' THEN 1
    WHEN 'recent_new_lead_contacting_observed_runway_unknown' THEN 5
    ELSE 5
  END,
  new_lead_runway_observed_sending_days ASC NULLS LAST,
  tc.unique_reply_rate_pct DESC NULLS LAST;`,
    notes: [
      "Replace '{{tag_name}}' with a real campaign tag.",
      "This is the required first recipe for runway questions because it prevents confusing new-lead exhaustion with total send-volume exhaustion.",
      "Exact uncontacted lead supply is not cached; use recent `new_leads_contacted` pace only as observed demand/proxy evidence, not as proof that the campaign is dry.",
      "Use step analytics first/last step, configured step counts, and configured first/last step to explain whether there is a follow-up tail after step 0 is exhausted.",
      "Use observed sending weekday examples and peak daily sends as real schedule/capacity evidence before relying on configured campaign daily limits.",
    ],
  },
  {
    id: "campaign-tag-runway-daily-history",
    topic: "campaign-performance",
    title: "Campaign tag runway daily history",
    question: "Which days are campaigns with a given Instantly tag actually sending on, and what is their observed per-campaign ceiling?",
    exactness: "exact",
    rationale: "Expose campaign-attributed daily sends and new-lead contacts by weekday so runway estimates are schedule-aware.",
    sql: `WITH tagged_campaigns AS (
  SELECT
    ct.workspace_id,
    ct.source_provider,
    ct.campaign_source_id,
    ct.campaign_tag_label,
    co.campaign_id,
    co.campaign_name,
    co.daily_limit AS campaign_daily_limit,
    co.leads_count,
    co.contacted_count
  FROM sendlens.campaign_tags ct
  JOIN sendlens.campaign_overview co
    ON ct.workspace_id = co.workspace_id
   AND ct.source_provider = co.source_provider
   AND ct.campaign_source_id = co.campaign_source_id
   AND ct.campaign_id = co.campaign_id
  WHERE lower(trim(ct.campaign_tag_label)) = lower(trim('{{tag_name}}'))
    AND co.status = 'active'
)
SELECT
  tc.campaign_tag_label,
  tc.campaign_id,
  tc.campaign_name,
  cdm.date,
  strftime(cdm.date, '%w') AS weekday_number,
  strftime(cdm.date, '%A') AS weekday_name,
  tc.campaign_daily_limit,
  CAST(NULL AS INTEGER) AS exact_uncontacted_leads,
  'unknown_no_exact_uncontacted_lead_field' AS lead_supply_exactness,
  COALESCE(cdm.sent, 0) AS campaign_attributed_sent,
  COALESCE(cdm.new_leads_contacted, 0) AS campaign_attributed_new_leads_contacted,
  COALESCE(cdm.contacted, 0) AS campaign_attributed_contacted,
  COALESCE(cdm.unique_replies, 0) AS campaign_attributed_unique_replies,
  COALESCE(cdm.opportunities, 0) AS campaign_attributed_opportunities
FROM tagged_campaigns tc
JOIN sendlens.campaign_daily_metrics cdm
  ON tc.workspace_id = cdm.workspace_id
 AND tc.campaign_id = cdm.campaign_id
WHERE cdm.date >= CURRENT_DATE - INTERVAL 30 DAY
ORDER BY cdm.date DESC, campaign_attributed_sent DESC, tc.campaign_name;`,
    notes: [
      "Replace '{{tag_name}}' with a real campaign tag.",
      "Use this after `campaign-tag-runway-inputs` when the answer needs a schedule table or a defensible real-capacity ceiling.",
      "Campaign-attributed daily metrics are exact Instantly campaign/day analytics.",
      "If weekend dates are absent or zero, state that the schedule was inferred from observed sends unless explicit schedule columns are available.",
    ],
  },
  {
    id: "campaign-tag-account-tag-capacity-runway",
    topic: "campaign-performance",
    title: "Campaign tag plus inbox tag capacity runway",
    question: "For campaigns with one tag using inboxes with another tag, what is the lead burn rate and practical runway?",
    exactness: "hybrid",
    rationale: "Combine exact campaign lead totals, campaign daily pace, assigned sender inventory, sender daily limits, account tags, completed counts, and sequence step mix for the complicated tag-plus-inbox runway question.",
    sql: `WITH tagged_campaigns AS (
  SELECT
    ct.workspace_id,
    ct.source_provider,
    ct.campaign_source_id,
    ct.campaign_tag_label AS campaign_tag,
    co.campaign_id,
    co.campaign_name,
    co.status,
    co.daily_limit AS campaign_daily_limit,
    co.leads_count,
    co.contacted_count,
    co.completed_count,
    co.emails_sent_count,
    co.reply_count_unique,
    co.bounced_count,
    co.unsubscribed_count,
    co.unique_reply_rate_pct,
    c.schedule_timezone,
    c.step_count
  FROM sendlens.campaign_tags ct
  JOIN sendlens.campaign_overview co
    ON ct.workspace_id = co.workspace_id
   AND ct.source_provider = co.source_provider
   AND ct.campaign_source_id = co.campaign_source_id
   AND ct.campaign_id = co.campaign_id
  JOIN sendlens.campaigns c
    ON co.workspace_id = c.workspace_id
   AND co.source_provider = c.source_provider
   AND co.campaign_id = c.id
  WHERE lower(trim(ct.campaign_tag_label)) = lower(trim('{{campaign_tag_name}}'))
    AND co.status = 'active'
),
sender_candidates AS (
  SELECT
    tc.workspace_id,
    tc.campaign_id,
    ca.account_email,
    regexp_extract(ca.account_email, '@(.+)$', 1) AS sender_domain,
    CASE
      WHEN MAX(CASE WHEN lower(COALESCE(ca.assignment_source, '')) = 'email' THEN 1 ELSE 0 END) = 1 THEN 'email'
      ELSE MIN(ca.assignment_source)
    END AS assignment_source,
    string_agg(DISTINCT ca.assignment_account_tag_label, ', ' ORDER BY ca.assignment_account_tag_label)
      FILTER (WHERE ca.assignment_account_tag_label IS NOT NULL AND trim(ca.assignment_account_tag_label) <> '') AS assignment_account_tag,
    MAX(ca.daily_limit) AS account_daily_limit,
    MAX(ca.total_sent_30d) AS total_sent_30d,
    MAX(ca.total_replies_30d) AS total_replies_30d,
    MAX(ca.total_bounces_30d) AS total_bounces_30d,
    MAX(ca.bounce_rate_30d_pct) AS bounce_rate_30d_pct,
    MAX(CASE
      WHEN lower(trim(COALESCE(account_tag.tag_label, ca.assignment_account_tag_label, ''))) = lower(trim('{{account_tag_name}}')) THEN 1
      ELSE 0
    END) AS matches_account_tag
  FROM tagged_campaigns tc
  JOIN sendlens.campaign_accounts ca
    ON tc.workspace_id = ca.workspace_id
   AND tc.source_provider = ca.source_provider
   AND tc.campaign_source_id = ca.campaign_source_id
   AND tc.campaign_id = ca.campaign_id
  LEFT JOIN sendlens.account_tags account_tag
    ON ca.workspace_id = account_tag.workspace_id
   AND ca.source_provider = account_tag.source_provider
   AND lower(ca.account_email) = lower(account_tag.account_email)
  GROUP BY 1, 2, 3, 4
),
sender_rollup AS (
  SELECT
    workspace_id,
    campaign_id,
    COUNT(DISTINCT account_email) AS assigned_sender_accounts,
    COUNT(DISTINCT CASE WHEN matches_account_tag = 1 THEN account_email END) AS tagged_sender_accounts,
    MIN(CASE WHEN matches_account_tag = 1 THEN account_email ELSE NULL END) AS tagged_sender_email_example,
    COALESCE(SUM(CASE WHEN matches_account_tag = 1 THEN account_daily_limit ELSE 0 END), 0) AS tagged_sender_daily_limit_total,
    COALESCE(SUM(account_daily_limit), 0) AS all_assigned_sender_daily_limit_total,
    ROUND(AVG(bounce_rate_30d_pct) FILTER (WHERE matches_account_tag = 1), 2) AS tagged_sender_avg_bounce_rate_30d_pct,
    SUM(COALESCE(total_sent_30d, 0)) FILTER (WHERE matches_account_tag = 1) AS tagged_sender_sent_30d
  FROM sender_candidates
  GROUP BY 1, 2
),
recent_daily AS (
  SELECT
    tc.workspace_id,
    tc.campaign_id,
    cdm.date,
    strftime(cdm.date, '%A') AS weekday_name,
    COALESCE(cdm.sent, 0) AS sent,
    COALESCE(cdm.new_leads_contacted, 0) AS new_leads_contacted,
    COALESCE(cdm.contacted, 0) AS contacted,
    COALESCE(cdm.unique_replies, 0) AS unique_replies,
    COALESCE(cdm.opportunities, 0) AS opportunities
  FROM tagged_campaigns tc
  LEFT JOIN sendlens.campaign_daily_metrics cdm
    ON tc.workspace_id = cdm.workspace_id
   AND tc.source_provider = cdm.source_provider
   AND tc.campaign_source_id = cdm.campaign_source_id
   AND tc.campaign_id = cdm.campaign_id
   AND cdm.date >= CURRENT_DATE - INTERVAL 30 DAY
),
pace AS (
  SELECT
    workspace_id,
    campaign_id,
    COUNT(*) FILTER (WHERE sent > 0) AS observed_sending_days_30d,
    MIN(CASE WHEN sent > 0 THEN weekday_name ELSE NULL END) AS observed_sending_weekday_example,
    ROUND(AVG(sent) FILTER (WHERE sent > 0), 2) AS avg_sent_per_sending_day_30d,
    MAX(sent) AS peak_sent_single_day_30d,
    ROUND(AVG(new_leads_contacted) FILTER (WHERE new_leads_contacted > 0), 2) AS avg_new_leads_contacted_per_active_day_30d,
    MAX(new_leads_contacted) AS peak_new_leads_contacted_single_day_30d,
    SUM(sent) AS sent_30d,
    SUM(new_leads_contacted) AS new_leads_contacted_30d
  FROM recent_daily
  GROUP BY 1, 2
),
step_totals AS (
  SELECT
    workspace_id,
    campaign_id,
    step,
    SUM(COALESCE(sent, 0)) AS sent,
    SUM(COALESCE(unique_replies, 0)) AS unique_replies,
    SUM(COALESCE(opportunities, 0)) AS opportunities
  FROM sendlens.step_analytics
  GROUP BY 1, 2, 3
),
step_rollup AS (
  SELECT
    workspace_id,
    campaign_id,
    MIN(step) AS first_step_with_analytics,
    MAX(step) AS last_step_with_analytics,
    SUM(CASE WHEN step = 0 THEN sent ELSE 0 END) AS step_0_sent,
    SUM(CASE WHEN step > 0 THEN sent ELSE 0 END) AS follow_up_sent,
    SUM(sent) AS step_analytics_sent_total
  FROM step_totals
  GROUP BY 1, 2
),
sequence_rollup AS (
  SELECT
    workspace_id,
    campaign_id,
    COUNT(DISTINCT step) AS configured_steps_with_templates,
    MIN(step) AS first_configured_step,
    MAX(step) AS last_configured_step
  FROM (
    SELECT DISTINCT workspace_id, campaign_id, step, delay_value, delay_unit
    FROM sendlens.campaign_variants
  ) cv
  GROUP BY 1, 2
)
SELECT
  tc.campaign_tag,
  '{{account_tag_name}}' AS account_tag_filter,
  tc.campaign_id,
  tc.campaign_name,
  tc.schedule_timezone,
  tc.campaign_daily_limit,
  sr.assigned_sender_accounts,
  sr.tagged_sender_accounts,
  sr.tagged_sender_email_example,
  sr.tagged_sender_daily_limit_total,
  sr.all_assigned_sender_daily_limit_total,
  CASE
    WHEN COALESCE(sr.tagged_sender_daily_limit_total, 0) = 0 THEN tc.campaign_daily_limit
    WHEN tc.campaign_daily_limit IS NULL THEN sr.tagged_sender_daily_limit_total
    ELSE LEAST(tc.campaign_daily_limit, sr.tagged_sender_daily_limit_total)
  END AS effective_configured_daily_capacity_for_tagged_inboxes,
  sr.tagged_sender_sent_30d,
  sr.tagged_sender_avg_bounce_rate_30d_pct,
  tc.leads_count,
  tc.contacted_count,
  CAST(NULL AS INTEGER) AS exact_uncontacted_leads,
  'unknown_no_exact_uncontacted_lead_field' AS lead_supply_exactness,
  tc.completed_count,
  GREATEST(COALESCE(tc.contacted_count, 0) - COALESCE(tc.completed_count, 0), 0) AS contacted_not_completed,
  tc.emails_sent_count,
  tc.reply_count_unique,
  tc.bounced_count,
  tc.unsubscribed_count,
  tc.unique_reply_rate_pct,
  p.observed_sending_days_30d,
  p.observed_sending_weekday_example,
  p.avg_sent_per_sending_day_30d,
  p.peak_sent_single_day_30d,
  p.avg_new_leads_contacted_per_active_day_30d,
  p.peak_new_leads_contacted_single_day_30d,
  p.sent_30d,
  p.new_leads_contacted_30d,
  CAST(NULL AS DOUBLE) AS observed_new_lead_runway_sending_days,
  CAST(NULL AS DOUBLE) AS configured_capacity_new_lead_runway_days,
  steps.step_0_sent,
  steps.follow_up_sent,
  steps.step_analytics_sent_total,
  steps.first_step_with_analytics,
  steps.last_step_with_analytics,
  seq.configured_steps_with_templates,
  seq.first_configured_step,
  seq.last_configured_step,
  CASE
    WHEN COALESCE(sr.tagged_sender_accounts, 0) = 0 THEN 'no_matching_tagged_senders_allocated'
    WHEN p.avg_new_leads_contacted_per_active_day_30d IS NOT NULL THEN 'recent_new_lead_contacting_observed_runway_unknown'
    ELSE 'lead_runway_unknown_missing_recent_new_lead_pace'
  END AS runway_status,
  'exact uncontacted lead supply is not cached; contacted_count can exceed leads_count, and contacted_not_completed includes in-flight plus replied/stopped/bounced/unsubscribed contacts' AS lead_state_caveat
FROM tagged_campaigns tc
LEFT JOIN sender_rollup sr
  ON tc.workspace_id = sr.workspace_id
 AND tc.campaign_id = sr.campaign_id
LEFT JOIN pace p
  ON tc.workspace_id = p.workspace_id
 AND tc.campaign_id = p.campaign_id
LEFT JOIN step_rollup steps
  ON tc.workspace_id = steps.workspace_id
 AND tc.campaign_id = steps.campaign_id
LEFT JOIN sequence_rollup seq
  ON tc.workspace_id = seq.workspace_id
 AND tc.campaign_id = seq.campaign_id
ORDER BY
  CASE runway_status
    WHEN 'no_matching_tagged_senders_allocated' THEN 1
    WHEN 'lead_runway_unknown_missing_recent_new_lead_pace' THEN 5
    ELSE 6
  END,
  observed_new_lead_runway_sending_days ASC NULLS LAST,
  tc.campaign_name;`,
    notes: [
      "Replace '{{campaign_tag_name}}' and '{{account_tag_name}}' with real tag labels.",
      "This is the closest recipe for the complicated question: campaign tag, inbox tag, assigned inbox capacity, campaign daily limit, lead contact runway, completed count, observed pace, and follow-up tail.",
      "Exact uncontacted lead supply is not cached; recent `new_leads_contacted` pace is observed activity/proxy evidence, not proof of remaining supply.",
      "Configured capacity uses the lower of campaign daily limit and matching tagged sender daily limits. Real throughput can be lower because follow-ups, schedules, throttles, and shared inboxes consume capacity.",
      "`contacted_not_completed` is not a pure in-flight count; it can include replied/stopped/bounced/unsubscribed contacts because cached aggregates do not expose exact current lead step for every lead.",
    ],
  },
  {
    id: "campaign-lead-state-sample-by-step",
    topic: "campaign-performance",
    title: "Campaign lead state sample by step",
    question: "Which sampled leads appear in flight, completed, replied, or stuck, and what step evidence do we have?",
    exactness: "sampled",
    rationale: "Use bounded lead evidence to inspect lead states and step-related fields when exact aggregate runway is not enough.",
    sql: `SELECT
  campaign_id,
  campaign_name,
  sample_source,
  status AS lead_status,
  lt_interest_status,
  lt_interest_label,
  reply_outcome_label,
  email_replied_step,
  email_replied_variant,
  email_open_count,
  email_click_count,
  COUNT(*) AS sampled_leads,
  SUM(CASE WHEN has_reply_signal THEN 1 ELSE 0 END) AS sampled_reply_signal_leads,
  MIN(timestamp_last_contact) AS oldest_last_contact,
  MAX(timestamp_last_contact) AS newest_last_contact,
  MIN(timestamp_last_reply) AS oldest_last_reply,
  MAX(timestamp_last_reply) AS newest_last_reply
FROM sendlens.lead_evidence
WHERE campaign_id = '{{campaign_id}}'
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
ORDER BY sampled_leads DESC, lead_status, email_replied_step NULLS LAST, email_open_count DESC NULLS LAST;`,
    notes: [
      "Replace '{{campaign_id}}' with one campaign ID.",
      "This is sampled lead-state evidence, not exact current lead-step inventory.",
      "Use it to inspect examples and likely patterns after exact aggregate runway recipes identify a risk.",
    ],
  },
  {
    id: "account-manager-client-brief",
    topic: "account-manager-brief",
    title: "Account manager client brief",
    question: "What should an account manager tell the client this week?",
    exactness: "exact",
    rationale: "Combine exact active-campaign health, recent campaign-attributed volume, reply/opportunity outcomes, and lead runway into a client-safe brief foundation.",
    sql: `WITH active_campaigns AS (
  SELECT
    co.workspace_id,
    co.campaign_id,
    co.campaign_name,
    co.status,
    co.daily_limit,
    co.leads_count,
    co.contacted_count,
    CAST(NULL AS INTEGER) AS exact_uncontacted_leads,
    'unknown_no_exact_uncontacted_lead_field' AS lead_supply_exactness,
    co.emails_sent_count,
    co.reply_count_unique,
    co.unique_reply_rate_pct,
    co.bounced_count,
    co.bounce_rate_pct,
    co.total_opportunities,
    co.total_opportunity_value,
    co.ingest_mode,
    co.reply_lead_rows,
    co.nonreply_rows_sampled,
    co.reply_outbound_rows
  FROM sendlens.campaign_overview co
  WHERE co.status = 'active'
),
recent_7d AS (
  SELECT
    workspace_id,
    campaign_id,
    SUM(COALESCE(sent, 0)) AS sent_7d,
    SUM(COALESCE(new_leads_contacted, 0)) AS new_leads_contacted_7d,
    SUM(COALESCE(unique_replies, 0)) AS unique_replies_7d,
    SUM(COALESCE(opportunities, 0)) AS opportunities_7d
  FROM sendlens.campaign_daily_metrics
  WHERE date >= CURRENT_DATE - INTERVAL 7 DAY
  GROUP BY 1, 2
),
recent_30d AS (
  SELECT
    workspace_id,
    campaign_id,
    COUNT(*) FILTER (WHERE COALESCE(sent, 0) > 0) AS sending_days_30d,
    ROUND(AVG(sent) FILTER (WHERE COALESCE(sent, 0) > 0), 2) AS avg_sent_per_sending_day_30d,
    MAX(sent) AS peak_sent_single_day_30d,
    ROUND(AVG(new_leads_contacted) FILTER (WHERE COALESCE(new_leads_contacted, 0) > 0), 2) AS avg_new_leads_contacted_per_active_day_30d
  FROM sendlens.campaign_daily_metrics
  WHERE date >= CURRENT_DATE - INTERVAL 30 DAY
  GROUP BY 1, 2
),
tag_rollup AS (
  SELECT
    workspace_id,
    campaign_id,
    MIN(tag_label) AS campaign_tag_example
  FROM sendlens.campaign_tags
  GROUP BY 1, 2
),
sender_coverage AS (
  SELECT
    workspace_id,
    campaign_id,
    COUNT(DISTINCT account_email) AS resolved_sender_accounts,
    COUNT(DISTINCT CASE WHEN status IS NOT NULL THEN account_email END) AS sender_accounts_with_status
  FROM sendlens.campaign_accounts
  GROUP BY 1, 2
)
SELECT
  ac.campaign_id,
  ac.campaign_name,
  tr.campaign_tag_example,
  ac.daily_limit,
  ac.leads_count,
  ac.contacted_count,
  ac.exact_uncontacted_leads,
  ac.lead_supply_exactness,
  r7.sent_7d,
  r7.new_leads_contacted_7d,
  r7.unique_replies_7d,
  r7.opportunities_7d,
  r30.sending_days_30d,
  r30.avg_sent_per_sending_day_30d,
  r30.peak_sent_single_day_30d,
  CAST(NULL AS DOUBLE) AS new_lead_runway_sending_days,
  ac.emails_sent_count,
  ac.reply_count_unique,
  ac.unique_reply_rate_pct,
  ac.bounced_count,
  ac.bounce_rate_pct,
  ac.total_opportunities,
  ac.total_opportunity_value,
  COALESCE(sc.resolved_sender_accounts, 0) AS resolved_sender_accounts,
  COALESCE(sc.sender_accounts_with_status, 0) AS sender_accounts_with_status,
  ac.ingest_mode,
  ac.reply_lead_rows,
  ac.nonreply_rows_sampled,
  ac.reply_outbound_rows,
  CASE
    WHEN ac.bounce_rate_pct >= 5 THEN 'high_bounce_risk'
    WHEN COALESCE(sc.resolved_sender_accounts, 0) = 0 THEN 'sender_inventory_missing'
    WHEN COALESCE(r7.sent_7d, 0) = 0 THEN 'no_recent_volume'
    WHEN r30.avg_new_leads_contacted_per_active_day_30d IS NULL THEN 'lead_runway_unknown_missing_recent_new_lead_pace'
    ELSE 'monitor'
  END AS am_attention_reason
FROM active_campaigns ac
LEFT JOIN recent_7d r7
  ON ac.workspace_id = r7.workspace_id
 AND ac.campaign_id = r7.campaign_id
LEFT JOIN recent_30d r30
  ON ac.workspace_id = r30.workspace_id
 AND ac.campaign_id = r30.campaign_id
LEFT JOIN tag_rollup tr
  ON ac.workspace_id = tr.workspace_id
 AND ac.campaign_id = tr.campaign_id
LEFT JOIN sender_coverage sc
  ON ac.workspace_id = sc.workspace_id
 AND ac.campaign_id = sc.campaign_id
ORDER BY
  CASE am_attention_reason
    WHEN 'high_bounce_risk' THEN 1
    WHEN 'sender_inventory_missing' THEN 2
    WHEN 'no_recent_volume' THEN 3
    WHEN 'lead_runway_unknown_missing_recent_new_lead_pace' THEN 4
    ELSE 6
  END,
  ac.unique_reply_rate_pct DESC NULLS LAST,
  r7.sent_7d DESC NULLS LAST;`,
    notes: [
      "Use this as the first exact data pull for account-manager briefs and daily action queues.",
      "Write the brief in client-safe language: wins, risks, current actions, asks, and next review date.",
      "Do not expose internal caveats verbosely to a client; translate unknown exact lead runway into clear limitations or next checks.",
      "For tag-specific briefs, add a join or WHERE filter on `campaign_tags` before ordering.",
    ],
  },
  {
    id: "campaign-launch-qa-checklist",
    topic: "campaign-launch-qa",
    title: "Campaign launch QA checklist",
    question: "Is this campaign ready to turn on?",
    exactness: "exact",
    rationale: "Check sender assignment, tracking settings, daily limit, schedule timezone, template steps, lead supply, and recent account health before launch.",
    sql: `WITH campaign_base AS (
  SELECT
    c.workspace_id,
    c.id AS campaign_id,
    c.name AS campaign_name,
    c.status,
    c.daily_limit,
    c.text_only,
    c.first_email_text_only,
    c.open_tracking,
    c.link_tracking,
    c.stop_on_reply,
    c.stop_on_auto_reply,
    c.match_lead_esp,
    c.allow_risky_contacts,
    c.disable_bounce_protect,
    c.insert_unsubscribe_header,
    co.tracking_status,
    co.deliverability_settings_status,
    c.schedule_timezone,
    c.sequence_count,
    c.step_count,
    co.leads_count,
    co.contacted_count,
    CAST(NULL AS INTEGER) AS exact_uncontacted_leads,
    'unknown_no_exact_uncontacted_lead_field' AS lead_supply_exactness,
    COALESCE(co.new_leads_contacted_count, 0) AS new_leads_contacted_count,
    co.bounce_rate_pct,
    co.unique_reply_rate_pct
  FROM sendlens.campaigns c
  LEFT JOIN sendlens.campaign_overview co
    ON c.workspace_id = co.workspace_id
   AND c.id = co.campaign_id
  WHERE lower(c.name) LIKE lower('%{{campaign_name}}%')
),
template_rollup AS (
  SELECT
    workspace_id,
    campaign_id,
    COUNT(DISTINCT step) AS template_steps,
    COUNT(*) AS template_variants,
    SUM(CASE WHEN subject IS NULL OR trim(subject) = '' THEN 1 ELSE 0 END) AS blank_subject_templates,
    SUM(CASE WHEN body_text IS NULL OR trim(body_text) = '' THEN 1 ELSE 0 END) AS blank_body_templates,
    MIN(step) AS first_template_step,
    MAX(step) AS last_template_step
  FROM sendlens.campaign_variants
  GROUP BY 1, 2
),
sender_rollup AS (
  SELECT
    workspace_id,
    campaign_id,
    COUNT(DISTINCT account_email) AS resolved_sender_accounts,
    SUM(CASE WHEN status IS NULL THEN 1 ELSE 0 END) AS sender_rows_missing_status,
    SUM(CASE WHEN COALESCE(bounce_rate_30d_pct, 0) >= 5 THEN 1 ELSE 0 END) AS senders_over_5pct_bounce_30d,
    ROUND(AVG(warmup_score), 2) AS avg_warmup_score,
    SUM(COALESCE(daily_limit, 0)) AS resolved_sender_daily_limit_total
  FROM sendlens.campaign_accounts
  GROUP BY 1, 2
)
SELECT
  cb.campaign_id,
  cb.campaign_name,
  cb.status,
  cb.daily_limit AS campaign_daily_limit,
  cb.text_only,
  cb.first_email_text_only,
  cb.open_tracking,
  cb.link_tracking,
  cb.stop_on_reply,
  cb.stop_on_auto_reply,
  cb.match_lead_esp,
  cb.allow_risky_contacts,
  cb.disable_bounce_protect,
  cb.insert_unsubscribe_header,
  cb.tracking_status,
  cb.deliverability_settings_status,
  cb.schedule_timezone,
  cb.sequence_count,
  cb.step_count,
  tr.template_steps,
  tr.template_variants,
  tr.first_template_step,
  tr.last_template_step,
  tr.blank_subject_templates,
  tr.blank_body_templates,
  cb.leads_count,
  cb.contacted_count,
  cb.exact_uncontacted_leads,
  cb.lead_supply_exactness,
  cb.new_leads_contacted_count,
  sr.resolved_sender_accounts,
  sr.resolved_sender_daily_limit_total,
  sr.sender_rows_missing_status,
  sr.senders_over_5pct_bounce_30d,
  sr.avg_warmup_score,
  cb.bounce_rate_pct,
  cb.unique_reply_rate_pct,
  CASE
    WHEN COALESCE(sr.resolved_sender_accounts, 0) = 0 THEN 'blocker_missing_senders'
    WHEN COALESCE(tr.template_steps, 0) = 0 THEN 'blocker_missing_templates'
    WHEN COALESCE(tr.blank_body_templates, 0) > 0 THEN 'blocker_blank_body'
    WHEN cb.tracking_status = 'tracking_unknown' OR cb.deliverability_settings_status = 'deliverability_settings_unknown' THEN 'review_settings_unknown'
    WHEN cb.disable_bounce_protect = TRUE OR cb.allow_risky_contacts = TRUE THEN 'review_deliverability_guardrails_relaxed'
    WHEN cb.open_tracking = TRUE OR cb.link_tracking = TRUE THEN 'review_tracking_enabled'
    WHEN COALESCE(sr.senders_over_5pct_bounce_30d, 0) > 0 THEN 'review_sender_bounce_risk'
    ELSE 'ready_with_checks'
  END AS launch_qa_status
FROM campaign_base cb
LEFT JOIN template_rollup tr
  ON cb.workspace_id = tr.workspace_id
 AND cb.campaign_id = tr.campaign_id
LEFT JOIN sender_rollup sr
  ON cb.workspace_id = sr.workspace_id
 AND cb.campaign_id = sr.campaign_id
ORDER BY
  CASE launch_qa_status
    WHEN 'blocker_missing_senders' THEN 1
    WHEN 'blocker_missing_templates' THEN 2
    WHEN 'blocker_blank_body' THEN 3
    WHEN 'review_settings_unknown' THEN 4
    WHEN 'review_deliverability_guardrails_relaxed' THEN 5
    WHEN 'review_tracking_enabled' THEN 6
    WHEN 'review_sender_bounce_risk' THEN 7
    ELSE 9
  END,
  cb.campaign_name;`,
    notes: [
      "Replace '{{campaign_name}}' with a campaign name fragment, or swap the WHERE clause for `c.id = '{{campaign_id}}'`.",
      "Pair this with `personalization-leak-audit` when the campaign uses template variables.",
      "Launch QA should produce blockers, warnings, and ready checks; do not bury blockers under general analysis.",
      "Do not mark a campaign blocked for no uncontacted leads from `leads_count - contacted_count`; exact uncontacted lead supply is not cached.",
      "Unknown tracking or deliverability settings mean the local cache lacks this field; ask for refresh_data before treating settings as ready.",
      "Open/link tracking warnings come from cold email best-practice policy, not a hard Instantly API error.",
      "Disabled bounce protection or allowed risky contacts are surfaced as deliverability guardrail review items.",
    ],
  },
  {
    id: "campaign-tracking-deliverability-settings",
    topic: "campaign-launch-qa",
    title: "Campaign tracking and deliverability settings",
    question: "Which campaigns have tracking or deliverability guardrail settings enabled?",
    exactness: "exact",
    rationale: "Expose per-campaign tracking and deliverability-related campaign settings from the exact Instantly campaign surface before launch or audit work.",
    sql: `SELECT
  campaign_id,
  campaign_name,
  status,
  daily_limit,
  text_only,
  first_email_text_only,
  open_tracking,
  link_tracking,
  tracking_status,
  stop_on_reply,
  stop_on_auto_reply,
  match_lead_esp,
  allow_risky_contacts,
  disable_bounce_protect,
  insert_unsubscribe_header,
  deliverability_settings_status,
  bounce_rate_pct,
  unique_reply_rate_pct,
  CASE
    WHEN tracking_status = 'tracking_unknown' OR deliverability_settings_status = 'deliverability_settings_unknown' THEN 'review_settings_unknown'
    WHEN disable_bounce_protect = TRUE OR allow_risky_contacts = TRUE THEN 'review_deliverability_guardrails'
    WHEN open_tracking = TRUE OR link_tracking = TRUE THEN 'review_tracking'
    ELSE 'ready_with_settings_checked'
  END AS settings_review_status
FROM sendlens.campaign_overview
ORDER BY
  CASE settings_review_status
    WHEN 'review_settings_unknown' THEN 1
    WHEN 'review_deliverability_guardrails' THEN 2
    WHEN 'review_tracking' THEN 3
    ELSE 4
  END,
  emails_sent_count DESC,
  campaign_name
LIMIT 100;`,
    notes: [
      "Use this when a user asks whether tracking, bounce protection, risky contacts, unsubscribe headers, or ESP matching are on per campaign.",
      "`tracking_unknown` or `deliverability_settings_unknown` means the local cache does not know the setting yet; refresh before making launch-readiness claims.",
      "`disable_bounce_protect = TRUE` and `allow_risky_contacts = TRUE` mean deliverability guardrails are relaxed and deserve launch review.",
      "`open_tracking` and `link_tracking` are exact campaign settings, not inferred from opens or clicks.",
    ],
  },
  {
    id: "workspace-campaign-recent-movers",
    topic: "campaign-performance",
    title: "Workspace campaign recent movers",
    question: "Which campaigns changed the most recently?",
    exactness: "exact",
    rationale: "Compare exact campaign-attributed metrics from the last 7 days against the prior 7 days to find campaigns that are accelerating, slowing, or going quiet.",
    sql: `WITH daily_windows AS (
  SELECT
    cdm.workspace_id,
    cdm.campaign_id,
    SUM(CASE WHEN cdm.date >= CURRENT_DATE - INTERVAL 7 DAY THEN COALESCE(cdm.sent, 0) ELSE 0 END) AS sent_7d,
    SUM(CASE WHEN cdm.date >= CURRENT_DATE - INTERVAL 7 DAY THEN COALESCE(cdm.new_leads_contacted, 0) ELSE 0 END) AS new_leads_contacted_7d,
    SUM(CASE WHEN cdm.date >= CURRENT_DATE - INTERVAL 7 DAY THEN COALESCE(cdm.unique_replies, 0) ELSE 0 END) AS unique_replies_7d,
    SUM(CASE WHEN cdm.date >= CURRENT_DATE - INTERVAL 7 DAY THEN COALESCE(cdm.opportunities, 0) ELSE 0 END) AS opportunities_7d,
    SUM(CASE WHEN cdm.date < CURRENT_DATE - INTERVAL 7 DAY AND cdm.date >= CURRENT_DATE - INTERVAL 14 DAY THEN COALESCE(cdm.sent, 0) ELSE 0 END) AS sent_prior_7d,
    SUM(CASE WHEN cdm.date < CURRENT_DATE - INTERVAL 7 DAY AND cdm.date >= CURRENT_DATE - INTERVAL 14 DAY THEN COALESCE(cdm.new_leads_contacted, 0) ELSE 0 END) AS new_leads_contacted_prior_7d,
    SUM(CASE WHEN cdm.date < CURRENT_DATE - INTERVAL 7 DAY AND cdm.date >= CURRENT_DATE - INTERVAL 14 DAY THEN COALESCE(cdm.unique_replies, 0) ELSE 0 END) AS unique_replies_prior_7d,
    SUM(CASE WHEN cdm.date < CURRENT_DATE - INTERVAL 7 DAY AND cdm.date >= CURRENT_DATE - INTERVAL 14 DAY THEN COALESCE(cdm.opportunities, 0) ELSE 0 END) AS opportunities_prior_7d,
    MAX(cdm.date) AS last_metric_date
  FROM sendlens.campaign_daily_metrics cdm
  WHERE cdm.date >= CURRENT_DATE - INTERVAL 14 DAY
  GROUP BY 1, 2
)
SELECT
  co.campaign_id,
  co.campaign_name,
  co.status,
  dw.last_metric_date,
  dw.sent_7d,
  dw.sent_prior_7d,
  dw.sent_7d - dw.sent_prior_7d AS sent_delta_vs_prior_7d,
  dw.new_leads_contacted_7d,
  dw.new_leads_contacted_prior_7d,
  dw.new_leads_contacted_7d - dw.new_leads_contacted_prior_7d AS new_leads_contacted_delta_vs_prior_7d,
  dw.unique_replies_7d,
  dw.unique_replies_prior_7d,
  dw.unique_replies_7d - dw.unique_replies_prior_7d AS unique_replies_delta_vs_prior_7d,
  dw.opportunities_7d,
  dw.opportunities_prior_7d,
  dw.opportunities_7d - dw.opportunities_prior_7d AS opportunities_delta_vs_prior_7d,
  ROUND(100.0 * dw.unique_replies_7d / NULLIF(dw.sent_7d, 0), 2) AS unique_reply_rate_7d_pct,
  ROUND(100.0 * dw.unique_replies_prior_7d / NULLIF(dw.sent_prior_7d, 0), 2) AS unique_reply_rate_prior_7d_pct,
  CASE
    WHEN COALESCE(dw.sent_7d, 0) = 0 AND COALESCE(dw.sent_prior_7d, 0) > 0 THEN 'stopped_sending'
    WHEN COALESCE(dw.sent_7d, 0) > 0 AND COALESCE(dw.sent_prior_7d, 0) = 0 THEN 'new_or_restarted_volume'
    WHEN dw.unique_replies_7d > dw.unique_replies_prior_7d THEN 'reply_volume_up'
    WHEN dw.unique_replies_7d < dw.unique_replies_prior_7d THEN 'reply_volume_down'
    WHEN dw.sent_7d > dw.sent_prior_7d THEN 'send_volume_up'
    WHEN dw.sent_7d < dw.sent_prior_7d THEN 'send_volume_down'
    ELSE 'stable_or_low_change'
  END AS movement_status
FROM daily_windows dw
JOIN sendlens.campaign_overview co
  ON dw.workspace_id = co.workspace_id
 AND dw.campaign_id = co.campaign_id
WHERE co.status = 'active'
ORDER BY
  CASE movement_status
    WHEN 'stopped_sending' THEN 1
    WHEN 'reply_volume_down' THEN 2
    WHEN 'new_or_restarted_volume' THEN 3
    WHEN 'reply_volume_up' THEN 4
    WHEN 'send_volume_up' THEN 5
    ELSE 6
  END,
  ABS(dw.sent_7d - dw.sent_prior_7d) DESC,
  co.campaign_name
LIMIT 100;`,
    notes: [
      "This is exact for cached campaign/day metrics.",
      "Use it when the user asks what changed recently or which campaigns need attention today.",
      "If rows are missing, check whether campaign daily analytics have been cached for the relevant period.",
    ],
  },
  {
    id: "negative-unsubscribe-concentration",
    topic: "workspace-health",
    title: "Negative and unsubscribe concentration",
    question: "Where are unsubscribes, bounces, not-interested, and wrong-person signals concentrated?",
    exactness: "hybrid",
    rationale: "Combine exact campaign unsubscribe/bounce aggregates with sampled reply outcome evidence to find campaigns or tags that need lead-quality, targeting, or copy review.",
    sql: `WITH reply_sample AS (
  SELECT
    workspace_id,
    campaign_id,
    COUNT(*) AS sampled_reply_or_signal_leads,
    SUM(CASE WHEN lt_interest_status = -1 THEN 1 ELSE 0 END) AS sampled_not_interested,
    SUM(CASE WHEN lt_interest_status = -2 THEN 1 ELSE 0 END) AS sampled_wrong_person,
    SUM(CASE WHEN reply_outcome_label = 'negative' THEN 1 ELSE 0 END) AS sampled_negative_outcomes
  FROM sendlens.lead_evidence
  WHERE has_reply_signal = TRUE
  GROUP BY 1, 2
),
tag_rollup AS (
  SELECT
    workspace_id,
    campaign_id,
    MIN(tag_label) AS campaign_tag_example
  FROM sendlens.campaign_tags
  GROUP BY 1, 2
)
SELECT
  co.campaign_id,
  co.campaign_name,
  tr.campaign_tag_example,
  co.emails_sent_count,
  co.reply_count_unique,
  co.unique_reply_rate_pct,
  co.bounced_count,
  co.bounce_rate_pct,
  ca.unsubscribed_count,
  ROUND(100.0 * ca.unsubscribed_count / NULLIF(co.emails_sent_count, 0), 2) AS unsubscribe_rate_pct,
  COALESCE(rs.sampled_reply_or_signal_leads, 0) AS sampled_reply_or_signal_leads,
  COALESCE(rs.sampled_not_interested, 0) AS sampled_not_interested,
  COALESCE(rs.sampled_wrong_person, 0) AS sampled_wrong_person,
  COALESCE(rs.sampled_negative_outcomes, 0) AS sampled_negative_outcomes,
  CASE
    WHEN COALESCE(co.bounce_rate_pct, 0) >= 5 THEN 'bounce_risk'
    WHEN ROUND(100.0 * ca.unsubscribed_count / NULLIF(co.emails_sent_count, 0), 2) >= 1 THEN 'unsubscribe_risk'
    WHEN COALESCE(rs.sampled_wrong_person, 0) >= COALESCE(rs.sampled_not_interested, 0)
      AND COALESCE(rs.sampled_wrong_person, 0) > 0 THEN 'wrong_person_concentration'
    WHEN COALESCE(rs.sampled_negative_outcomes, 0) > 0 THEN 'negative_reply_concentration'
    ELSE 'monitor'
  END AS concentration_status
FROM sendlens.campaign_overview co
LEFT JOIN sendlens.campaign_analytics ca
  ON co.workspace_id = ca.workspace_id
 AND co.campaign_id = ca.campaign_id
LEFT JOIN reply_sample rs
  ON co.workspace_id = rs.workspace_id
 AND co.campaign_id = rs.campaign_id
LEFT JOIN tag_rollup tr
  ON co.workspace_id = tr.workspace_id
 AND co.campaign_id = tr.campaign_id
WHERE co.status = 'active'
ORDER BY
  CASE concentration_status
    WHEN 'bounce_risk' THEN 1
    WHEN 'unsubscribe_risk' THEN 2
    WHEN 'wrong_person_concentration' THEN 3
    WHEN 'negative_reply_concentration' THEN 4
    ELSE 5
  END,
  co.bounce_rate_pct DESC NULLS LAST,
  unsubscribe_rate_pct DESC NULLS LAST,
  sampled_negative_outcomes DESC NULLS LAST;`,
    notes: [
      "Unsubscribe and bounce metrics are exact campaign aggregates.",
      "Not-interested and wrong-person concentrations come from sampled/bounded lead evidence unless the campaign was fully scanned.",
      "Use this to decide whether the next action is lead source cleanup, ICP correction, copy rewrite, or sender health review.",
    ],
  },
  {
    id: "experiment-planner-candidates",
    topic: "experiment-planner",
    title: "Experiment planner candidates",
    question: "Which campaign experiments should we launch next?",
    exactness: "hybrid",
    rationale: "Rank active campaigns by exact performance and evidence coverage so the agent can choose whether the next test should target copy, ICP, reply handling, lead supply, or deliverability.",
    sql: `WITH active_campaigns AS (
  SELECT
    co.workspace_id,
    co.campaign_id,
    co.campaign_name,
    co.leads_count,
    co.contacted_count,
    CAST(NULL AS INTEGER) AS exact_uncontacted_leads,
    'unknown_no_exact_uncontacted_lead_field' AS lead_supply_exactness,
    co.emails_sent_count,
    co.reply_count_unique,
    co.unique_reply_rate_pct,
    co.bounced_count,
    co.bounce_rate_pct,
    co.total_opportunities,
    co.ingest_mode,
    co.reply_lead_rows,
    co.nonreply_rows_sampled,
    co.reply_outbound_rows
  FROM sendlens.campaign_overview co
  WHERE co.status = 'active'
),
step_summary AS (
  SELECT
    workspace_id,
    campaign_id,
    COUNT(DISTINCT step) AS steps_with_analytics,
    SUM(COALESCE(sent, 0)) AS step_sent_total,
    SUM(COALESCE(unique_replies, 0)) AS step_unique_replies_total,
    SUM(COALESCE(opportunities, 0)) AS step_opportunities_total
  FROM sendlens.step_analytics
  GROUP BY 1, 2
),
recent_volume AS (
  SELECT
    workspace_id,
    campaign_id,
    SUM(COALESCE(sent, 0)) AS sent_14d,
    SUM(COALESCE(new_leads_contacted, 0)) AS new_leads_contacted_14d,
    SUM(COALESCE(unique_replies, 0)) AS unique_replies_14d,
    SUM(COALESCE(opportunities, 0)) AS opportunities_14d
  FROM sendlens.campaign_daily_metrics
  WHERE date >= CURRENT_DATE - INTERVAL 14 DAY
  GROUP BY 1, 2
),
tag_rollup AS (
  SELECT
    workspace_id,
    campaign_id,
    MIN(tag_label) AS campaign_tag_example
  FROM sendlens.campaign_tags
  GROUP BY 1, 2
)
SELECT
  ac.campaign_id,
  ac.campaign_name,
  tr.campaign_tag_example,
  ac.leads_count,
  ac.contacted_count,
  ac.exact_uncontacted_leads,
  ac.lead_supply_exactness,
  rv.sent_14d,
  rv.new_leads_contacted_14d,
  rv.unique_replies_14d,
  rv.opportunities_14d,
  ac.emails_sent_count,
  ac.reply_count_unique,
  ac.unique_reply_rate_pct,
  ac.bounced_count,
  ac.bounce_rate_pct,
  ac.total_opportunities,
  ss.steps_with_analytics,
  ss.step_sent_total,
  ss.step_unique_replies_total,
  ss.step_opportunities_total,
  ac.ingest_mode,
  ac.reply_lead_rows,
  ac.nonreply_rows_sampled,
  ac.reply_outbound_rows,
  CASE
    WHEN ac.bounce_rate_pct >= 5 THEN 'deliverability_or_lead_quality_test'
    WHEN ac.emails_sent_count >= 300 AND ac.unique_reply_rate_pct < 0.5 THEN 'copy_or_icp_test'
    WHEN ac.emails_sent_count >= 300 AND ac.total_opportunities = 0 THEN 'reply_quality_or_offer_test'
    WHEN COALESCE(ac.reply_outbound_rows, 0) = 0 THEN 'hydrate_or_load_campaign_before_testing'
    ELSE 'optimize_winner_or_holdout_test'
  END AS recommended_test_lane
FROM active_campaigns ac
LEFT JOIN recent_volume rv
  ON ac.workspace_id = rv.workspace_id
 AND ac.campaign_id = rv.campaign_id
LEFT JOIN step_summary ss
  ON ac.workspace_id = ss.workspace_id
 AND ac.campaign_id = ss.campaign_id
LEFT JOIN tag_rollup tr
  ON ac.workspace_id = tr.workspace_id
 AND ac.campaign_id = tr.campaign_id
ORDER BY
  CASE recommended_test_lane
    WHEN 'deliverability_or_lead_quality_test' THEN 1
    WHEN 'copy_or_icp_test' THEN 2
    WHEN 'reply_quality_or_offer_test' THEN 3
    WHEN 'hydrate_or_load_campaign_before_testing' THEN 5
    ELSE 6
  END,
  rv.sent_14d DESC NULLS LAST,
  ac.emails_sent_count DESC;`,
    notes: [
      "Use this as the first pass for experiment planning, then narrow to one campaign and use copy, reply, or ICP recipes for the actual hypothesis.",
      "This recipe is hybrid because it combines exact campaign metrics with sampled/evidence coverage fields to decide whether deeper evidence is ready.",
      "A good experiment plan should include hypothesis, change, target cohort, success metric, stop condition, owner, and evaluation date.",
      "Do not recommend lead-supply refill tests solely from `leads_count - contacted_count`; exact uncontacted lead supply is not cached.",
    ],
  },
  {
    id: "inbox-placement-test-overview",
    topic: "workspace-health",
    title: "Inbox placement test overview",
    question: "Which inbox placement tests show spam, category, or primary-inbox risk?",
    exactness: "exact",
    rationale: "Use exact Instantly inbox placement analytics before attributing low replies only to copy or targeting.",
    sql: `SELECT
  test_id,
  test_name,
  campaign_id,
  campaign_name,
  status,
  received_records,
  primary_inbox_records,
  category_records,
  spam_records,
  primary_inbox_rate_pct,
  category_rate_pct,
  spam_rate_pct,
  spf_failures,
  dkim_failures,
  dmarc_failures,
  timestamp_created
FROM sendlens.inbox_placement_test_overview
ORDER BY spam_rate_pct DESC NULLS LAST, primary_inbox_rate_pct ASC NULLS LAST, received_records DESC;`,
    notes: [
      "This is exact for inbox placement tests returned by the Instantly API.",
      "Use it when workspace reply rate is low, spam/category placement is suspected, or a campaign's performance changed suddenly.",
      "A missing row means no inbox placement test data was available locally, not that deliverability is healthy.",
    ],
  },
  {
    id: "sender-deliverability-health",
    topic: "workspace-health",
    title: "Sender deliverability health",
    question: "Which sender accounts are landing in spam or categories in inbox placement tests?",
    exactness: "exact",
    rationale: "Roll exact inbox placement analytics up by sender before deciding which accounts to pause or inspect.",
    sql: `SELECT
  sender_email,
  inbox_placement_tests,
  received_records,
  primary_inbox_records,
  category_records,
  spam_records,
  primary_inbox_rate_pct,
  category_rate_pct,
  spam_rate_pct,
  spf_failures,
  dkim_failures,
  dmarc_failures,
  first_seen_at,
  last_seen_at
FROM sendlens.sender_deliverability_health
ORDER BY spam_rate_pct DESC NULLS LAST, primary_inbox_rate_pct ASC NULLS LAST, received_records DESC;`,
    notes: [
      "This is exact for received inbox placement analytics rows.",
      "Pair it with `account-health` when deciding whether risk is warmup/account-level or inbox-placement specific.",
      "Filter to a sender email when investigating one sending account.",
    ],
  },
  {
    id: "inbox-placement-auth-failures",
    topic: "workspace-health",
    title: "Inbox placement authentication failures",
    question: "Which inbox placement rows show SPF, DKIM, DMARC, or blacklist problems?",
    exactness: "exact",
    rationale: "Surface concrete authentication and blacklist evidence from inbox placement analytics.",
    sql: `SELECT
  test_id,
  sender_email,
  recipient_email,
  recipient_esp,
  spf_pass,
  dkim_pass,
  dmarc_pass,
  smtp_ip_blacklist_report_json,
  authentication_failure_results_json,
  timestamp_created
FROM sendlens.inbox_placement_analytics
WHERE record_type = 2
  AND (
    COALESCE(spf_pass, TRUE) = FALSE
    OR COALESCE(dkim_pass, TRUE) = FALSE
    OR COALESCE(dmarc_pass, TRUE) = FALSE
    OR smtp_ip_blacklist_report_json IS NOT NULL
    OR authentication_failure_results_json IS NOT NULL
  )
ORDER BY timestamp_created DESC NULLS LAST
LIMIT 100;`,
    notes: [
      "This is exact evidence from inbox placement analytics rows.",
      "Use these rows for deliverability debugging; do not infer authentication failures from reply rate alone.",
      "Blacklist and authentication JSON fields preserve the raw Instantly payload for follow-up inspection.",
    ],
  },
  {
    id: "smartlead-delivery-test-overview",
    topic: "workspace-health",
    title: "Smartlead Smart Delivery test overview",
    question: "Which Smartlead Smart Delivery tests show primary-inbox, category, or spam risk?",
    exactness: "exact",
    rationale: "Use exact Smart Delivery run counts when the support-gated read surface is available.",
    sql: `SELECT
  source_provider,
  test_id,
  test_name,
  test_type,
  test_status,
  latest_run_status,
  latest_run_no,
  total_count,
  inbox_count,
  category_count,
  spam_count,
  failed_count,
  primary_inbox_rate_pct,
  category_rate_pct,
  spam_rate_pct,
  latest_observed_at
FROM sendlens.smartlead_delivery_test_overview
ORDER BY spam_rate_pct DESC NULLS LAST, primary_inbox_rate_pct ASC NULLS LAST, total_count DESC NULLS LAST;`,
    notes: [
      "Counts come from Smart Delivery schedule history and rates are derived only from those exact counts.",
      "Smart Delivery is support-gated; a missing row is not proof that placement is healthy.",
      "Only the newest bounded test set is report-hydrated during refresh; provider capability coverage records the bound.",
    ],
  },
  {
    id: "smartlead-sender-delivery-health",
    topic: "workspace-health",
    title: "Smartlead sender delivery health",
    question: "Which Smartlead senders have weak inbox placement or reputation in Smart Delivery?",
    exactness: "exact",
    rationale: "Inspect provider-reported sender-level placement and reputation without manufacturing seed-level outcomes.",
    sql: `SELECT
  source_provider,
  test_id,
  sender_email,
  tests_count,
  inbox_rate_pct,
  spam_rate_pct,
  bounce_rate_pct,
  reputation_score,
  observed_at
FROM sendlens.smartlead_sender_delivery_health
ORDER BY spam_rate_pct DESC NULLS LAST, inbox_rate_pct ASC NULLS LAST, reputation_score ASC NULLS LAST;`,
    notes: [
      "These values are exact provider-reported sender aggregates for each Smart Delivery test.",
      "Do not combine their denominators with Standard API campaign rates without an explicit normalization decision.",
    ],
  },
  {
    id: "smartlead-delivery-authentication-health",
    topic: "workspace-health",
    title: "Smartlead delivery authentication and blacklist health",
    question: "Which Smartlead Smart Delivery checks show SPF, DKIM, rDNS, blacklist, IP, or spam-filter risk?",
    exactness: "exact",
    rationale: "Surface concrete Smart Delivery diagnostic evidence before attributing placement problems to copy or targeting.",
    sql: `SELECT
  source_provider,
  test_id,
  evidence_type,
  sender_email,
  recipient_email,
  provider,
  ip,
  spf_pass,
  dkim_pass,
  rdns_pass,
  domain_blacklisted,
  ip_blacklisted,
  blacklist_count,
  observed_at,
  diagnostic_json
FROM sendlens.smartlead_delivery_authentication_health
WHERE COALESCE(spf_pass, TRUE) = FALSE
   OR COALESCE(dkim_pass, TRUE) = FALSE
   OR COALESCE(rdns_pass, TRUE) = FALSE
   OR COALESCE(domain_blacklisted, FALSE) = TRUE
   OR COALESCE(ip_blacklisted, FALSE) = TRUE
   OR COALESCE(blacklist_count, 0) > 0
   OR evidence_type = 'spam_filter'
ORDER BY observed_at DESC NULLS LAST
LIMIT 100;`,
    notes: [
      "The query returns only exact check results and diagnostic summaries; raw email content and reply headers are intentionally absent.",
      "DMARC is not claimed because the checked Smart Delivery read reference does not expose a standalone DMARC endpoint.",
    ],
  },
  {
    id: "campaign-winners",
    topic: "campaign-performance",
    title: "Winning campaigns",
    question: "Which campaigns are winning on reply rate and opportunities?",
    exactness: "exact",
    rationale: "Compare exact reply efficiency and downstream opportunity creation across campaigns.",
    sql: `SELECT
  campaign_id,
  campaign_name AS name,
  status,
  daily_limit,
  emails_sent_count,
  reply_count_unique,
  unique_reply_rate_pct,
  total_opportunities,
  reply_lead_rows,
  nonreply_rows_sampled,
  filtered_lead_rows
FROM sendlens.campaign_overview
WHERE status = 'active'
ORDER BY unique_reply_rate_pct DESC NULLS LAST, total_opportunities DESC NULLS LAST, emails_sent_count DESC;`,
    notes: [
      "This defaults to active campaigns only.",
      "Use a minimum sent threshold in the conversation if the workspace has tiny campaigns.",
    ],
  },
  {
    id: "variant-winners",
    topic: "campaign-performance",
    title: "Variant winners by campaign",
    question: "Which step and variant combinations are winning?",
    exactness: "exact",
    rationale: "Find exact step and variant performance before making copy changes, falling back to opportunity metrics when step-level reply coverage is sparse.",
    sql: `WITH step_coverage AS (
  SELECT
    workspace_id,
    campaign_id,
    COUNT(*) AS step_rows,
    SUM(CASE WHEN unique_replies IS NOT NULL THEN 1 ELSE 0 END) AS step_rows_with_unique_replies
  FROM sendlens.step_analytics
  GROUP BY workspace_id, campaign_id
)
SELECT
  sa.campaign_id,
  c.name AS campaign_name,
  sa.step,
  sa.variant,
  sa.sent,
  CASE
    WHEN COALESCE(sc.step_rows_with_unique_replies, 0) * 1.0 / NULLIF(sc.step_rows, 0) >= 0.6
      THEN 'unique_reply_rate'
    ELSE 'opportunity_rate'
  END AS ranking_basis,
  ROUND(100.0 * COALESCE(sc.step_rows_with_unique_replies, 0) / NULLIF(sc.step_rows, 0), 2) AS unique_reply_coverage_pct,
  sa.unique_replies,
  ROUND(100.0 * sa.unique_replies / NULLIF(sa.sent, 0), 2) AS unique_reply_rate_pct,
  sa.opportunities,
  ROUND(100.0 * sa.opportunities / NULLIF(sa.sent, 0), 2) AS opportunity_rate_pct,
  sa.bounces,
  ROUND(100.0 * sa.bounces / NULLIF(sa.sent, 0), 2) AS bounce_rate_pct,
  cv.subject
FROM sendlens.step_analytics sa
JOIN sendlens.campaigns c
  ON sa.workspace_id = c.workspace_id AND sa.campaign_id = c.id
LEFT JOIN step_coverage sc
  ON sa.workspace_id = sc.workspace_id
 AND sa.campaign_id = sc.campaign_id
LEFT JOIN sendlens.campaign_variants cv
  ON sa.workspace_id = cv.workspace_id
 AND sa.campaign_id = cv.campaign_id
 AND sa.step = cv.step
 AND sa.variant = cv.variant
WHERE c.status = 'active'
ORDER BY
  CASE
    WHEN COALESCE(sc.step_rows_with_unique_replies, 0) * 1.0 / NULLIF(sc.step_rows, 0) >= 0.6
      THEN ROUND(100.0 * sa.unique_replies / NULLIF(sa.sent, 0), 2)
  END DESC NULLS LAST,
  CASE
    WHEN COALESCE(sc.step_rows_with_unique_replies, 0) * 1.0 / NULLIF(sc.step_rows, 0) < 0.6
      THEN ROUND(100.0 * sa.opportunities / NULLIF(sa.sent, 0), 2)
  END DESC NULLS LAST,
  sa.opportunities DESC NULLS LAST,
  sa.sent DESC;`,
    notes: [
      "This is exact because step analytics come from Instantly aggregates.",
      "This defaults to active campaigns only.",
      "When at least 60% of step rows in a campaign have step-level `unique_replies`, rank by exact unique reply rate.",
      "When step-level `unique_replies` coverage is sparse or null, rank by `opportunity_rate_pct` and `opportunities` instead.",
      "For one campaign, add `AND sa.campaign_id = '{{campaign_id}}'`.",
      "Ask explicitly for inactive or historical campaigns if you want them included.",
    ],
  },
  {
    id: "step-fatigue-by-campaign",
    topic: "campaign-performance",
    title: "Step fatigue by campaign",
    question: "Where does one campaign's sequence stop producing value?",
    exactness: "exact",
    rationale: "Roll exact step analytics up to step level and make the metric basis explicit before judging fatigue.",
    sql: `WITH step_coverage AS (
  SELECT
    workspace_id,
    campaign_id,
    COUNT(*) AS step_variant_rows,
    SUM(CASE WHEN unique_replies IS NOT NULL THEN 1 ELSE 0 END) AS rows_with_unique_replies
  FROM sendlens.step_analytics
  WHERE campaign_id = '{{campaign_id}}'
  GROUP BY workspace_id, campaign_id
),
step_rollup AS (
  SELECT
    sa.workspace_id,
    sa.campaign_id,
    c.name AS campaign_name,
    sa.step,
    COUNT(*) AS variant_rows,
    SUM(sa.sent) AS sent,
    SUM(sa.unique_replies) AS unique_replies,
    SUM(sa.opportunities) AS opportunities,
    SUM(sa.bounces) AS bounces,
    ROUND(100.0 * SUM(sa.unique_replies) / NULLIF(SUM(sa.sent), 0), 2) AS unique_reply_rate_pct,
    ROUND(100.0 * SUM(sa.opportunities) / NULLIF(SUM(sa.sent), 0), 2) AS opportunity_rate_pct,
    ROUND(100.0 * SUM(sa.bounces) / NULLIF(SUM(sa.sent), 0), 2) AS bounce_rate_pct
  FROM sendlens.step_analytics sa
  JOIN sendlens.campaigns c
    ON sa.workspace_id = c.workspace_id
   AND sa.campaign_id = c.id
  WHERE sa.campaign_id = '{{campaign_id}}'
  GROUP BY 1, 2, 3, 4
),
scored AS (
  SELECT
    sr.*,
    ROUND(100.0 * COALESCE(sc.rows_with_unique_replies, 0) / NULLIF(sc.step_variant_rows, 0), 2) AS unique_reply_coverage_pct,
    CASE
      WHEN COALESCE(sc.rows_with_unique_replies, 0) * 1.0 / NULLIF(sc.step_variant_rows, 0) >= 0.6
        THEN 'unique_reply_rate'
      ELSE 'opportunity_rate'
    END AS metric_basis,
    CASE
      WHEN COALESCE(sc.rows_with_unique_replies, 0) * 1.0 / NULLIF(sc.step_variant_rows, 0) >= 0.6
        THEN sr.unique_reply_rate_pct
      ELSE sr.opportunity_rate_pct
    END AS metric_value_pct
  FROM step_rollup sr
  LEFT JOIN step_coverage sc
    ON sr.workspace_id = sc.workspace_id
   AND sr.campaign_id = sc.campaign_id
)
SELECT
  campaign_id,
  campaign_name,
  step,
  variant_rows,
  sent,
  unique_replies,
  unique_reply_rate_pct,
  opportunities,
  opportunity_rate_pct,
  bounces,
  bounce_rate_pct,
  unique_reply_coverage_pct,
  metric_basis,
  metric_value_pct,
  LAG(metric_value_pct) OVER (PARTITION BY workspace_id, campaign_id ORDER BY step) AS previous_step_metric_value_pct,
  metric_value_pct - LAG(metric_value_pct) OVER (PARTITION BY workspace_id, campaign_id ORDER BY step) AS metric_delta_from_previous_step_pct_points
FROM scored
ORDER BY step;`,
    notes: [
      "This is exact because it uses Instantly step analytics, not sampled lead evidence.",
      "Replace '{{campaign_id}}' with one campaign ID.",
      "If at least 60% of step/variant rows have `unique_replies`, the metric basis is `unique_reply_rate`.",
      "If step reply coverage is sparse, the metric basis switches to `opportunity_rate` so the agent does not overclaim reply-rate precision.",
      "Use the step-to-step delta as a directional fatigue signal, then inspect variants/copy before recommending cuts.",
    ],
  },
  {
    id: "copy-template-review",
    topic: "copy-analysis",
    title: "Template review by step",
    question: "What copy is currently live in the campaign?",
    exactness: "exact",
    rationale: "Inspect the intended templates before comparing them against real replies or sampled outbound messages.",
    sql: `SELECT
  campaign_id,
  sequence_index,
  step,
  variant,
  step_type,
  delay_value,
  delay_unit,
  subject,
  body_text
FROM sendlens.campaign_variants
WHERE campaign_id = '{{campaign_id}}'
ORDER BY sequence_index, step, variant;`,
    notes: [
      "This shows intended templates, not rendered personalization.",
      "Pair it with reply emails when recommending copy changes.",
    ],
  },
  {
    id: "rendered-outbound-sample",
    topic: "copy-analysis",
    title: "Rendered outbound summary",
    question: "How are templates rendering across sampled lead variables without exposing full recipient or body text?",
    exactness: "sampled",
    rationale: "Use aggregated local reconstruction coverage and short previews to spot personalization drift before opening raw rows.",
    sql: `SELECT
  campaign_id,
  campaign_name,
  step_resolved,
  variant_resolved,
  sample_source,
  COUNT(*) AS sampled_rendered_rows,
  COUNT(DISTINCT to_email) AS sampled_leads,
  SUM(CASE WHEN regexp_matches(COALESCE(rendered_subject, ''), '\\{\\{[^}]+\\}\\}') THEN 1 ELSE 0 END) AS rows_with_unresolved_subject_token,
  SUM(CASE WHEN regexp_matches(COALESCE(rendered_body_text, ''), '\\{\\{[^}]+\\}\\}') THEN 1 ELSE 0 END) AS rows_with_unresolved_body_token,
  ROUND(AVG(length(COALESCE(rendered_subject, ''))), 1) AS avg_rendered_subject_chars,
  ROUND(AVG(length(COALESCE(rendered_body_text, ''))), 1) AS avg_rendered_body_chars,
  MIN(sent_at) AS oldest_sample_sent_at,
  MAX(sent_at) AS newest_sample_sent_at,
  MIN(left(COALESCE(rendered_subject, ''), 160)) AS example_rendered_subject_preview,
  MIN(left(COALESCE(rendered_body_text, ''), 240)) AS example_rendered_body_preview
FROM sendlens.rendered_outbound_context
WHERE campaign_id = '{{campaign_id}}'
GROUP BY 1, 2, 3, 4, 5
ORDER BY rows_with_unresolved_body_token DESC, sampled_rendered_rows DESC, step_resolved, variant_resolved;`,
    notes: [
      "This is sampled evidence only.",
      "Rendered rows are reconstructed locally from templates plus lead variables, not exact delivered email bodies.",
      "This safe summary intentionally omits recipient email, full rendered body text, and full template body text.",
      "Use `rendered-outbound-raw-detail` only for local diagnosis when raw row inspection is necessary.",
    ],
  },
  {
    id: "rendered-outbound-raw-detail",
    topic: "copy-analysis",
    title: "Rendered outbound raw detail",
    question: "Which raw reconstructed outbound rows should I inspect locally for copy QA?",
    exactness: "sampled",
    rationale: "Inspect locally reconstructed row-level copy only after the safe summary shows a reason to open raw details.",
    sql: `SELECT
  campaign_id,
  campaign_name,
  to_email,
  step_resolved,
  variant_resolved,
  rendered_subject AS subject,
  rendered_body_text AS body_text,
  template_subject,
  template_body_text,
  sample_source,
  sent_at
FROM sendlens.rendered_outbound_context
WHERE campaign_id = '{{campaign_id}}'
ORDER BY sent_at DESC
LIMIT 50;`,
    notes: [
      "Raw detail mode can expose recipient emails, rendered outbound bodies, and template bodies.",
      "Use only for local diagnosis; do not paste raw bodies or contact fields into Linear, docs, PRs, or external artifacts.",
      "Rendered rows are reconstructed locally from templates plus lead variables, not exact delivered email bodies.",
    ],
  },
  {
    id: "personalization-leak-audit",
    topic: "copy-analysis",
    title: "Personalization leak audit",
    question: "Did any reconstructed outbound copy still contain unresolved template tokens?",
    exactness: "sampled",
    rationale: "Summarize sampled reconstructed outbound rows where template variables appear to have leaked through unresolved before opening raw examples.",
    route_card: {
      preferred_intent: "safe personalization leak summary before raw reconstructed-copy inspection",
      grain: "one row per unresolved token class/name in one campaign",
      time_basis: "cached sampled/reconstructed outbound rows",
      attribution: "local reconstruction from templates plus cached lead variables",
      provider_scope: "campaign-scoped; preserve provider-qualified campaign IDs when supplied",
      population_scope: "sampled rendered outbound evidence for one campaign",
      tag_role: "none",
      prerequisites: ["known campaign_id", "rendered outbound context available"],
      cost: "medium",
      privacy: "summary previews are bounded; raw recipient/body detail requires a separate raw-detail recipe and local authorization",
      privacy_class: "sampled_content_summary",
      safe_adaptations: ["filter to one step or variant", "open raw detail only for locally authorized diagnosis"],
      forbidden_adaptations: ["paste raw bodies or contact fields into external artifacts", "claim exact delivered copy from reconstructed evidence"],
    },
    sql: `WITH tokenized_rows AS (
  SELECT
    campaign_id,
    campaign_name,
    to_email,
    step_resolved,
    variant_resolved,
    left(COALESCE(rendered_subject, ''), 160) AS rendered_subject_preview,
    left(COALESCE(rendered_body_text, ''), 240) AS rendered_body_preview,
    sample_source,
    sent_at,
    regexp_matches(COALESCE(rendered_subject, ''), '\\{\\{[^}]+\\}\\}') AS subject_has_unresolved_token,
    regexp_matches(COALESCE(rendered_body_text, ''), '\\{\\{[^}]+\\}\\}') AS body_has_unresolved_token,
    trim(unnest(list_concat(
      regexp_extract_all(COALESCE(rendered_subject, ''), '\\{\\{\\s*([^}]+?)\\s*\\}\\}', 1),
      regexp_extract_all(COALESCE(rendered_body_text, ''), '\\{\\{\\s*([^}]+?)\\s*\\}\\}', 1)
    ))) AS unresolved_token_name
  FROM sendlens.rendered_outbound_context
  WHERE campaign_id = '{{campaign_id}}'
    AND (
      regexp_matches(COALESCE(rendered_subject, ''), '\\{\\{[^}]+\\}\\}')
      OR regexp_matches(COALESCE(rendered_body_text, ''), '\\{\\{[^}]+\\}\\}')
    )
),
classified_tokens AS (
  SELECT
    *,
    CASE
      WHEN regexp_replace(lower(unresolved_token_name), '[^a-z0-9]', '', 'g') = 'accountsignature'
        THEN 'account_signature'
      ELSE 'campaign_payload'
    END AS unresolved_token_class
  FROM tokenized_rows
  WHERE unresolved_token_name <> ''
),
leaked_rows AS (
  SELECT
    campaign_id,
    campaign_name,
    to_email,
    step_resolved,
    variant_resolved,
    rendered_subject_preview,
    rendered_body_preview,
    sample_source,
    sent_at,
    bool_or(subject_has_unresolved_token) AS subject_has_unresolved_token,
    bool_or(body_has_unresolved_token) AS body_has_unresolved_token,
    string_agg(DISTINCT unresolved_token_class, ', ' ORDER BY unresolved_token_class) AS unresolved_token_classes,
    string_agg(DISTINCT CASE WHEN unresolved_token_class = 'campaign_payload' THEN unresolved_token_name END, ', ' ORDER BY CASE WHEN unresolved_token_class = 'campaign_payload' THEN unresolved_token_name END) AS payload_unresolved_token_names,
    string_agg(DISTINCT CASE WHEN unresolved_token_class = 'account_signature' THEN unresolved_token_name END, ', ' ORDER BY CASE WHEN unresolved_token_class = 'account_signature' THEN unresolved_token_name END) AS account_signature_token_names,
    SUM(CASE WHEN unresolved_token_class = 'campaign_payload' THEN 1 ELSE 0 END) AS payload_unresolved_token_count,
    SUM(CASE WHEN unresolved_token_class = 'account_signature' THEN 1 ELSE 0 END) AS account_signature_token_count,
    CASE
      WHEN SUM(CASE WHEN unresolved_token_class = 'campaign_payload' THEN 1 ELSE 0 END) > 0
       AND SUM(CASE WHEN unresolved_token_class = 'account_signature' THEN 1 ELSE 0 END) > 0
        THEN 'mixed_payload_and_signature_unresolved'
      WHEN SUM(CASE WHEN unresolved_token_class = 'campaign_payload' THEN 1 ELSE 0 END) > 0
        THEN 'payload_personalization_unresolved'
      WHEN SUM(CASE WHEN unresolved_token_class = 'account_signature' THEN 1 ELSE 0 END) > 0
        THEN 'signature_unresolved_reconstruction_caveat'
      ELSE 'unclassified_unresolved_token'
    END AS token_classification
  FROM classified_tokens
  GROUP BY
    campaign_id,
    campaign_name,
    to_email,
    step_resolved,
    variant_resolved,
    rendered_subject_preview,
    rendered_body_preview,
    sample_source,
    sent_at
),
rollup AS (
  SELECT
    COUNT(DISTINCT CASE WHEN payload_unresolved_token_count > 0 THEN campaign_id END) AS affected_campaigns,
    COUNT(DISTINCT CASE WHEN payload_unresolved_token_count > 0 THEN COALESCE(step_resolved, 'unknown') || ':' || COALESCE(variant_resolved, 'unknown') END) AS affected_step_variants,
    COUNT(DISTINCT CASE WHEN payload_unresolved_token_count > 0 THEN to_email END) AS affected_leads,
    SUM(CASE WHEN payload_unresolved_token_count > 0 THEN 1 ELSE 0 END) AS affected_rendered_rows,
    SUM(CASE WHEN payload_unresolved_token_count > 0 THEN 1 ELSE 0 END) AS rendered_rows_with_payload_tokens,
    SUM(CASE WHEN account_signature_token_count > 0 THEN 1 ELSE 0 END) AS rendered_rows_with_account_signature_tokens
  FROM leaked_rows
)
SELECT
  lr.campaign_id,
  lr.campaign_name,
  lr.step_resolved,
  lr.variant_resolved,
  r.affected_campaigns,
  r.affected_step_variants,
  r.affected_leads,
  r.affected_rendered_rows,
  r.rendered_rows_with_payload_tokens,
  r.rendered_rows_with_account_signature_tokens,
  COUNT(*) AS leaked_rows_in_group,
  SUM(CASE WHEN lr.subject_has_unresolved_token THEN 1 ELSE 0 END) AS subject_token_rows,
  SUM(CASE WHEN lr.body_has_unresolved_token THEN 1 ELSE 0 END) AS body_token_rows,
  SUM(CASE WHEN lr.payload_unresolved_token_count > 0 THEN 1 ELSE 0 END) AS payload_token_rows,
  SUM(CASE WHEN lr.account_signature_token_count > 0 THEN 1 ELSE 0 END) AS account_signature_token_rows,
  string_agg(DISTINCT lr.unresolved_token_classes, ', ' ORDER BY lr.unresolved_token_classes) AS unresolved_token_classes,
  string_agg(DISTINCT lr.payload_unresolved_token_names, ', ' ORDER BY lr.payload_unresolved_token_names) AS payload_unresolved_token_names,
  string_agg(DISTINCT lr.account_signature_token_names, ', ' ORDER BY lr.account_signature_token_names) AS account_signature_token_names,
  CASE
    WHEN SUM(CASE WHEN lr.payload_unresolved_token_count > 0 THEN 1 ELSE 0 END) > 0
     AND SUM(CASE WHEN lr.account_signature_token_count > 0 THEN 1 ELSE 0 END) > 0
      THEN 'mixed_payload_and_signature_unresolved'
    WHEN SUM(CASE WHEN lr.payload_unresolved_token_count > 0 THEN 1 ELSE 0 END) > 0
      THEN 'payload_personalization_unresolved'
    WHEN SUM(CASE WHEN lr.account_signature_token_count > 0 THEN 1 ELSE 0 END) > 0
      THEN 'signature_unresolved_reconstruction_caveat'
    ELSE 'unclassified_unresolved_token'
  END AS token_classification,
  MIN(lr.rendered_subject_preview) AS example_rendered_subject_preview,
  MIN(lr.rendered_body_preview) AS example_rendered_body_preview,
  MIN(lr.sample_source) AS example_sample_source,
  MAX(lr.sent_at) AS newest_leak_sample_at
FROM leaked_rows lr
CROSS JOIN rollup r
GROUP BY
  lr.campaign_id,
  lr.campaign_name,
  lr.step_resolved,
  lr.variant_resolved,
  r.affected_campaigns,
  r.affected_step_variants,
  r.affected_leads,
  r.affected_rendered_rows,
  r.rendered_rows_with_payload_tokens,
  r.rendered_rows_with_account_signature_tokens
ORDER BY payload_token_rows DESC, account_signature_token_rows DESC, leaked_rows_in_group DESC, newest_leak_sample_at DESC NULLS LAST
LIMIT 50;`,
    notes: [
      "This is sampled reconstructed-copy evidence, not exact delivered-email proof.",
      "Replace '{{campaign_id}}' with one campaign ID; personalization variables are campaign-specific.",
      "`token_classification = 'payload_personalization_unresolved'` means campaign/lead payload variables still appear unresolved.",
      "`token_classification = 'signature_unresolved_reconstruction_caveat'` means only known account signature tokens remained in the local reconstruction; do not treat that as proof lead personalization failed.",
      "`affected_*` counts include unresolved campaign/lead payload rows, not signature-only reconstruction caveats.",
      "This safe summary intentionally omits recipient email, full rendered body text, and full template body text.",
      "Use affected counts and previews for triage; use `personalization-leak-raw-detail` only for local row-level QA.",
    ],
  },
  {
    id: "personalization-leak-raw-detail",
    topic: "copy-analysis",
    title: "Personalization leak raw detail",
    question: "Which raw reconstructed outbound rows contain unresolved template tokens?",
    exactness: "sampled",
    rationale: "Inspect row-level reconstructed outbound copy locally after the safe leak audit identifies affected steps or variants.",
    sql: `WITH tokenized_rows AS (
  SELECT
    campaign_id,
    campaign_name,
    to_email,
    step_resolved,
    variant_resolved,
    rendered_subject,
    rendered_body_text,
    template_subject,
    template_body_text,
    sample_source,
    sent_at,
    regexp_matches(COALESCE(rendered_subject, ''), '\\{\\{[^}]+\\}\\}') AS subject_has_unresolved_token,
    regexp_matches(COALESCE(rendered_body_text, ''), '\\{\\{[^}]+\\}\\}') AS body_has_unresolved_token,
    trim(unnest(list_concat(
      regexp_extract_all(COALESCE(rendered_subject, ''), '\\{\\{\\s*([^}]+?)\\s*\\}\\}', 1),
      regexp_extract_all(COALESCE(rendered_body_text, ''), '\\{\\{\\s*([^}]+?)\\s*\\}\\}', 1)
    ))) AS unresolved_token_name
  FROM sendlens.rendered_outbound_context
  WHERE campaign_id = '{{campaign_id}}'
    AND (
      regexp_matches(COALESCE(rendered_subject, ''), '\\{\\{[^}]+\\}\\}')
      OR regexp_matches(COALESCE(rendered_body_text, ''), '\\{\\{[^}]+\\}\\}')
    )
),
classified_tokens AS (
  SELECT
    *,
    CASE
      WHEN regexp_replace(lower(unresolved_token_name), '[^a-z0-9]', '', 'g') = 'accountsignature'
        THEN 'account_signature'
      ELSE 'campaign_payload'
    END AS unresolved_token_class
  FROM tokenized_rows
  WHERE unresolved_token_name <> ''
),
leaked_rows AS (
  SELECT
    campaign_id,
    campaign_name,
    to_email,
    step_resolved,
    variant_resolved,
    rendered_subject,
    rendered_body_text,
    template_subject,
    template_body_text,
    sample_source,
    sent_at,
    bool_or(subject_has_unresolved_token) AS subject_has_unresolved_token,
    bool_or(body_has_unresolved_token) AS body_has_unresolved_token,
    string_agg(DISTINCT unresolved_token_name, ', ' ORDER BY unresolved_token_name) AS unresolved_token_names,
    string_agg(DISTINCT unresolved_token_class, ', ' ORDER BY unresolved_token_class) AS unresolved_token_classes,
    string_agg(DISTINCT CASE WHEN unresolved_token_class = 'campaign_payload' THEN unresolved_token_name END, ', ' ORDER BY CASE WHEN unresolved_token_class = 'campaign_payload' THEN unresolved_token_name END) AS payload_unresolved_token_names,
    string_agg(DISTINCT CASE WHEN unresolved_token_class = 'account_signature' THEN unresolved_token_name END, ', ' ORDER BY CASE WHEN unresolved_token_class = 'account_signature' THEN unresolved_token_name END) AS account_signature_token_names,
    SUM(CASE WHEN unresolved_token_class = 'campaign_payload' THEN 1 ELSE 0 END) AS payload_unresolved_token_count,
    SUM(CASE WHEN unresolved_token_class = 'account_signature' THEN 1 ELSE 0 END) AS account_signature_token_count,
    CASE
      WHEN SUM(CASE WHEN unresolved_token_class = 'campaign_payload' THEN 1 ELSE 0 END) > 0
       AND SUM(CASE WHEN unresolved_token_class = 'account_signature' THEN 1 ELSE 0 END) > 0
        THEN 'mixed_payload_and_signature_unresolved'
      WHEN SUM(CASE WHEN unresolved_token_class = 'campaign_payload' THEN 1 ELSE 0 END) > 0
        THEN 'payload_personalization_unresolved'
      WHEN SUM(CASE WHEN unresolved_token_class = 'account_signature' THEN 1 ELSE 0 END) > 0
        THEN 'signature_unresolved_reconstruction_caveat'
      ELSE 'unclassified_unresolved_token'
    END AS token_classification
  FROM classified_tokens
  GROUP BY
    campaign_id,
    campaign_name,
    to_email,
    step_resolved,
    variant_resolved,
    rendered_subject,
    rendered_body_text,
    template_subject,
    template_body_text,
    sample_source,
    sent_at
),
rollup AS (
  SELECT
    COUNT(DISTINCT campaign_id) AS affected_campaigns,
    COUNT(DISTINCT COALESCE(step_resolved, 'unknown') || ':' || COALESCE(variant_resolved, 'unknown')) AS affected_step_variants,
    COUNT(DISTINCT to_email) AS affected_leads,
    COUNT(*) AS affected_rendered_rows,
    SUM(CASE WHEN payload_unresolved_token_count > 0 THEN 1 ELSE 0 END) AS rendered_rows_with_payload_tokens,
    SUM(CASE WHEN account_signature_token_count > 0 THEN 1 ELSE 0 END) AS rendered_rows_with_account_signature_tokens
  FROM leaked_rows
)
SELECT
  lr.campaign_id,
  lr.campaign_name,
  r.affected_campaigns,
  r.affected_step_variants,
  r.affected_leads,
  r.affected_rendered_rows,
  r.rendered_rows_with_payload_tokens,
  r.rendered_rows_with_account_signature_tokens,
  lr.to_email AS sample_email,
  lr.step_resolved,
  lr.variant_resolved,
  lr.subject_has_unresolved_token,
  lr.body_has_unresolved_token,
  lr.unresolved_token_names,
  lr.unresolved_token_classes,
  lr.payload_unresolved_token_names,
  lr.account_signature_token_names,
  lr.payload_unresolved_token_count,
  lr.account_signature_token_count,
  lr.token_classification,
  lr.rendered_subject,
  lr.rendered_body_text,
  lr.template_subject,
  lr.template_body_text,
  lr.sample_source,
  lr.sent_at
FROM leaked_rows lr
CROSS JOIN rollup r
ORDER BY lr.sent_at DESC NULLS LAST, lr.to_email
LIMIT 50;`,
    notes: [
      "Raw detail mode can expose recipient emails, rendered outbound bodies, and template bodies.",
      "Use only for local diagnosis; do not paste raw bodies or contact fields into Linear, docs, PRs, or external artifacts.",
      "This is sampled reconstructed-copy evidence, not exact delivered-email proof.",
      "Replace '{{campaign_id}}' with one campaign ID; personalization variables are campaign-specific.",
      "`token_classification = 'payload_personalization_unresolved'` means campaign/lead payload variables still appear unresolved.",
      "`token_classification = 'signature_unresolved_reconstruction_caveat'` means only known account signature tokens remained in the local reconstruction; do not treat that as proof lead personalization failed.",
      "Use the class-specific affected counts for triage and the sample rows for concrete QA examples.",
      "Rows indicate unresolved `{{...}}` patterns in locally reconstructed subject or body text.",
    ],
  },
  {
    id: "reply-hydration-coverage",
    topic: "reply-patterns",
    title: "Reply hydration coverage",
    question: "Did we fetch enough reply bodies for this campaign, by reply status?",
    exactness: "exact",
    rationale: "Audit the exact on-demand reply hydration state and stored fetched reply rows before summarizing actual wording.",
    sql: `WITH fetched_context AS (
  SELECT
    campaign_id,
    reply_email_i_status AS i_status,
    reply_email_i_status_label,
    COUNT(DISTINCT reply_email_id) AS stored_reply_rows,
    COUNT(DISTINCT CASE WHEN hydrated_reply_body THEN reply_email_id ELSE NULL END) AS stored_reply_body_rows,
    COUNT(DISTINCT CASE WHEN reply_is_auto_reply THEN reply_email_id ELSE NULL END) AS auto_reply_rows,
    COUNT(DISTINCT CASE WHEN has_lead_context THEN reply_email_id ELSE NULL END) AS rows_with_lead_context,
    COUNT(DISTINCT CASE WHEN has_template_context THEN reply_email_id ELSE NULL END) AS rows_with_template_context,
    COUNT(DISTINCT CASE WHEN context_gap_reason <> 'covered' THEN reply_email_id ELSE NULL END) AS context_gap_rows,
    MIN(reply_received_at) AS oldest_reply_received_at,
    MAX(reply_received_at) AS newest_reply_received_at
  FROM sendlens.reply_email_context
  WHERE campaign_id = '{{campaign_id}}'
    AND reply_email_i_status IN (1, -1, -2)
  GROUP BY 1, 2, 3
)
SELECT
  hs.campaign_id,
  hs.i_status,
  fc.reply_email_i_status_label,
  COALESCE(fc.stored_reply_rows, 0) AS stored_reply_rows,
  COALESCE(fc.stored_reply_body_rows, 0) AS stored_reply_body_rows,
  COALESCE(fc.auto_reply_rows, 0) AS auto_reply_rows,
  COALESCE(fc.rows_with_lead_context, 0) AS rows_with_lead_context,
  COALESCE(fc.rows_with_template_context, 0) AS rows_with_template_context,
  COALESCE(fc.context_gap_rows, 0) AS context_gap_rows,
  hs.pages_hydrated,
  hs.emails_hydrated,
  hs.exhausted,
  hs.last_hydrated_at,
  fc.oldest_reply_received_at,
  fc.newest_reply_received_at
FROM sendlens.reply_email_hydration_state hs
LEFT JOIN fetched_context fc
  ON fc.campaign_id = hs.campaign_id
 AND fc.i_status = hs.i_status
WHERE hs.campaign_id = '{{campaign_id}}'
  AND hs.i_status IN (1, -1, -2)
ORDER BY i_status DESC;`,
    notes: [
      "Run prepare_campaign_analysis first for premium analysis; this recipe audits what is now hydrated locally.",
      "Exact fetch coverage is limited to the selected List Email status/latest-thread request surface. Stored reply_email_context counts do not track latest_of_thread, and exhausted selected buckets do not prove complete coverage of the separate campaign aggregate.",
      "Report the aggregate unique human reply count, selected statuses, OOO exclusion, fetch_latest_of_thread, stored_context_latest_of_thread_basis, per-status fetched/hydrated counts, exhaustion, and the aggregate-to-hydrated gap. Maximum depth does not guarantee recovery once selected buckets are exhausted.",
      "Status 0 out-of-office is intentionally excluded unless explicitly requested.",
    ],
  },
  {
    id: "reply-email-context-feed",
    topic: "reply-patterns",
    title: "Reply email context summary",
    question: "What fetched reply coverage and context gaps are available without exposing raw reply bodies or contact fields?",
    exactness: "hybrid",
    rationale: "Use the email-anchored reply view to summarize fetched body coverage and context gaps before opening raw rows.",
    sql: `SELECT
  campaign_id,
  campaign_name,
  reply_email_i_status,
  reply_email_i_status_label,
  reply_outcome_label,
  step_resolved,
  variant_resolved,
  has_lead_context,
  has_template_context,
  hydrated_reply_body,
  context_gap_reason,
  COUNT(DISTINCT reply_email_id) AS reply_email_rows,
  COUNT(DISTINCT lead_id) AS matched_leads,
  COUNT(DISTINCT CASE WHEN hydrated_reply_body THEN reply_email_id ELSE NULL END) AS hydrated_reply_body_rows,
  COUNT(DISTINCT CASE WHEN reply_content_preview IS NOT NULL AND trim(reply_content_preview) <> '' THEN reply_email_id ELSE NULL END) AS rows_with_reply_preview,
  MIN(reply_received_at) AS oldest_reply_received_at,
  MAX(reply_received_at) AS newest_reply_received_at,
  MIN(left(COALESCE(reply_subject, ''), 160)) AS example_reply_subject_preview,
  MIN(left(COALESCE(reply_content_preview, ''), 240)) AS example_reply_content_preview,
  MIN(left(COALESCE(rendered_subject, template_subject, ''), 160)) AS example_outbound_subject_preview
FROM sendlens.reply_email_context
WHERE campaign_id = '{{campaign_id}}'
  AND reply_email_i_status IN (1, -1, -2)
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
ORDER BY newest_reply_received_at DESC NULLS LAST, reply_email_rows DESC
LIMIT 150;`,
    notes: [
      "Fetched reply previews are exact snippets for rows stored from Instantly List Email.",
      "Lead and rendered-copy context may be sampled or backfilled; use has_lead_context and context_gap_reason before overclaiming.",
      "Prefer this view over reply_context after prepare_campaign_analysis because it is anchored on reply_emails.",
      "This safe summary intentionally omits lead email, reply-from email, and full reply body text.",
      "Use `reply-email-context-raw-detail` only for local diagnosis when raw row inspection is necessary.",
    ],
  },
  {
    id: "reply-email-context-raw-detail",
    topic: "reply-patterns",
    title: "Reply email context raw detail",
    question: "Which fetched reply rows and context fields should I inspect locally?",
    exactness: "hybrid",
    rationale: "Inspect email-anchored raw reply rows locally only after the safe context summary shows a reason to open details.",
    sql: `SELECT
  campaign_id,
  campaign_name,
  reply_email_id,
  lead_id,
  lead_email,
  reply_email_i_status,
  reply_email_i_status_label,
  reply_outcome_label,
  reply_subject,
  reply_from_email,
  reply_received_at,
  reply_body_text,
  reply_content_preview,
  company_name,
  company_domain,
  job_title,
  step_resolved,
  variant_resolved,
  rendered_subject,
  template_subject,
  has_lead_context,
  has_template_context,
  hydrated_reply_body,
  context_gap_reason
FROM sendlens.reply_email_context
WHERE campaign_id = '{{campaign_id}}'
  AND reply_email_i_status IN (1, -1, -2)
ORDER BY reply_received_at DESC NULLS LAST, lead_email
LIMIT 150;`,
    notes: [
      "Raw detail mode can expose lead emails, reply-from emails, company/person context, and full reply bodies.",
      "Use only for local diagnosis; do not paste raw bodies or contact fields into Linear, docs, PRs, or external artifacts.",
      "Fetched reply body text is exact for rows stored from Instantly List Email.",
      "Lead and rendered-copy context may be sampled or backfilled; use has_lead_context and context_gap_reason before overclaiming.",
    ],
  },
  {
    id: "campaign-evidence-coverage-audit",
    topic: "campaign-performance",
    title: "Campaign evidence coverage audit",
    question: "What evidence is exact, sampled, hydrated, or missing for this campaign?",
    exactness: "hybrid",
    rationale: "Separate exact aggregates, bounded lead scans, reconstructed outbound, fetched reply bodies, and context gaps before client-safe conclusions.",
    sql: `WITH reply_email_counts AS (
  SELECT
    campaign_id,
    COUNT(DISTINCT reply_email_id) AS fetched_reply_email_rows,
    COUNT(DISTINCT CASE WHEN hydrated_reply_body THEN reply_email_id ELSE NULL END) AS hydrated_reply_body_rows,
    COUNT(DISTINCT CASE WHEN has_lead_context THEN reply_email_id ELSE NULL END) AS reply_rows_with_lead_context,
    COUNT(DISTINCT CASE WHEN has_template_context THEN reply_email_id ELSE NULL END) AS reply_rows_with_template_context,
    COUNT(DISTINCT CASE WHEN context_gap_reason <> 'covered' THEN reply_email_id ELSE NULL END) AS reply_context_gap_rows
  FROM sendlens.reply_email_context
  WHERE campaign_id = '{{campaign_id}}'
  GROUP BY 1
)
SELECT
  co.campaign_id,
  co.campaign_name,
  co.emails_sent_count,
  co.reply_count_unique,
  co.unique_reply_rate_pct,
  co.bounced_count,
  co.bounce_rate_pct,
  co.total_opportunities,
  co.ingest_mode,
  co.reply_rows AS reply_signal_rows_found_during_bounded_lead_scan,
  co.reply_lead_rows,
  co.nonreply_rows_sampled,
  co.outbound_rows_sampled,
  co.reply_outbound_rows,
  COALESCE(rec.fetched_reply_email_rows, 0) AS fetched_reply_email_rows,
  COALESCE(rec.hydrated_reply_body_rows, 0) AS hydrated_reply_body_rows,
  COALESCE(rec.reply_rows_with_lead_context, 0) AS reply_rows_with_lead_context,
  COALESCE(rec.reply_rows_with_template_context, 0) AS reply_rows_with_template_context,
  COALESCE(rec.reply_context_gap_rows, 0) AS reply_context_gap_rows
FROM sendlens.campaign_overview co
LEFT JOIN reply_email_counts rec
  ON co.campaign_id = rec.campaign_id
WHERE co.campaign_id = '{{campaign_id}}';`,
    notes: [
      "Campaign metrics are exact aggregates from Instantly.",
      "Lead/sample/outbound rows are bounded or reconstructed evidence unless ingest_mode is full.",
      "Hydrated reply body rows are exact fetched email rows, but may still be partial if status pagination hit the cap.",
    ],
  },
  {
    id: "campaign-daily-health-trend",
    topic: "campaign-performance",
    title: "Campaign daily health trend",
    question: "What changed in daily sends, replies, and opportunities for this campaign?",
    exactness: "exact",
    rationale: "Use exact campaign-day analytics before blaming copy or ICP for a recent performance change.",
    sql: `SELECT
  campaign_id,
  date,
  sent,
  contacted,
  new_leads_contacted,
  unique_opened,
  unique_replies,
  unique_replies_automatic,
  opportunities,
  unique_opportunities,
  ROUND(100.0 * unique_replies / NULLIF(sent, 0), 2) AS daily_unique_reply_rate_pct,
  ROUND(100.0 * opportunities / NULLIF(sent, 0), 2) AS daily_opportunity_rate_pct
FROM sendlens.campaign_daily_metrics
WHERE campaign_id = '{{campaign_id}}'
ORDER BY date DESC
LIMIT 60;`,
    notes: [
      "Use this before copy/ICP claims when the user asks what changed.",
      "Missing dates mean no cached campaign-day rows were returned by Instantly for those dates, not automatically zero sends.",
    ],
  },
  {
    id: "campaign-funnel-quality",
    topic: "campaign-performance",
    title: "Campaign funnel quality",
    question: "Is this campaign actually working beyond reply rate?",
    exactness: "exact",
    rationale: "Compare exact sent, reply, bounce, and opportunity metrics before promoting a campaign as working.",
    sql: `SELECT
  campaign_id,
  campaign_name,
  status,
  emails_sent_count,
  reply_count_unique,
  reply_count_automatic,
  unique_reply_rate_pct,
  bounced_count,
  bounce_rate_pct,
  total_opportunities,
  ROUND(100.0 * total_opportunities / NULLIF(emails_sent_count, 0), 2) AS opportunity_rate_pct,
  total_opportunity_value,
  tracking_status,
  deliverability_settings_status,
  reply_lead_rows,
  nonreply_rows_sampled,
  reply_outbound_rows
FROM sendlens.campaign_overview
WHERE campaign_id = '{{campaign_id}}';`,
    notes: [
      "This is exact aggregate evidence for funnel shape, not exact reply wording.",
      "Use prepare_campaign_analysis before saying why the campaign is working or not working.",
    ],
  },
  {
    id: "reply-feed",
    topic: "reply-patterns",
    title: "Reply outcome summary",
    question: "How do positive, negative, and neutral replies cluster by step and variant without exposing raw contacts or bodies?",
    exactness: "hybrid",
    rationale: "Use lead reply outcomes plus local reconstruction coverage to compare positive and negative cohorts before opening raw rows.",
    sql: `SELECT
  campaign_id,
  campaign_name,
  reply_outcome_label,
  lt_interest_label,
  reply_email_i_status,
  step_resolved,
  variant_resolved,
  COUNT(*) AS replied_leads,
  SUM(CASE WHEN reply_body_text IS NOT NULL AND trim(reply_body_text) <> '' THEN 1 ELSE 0 END) AS fetched_reply_body_rows,
  MIN(reply_received_at) AS oldest_reply_received_at,
  MAX(reply_received_at) AS newest_reply_received_at,
  MIN(left(COALESCE(reply_subject, ''), 160)) AS example_reply_subject_preview,
  MIN(left(COALESCE(rendered_subject, template_subject, ''), 160)) AS example_outbound_subject_preview
FROM sendlens.reply_context
WHERE campaign_id = '{{campaign_id}}'
GROUP BY 1, 2, 3, 4, 5, 6, 7
ORDER BY replied_leads DESC, newest_reply_received_at DESC NULLS LAST
LIMIT 100;`,
    notes: [
      "Run fetch_reply_text for this campaign in default sync_newest mode, then rerun the query when the user needs current reply wording.",
      "This safe summary intentionally omits lead email, reply-from email, full reply body text, and full rendered/template body text.",
      "Use it for positive/negative cohort triage; use `reply-feed-raw-detail` only for local row-level copy reconstruction.",
    ],
  },
  {
    id: "reply-feed-raw-detail",
    topic: "reply-patterns",
    title: "Reply outcome raw detail",
    question: "Which raw reply outcome rows should I inspect locally for copy reconstruction?",
    exactness: "hybrid",
    rationale: "Inspect lead reply outcomes plus locally reconstructed copy only after the safe reply summary identifies cohorts worth opening.",
    sql: `SELECT
  campaign_id,
  campaign_name,
  lead_email,
  company_name,
  job_title,
  reply_outcome_label,
  lt_interest_label,
  reply_email_i_status,
  reply_subject,
  reply_body_text,
  reply_from_email,
  reply_received_at,
  rendered_subject,
  rendered_body_text,
  template_subject,
  template_body_text,
  reply_at
FROM sendlens.reply_context
WHERE campaign_id = '{{campaign_id}}'
ORDER BY reply_at DESC
LIMIT 100;`,
    notes: [
      "Raw detail mode can expose lead emails, reply-from emails, company/person context, reply bodies, and reconstructed outbound bodies.",
      "Use only for local diagnosis; do not paste raw bodies or contact fields into Linear, docs, PRs, or external artifacts.",
      "Fetched inbound reply text is exact when available; rendered outbound copy remains reconstructed evidence.",
      "Use it for positive/negative cohort analysis and copy reconstruction.",
    ],
  },
  {
    id: "fetched-reply-text-by-campaign",
    topic: "reply-patterns",
    title: "Fetched reply text summary by campaign",
    question: "What reply wording previews and coverage are available for fetched positive and negative replies?",
    exactness: "exact",
    rationale: "Use fetched inbound reply previews and counts after running fetch_reply_text for one campaign before opening raw bodies.",
    route_card: {
      preferred_intent: "safe fetched reply wording coverage after one-campaign reply hydration",
      grain: "one row per campaign reply status/outcome",
      time_basis: "fetched local reply_email rows at cache time",
      attribution: "inbound reply email rows joined to campaign context",
      provider_scope: "campaign-scoped; preserve provider-qualified campaign IDs when supplied",
      population_scope: "selected fetched statuses for one campaign; out-of-office excluded by default",
      tag_role: "none",
      prerequisites: ["known campaign_id", "fetch_reply_text or prepare_campaign_analysis when fresh bodies are needed"],
      cost: "medium",
      privacy: "returns bounded subject/content previews and counts, not full bodies or email addresses",
      privacy_class: "bounded_content_previews",
      safe_adaptations: ["change selected reply statuses deliberately", "follow with raw-detail recipe only for local authorized inspection"],
      forbidden_adaptations: ["treat selected-status hydration as every aggregate reply", "export full reply bodies or addresses"],
    },
    sql: `SELECT
  campaign_id,
  campaign_name,
  reply_email_i_status,
  reply_outcome_label,
  COUNT(*) AS fetched_reply_rows,
  SUM(CASE WHEN reply_body_text IS NOT NULL AND trim(reply_body_text) <> '' THEN 1 ELSE 0 END) AS fetched_reply_body_rows,
  MIN(reply_received_at) AS oldest_reply_received_at,
  MAX(reply_received_at) AS newest_reply_received_at,
  MIN(left(COALESCE(reply_subject, ''), 160)) AS example_reply_subject_preview,
  MIN(left(COALESCE(reply_content_preview, ''), 240)) AS example_reply_content_preview
FROM sendlens.reply_context
WHERE campaign_id = '{{campaign_id}}'
  AND reply_email_id IS NOT NULL
  AND reply_email_i_status IN (1, -1, -2)
GROUP BY 1, 2, 3, 4
ORDER BY fetched_reply_rows DESC, newest_reply_received_at DESC NULLS LAST
LIMIT 100;`,
    notes: [
      "Run fetch_reply_text for this campaign in default sync_newest mode first if no rows are returned or the user wants the newest reply wording.",
      "This is exact for fetched inbound email rows stored in reply_emails, but returns previews and counts by default.",
      "Status 0 out-of-office is intentionally excluded.",
      "This safe summary intentionally omits lead email, reply-from email, and full reply body text.",
      "Use `fetched-reply-text-raw-detail-by-campaign` only for local diagnosis when raw reply bodies are necessary.",
    ],
  },
  {
    id: "fetched-reply-text-raw-detail-by-campaign",
    topic: "reply-patterns",
    title: "Fetched reply text raw detail by campaign",
    question: "What raw fetched reply bodies should I inspect locally?",
    exactness: "exact",
    rationale: "Inspect fetched inbound reply bodies locally after the safe fetched-reply summary identifies statuses or outcomes worth opening.",
    sql: `SELECT
  campaign_id,
  campaign_name,
  lead_email,
  reply_email_i_status,
  reply_outcome_label,
  reply_subject,
  reply_from_email,
  reply_received_at,
  reply_body_text
FROM sendlens.reply_context
WHERE campaign_id = '{{campaign_id}}'
  AND reply_email_id IS NOT NULL
  AND reply_email_i_status IN (1, -1, -2)
ORDER BY reply_received_at DESC NULLS LAST
LIMIT 100;`,
    notes: [
      "Raw detail mode can expose lead emails, reply-from emails, and full reply bodies.",
      "Use only for local diagnosis; do not paste raw bodies or contact fields into Linear, docs, PRs, or external artifacts.",
      "Run fetch_reply_text for this campaign in default sync_newest mode first if no rows are returned or the user wants the newest reply wording.",
      "This is exact for fetched inbound email rows stored in reply_emails.",
      "Status 0 out-of-office is intentionally excluded.",
    ],
  },
  {
    id: "reply-patterns-by-variant",
    topic: "reply-patterns",
    title: "Reply outcomes by variant",
    question: "Which variants are generating the strongest positive and negative reply outcomes?",
    exactness: "hybrid",
    rationale: "Combine exact lead reply outcomes with exact campaign templates to compare which variants produce positive vs negative responses.",
    sql: `SELECT
  campaign_id,
  step_resolved,
  variant_resolved,
  template_subject,
  COUNT(*) AS replied_leads,
  SUM(CASE WHEN reply_outcome_label = 'positive' THEN 1 ELSE 0 END) AS positive_replies,
  SUM(CASE WHEN reply_outcome_label = 'negative' THEN 1 ELSE 0 END) AS negative_replies,
  SUM(CASE WHEN reply_outcome_label = 'neutral' THEN 1 ELSE 0 END) AS neutral_replies
FROM sendlens.reply_context
WHERE campaign_id = '{{campaign_id}}'
GROUP BY 1, 2, 3, 4
ORDER BY positive_replies DESC, replied_leads DESC;`,
    notes: [
      "Lead reply outcomes are exact at the aggregate level; copy is reconstructed from the stored template and lead variables.",
      "Use this before proposing a specific variant rewrite or segment test.",
    ],
  },
  {
    id: "lead-list-source-quality",
    topic: "icp-signals",
    title: "Lead list and source quality",
    question: "Which lead lists or uploaded sources are producing replies, wrong-person outcomes, or poor quality?",
    exactness: "sampled",
    rationale: "Use campaign-scoped sampled lead evidence to compare list_id and sample_source quality before deciding which source to refill or pause.",
    sql: `SELECT
  campaign_id,
  campaign_name,
  COALESCE(list_id, 'missing_list_id') AS list_id,
  sample_source,
  COUNT(DISTINCT email) AS sampled_leads,
  SUM(CASE WHEN has_reply_signal THEN 1 ELSE 0 END) AS sampled_reply_signal_leads,
  SUM(CASE WHEN reply_outcome_label = 'positive' THEN 1 ELSE 0 END) AS sampled_positive_outcomes,
  SUM(CASE WHEN lt_interest_status = -1 THEN 1 ELSE 0 END) AS sampled_not_interested,
  SUM(CASE WHEN lt_interest_status = -2 THEN 1 ELSE 0 END) AS sampled_wrong_person,
  SUM(CASE WHEN reply_outcome_label = 'negative' THEN 1 ELSE 0 END) AS sampled_negative_outcomes,
  ROUND(100.0 * SUM(CASE WHEN has_reply_signal THEN 1 ELSE 0 END) / NULLIF(COUNT(DISTINCT email), 0), 2) AS sampled_reply_signal_rate_pct,
  ROUND(100.0 * SUM(CASE WHEN reply_outcome_label = 'positive' THEN 1 ELSE 0 END) / NULLIF(COUNT(DISTINCT email), 0), 2) AS sampled_positive_rate_pct,
  ROUND(100.0 * SUM(CASE WHEN lt_interest_status = -2 THEN 1 ELSE 0 END) / NULLIF(COUNT(DISTINCT email), 0), 2) AS sampled_wrong_person_rate_pct
FROM sendlens.lead_evidence
WHERE campaign_id = '{{campaign_id}}'
GROUP BY 1, 2, 3, 4
ORDER BY sampled_wrong_person_rate_pct DESC NULLS LAST, sampled_negative_outcomes DESC, sampled_positive_rate_pct DESC NULLS LAST, sampled_leads DESC;`,
    notes: [
      "Replace '{{campaign_id}}' with one campaign ID.",
      "This is sampled lead evidence unless the campaign was fully scanned.",
      "Use it to decide which list/source deserves cleanup, enrichment, or refill priority.",
    ],
  },
  {
    id: "company-domain-quality",
    topic: "icp-signals",
    title: "Company domain quality",
    question: "Are certain company domains producing good replies, bad replies, or wrong-person outcomes?",
    exactness: "sampled",
    rationale: "Group sampled lead evidence by company_domain to find account-level quality and duplicate-company patterns inside one campaign.",
    sql: `SELECT
  campaign_id,
  campaign_name,
  COALESCE(company_domain, website, 'missing_domain') AS company_domain_or_website,
  COUNT(DISTINCT email) AS sampled_contacts,
  COUNT(DISTINCT company_name) AS sampled_company_names,
  MIN(company_name) FILTER (WHERE company_name IS NOT NULL) AS company_name_example,
  SUM(CASE WHEN has_reply_signal THEN 1 ELSE 0 END) AS sampled_reply_signal_contacts,
  SUM(CASE WHEN reply_outcome_label = 'positive' THEN 1 ELSE 0 END) AS sampled_positive_outcomes,
  SUM(CASE WHEN reply_outcome_label = 'negative' THEN 1 ELSE 0 END) AS sampled_negative_outcomes,
  SUM(CASE WHEN lt_interest_status = -2 THEN 1 ELSE 0 END) AS sampled_wrong_person,
  ROUND(100.0 * SUM(CASE WHEN reply_outcome_label = 'positive' THEN 1 ELSE 0 END) / NULLIF(COUNT(DISTINCT email), 0), 2) AS sampled_positive_rate_pct,
  ROUND(100.0 * SUM(CASE WHEN reply_outcome_label = 'negative' THEN 1 ELSE 0 END) / NULLIF(COUNT(DISTINCT email), 0), 2) AS sampled_negative_rate_pct
FROM sendlens.lead_evidence
WHERE campaign_id = '{{campaign_id}}'
GROUP BY 1, 2, 3
HAVING COUNT(DISTINCT email) >= 1
ORDER BY sampled_negative_rate_pct DESC NULLS LAST, sampled_wrong_person DESC, sampled_positive_rate_pct DESC NULLS LAST, sampled_contacts DESC
LIMIT 100;`,
    notes: [
      "Replace '{{campaign_id}}' with one campaign ID.",
      "This is sampled evidence and should be treated as a segment hypothesis, not a full account-domain census.",
      "Use duplicate or high-negative domains to guide lead cleaning, account suppression, or ICP refinement.",
    ],
  },
  {
    id: "cross-provider-overlap-risk",
    topic: "icp-signals",
    title: "Cross-provider duplicate contact and company exposure",
    question: "Are we contacting the same people or companies across Instantly and Smartlead?",
    exactness: "sampled",
    rationale: "Find sampled contacts, domains, or companies that appear in more than one source provider within the overlap-risk window so analysts can spot diversification that is really duplicate outreach.",
    sql: `SELECT
  overlap_type,
  overlap_key,
  source_provider_count,
  source_providers,
  campaign_count,
  sampled_rows,
  sampled_contacts,
  first_exposure_at,
  last_exposure_at,
  overall_contact_span_days,
  closest_cross_provider_window_days,
  contact_window_days,
  within_unsafe_window,
  overlap_risk_level,
  sampled_reply_signal_rows,
  sampled_negative_rows
FROM sendlens.provider_overlap_risk
WHERE COALESCE(within_unsafe_window, TRUE) = TRUE
ORDER BY
  CASE overlap_risk_level
    WHEN 'high' THEN 0
    WHEN 'medium' THEN 1
    WHEN 'timing_unknown' THEN 2
    ELSE 3
  END,
  campaign_count DESC,
  sampled_negative_rows DESC,
  sampled_rows DESC
LIMIT 100;`,
    notes: [
      "This is sampled exposure evidence from cached lead rows, not a full suppression or CRM dedupe audit unless all relevant campaigns were fully scanned.",
      "Use provider_overlap_risk_details to inspect the provider-qualified campaign rows behind a risky overlap.",
      "A high/medium overlap is evidence to review coordination; do not infer reply-level duplication until Smartlead message-history hydration exists.",
    ],
  },
  {
    id: "cross-provider-overlap-effective",
    topic: "icp-signals",
    title: "Effective-window cross-provider overlap evidence",
    question: "What effective evidence window supports each sampled cross-provider overlap risk?",
    exactness: "sampled",
    rationale: "Expose the observed sampling window and lineage basis behind cross-provider overlap without implying historical assignment continuity or population coverage.",
    sql: `SELECT
  overlap_type,
  overlap_key,
  source_provider,
  campaign_id,
  campaign_source_id,
  campaign_name,
  exposure_at,
  effective_from,
  effective_to,
  effective_window_status,
  evidence_frame,
  lineage_basis,
  overlap_risk_level,
  within_unsafe_window
FROM sendlens.cross_provider_lead_overlap_effective
ORDER BY
  CASE overlap_risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'timing_unknown' THEN 2 ELSE 3 END,
  effective_from DESC NULLS LAST,
  source_provider,
  campaign_id
LIMIT 100;`,
    notes: [
      "This remains sampled overlap evidence; effective_from is an observed cache/sampling bound, not a full historical assignment interval.",
      "Provider-qualified identity and timing remain separate from sender/domain assignment lineage.",
    ],
  },
  {
    id: "duplicate-contact-company-exposure",
    topic: "icp-signals",
    title: "Duplicate contact and company exposure across campaigns",
    question: "Are we contacting the same people or companies across multiple campaigns?",
    exactness: "sampled",
    rationale: "Find sampled contacts or company domains that appear in more than one campaign so analysts can spot overlap risk before blaming copy.",
    sql: `WITH key_options AS (
  SELECT ROW_NUMBER() OVER () AS key_index
  FROM sendlens.campaigns
  LIMIT 2
),
exposure_keys AS (
  SELECT
    campaign_id,
    campaign_name,
    has_reply_signal,
    reply_outcome_label,
    CASE key_index
      WHEN 1 THEN 'contact_email'
      ELSE 'company_domain'
    END AS exposure_type,
    CASE key_index
      WHEN 1 THEN lower(email)
      ELSE lower(company_domain)
    END AS exposure_key
  FROM sendlens.lead_evidence
  JOIN key_options ON TRUE
)
SELECT
  exposure_type,
  exposure_key,
  COUNT(DISTINCT campaign_id) AS campaigns_seen,
  COUNT(*) AS sampled_rows,
  MIN(campaign_name) AS campaign_example,
  SUM(CASE WHEN has_reply_signal THEN 1 ELSE 0 END) AS sampled_reply_signal_rows,
  SUM(CASE WHEN reply_outcome_label = 'negative' THEN 1 ELSE 0 END) AS sampled_negative_rows
FROM exposure_keys
WHERE exposure_key IS NOT NULL
  AND trim(exposure_key) <> ''
GROUP BY 1, 2
HAVING COUNT(DISTINCT campaign_id) > 1
ORDER BY campaigns_seen DESC, sampled_negative_rows DESC, sampled_rows DESC
LIMIT 100;`,
    notes: [
      "This is sampled exposure evidence from cached lead rows, not a full dedupe audit unless all relevant campaigns were fully scanned.",
      "Use it when reply quality looks bad and repeated outreach or account overlap could be the cause.",
    ],
  },
  {
    id: "campaign-metadata-coverage",
    topic: "icp-signals",
    title: "Campaign lead-metadata coverage",
    question: "Which arbitrary lead metadata fields are available, how complete are they, and which fields have enough scalar values for cohort analysis?",
    exactness: "sampled",
    rationale: "Inspect campaign-scoped metadata coverage, type, and sparse-value counts before selecting exact payload keys for ICP or reply-outcome analysis.",
    route_card: {
      preferred_intent: "safe campaign metadata discovery before ICP or reply cohort analysis",
      grain: "one aggregate row per exact provider payload key",
      time_basis: "current cached sampled lead evidence",
      attribution: "provider lead payload/custom-field presence and type only; no value-level outcome claim",
      provider_scope: "provider-qualified through the selected campaign",
      population_scope: "sampled cached leads in exactly one campaign",
      tag_role: "none; resolve the campaign before metadata analysis",
      prerequisites: ["load the selected campaign", "replace {{campaign_id}} with one exact campaign ID"],
      cost: "low",
      privacy: "aggregate coverage/cardinality/type counts only; no contact identifiers or raw payload values",
      privacy_class: "metadata_counts_only",
      safe_adaptations: ["filter to one exact payload key", "filter to one metadata family", "change aggregate ordering"],
      forbidden_adaptations: ["remove the campaign boundary", "expose raw contact or payload values", "merge metadata-family aliases as if they were semantically identical"],
    },
    sql: `WITH campaign_totals AS (
  SELECT
    workspace_id,
    campaign_id,
    campaign_name,
    COUNT(DISTINCT COALESCE(NULLIF(email, ''), provider_lead_id)) AS sampled_leads
  FROM sendlens.lead_evidence
  WHERE campaign_id = '{{campaign_id}}'
  GROUP BY 1, 2, 3
),
value_counts AS (
  SELECT
    workspace_id,
    campaign_id,
    payload_key,
    payload_value_normalized,
    COUNT(DISTINCT COALESCE(NULLIF(email, ''), provider_lead_id)) AS leads_with_value
  FROM sendlens.lead_payload_kv
  WHERE campaign_id = '{{campaign_id}}'
    AND payload_is_scalar = TRUE
    AND COALESCE(trim(payload_value_normalized), '') <> ''
  GROUP BY 1, 2, 3, 4
),
value_coverage AS (
  SELECT
    workspace_id,
    campaign_id,
    payload_key,
    COUNT(*) FILTER (WHERE leads_with_value < 5) AS sparse_value_count,
    COUNT(*) FILTER (WHERE leads_with_value >= 5) AS values_meeting_min_cohort
  FROM value_counts
  GROUP BY 1, 2, 3
),
key_coverage AS (
  SELECT
    workspace_id,
    campaign_id,
    campaign_name,
    payload_key,
    payload_key_normalized,
    payload_key_family,
    COUNT(DISTINCT COALESCE(NULLIF(email, ''), provider_lead_id)) AS leads_with_key,
    COUNT(DISTINCT payload_value_normalized) FILTER (
      WHERE payload_is_scalar = TRUE
        AND COALESCE(trim(payload_value_normalized), '') <> ''
    ) AS distinct_scalar_values,
    SUM(CASE WHEN payload_is_scalar THEN 1 ELSE 0 END) AS scalar_rows,
    SUM(CASE WHEN payload_is_scalar = FALSE THEN 1 ELSE 0 END) AS non_scalar_rows,
    SUM(CASE
      WHEN payload_is_scalar = TRUE
       AND COALESCE(trim(payload_value), '') = '' THEN 1
      ELSE 0
    END) AS blank_scalar_rows
  FROM sendlens.lead_payload_kv
  WHERE campaign_id = '{{campaign_id}}'
  GROUP BY 1, 2, 3, 4, 5, 6
)
SELECT
  kc.campaign_id,
  kc.campaign_name,
  kc.payload_key,
  kc.payload_key_normalized,
  kc.payload_key_family,
  ct.sampled_leads,
  kc.leads_with_key,
  ROUND(100.0 * kc.leads_with_key / NULLIF(ct.sampled_leads, 0), 2) AS key_coverage_pct,
  kc.distinct_scalar_values,
  kc.scalar_rows,
  kc.non_scalar_rows,
  kc.blank_scalar_rows,
  COALESCE(vc.sparse_value_count, 0) AS sparse_value_count,
  COALESCE(vc.values_meeting_min_cohort, 0) AS values_meeting_min_cohort
FROM key_coverage kc
JOIN campaign_totals ct
  ON kc.workspace_id = ct.workspace_id
 AND kc.campaign_id = ct.campaign_id
LEFT JOIN value_coverage vc
  ON kc.workspace_id = vc.workspace_id
 AND kc.campaign_id = vc.campaign_id
 AND kc.payload_key = vc.payload_key
ORDER BY
  CASE WHEN kc.payload_key_family IS NULL THEN 1 ELSE 0 END,
  key_coverage_pct DESC,
  kc.payload_key;`,
    notes: [
      "Replace '{{campaign_id}}' with one campaign ID and run this before value-level analysis unless the exact payload key is already named.",
      "Raw payload keys remain authoritative. `payload_key_normalized` and `payload_key_family` are discovery aids and must not silently merge different source fields.",
      "`sparse_value_count` includes populated scalar values represented by fewer than five sampled leads; those values remain visible as a count even though the value-signal recipe suppresses their cohorts.",
      "Arrays and objects remain preserved in `payload_value_json` and appear as non-scalar rows; do not group them as ordinary scalar ICP values without an explicit interpretation.",
      "Coverage is sampled and campaign-scoped, not proof of full lead-population completeness.",
    ],
  },
  {
    id: "campaign-payload-key-inventory",
    topic: "icp-signals",
    title: "Campaign payload-key inventory",
    question: "Which custom payload keys exist in this campaign's sampled lead evidence?",
    exactness: "sampled",
    rationale: "Inventory campaign-specific payload keys before choosing variables for reply or opportunity analysis.",
    sql: `SELECT
  campaign_id,
  campaign_name,
  payload_key,
  COUNT(DISTINCT email) AS sampled_leads_with_key,
  COUNT(DISTINCT payload_value) AS distinct_sampled_values,
  SUM(CASE WHEN has_reply_signal THEN 1 ELSE 0 END) AS sampled_replying_leads_with_key,
  SUM(CASE WHEN lt_interest_status >= 1 THEN 1 ELSE 0 END) AS sampled_positive_leads_with_key,
  ROUND(100.0 * SUM(CASE WHEN has_reply_signal THEN 1 ELSE 0 END) / NULLIF(COUNT(DISTINCT email), 0), 2) AS sampled_reply_share_pct,
  ROUND(100.0 * SUM(CASE WHEN lt_interest_status >= 1 THEN 1 ELSE 0 END) / NULLIF(COUNT(DISTINCT email), 0), 2) AS sampled_positive_share_pct
FROM sendlens.lead_payload_kv
WHERE campaign_id = '{{campaign_id}}'
GROUP BY 1, 2, 3
ORDER BY sampled_leads_with_key DESC, sampled_reply_share_pct DESC NULLS LAST, payload_key;`,
    notes: [
      "This is sampled evidence only and must stay scoped to one campaign.",
      "Payload keys can come from uploaded lead-list metadata, campaign custom fields, RB2B, Clay, or another external source. Missing keys are source-specific absence, not proof that metadata coverage is thin, visitor intent is missing, or Instantly enrichment failed; only diagnose missing metadata when an intended variable is demonstrably expected and remains unresolved or blank.",
      "Use this before `campaign-payload-key-signals` when you do not know the available payload keys.",
      "A key appearing in replied leads does not prove full-population lift; it identifies variables worth testing next.",
    ],
  },
  {
    id: "campaign-payload-presence-signals",
    topic: "icp-signals",
    title: "Campaign payload-key presence signals",
    question: "Which payload keys appear more often in replying or positive sampled leads?",
    exactness: "sampled",
    rationale: "Compare sampled lead outcomes when a campaign-specific payload key is present versus absent.",
    sql: `WITH campaign_totals AS (
  SELECT
    workspace_id,
    campaign_id,
    campaign_name,
    COUNT(DISTINCT email) AS sampled_leads,
    SUM(CASE WHEN has_reply_signal THEN 1 ELSE 0 END) AS replying_leads,
    SUM(CASE WHEN lt_interest_status >= 1 THEN 1 ELSE 0 END) AS positive_leads
  FROM sendlens.lead_evidence
  WHERE campaign_id = '{{campaign_id}}'
  GROUP BY 1, 2, 3
),
key_presence AS (
  SELECT
    workspace_id,
    campaign_id,
    campaign_name,
    payload_key,
    COUNT(DISTINCT email) AS leads_with_key,
    SUM(CASE WHEN has_reply_signal THEN 1 ELSE 0 END) AS replying_leads_with_key,
    SUM(CASE WHEN lt_interest_status >= 1 THEN 1 ELSE 0 END) AS positive_leads_with_key
  FROM sendlens.lead_payload_kv
  WHERE campaign_id = '{{campaign_id}}'
  GROUP BY 1, 2, 3, 4
)
SELECT
  kp.campaign_id,
  kp.campaign_name,
  kp.payload_key,
  ct.sampled_leads,
  kp.leads_with_key,
  ct.sampled_leads - kp.leads_with_key AS leads_without_key,
  ROUND(100.0 * kp.leads_with_key / NULLIF(ct.sampled_leads, 0), 2) AS key_presence_pct,
  kp.replying_leads_with_key,
  ct.replying_leads - kp.replying_leads_with_key AS replying_leads_without_key,
  ROUND(100.0 * kp.replying_leads_with_key / NULLIF(kp.leads_with_key, 0), 2) AS reply_share_with_key_pct,
  ROUND(100.0 * (ct.replying_leads - kp.replying_leads_with_key) / NULLIF(ct.sampled_leads - kp.leads_with_key, 0), 2) AS reply_share_without_key_pct,
  kp.positive_leads_with_key,
  ct.positive_leads - kp.positive_leads_with_key AS positive_leads_without_key,
  ROUND(100.0 * kp.positive_leads_with_key / NULLIF(kp.leads_with_key, 0), 2) AS positive_share_with_key_pct,
  ROUND(100.0 * (ct.positive_leads - kp.positive_leads_with_key) / NULLIF(ct.sampled_leads - kp.leads_with_key, 0), 2) AS positive_share_without_key_pct
FROM key_presence kp
JOIN campaign_totals ct
  ON kp.workspace_id = ct.workspace_id
 AND kp.campaign_id = ct.campaign_id
ORDER BY reply_share_with_key_pct DESC NULLS LAST, leads_with_key DESC, payload_key;`,
    notes: [
      "This is sampled evidence only and should produce hypotheses, not full-population claims.",
      "Treat missing keys as source-specific absence, not automatically as a lead-list metadata coverage issue. Recommend richer future metadata only when a decision requires an intended variable that is demonstrably expected and unresolved or blank.",
      "Use it to decide which payload keys deserve value-level analysis with `campaign-payload-key-signals`.",
      "`lead_payload_kv` avoids JSON-path edge cases, so keys with spaces, dots, or punctuation can still be analyzed by exact key value.",
    ],
  },
  {
    id: "campaign-payload-key-signals",
    topic: "icp-signals",
    title: "Campaign payload-key signals",
    question: "Within one campaign, which values of a chosen payload key appear to correlate with replies or positive outcomes?",
    exactness: "sampled",
    rationale: "Use campaign-scoped sampled lead evidence plus raw payload JSON to test one campaign variable at a time.",
    sql: `SELECT
  campaign_id,
  campaign_name,
  payload_value,
  COUNT(DISTINCT email) AS sampled_lead_count,
  SUM(CASE WHEN has_reply_signal THEN 1 ELSE 0 END) AS sampled_replying_leads,
  SUM(CASE WHEN lt_interest_status >= 1 THEN 1 ELSE 0 END) AS positive_signal_leads,
  ROUND(100.0 * SUM(CASE WHEN has_reply_signal THEN 1 ELSE 0 END) / NULLIF(COUNT(DISTINCT email), 0), 2) AS sampled_reply_share_pct,
  ROUND(100.0 * SUM(CASE WHEN lt_interest_status >= 1 THEN 1 ELSE 0 END) / NULLIF(COUNT(DISTINCT email), 0), 2) AS sampled_positive_share_pct
FROM sendlens.lead_payload_kv
WHERE campaign_id = '{{campaign_id}}'
  AND payload_key = '{{payload_key}}'
  AND payload_is_scalar = TRUE
  AND COALESCE(trim(payload_value_normalized), '') <> ''
GROUP BY 1, 2, 3
HAVING COUNT(DISTINCT email) >= 5
ORDER BY sampled_reply_share_pct DESC NULLS LAST, sampled_lead_count DESC;`,
    notes: [
      "This is sampled evidence only and should stay scoped to one campaign.",
      "Replace '{{payload_key}}' with the exact payload key for that campaign, such as region, existing_customer, or recent_grant_or_initiative.",
      "Use `campaign-metadata-coverage` first to see sparse-value counts. If the intended key has too few populated values, describe the observed source-specific coverage and recommend collecting it in future uploaded lead lists only when the decision requires it.",
      "Use scalar values for this recipe. Arrays and objects remain available as JSON evidence but require an explicit interpretation before grouping.",
      "Use it to form hypotheses, not final population claims.",
    ],
  },
  {
    id: "campaign-payload-sample",
    topic: "icp-signals",
    title: "Campaign payload sample",
    question: "What raw payload fields are present in this campaign's sampled lead evidence?",
    exactness: "sampled",
    rationale: "Inspect raw payload JSON for one campaign before choosing which keys to group by.",
    sql: `SELECT
  campaign_id,
  campaign_name,
  email,
  job_title,
  lt_interest_label,
  reply_outcome_label,
  custom_payload
FROM sendlens.lead_evidence
WHERE campaign_id = '{{campaign_id}}'
ORDER BY has_reply_signal DESC, timestamp_last_reply DESC NULLS LAST
LIMIT 25;`,
    notes: [
      "Use this first when you do not know the campaign's payload keys yet.",
      "Payload structure is campaign-specific and should not be assumed to match other campaigns.",
      "Blank `job_title` or payload fields are source-specific absence, not automatically missing uploaded metadata, failed enrichment, or missing visitor intent. Inspect the campaign's intended template tokens and available payload keys first; recommend additional role, function, seniority, company category, geography, source, or trigger fields only when a specific decision requires them.",
    ],
  },
  {
    id: "tag-catalog",
    topic: "tags",
    title: "Available custom tags",
    question: "Which Instantly tags are available for filtering?",
    exactness: "exact",
    rationale: "Inspect the tag catalog before building filtered analyses.",
    sql: `SELECT
  COALESCE(t.source_provider, m.source_provider, 'instantly') AS source_provider,
  t.id AS tag_id,
  COALESCE(t.label, t.name) AS tag_name,
  lower(trim(COALESCE(t.label, t.name))) AS normalized_tag_name,
  t.color,
  t.description,
  COUNT(DISTINCT CASE WHEN m.resource_type = '2' THEN m.resource_id END) AS tagged_campaigns,
  COUNT(DISTINCT CASE WHEN m.resource_type = '1' THEN m.resource_id END) AS tagged_accounts,
  COUNT(DISTINCT m.resource_id) AS tagged_resources,
  t.timestamp_updated
FROM sendlens.custom_tags t
LEFT JOIN sendlens.custom_tag_mappings m
  ON t.workspace_id = m.workspace_id
 AND t.id = m.tag_id
 AND COALESCE(t.source_provider, 'instantly') = COALESCE(m.source_provider, 'instantly')
GROUP BY 1, 2, 3, 4, 5, 6, 10
ORDER BY tag_name;`,
    notes: [
      "Use this first when the user says 'filter by tags'.",
      "The normalized tag name helps match case or whitespace variants before replacing '{{tag_name}}' in other recipes.",
      "Mapping counts distinguish campaign tags from account tags so the model does not assume the wrong scope.",
      "Tags are exact workspace metadata.",
    ],
  },
  {
    id: "tag-scope-audit",
    topic: "tags",
    title: "Tag scope audit",
    question: "Does a given Instantly tag apply to campaigns, accounts, or another resource type?",
    exactness: "exact",
    rationale: "Resolve tag scope before choosing campaign-tag, account-tag, or custom SQL analyses.",
    route_card: {
      preferred_intent: "determine whether a tag is a campaign tag, account tag, or ambiguous tag",
      grain: "one row per tag resource type",
      time_basis: "current cached tag mappings",
      attribution: "tag metadata and mapping counts only",
      provider_scope: "provider-qualified tag mappings where available",
      population_scope: "all cached mappings for the exact normalized tag",
      tag_role: "disambiguates campaign tags from assignment/account tags",
      prerequisites: ["known tag label"],
      cost: "low",
      privacy: "tag metadata and counts only; no lead, account email, reply, or payload detail",
      privacy_class: "metadata_counts_only",
      safe_adaptations: ["use trim/case-insensitive matching", "report inferred scope and stop when invoked by a packaged zero-row fallback"],
      forbidden_adaptations: ["assume a tag on accounts scopes campaigns", "broaden to all tags after an exact user tag miss without saying so"],
    },
    sql: `SELECT
  COALESCE(t.source_provider, m.source_provider, 'instantly') AS source_provider,
  COALESCE(t.label, t.name) AS tag_name,
  lower(trim(COALESCE(t.label, t.name))) AS normalized_tag_name,
  m.resource_type,
  CASE m.resource_type
    WHEN '1' THEN 'account'
    WHEN '2' THEN 'campaign'
    ELSE 'other_or_unknown'
  END AS inferred_resource_scope,
  COUNT(DISTINCT m.resource_id) AS tagged_resources,
  MIN(m.synced_at) AS first_mapping_synced_at,
  MAX(m.synced_at) AS last_mapping_synced_at
FROM sendlens.custom_tags t
LEFT JOIN sendlens.custom_tag_mappings m
  ON t.workspace_id = m.workspace_id
 AND t.id = m.tag_id
 AND COALESCE(t.source_provider, 'instantly') = COALESCE(m.source_provider, 'instantly')
WHERE lower(trim(COALESCE(t.label, t.name))) = lower(trim('{{tag_name}}'))
GROUP BY 1, 2, 3, 4, 5
ORDER BY tagged_resources DESC, inferred_resource_scope;`,
    notes: [
      "Replace '{{tag_name}}' with the user's tag label.",
      "Use this when the user says 'tagged' but does not clearly say whether the tag is on campaigns, accounts, or another resource.",
      "Campaign-tag recipes require campaign mappings; account-tag questions may need account_tags or custom SQL instead.",
    ],
  },
  {
    id: "sampled-leads-by-tag",
    topic: "tags",
    title: "Sampled leads by tag",
    question: "How do sampled tagged leads compare?",
    exactness: "hybrid",
    rationale: "Join exact campaign tags to sampled lead evidence for directional tag-based analysis.",
    sql: `SELECT
  ct.campaign_tag_label AS tag_name,
  le.campaign_id,
  le.campaign_name,
  COUNT(*) AS sampled_lead_count,
  SUM(CASE WHEN le.has_reply_signal THEN 1 ELSE 0 END) AS sampled_replying_leads,
  ROUND(100.0 * SUM(CASE WHEN le.has_reply_signal THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) AS sampled_reply_share_pct
FROM sendlens.lead_evidence le
JOIN sendlens.campaign_tags ct
  ON le.workspace_id = ct.workspace_id
 AND le.source_provider = ct.source_provider
 AND le.campaign_source_id = ct.campaign_source_id
 AND le.campaign_id = ct.campaign_id
WHERE lower(trim(ct.campaign_tag_label)) = lower(trim('{{tag_name}}'))
GROUP BY 1, 2, 3
ORDER BY sampled_reply_share_pct DESC NULLS LAST, sampled_lead_count DESC;`,
    notes: [
      "This is hybrid because campaign tags are exact but the lead layer is sampled.",
      "Replace '{{tag_name}}' with a real value from the tag catalog.",
    ],
  },
  {
    id: "campaigns-by-tag",
    topic: "tags",
    title: "Campaigns by tag",
    question: "Which campaigns are associated with a given tag?",
    exactness: "exact",
    rationale: "Use exact mappings to identify campaigns connected to a tag before deeper analysis.",
    sql: `SELECT
  ct.campaign_tag_label AS tag_name,
  co.campaign_id,
  co.campaign_name AS name,
  co.status,
  co.daily_limit,
  co.emails_sent_count,
  co.reply_count_unique,
  co.unique_reply_rate_pct,
  co.total_opportunities
FROM sendlens.campaign_tags ct
JOIN sendlens.campaign_overview co
  ON ct.workspace_id = co.workspace_id
 AND ct.source_provider = co.source_provider
 AND ct.campaign_source_id = co.campaign_source_id
 AND ct.campaign_id = co.campaign_id
WHERE lower(trim(ct.campaign_tag_label)) = lower(trim('{{tag_name}}'))
ORDER BY co.unique_reply_rate_pct DESC NULLS LAST, co.emails_sent_count DESC;`,
    notes: [
      "This is exact for campaign-level tags and performance aggregates.",
      "Use it when the workspace organizes campaigns with tags.",
    ],
  },
];

export function getQueryRecipes(topic?: string): QueryRecipe[] {
  if (!topic) {
    return QUERY_RECIPES;
  }

  const normalized = topic.trim().toLowerCase();
  return QUERY_RECIPES.filter((recipe) => recipe.topic === normalized);
}

export function summarizeQueryRecipe(recipe: QueryRecipe): QueryRecipeSummary {
  return {
    id: recipe.id,
    topic: recipe.topic,
    title: recipe.title,
    question: recipe.question,
    exactness: recipe.exactness,
    rationale: recipe.rationale,
    route_card: recipe.route_card,
    sql_available: true,
  };
}

export function getQueryRecipeById(recipeId: string, topic?: string): QueryRecipe | undefined {
  const normalizedRecipeId = recipeId.trim().toLowerCase();
  return getQueryRecipes(topic).find((recipe) => recipe.id.toLowerCase() === normalizedRecipeId);
}

export function buildQueryRecipeResponse(options: QueryRecipeResponseOptions = {}) {
  const mode = options.mode ?? (options.recipe_id ? "full" : "summary");
  const page = Math.max(1, Math.trunc(options.page ?? 1));
  const pageSize = Math.min(
    MAX_RECIPE_PAGE_SIZE,
    Math.max(1, Math.trunc(options.page_size ?? DEFAULT_RECIPE_PAGE_SIZE)),
  );

  if (options.recipe_id) {
    const recipe = getQueryRecipeById(options.recipe_id, options.topic);
    return {
      topic: options.topic ?? "all",
      mode: "full" as const,
      output_shape: "single_recipe" as const,
      recipe_id: options.recipe_id,
      recipe_count: recipe ? 1 : 0,
      returned_count: recipe ? 1 : 0,
      page: null,
      page_size: null,
      has_more: false,
      next_page: null,
      recipes: recipe ? [recipe] : [],
      guidance:
        "Exact recipe lookup returns full SQL. Replace placeholders before calling analyze_data.",
    };
  }

  const recipes = rankRecipesForResponse(getQueryRecipes(options.topic), mode);
  const startIndex = (page - 1) * pageSize;
  const pagedRecipes = recipes.slice(startIndex, startIndex + pageSize);
  const hasMore = startIndex + pageSize < recipes.length;

  return {
    topic: options.topic ?? "all",
    mode,
    output_shape: mode === "full" ? "paged_full_recipes" : "compact_recipe_index",
    recipe_count: recipes.length,
    returned_count: pagedRecipes.length,
    page,
    page_size: pageSize,
    has_more: hasMore,
    next_page: hasMore ? page + 1 : null,
    recipes: mode === "full" ? pagedRecipes : pagedRecipes.map(summarizeQueryRecipe),
    guidance:
      mode === "full"
        ? "Full SQL is included for this bounded page. Replace placeholders before calling analyze_data."
        : "Compact summaries omit SQL. Route-card recipes are listed first because they expose bounded intent, scope, cost, privacy, and adaptation guidance; this is not prompt-specific matching. Pass recipe_id for one full recipe, mode='full' for a bounded SQL page, or next_page to continue.",
  };
}

function rankRecipesForResponse(recipes: QueryRecipe[], mode: QueryRecipeMode) {
  if (mode !== "summary") return recipes;
  return [...recipes].sort((left, right) =>
    Number(Boolean(right.route_card)) - Number(Boolean(left.route_card)),
  );
}
