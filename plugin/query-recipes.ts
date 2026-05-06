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
    id: "campaign-sender-inventory-by-tag",
    topic: "workspace-health",
    title: "Campaign sender inventory by tag",
    question: "Which inboxes are assigned to campaigns with a given Instantly tag?",
    exactness: "exact",
    rationale: "Use campaign sender assignments before making campaign-scoped domain or inbox-health claims.",
    sql: `SELECT
  ct.tag_label AS campaign_tag,
  ca.campaign_id,
  ca.campaign_name,
  ca.account_email,
  regexp_extract(ca.account_email, '@(.+)$', 1) AS domain,
  ca.assignment_source,
  ca.tag_label AS account_tag,
  ca.status,
  ca.warmup_status,
  ca.warmup_score,
  ca.total_sent_30d,
  ca.total_bounces_30d,
  ca.bounce_rate_30d_pct
FROM sendlens.campaign_tags ct
JOIN sendlens.campaign_accounts ca
  ON ct.workspace_id = ca.workspace_id
 AND ct.campaign_id = ca.campaign_id
WHERE lower(trim(ct.tag_label)) = lower(trim('{{tag_name}}'))
ORDER BY ca.bounce_rate_30d_pct DESC NULLS LAST, ca.total_sent_30d DESC NULLS LAST, ca.campaign_name, ca.account_email;`,
    notes: [
      "Replace '{{tag_name}}' with a real campaign tag such as 'The Kiln'.",
      "This resolves both direct campaign account lists and tag-based account assignments when account tag mappings are cached.",
      "If this returns no rows, SendLens has no resolved campaign sender inventory for that tag yet.",
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
    co.campaign_id,
    co.campaign_name,
    co.status,
    co.daily_limit AS campaign_daily_limit,
    co.emails_sent_count
  FROM sendlens.campaign_tags ct
  JOIN sendlens.campaign_overview co
    ON ct.workspace_id = co.workspace_id
   AND ct.campaign_id = co.campaign_id
  WHERE lower(trim(ct.tag_label)) = lower(trim('{{tag_name}}'))
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
   AND tc.campaign_id = ca.campaign_id
  LEFT JOIN sendlens.account_daily_metrics adm
    ON ca.workspace_id = adm.workspace_id
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
    co.campaign_id,
    co.campaign_name,
    co.status,
    co.daily_limit AS campaign_daily_limit,
    co.emails_sent_count
  FROM sendlens.campaign_tags ct
  JOIN sendlens.campaign_overview co
    ON ct.workspace_id = co.workspace_id
   AND ct.campaign_id = co.campaign_id
  WHERE lower(trim(ct.tag_label)) = lower(trim('{{tag_name}}'))
    AND co.status = 'active'
),
campaign_days AS (
  SELECT
    tc.campaign_id,
    tc.campaign_name,
    adm.date,
    COUNT(DISTINCT ca.account_email) AS assigned_accounts_with_metrics,
    SUM(COALESCE(adm.sent, 0)) AS sender_scoped_sent,
    SUM(COALESCE(adm.unique_replies, 0)) AS sender_scoped_unique_replies,
    SUM(COALESCE(adm.bounced, 0)) AS sender_scoped_bounces
  FROM tagged_campaigns tc
  JOIN sendlens.campaign_accounts ca
    ON tc.workspace_id = ca.workspace_id
   AND tc.campaign_id = ca.campaign_id
  JOIN sendlens.account_daily_metrics adm
    ON ca.workspace_id = adm.workspace_id
   AND lower(ca.account_email) = lower(adm.email)
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
    co.campaign_id,
    co.campaign_name,
    co.daily_limit AS campaign_daily_limit,
    co.emails_sent_count
  FROM sendlens.campaign_tags ct
  JOIN sendlens.campaign_overview co
    ON ct.workspace_id = co.workspace_id
   AND ct.campaign_id = co.campaign_id
  WHERE lower(trim(ct.tag_label)) = lower(trim('{{tag_name}}'))
    AND co.status = 'active'
),
assigned_accounts AS (
  SELECT DISTINCT
    tc.workspace_id,
    ca.account_email
  FROM tagged_campaigns tc
  JOIN sendlens.campaign_accounts ca
    ON tc.workspace_id = ca.workspace_id
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
    co.campaign_id,
    co.campaign_name,
    co.daily_limit AS campaign_daily_limit,
    co.emails_sent_count
  FROM sendlens.campaign_tags ct
  JOIN sendlens.campaign_overview co
    ON ct.workspace_id = co.workspace_id
   AND ct.campaign_id = co.campaign_id
  WHERE lower(trim(ct.tag_label)) = lower(trim('{{tag_name}}'))
    AND co.status = 'active'
),
assigned_accounts AS (
  SELECT DISTINCT
    tc.workspace_id,
    ca.account_email,
    ca.daily_limit AS account_daily_limit
  FROM tagged_campaigns tc
  JOIN sendlens.campaign_accounts ca
    ON tc.workspace_id = ca.workspace_id
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
    co.campaign_id
  FROM sendlens.campaign_tags ct
  JOIN sendlens.campaign_overview co
    ON ct.workspace_id = co.workspace_id
   AND ct.campaign_id = co.campaign_id
  WHERE lower(trim(ct.tag_label)) = lower(trim('{{tag_name}}'))
    AND co.status = 'active'
),
assigned_accounts AS (
  SELECT DISTINCT
    tc.workspace_id,
    ca.account_email
  FROM tagged_campaigns tc
  JOIN sendlens.campaign_accounts ca
    ON tc.workspace_id = ca.workspace_id
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
    ct.tag_label,
    co.campaign_id,
    co.campaign_name,
    co.status,
    co.daily_limit AS campaign_daily_limit,
    co.leads_count,
    co.contacted_count,
    GREATEST(COALESCE(co.leads_count, 0) - COALESCE(co.contacted_count, 0), 0) AS leads_remaining,
    COALESCE(co.emails_sent_count, 0) AS emails_sent_count,
    co.reply_count_unique,
    co.unique_reply_rate_pct,
    c.schedule_timezone,
    c.step_count
  FROM sendlens.campaign_tags ct
  JOIN sendlens.campaign_overview co
    ON ct.workspace_id = co.workspace_id
   AND ct.campaign_id = co.campaign_id
  JOIN sendlens.campaigns c
    ON co.workspace_id = c.workspace_id
   AND co.campaign_id = c.id
  WHERE lower(trim(ct.tag_label)) = lower(trim('{{tag_name}}'))
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
   AND tc.campaign_id = cdm.campaign_id
   AND cdm.date >= CURRENT_DATE - INTERVAL 30 DAY
),
pace AS (
  SELECT
    workspace_id,
    campaign_id,
    COUNT(*) FILTER (WHERE sent > 0) AS observed_sending_days_30d,
    string_agg(DISTINCT weekday_name, ', ') FILTER (WHERE sent > 0) AS observed_sending_weekdays_30d,
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
    string_agg(
      'step ' || CAST(step AS VARCHAR) || ': ' || CAST(sent AS VARCHAR),
      ' / '
      ORDER BY step
    ) AS sent_by_step,
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
    string_agg(
      'step ' || CAST(step AS VARCHAR) || ': delay ' || COALESCE(CAST(delay_value AS VARCHAR), '?') || ' ' || COALESCE(delay_unit, '?'),
      ' / '
      ORDER BY step
    ) AS configured_step_delays
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
  tc.tag_label,
  tc.campaign_id,
  tc.campaign_name,
  tc.campaign_daily_limit,
  tc.schedule_timezone,
  tc.leads_count,
  tc.contacted_count,
  tc.leads_remaining,
  tc.emails_sent_count,
  tc.reply_count_unique,
  tc.unique_reply_rate_pct,
  tc.step_count,
  sr.configured_steps_with_templates,
  sr.configured_step_delays,
  st.sent_by_step,
  st.step_analytics_sent_total,
  p.observed_sending_days_30d,
  p.observed_sending_weekdays_30d,
  p.avg_sent_per_observed_sending_day_30d,
  p.peak_sent_single_day_30d,
  p.avg_new_leads_contacted_per_active_day_30d,
  p.peak_new_leads_contacted_single_day_30d,
  ROUND(tc.leads_remaining / NULLIF(p.avg_new_leads_contacted_per_active_day_30d, 0), 1) AS new_lead_runway_observed_sending_days,
  CASE
    WHEN tc.leads_remaining = 0 THEN 'dry_on_new_prospects'
    WHEN p.avg_new_leads_contacted_per_active_day_30d IS NULL THEN 'missing_recent_new_lead_pace'
    WHEN tc.leads_remaining / NULLIF(p.avg_new_leads_contacted_per_active_day_30d, 0) < 2 THEN 'less_than_2_sending_days'
    WHEN tc.leads_remaining / NULLIF(p.avg_new_leads_contacted_per_active_day_30d, 0) < 5 THEN 'less_than_1_work_week'
    ELSE 'has_new_lead_buffer'
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
    WHEN 'dry_on_new_prospects' THEN 1
    WHEN 'less_than_2_sending_days' THEN 2
    WHEN 'less_than_1_work_week' THEN 3
    WHEN 'missing_recent_new_lead_pace' THEN 4
    ELSE 5
  END,
  new_lead_runway_observed_sending_days ASC NULLS LAST,
  tc.unique_reply_rate_pct DESC NULLS LAST;`,
    notes: [
      "Replace '{{tag_name}}' with a real campaign tag.",
      "This is the required first recipe for runway questions because it prevents confusing new-lead exhaustion with total send-volume exhaustion.",
      "Use `leads_remaining` and `avg_new_leads_contacted_per_active_day_30d` for new-prospect runway.",
      "Use `sent_by_step`, `configured_steps_with_templates`, and `configured_step_delays` to explain the follow-up tail after step 0 is exhausted.",
      "Use observed sending weekdays and peak daily sends as real schedule/capacity evidence before relying on configured campaign daily limits.",
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
    ct.tag_label,
    co.campaign_id,
    co.campaign_name,
    co.daily_limit AS campaign_daily_limit,
    co.leads_count,
    co.contacted_count
  FROM sendlens.campaign_tags ct
  JOIN sendlens.campaign_overview co
    ON ct.workspace_id = co.workspace_id
   AND ct.campaign_id = co.campaign_id
  WHERE lower(trim(ct.tag_label)) = lower(trim('{{tag_name}}'))
    AND co.status = 'active'
)
SELECT
  tc.tag_label,
  tc.campaign_id,
  tc.campaign_name,
  cdm.date,
  strftime(cdm.date, '%w') AS weekday_number,
  strftime(cdm.date, '%A') AS weekday_name,
  tc.campaign_daily_limit,
  GREATEST(COALESCE(tc.leads_count, 0) - COALESCE(tc.contacted_count, 0), 0) AS current_leads_remaining,
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
    GREATEST(COALESCE(co.leads_count, 0) - COALESCE(co.contacted_count, 0), 0) AS leads_remaining,
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
    string_agg(tag_label, ', ' ORDER BY tag_label) AS campaign_tags
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
  tr.campaign_tags,
  ac.daily_limit,
  ac.leads_count,
  ac.contacted_count,
  ac.leads_remaining,
  r7.sent_7d,
  r7.new_leads_contacted_7d,
  r7.unique_replies_7d,
  r7.opportunities_7d,
  r30.sending_days_30d,
  r30.avg_sent_per_sending_day_30d,
  r30.peak_sent_single_day_30d,
  ROUND(ac.leads_remaining / NULLIF(r30.avg_new_leads_contacted_per_active_day_30d, 0), 1) AS new_lead_runway_sending_days,
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
    WHEN ac.leads_remaining = 0 THEN 'dry_on_new_prospects'
    WHEN ac.leads_remaining / NULLIF(r30.avg_new_leads_contacted_per_active_day_30d, 0) < 5 THEN 'lead_refill_needed'
    WHEN COALESCE(sc.resolved_sender_accounts, 0) = 0 THEN 'sender_inventory_missing'
    WHEN COALESCE(r7.sent_7d, 0) = 0 THEN 'no_recent_volume'
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
    WHEN 'dry_on_new_prospects' THEN 2
    WHEN 'lead_refill_needed' THEN 3
    WHEN 'sender_inventory_missing' THEN 4
    WHEN 'no_recent_volume' THEN 5
    ELSE 6
  END,
  ac.unique_reply_rate_pct DESC NULLS LAST,
  r7.sent_7d DESC NULLS LAST;`,
    notes: [
      "Use this as the first exact data pull for account-manager briefs and daily action queues.",
      "Write the brief in client-safe language: wins, risks, current actions, asks, and next review date.",
      "Do not expose internal caveats verbosely to a client; translate them into clear limitations or next checks.",
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
    GREATEST(COALESCE(co.leads_count, 0) - COALESCE(co.contacted_count, 0), 0) AS leads_remaining,
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
    string_agg(
      DISTINCT 'step ' || CAST(step AS VARCHAR) || ': delay ' || COALESCE(CAST(delay_value AS VARCHAR), '?') || ' ' || COALESCE(delay_unit, '?'),
      ' / '
    ) AS step_delays
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
  tr.step_delays,
  tr.blank_subject_templates,
  tr.blank_body_templates,
  cb.leads_count,
  cb.contacted_count,
  cb.leads_remaining,
  sr.resolved_sender_accounts,
  sr.resolved_sender_daily_limit_total,
  sr.sender_rows_missing_status,
  sr.senders_over_5pct_bounce_30d,
  sr.avg_warmup_score,
  cb.bounce_rate_pct,
  cb.unique_reply_rate_pct,
  CASE
    WHEN COALESCE(sr.resolved_sender_accounts, 0) = 0 THEN 'blocker_missing_senders'
    WHEN COALESCE(cb.leads_remaining, 0) = 0 THEN 'blocker_no_uncontacted_leads'
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
    WHEN 'blocker_no_uncontacted_leads' THEN 2
    WHEN 'blocker_missing_templates' THEN 3
    WHEN 'blocker_blank_body' THEN 4
    WHEN 'review_settings_unknown' THEN 5
    WHEN 'review_deliverability_guardrails_relaxed' THEN 6
    WHEN 'review_tracking_enabled' THEN 7
    WHEN 'review_sender_bounce_risk' THEN 8
    ELSE 9
  END,
  cb.campaign_name;`,
    notes: [
      "Replace '{{campaign_name}}' with a campaign name fragment, or swap the WHERE clause for `c.id = '{{campaign_id}}'`.",
      "Pair this with `personalization-leak-audit` when the campaign uses template variables.",
      "Launch QA should produce blockers, warnings, and ready checks; do not bury blockers under general analysis.",
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
    GREATEST(COALESCE(co.leads_count, 0) - COALESCE(co.contacted_count, 0), 0) AS leads_remaining,
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
    string_agg(tag_label, ', ' ORDER BY tag_label) AS campaign_tags
  FROM sendlens.campaign_tags
  GROUP BY 1, 2
)
SELECT
  ac.campaign_id,
  ac.campaign_name,
  tr.campaign_tags,
  ac.leads_count,
  ac.contacted_count,
  ac.leads_remaining,
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
    WHEN COALESCE(ac.leads_remaining, 0) < 100 THEN 'lead_supply_or_segment_refill_test'
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
    WHEN 'lead_supply_or_segment_refill_test' THEN 4
    WHEN 'hydrate_or_load_campaign_before_testing' THEN 5
    ELSE 6
  END,
  rv.sent_14d DESC NULLS LAST,
  ac.emails_sent_count DESC;`,
    notes: [
      "Use this as the first pass for experiment planning, then narrow to one campaign and use copy, reply, or ICP recipes for the actual hypothesis.",
      "This recipe is hybrid because it combines exact campaign metrics with sampled/evidence coverage fields to decide whether deeper evidence is ready.",
      "A good experiment plan should include hypothesis, change, target cohort, success metric, stop condition, owner, and evaluation date.",
      "Do not recommend copy tests for campaigns with unresolved deliverability or lead-supply blockers until those blockers are addressed.",
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
      "Run fetch_reply_text for this campaign in default sync_newest mode, then rerun the query when the user needs current reply wording.",
      "Fetched inbound reply text is exact when available; rendered outbound copy remains reconstructed evidence.",
      "Use it for positive/negative cohort analysis and copy reconstruction.",
    ],
  },
  {
    id: "fetched-reply-text-by-campaign",
    topic: "reply-patterns",
    title: "Fetched reply text by campaign",
    question: "What are prospects actually saying in fetched positive and negative replies?",
    exactness: "exact",
    rationale: "Use fetched inbound reply bodies after running fetch_reply_text for one campaign.",
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
      "Payload keys usually come from uploaded lead-list metadata or campaign custom fields; missing keys mean metadata coverage is thin, not that Instantly enrichment failed.",
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
      "Treat missing keys as a lead-list metadata coverage issue. Recommend adding richer metadata to future uploads when sparse fields block analysis.",
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
GROUP BY 1, 2, 3
HAVING COUNT(DISTINCT email) >= 5
ORDER BY sampled_reply_share_pct DESC NULLS LAST, sampled_lead_count DESC;`,
    notes: [
      "This is sampled evidence only and should stay scoped to one campaign.",
      "Replace '{{payload_key}}' with the exact payload key for that campaign, such as region, existing_customer, or recent_grant_or_initiative.",
      "If the key has too few populated values, recommend collecting that field in future uploaded lead lists rather than blaming Instantly enrichment.",
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
      "Blank `job_title` or payload fields should be described as missing uploaded lead metadata/custom fields. Recommend adding role/title, function, seniority, company category, geography, list source, and trigger fields to future uploads when needed.",
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
GROUP BY 1, 2, 3, 4, 5, 9
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
    sql: `SELECT
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
WHERE lower(trim(COALESCE(t.label, t.name))) = lower(trim('{{tag_name}}'))
GROUP BY 1, 2, 3, 4
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
WHERE lower(trim(ct.tag_label)) = lower(trim('{{tag_name}}'))
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
  daily_limit,
  emails_sent_count,
  reply_count_unique,
  unique_reply_rate_pct,
  total_opportunities
FROM sendlens.campaign_tags ct
JOIN sendlens.campaign_overview co
  ON ct.workspace_id = co.workspace_id
 AND ct.campaign_id = co.campaign_id
WHERE lower(trim(tag_label)) = lower(trim('{{tag_name}}'))
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
