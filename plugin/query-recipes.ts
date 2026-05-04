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
      "Run hydrate_reply_text for this campaign in default sync_newest mode, then rerun the query when the user needs current reply wording.",
      "Hydrated inbound reply text is exact when available; rendered outbound copy remains reconstructed evidence.",
      "Use it for positive/negative cohort analysis and copy reconstruction.",
    ],
  },
  {
    id: "hydrated-reply-text-by-campaign",
    topic: "reply-patterns",
    title: "Hydrated reply text by campaign",
    question: "What are prospects actually saying in hydrated positive and negative replies?",
    exactness: "exact",
    rationale: "Use hydrated inbound reply bodies after running hydrate_reply_text for one campaign.",
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
      "Run hydrate_reply_text for this campaign in default sync_newest mode first if no rows are returned or the user wants the newest reply wording.",
      "This is exact for hydrated inbound email rows stored in reply_emails.",
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
