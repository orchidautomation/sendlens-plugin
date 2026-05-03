export const QUERY_RECIPE_TOPICS = [
  "workspace-health",
  "campaign-performance",
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
  sql: string;
  notes: string[];
};

const QUERY_RECIPES: QueryRecipe[] = [
  {
    id: "workspace-overview",
    topic: "workspace-health",
    title: "Workspace overview",
    question: "What is working and not working across the workspace?",
    exactness: "exact",
    rationale: "Rank campaigns by exact reply and bounce performance before diving into deeper diagnosis.",
    sql: `SELECT
  campaign_id,
  campaign_name AS name,
  status,
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
    title: "Rendered outbound sample",
    question: "How are templates rendering when reconstructed against sampled lead variables?",
    exactness: "sampled",
    rationale: "Use locally reconstructed copy to spot personalization drift or malformed rendering without paying the /emails cost.",
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
      "This is sampled evidence only.",
      "Rendered rows are reconstructed locally from templates plus lead variables, not exact delivered email bodies.",
    ],
  },
  {
    id: "personalization-leak-audit",
    topic: "copy-analysis",
    title: "Personalization leak audit",
    question: "Did any reconstructed outbound copy still contain unresolved template tokens?",
    exactness: "sampled",
    rationale: "Find sampled reconstructed outbound rows where template variables appear to have leaked through unresolved.",
    sql: `WITH leaked_rows AS (
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
    regexp_matches(COALESCE(rendered_body_text, ''), '\\{\\{[^}]+\\}\\}') AS body_has_unresolved_token
  FROM sendlens.rendered_outbound_context
  WHERE campaign_id = '{{campaign_id}}'
    AND (
      regexp_matches(COALESCE(rendered_subject, ''), '\\{\\{[^}]+\\}\\}')
      OR regexp_matches(COALESCE(rendered_body_text, ''), '\\{\\{[^}]+\\}\\}')
    )
),
rollup AS (
  SELECT
    COUNT(DISTINCT campaign_id) AS affected_campaigns,
    COUNT(DISTINCT COALESCE(step_resolved, 'unknown') || ':' || COALESCE(variant_resolved, 'unknown')) AS affected_step_variants,
    COUNT(DISTINCT to_email) AS affected_leads,
    COUNT(*) AS affected_rendered_rows
  FROM leaked_rows
)
SELECT
  lr.campaign_id,
  lr.campaign_name,
  r.affected_campaigns,
  r.affected_step_variants,
  r.affected_leads,
  r.affected_rendered_rows,
  lr.to_email AS sample_email,
  lr.step_resolved,
  lr.variant_resolved,
  lr.subject_has_unresolved_token,
  lr.body_has_unresolved_token,
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
      "This is sampled reconstructed-copy evidence, not exact delivered-email proof.",
      "Replace '{{campaign_id}}' with one campaign ID; personalization variables are campaign-specific.",
      "Rows indicate unresolved `{{...}}` patterns in locally reconstructed subject or body text.",
      "Use the affected counts for triage and the sample rows for concrete QA examples.",
    ],
  },
  {
    id: "reply-feed",
    topic: "reply-patterns",
    title: "Reply outcome feed",
    question: "Which leads replied positively, negatively, or neutrally, and what copy did they receive?",
    exactness: "hybrid",
    rationale: "Use lead reply outcomes plus locally reconstructed template copy to compare positive and negative cohorts.",
    sql: `SELECT
  campaign_id,
  campaign_name,
  lead_email,
  company_name,
  job_title,
  reply_outcome_label,
  lt_interest_label,
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
      "This does not contain exact inbound reply text.",
      "Use it for positive/negative cohort analysis and copy reconstruction in V1.",
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
    id: "campaign-payload-key-signals",
    topic: "icp-signals",
    title: "Campaign payload-key signals",
    question: "Within one campaign, which values of a chosen payload key appear to correlate with replies or positive outcomes?",
    exactness: "sampled",
    rationale: "Use campaign-scoped sampled lead evidence plus raw payload JSON to test one campaign variable at a time.",
    sql: `SELECT
  campaign_id,
  campaign_name,
  json_extract_string(custom_payload, '$.{{payload_key}}') AS payload_value,
  COUNT(*) AS sampled_lead_count,
  SUM(CASE WHEN has_reply_signal THEN 1 ELSE 0 END) AS sampled_replying_leads,
  SUM(CASE WHEN lt_interest_status >= 1 THEN 1 ELSE 0 END) AS positive_signal_leads,
  ROUND(100.0 * SUM(CASE WHEN has_reply_signal THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) AS sampled_reply_share_pct,
  ROUND(100.0 * SUM(CASE WHEN lt_interest_status >= 1 THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) AS sampled_positive_share_pct
FROM sendlens.lead_evidence
WHERE campaign_id = '{{campaign_id}}'
  AND json_extract(custom_payload, '$.{{payload_key}}') IS NOT NULL
GROUP BY 1, 2, 3
HAVING COUNT(*) >= 5
ORDER BY sampled_reply_share_pct DESC NULLS LAST, sampled_lead_count DESC;`,
    notes: [
      "This is sampled evidence only and should stay scoped to one campaign.",
      "Replace '{{payload_key}}' with the exact payload key for that campaign, such as region, existing_customer, or recent_grant_or_initiative.",
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
  id AS tag_id,
  COALESCE(label, name) AS tag_name,
  color,
  description,
  timestamp_updated
FROM sendlens.custom_tags
ORDER BY tag_name;`,
    notes: [
      "Use this first when the user says 'filter by tags'.",
      "Tags are exact workspace metadata.",
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
  ct.tag_label AS tag_name,
  le.campaign_id,
  le.campaign_name,
  COUNT(*) AS sampled_lead_count,
  SUM(CASE WHEN le.has_reply_signal THEN 1 ELSE 0 END) AS sampled_replying_leads,
  ROUND(100.0 * SUM(CASE WHEN le.has_reply_signal THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) AS sampled_reply_share_pct
FROM sendlens.lead_evidence le
JOIN sendlens.campaign_tags ct
  ON le.workspace_id = ct.workspace_id
 AND le.campaign_id = ct.campaign_id
WHERE ct.tag_label = '{{tag_name}}'
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
  tag_label AS tag_name,
  campaign_id,
  campaign_name AS name,
  status,
  emails_sent_count,
  reply_count_unique,
  unique_reply_rate_pct,
  total_opportunities
FROM sendlens.campaign_tags ct
JOIN sendlens.campaign_overview co
  ON ct.workspace_id = co.workspace_id
 AND ct.campaign_id = co.campaign_id
WHERE tag_label = '{{tag_name}}'
ORDER BY unique_reply_rate_pct DESC NULLS LAST, emails_sent_count DESC;`,
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
