export const LOCAL_PLUGIN_NAME = "sendlens";
export const DEFAULT_DB_DIRECTORY = ".sendlens";
export const DEFAULT_DB_FILENAME = "workspace-cache.duckdb";

export const FULL_LEADS_THRESHOLD = 500;
export const FULL_EMAILS_THRESHOLD = 1000;
export const MAX_NONREPLY_LEAD_SAMPLE = 100;
export const MIN_NONREPLY_LEAD_SAMPLE = 40;
export const MAX_OUTBOUND_EMAIL_SAMPLE = 100;
export const DEFAULT_PAGE_SIZE = 100;
export const MAX_SAMPLE_PAGES = 4;
export const MAX_REPLY_LEAD_PAGES = 12;
export const SESSION_START_MAX_REPLY_LEAD_PAGES = 4;
export const MIN_SIGNAL_REPLY_LEADS = 12;
export const MAX_SIGNAL_REPLY_LEADS = 40;
export const MIN_SIGNAL_SCAN_PAGES = 2;
export const MAX_FULL_EMAIL_PAGES = 20;
export const MAX_REPLY_EMAIL_PAGES = 200;
export const MAX_INBOX_PLACEMENT_TEST_PAGES = 20;
export const MAX_INBOX_PLACEMENT_ANALYTICS_PAGES_PER_TEST = 20;
export const SESSION_START_EMAIL_LOOKBACK_DAYS = 21;
export const SESSION_START_REPLY_EMAIL_PAGES = 8;
export const SESSION_START_NONREPLY_LEAD_SAMPLE = 25;
export const REFRESH_CAMPAIGN_CONCURRENCY = 6;
export const SIGNAL_REPLY_INTEREST_STATUSES = [1, -1, -2] as const;

export const PUBLIC_TABLES = [
  "campaigns",
  "campaign_analytics",
  "step_analytics",
  "campaign_variants",
  "campaign_account_assignments",
  "campaign_accounts",
  "accounts",
  "account_daily_metrics",
  "custom_tags",
  "custom_tag_mappings",
  "campaign_tags",
  "account_tags",
  "inbox_placement_tests",
  "inbox_placement_analytics",
  "inbox_placement_test_overview",
  "sender_deliverability_health",
  "reply_emails",
  "reply_email_hydration_state",
  "sampled_leads",
  "sampled_outbound_emails",
  "sampling_runs",
  "campaign_overview",
  "lead_evidence",
  "lead_payload_kv",
  "reply_context",
  "rendered_outbound_context",
] as const;

export type PublicTableName = (typeof PUBLIC_TABLES)[number];

export const TABLE_DESCRIPTIONS: Record<PublicTableName, string> = {
  campaigns:
    "Exact campaign metadata from Instantly, including tracking and sequence counts.",
  campaign_analytics:
    "Exact per-campaign aggregate metrics such as sends, replies, bounces, and opportunities.",
  step_analytics:
    "Exact step and variant performance metrics from Instantly analytics.",
  campaign_variants:
    "Exact campaign templates extracted from campaign details: step, variant, subject, body, and delays.",
  campaign_account_assignments:
    "Exact campaign sender assignment settings from campaign details, including direct account emails and account-tag IDs.",
  campaign_accounts:
    "Resolved campaign sender inventory that expands direct campaign accounts and tag-based account assignments, joined to account health when available.",
  accounts:
    "Exact sending-account snapshot with warmup metadata and recent performance rollups.",
  account_daily_metrics:
    "Exact per-account daily performance metrics for recent periods.",
  custom_tags:
    "Exact Instantly custom tag definitions available for filtering local analysis.",
  custom_tag_mappings:
    "Exact Instantly custom tag assignments across tagged resources such as campaigns or accounts.",
  campaign_tags:
    "Convenience view joining campaign tag mappings to campaign names for exact tag-based filtering.",
  account_tags:
    "Convenience view joining account tag mappings to account emails for exact sender filtering.",
  inbox_placement_tests:
    "Exact inbox placement test definitions from Instantly, including linked campaigns, sending accounts, recipients, schedules, and raw metadata.",
  inbox_placement_analytics:
    "Exact per-email inbox placement analytics from Instantly tests, including sender, recipient ESP/geo/type, spam/category flags, and SPF/DKIM/DMARC results.",
  inbox_placement_test_overview:
    "Semantic inbox placement test rollup with primary inbox, category, spam, and authentication failure rates by test.",
  sender_deliverability_health:
    "Semantic sender-level deliverability health view built from inbox placement analytics across tests.",
  reply_emails:
    "Exact hydrated inbound reply email rows fetched on demand from Instantly email search, including body text, body HTML, thread IDs, and interest status.",
  reply_email_hydration_state:
    "Pagination and cache state for on-demand reply text hydration by campaign, interest status, and thread mode.",
  sampled_leads:
    "Campaign-scoped lead evidence with full replied leads and a bounded non-reply sample. Do not use for population totals.",
  sampled_outbound_emails:
    "Locally reconstructed outbound copy built from campaign templates plus lead variables. Do not treat it as exact delivered email text.",
  sampling_runs:
    "Per-campaign ingest coverage metadata, including exact-vs-sampled mode and sample sizes.",
  campaign_overview:
    "Semantic campaign health view: exact metrics, status, sample coverage, and reply/bounce rates in one place.",
  lead_evidence:
    "Semantic lead evidence view with stable Instantly lead fields, reply signals, and preserved campaign-scoped payload JSON.",
  lead_payload_kv:
    "Campaign-scoped sampled lead payload key/value view for ICP analysis without using raw JSON table functions in agent-authored SQL.",
  reply_context:
    "Reply outcome view that joins replied leads to hydrated inbound reply text when available plus originating templates and locally reconstructed copy.",
  rendered_outbound_context:
    "Rendered outbound analysis view that joins reconstructed lead-level copy to campaign names and intended templates.",
};
