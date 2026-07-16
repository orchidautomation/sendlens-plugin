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

export type QueryRecipeSummary = Omit<QueryRecipe, "sql" | "notes"> & {
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
    id: "sender-load-balance-by-campaign-tag",
    topic: "workspace-health",
    title: "Sender load balance by campaign tag",
    question: "Are the inboxes assigned to a campaign tag unevenly loaded or risky?",
    exactness: "exact",
    rationale: "Use resolved campaign sender assignments, sender daily limits, and account daily metrics to spot overloaded, underused, or risky inboxes.",
    sql: `WITH tagged_campaign_senders AS (
  SELECT
    ct.workspace_id,
    ct.tag_label AS campaign_tag,
    ca.campaign_id,
    ca.campaign_name,
    ca.account_email,
    regexp_extract(ca.account_email, '@(.+)$', 1) AS sender_domain,
    ca.assignment_source,
    ca.tag_label AS assignment_account_tag,
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
   AND ct.campaign_id = ca.campaign_id
  WHERE lower(trim(ct.tag_label)) = lower(trim('{{tag_name}}'))
),
sender_campaign_counts AS (
  SELECT
    workspace_id,
    lower(account_email) AS account_email,
    COUNT(DISTINCT campaign_id) AS active_campaigns_using_sender
  FROM sendlens.campaign_accounts
  GROUP BY 1, 2
),
recent_account_daily AS (
  SELECT
    workspace_id,
    lower(email) AS account_email,
    COUNT(*) FILTER (WHERE COALESCE(sent, 0) > 0) AS sending_days_30d,
    ROUND(AVG(sent) FILTER (WHERE COALESCE(sent, 0) > 0), 2) AS avg_sent_per_sending_day_30d,
    MAX(sent) AS peak_sent_single_day_30d,
    SUM(COALESCE(sent, 0)) AS account_sent_30d,
    SUM(COALESCE(unique_replies, 0)) AS account_unique_replies_30d,
    SUM(COALESCE(bounced, 0)) AS account_bounces_30d
  FROM sendlens.account_daily_metrics
  WHERE date >= CURRENT_DATE - INTERVAL 30 DAY
  GROUP BY 1, 2
)
SELECT
  tcs.campaign_tag,
  tcs.account_email,
  tcs.sender_domain,
  MIN(tcs.campaign_name) AS tagged_campaign_example,
  COUNT(DISTINCT tcs.campaign_id) AS tagged_campaign_count,
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
 AND lower(tcs.account_email) = scc.account_email
LEFT JOIN recent_account_daily rad
  ON tcs.workspace_id = rad.workspace_id
 AND lower(tcs.account_email) = rad.account_email
GROUP BY
  tcs.campaign_tag,
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
      "Use this before capacity or burn-rate claims that depend on sender availability.",
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
  tc.tag_label,
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
    ct.tag_label AS campaign_tag,
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
   AND ct.campaign_id = co.campaign_id
  JOIN sendlens.campaigns c
    ON co.workspace_id = c.workspace_id
   AND co.campaign_id = c.id
  WHERE lower(trim(ct.tag_label)) = lower(trim('{{campaign_tag_name}}'))
    AND co.status = 'active'
),
sender_candidates AS (
  SELECT
    tc.workspace_id,
    tc.campaign_id,
    ca.account_email,
    regexp_extract(ca.account_email, '@(.+)$', 1) AS sender_domain,
    ca.assignment_source,
    ca.tag_label AS assignment_account_tag,
    MAX(ca.daily_limit) AS account_daily_limit,
    MAX(ca.total_sent_30d) AS total_sent_30d,
    MAX(ca.total_replies_30d) AS total_replies_30d,
    MAX(ca.total_bounces_30d) AS total_bounces_30d,
    MAX(ca.bounce_rate_30d_pct) AS bounce_rate_30d_pct,
    MAX(CASE
      WHEN lower(trim(COALESCE(account_tag.tag_label, ca.tag_label, ''))) = lower(trim('{{account_tag_name}}')) THEN 1
      ELSE 0
    END) AS matches_account_tag
  FROM tagged_campaigns tc
  JOIN sendlens.campaign_accounts ca
    ON tc.workspace_id = ca.workspace_id
   AND tc.campaign_id = ca.campaign_id
  LEFT JOIN sendlens.account_tags account_tag
    ON ca.workspace_id = account_tag.workspace_id
   AND lower(ca.account_email) = lower(account_tag.account_email)
  GROUP BY 1, 2, 3, 4, 5, 6
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
  ct.tag_label AS tag_name,
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
 AND ct.campaign_id = co.campaign_id
WHERE lower(trim(ct.tag_label)) = lower(trim('{{tag_name}}'))
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

  const recipes = getQueryRecipes(options.topic);
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
        : "Compact summaries omit SQL. Pass recipe_id for one full recipe, mode='full' for a bounded SQL page, or next_page to continue.",
  };
}
