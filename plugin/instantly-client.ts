/**
 * Instantly API v2 client with rate limiting and retry.
 * Workspace-wide limit: 100 req/sec and 6000 req/min.
 * The /emails listing endpoint is separately capped at 20 req/min.
 */
import { appendTraceLog } from "./debug-log";

const API_BASE = "https://api.instantly.ai/api/v2";
const MAX_CONCURRENT = 8;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;
const EMAILS_MIN_INTERVAL_MS = 3000; // 20 req/min

export interface InstantlyLead extends Record<string, unknown> {
  id?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  company_domain?: string;
  status?: number | string;
  email_open_count?: number;
  email_reply_count?: number;
  email_click_count?: number;
  lt_interest_status?: number | string;
  timestamp_created?: string;
  timestamp_updated?: string;
  timestamp_last_contact?: string;
  timestamp_last_open?: string;
  timestamp_last_reply?: string;
  timestamp_last_click?: string;
  timestamp_last_interest_change?: string;
  timestamp_last_touch?: string;
  timestamp_added_subsequence?: string;
  esp_code?: number | string;
  verification_status?: number | string;
  enrichment_status?: number | string;
  email_opened_step?: number | string;
  email_opened_variant?: number | string;
  email_replied_step?: number | string;
  email_replied_variant?: number | string;
  email_clicked_step?: number | string;
  email_clicked_variant?: number | string;
  subsequence_id?: string;
  last_contacted_from?: string;
  pl_value?: string;
  pl_value_lead?: string;
  is_website_visitor?: boolean | number | string;
  list_id?: string;
  upload_method?: string;
  uploaded_by_user?: string;
  assigned_to?: string;
  esg_code?: number | string;
  status_summary?: unknown;
  job_title?: string;
  website?: string;
  phone?: string;
  personalization?: string;
  payload?: Record<string, unknown>;
}

// Simple semaphore for concurrency control
let activeRequests = 0;
const queue: Array<() => void> = [];
let emailLane: Promise<void> = Promise.resolve();
let lastEmailRequestAt = 0;

function acquireSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT) {
    activeRequests++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}

function releaseSlot() {
  activeRequests--;
  const next = queue.shift();
  if (next) {
    activeRequests++;
    next();
  }
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  lane: "default" | "emails" = "default",
  attempt = 1,
): Promise<Response> {
  const startedAt = Date.now();
  const parsedUrl = new URL(url);
  await appendTraceLog("http.request", {
    lane,
    attempt,
    method: options.method ?? "GET",
    path: parsedUrl.pathname,
    query: parsedUrl.searchParams.toString(),
  });
  if (lane === "emails") {
    await waitForEmailsLane();
  }

  await acquireSlot();
  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (err) {
    releaseSlot();
    if (attempt <= RETRY_ATTEMPTS) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`[instantly] Network error, retry ${attempt}/${RETRY_ATTEMPTS} in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
      return fetchWithRetry(url, options, lane, attempt + 1);
    }
    throw err;
  }
  releaseSlot();

  if (res.status === 429 && attempt <= RETRY_ATTEMPTS) {
    const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
    await appendTraceLog("http.retry", {
      lane,
      attempt,
      status: res.status,
      delayMs: delay,
      path: parsedUrl.pathname,
      elapsedMs: Date.now() - startedAt,
    });
    console.log(`[instantly] 429 rate limited, retry ${attempt}/${RETRY_ATTEMPTS} in ${delay}ms`);
    await new Promise((r) => setTimeout(r, delay));
    return fetchWithRetry(url, options, lane, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text();
    await appendTraceLog("http.error", {
      lane,
      attempt,
      status: res.status,
      path: parsedUrl.pathname,
      elapsedMs: Date.now() - startedAt,
      body,
    });
    throw new Error(`Instantly API ${res.status}: ${body}`);
  }
  await appendTraceLog("http.response", {
    lane,
    attempt,
    status: res.status,
    path: parsedUrl.pathname,
    elapsedMs: Date.now() - startedAt,
  });
  return res;
}

function waitForEmailsLane(): Promise<void> {
  emailLane = emailLane.then(async () => {
    const now = Date.now();
    const waitMs = Math.max(0, EMAILS_MIN_INTERVAL_MS - (now - lastEmailRequestAt));
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastEmailRequestAt = Date.now();
  });
  return emailLane;
}

function headers(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

// ── API Methods ──

export async function listCampaigns(apiKey: string) {
  const res = await fetchWithRetry(
    `${API_BASE}/campaigns?limit=100`,
    { headers: headers(apiKey) },
  );
  const data = await res.json() as Record<string, unknown>;
  return (data.items || []) as Array<Record<string, unknown>>;
}

export type InstantlyApiKeyValidation = {
  status: "valid" | "invalid" | "unreachable";
  message: string;
  http_status?: number;
  returned_campaigns?: number;
};

export async function validateApiKey(
  apiKey: string,
  timeoutMs = 5000,
): Promise<InstantlyApiKeyValidation> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}/campaigns?limit=1`, {
      headers: headers(apiKey),
      signal: controller.signal,
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      const items = Array.isArray(data.items)
        ? data.items
        : Array.isArray(data)
          ? data
          : [];
      return {
        status: "valid",
        message: `Instantly accepted the key and returned ${items.length} campaign row${items.length === 1 ? "" : "s"} in the probe.`,
        http_status: res.status,
        returned_campaigns: items.length,
      };
    }

    if (res.status === 401 || res.status === 403) {
      return {
        status: "invalid",
        message: `Instantly rejected the key with HTTP ${res.status}.`,
        http_status: res.status,
      };
    }

    return {
      status: "unreachable",
      message: `Instantly credential probe returned HTTP ${res.status}; retry setup or run refresh_data after connectivity is healthy.`,
      http_status: res.status,
    };
  } catch (error) {
    return {
      status: "unreachable",
      message:
        error instanceof Error
          ? `Instantly credential probe could not complete: ${error.message}.`
          : "Instantly credential probe could not complete.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function listSubsequencesPage(
  apiKey: string,
  parentCampaignId: string,
  cursor?: string,
) {
  const params = new URLSearchParams();
  params.set("limit", "100");
  params.set("parent_campaign", parentCampaignId);
  if (cursor) params.set("starting_after", cursor);
  const res = await fetchWithRetry(
    `${API_BASE}/subsequences?${params.toString()}`,
    { headers: headers(apiKey) },
  );
  const data = await res.json() as Record<string, unknown>;
  const items = (data.items || (Array.isArray(data) ? data : [])) as Array<Record<string, unknown>>;
  const nextCursor =
    (data.next_starting_after as string | undefined)
    ?? (data.next_cursor as string | undefined)
    ?? (data.starting_after as string | undefined)
    ?? null;
  return { items, nextCursor };
}

export async function listAllSubsequences(
  apiKey: string,
  parentCampaignId: string,
  maxPages = 50,
): Promise<Array<Record<string, unknown>>> {
  const allSubsequences: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const { items, nextCursor } = await listSubsequencesPage(
      apiKey,
      parentCampaignId,
      cursor || undefined,
    );
    allSubsequences.push(...items);
    cursor = nextCursor;
    if (!cursor || items.length < 100) break;
  }

  return allSubsequences;
}

export async function getCampaignAnalytics(apiKey: string) {
  const res = await fetchWithRetry(
    `${API_BASE}/campaigns/analytics`,
    { headers: headers(apiKey) },
  );
  return (await res.json()) as Array<Record<string, unknown>>;
}

export async function getCampaignDetails(apiKey: string, campaignId: string) {
  const res = await fetchWithRetry(
    `${API_BASE}/campaigns/${campaignId}`,
    { headers: headers(apiKey) },
  );
  return (await res.json()) as Record<string, unknown>;
}

export async function getStepAnalytics(
  apiKey: string,
  campaignId: string,
  opts: { includeOpportunitiesCount?: boolean } = {},
) {
  const params = new URLSearchParams();
  params.set("campaign_id", campaignId);
  if (opts.includeOpportunitiesCount) {
    params.set("include_opportunities_count", "true");
  }
  const res = await fetchWithRetry(
    `${API_BASE}/campaigns/analytics/steps?${params.toString()}`,
    { headers: headers(apiKey) },
  );
  return (await res.json()) as Array<Record<string, unknown>>;
}

export async function getDailyAnalytics(
  apiKey: string,
  campaignId: string,
  startDate?: string,
) {
  let url = `${API_BASE}/campaigns/analytics/daily?campaign_id=${campaignId}`;
  if (startDate) url += `&start_date=${startDate}`;
  const res = await fetchWithRetry(url, { headers: headers(apiKey) });
  return (await res.json()) as Array<Record<string, unknown>>;
}

export async function listAccounts(apiKey: string) {
  const res = await fetchWithRetry(
    `${API_BASE}/accounts?limit=100`,
    { headers: headers(apiKey) },
  );
  const data = await res.json() as Record<string, unknown>;
  return (data.items || []) as Array<Record<string, unknown>>;
}

export async function listLeadLists(
  apiKey: string,
  cursor?: string,
) {
  const params = new URLSearchParams();
  params.set("limit", "100");
  if (cursor) params.set("starting_after", cursor);
  const res = await fetchWithRetry(
    `${API_BASE}/lead-lists?${params.toString()}`,
    { headers: headers(apiKey) },
  );
  const data = await res.json() as Record<string, unknown>;
  const items = (data.items || (Array.isArray(data) ? data : [])) as Array<Record<string, unknown>>;
  const nextCursor =
    (data.next_starting_after as string | undefined)
    ?? (data.next_cursor as string | undefined)
    ?? (data.starting_after as string | undefined)
    ?? null;
  return { items, nextCursor };
}

export async function listCustomTags(
  apiKey: string,
  cursor?: string,
) {
  const params = new URLSearchParams();
  params.set("limit", "100");
  if (cursor) params.set("starting_after", cursor);
  const res = await fetchWithRetry(
    `${API_BASE}/custom-tags?${params.toString()}`,
    { headers: headers(apiKey) },
  );
  const data = await res.json() as Record<string, unknown>;
  const items = (data.items || (Array.isArray(data) ? data : [])) as Array<Record<string, unknown>>;
  const nextCursor =
    (data.next_starting_after as string | undefined)
    ?? (data.next_cursor as string | undefined)
    ?? (data.starting_after as string | undefined)
    ?? null;
  return { items, nextCursor };
}

export async function listAllCustomTags(
  apiKey: string,
  maxPages = 200,
): Promise<Array<Record<string, unknown>>> {
  const allTags: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const { items, nextCursor } = await listCustomTags(apiKey, cursor || undefined);
    allTags.push(...items);
    cursor = nextCursor;
    if (!cursor || items.length < 100) break;
  }

  return allTags;
}


type LeadPageOptions = {
  filter?: string;
  queries?: unknown[];
  limit?: number;
};

export async function listLeadsPage(
  apiKey: string,
  campaignId: string,
  cursor?: string,
  opts: LeadPageOptions = {},
) {
  const body: Record<string, unknown> = {
    campaign: campaignId,
    limit: opts.limit ?? 100,
  };
  if (cursor) body.starting_after = cursor;
  if (opts.filter) body.filter = opts.filter;
  if (opts.queries) body.queries = opts.queries;

  const res = await fetchWithRetry(`${API_BASE}/leads/list`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify(body),
  });
  const data = await res.json() as Record<string, unknown>;
  return {
    items: (data.items || []) as InstantlyLead[],
    nextCursor: data.next_starting_after as string | null,
  };
}

/**
 * Paginate all leads for a campaign. Batches 5 pages concurrently.
 * Returns all leads (can be 150K+).
 */
export async function listAllLeads(
  apiKey: string,
  campaignId: string,
  maxPages = 50,
  opts: LeadPageOptions = {},
): Promise<InstantlyLead[]> {
  const allLeads: InstantlyLead[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const { items, nextCursor } = await listLeadsPage(
      apiKey,
      campaignId,
      cursor || undefined,
      opts,
    );
    allLeads.push(...items);
    cursor = nextCursor;
    if (!cursor || items.length < (opts.limit ?? 100)) break;
  }

  return allLeads;
}

export async function listSentEmails(
  apiKey: string,
  campaignId: string,
  limit = 50,
) {
  const page = await listEmails(apiKey, campaignId);
  return page.items.slice(0, limit);
}

type EmailPageOptions = {
  emailType?: "received" | "sent" | "manual";
  mode?: "emode_focused" | "emode_others" | "emode_all";
  iStatus?: number;
  isUnread?: boolean;
  lead?: string;
  search?: string;
  companyDomain?: string;
  minTimestampCreated?: string;
  maxTimestampCreated?: string;
  previewOnly?: boolean;
  latestOfThread?: boolean;
  sortOrder?: "asc" | "desc";
  limit?: number;
};

export async function listEmails(
  apiKey: string,
  campaignId: string,
  cursor?: string,
  opts: EmailPageOptions = {},
) {
  const params = new URLSearchParams();
  params.set("campaign_id", campaignId);
  params.set("limit", String(opts.limit ?? 100));
  if (cursor) params.set("starting_after", cursor);
  if (opts.emailType) params.set("email_type", opts.emailType);
  if (opts.mode) params.set("mode", opts.mode);
  if (opts.iStatus != null) params.set("i_status", String(opts.iStatus));
  if (opts.isUnread != null) params.set("is_unread", opts.isUnread ? "true" : "false");
  if (opts.lead) params.set("lead", opts.lead);
  if (opts.search) params.set("search", opts.search);
  if (opts.companyDomain) params.set("company_domain", opts.companyDomain);
  if (opts.minTimestampCreated) params.set("min_timestamp_created", opts.minTimestampCreated);
  if (opts.maxTimestampCreated) params.set("max_timestamp_created", opts.maxTimestampCreated);
  if (opts.previewOnly != null) params.set("preview_only", opts.previewOnly ? "true" : "false");
  if (opts.latestOfThread != null) params.set("latest_of_thread", opts.latestOfThread ? "true" : "false");
  if (opts.sortOrder) params.set("sort_order", opts.sortOrder);
  const res = await fetchWithRetry(
    `${API_BASE}/emails?${params.toString()}`,
    { headers: headers(apiKey) },
    "emails",
  );
  const data = await res.json() as Record<string, unknown>;
  const items = (data.items || (Array.isArray(data) ? data : [])) as Array<Record<string, unknown>>;
  const nextCursor =
    (data.next_starting_after as string | undefined)
    ?? (data.next_cursor as string | undefined)
    ?? (data.starting_after as string | undefined)
    ?? null;
  return { items, nextCursor };
}

export async function listLeadLabels(
  apiKey: string,
  cursor?: string,
) {
  const params = new URLSearchParams();
  params.set("limit", "100");
  if (cursor) params.set("starting_after", cursor);

  const res = await fetchWithRetry(
    `${API_BASE}/lead-labels?${params.toString()}`,
    { headers: headers(apiKey) },
  );
  const data = await res.json() as Record<string, unknown>;
  const items = (data.items || (Array.isArray(data) ? data : [])) as Array<Record<string, unknown>>;
  const nextCursor =
    (data.next_starting_after as string | undefined)
    ?? (data.next_cursor as string | undefined)
    ?? (data.starting_after as string | undefined)
    ?? null;

  return { items, nextCursor };
}

export async function listAllLeadLabels(
  apiKey: string,
  maxPages = 200,
): Promise<Array<Record<string, unknown>>> {
  const allLabels: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const { items, nextCursor } = await listLeadLabels(apiKey, cursor || undefined);
    allLabels.push(...items);
    cursor = nextCursor;
    if (!cursor || items.length < 100) break;
  }

  return allLabels;
}

export async function listAllEmails(
  apiKey: string,
  campaignId: string,
  maxPages = 200,
  opts: EmailPageOptions = {},
): Promise<Array<Record<string, unknown>>> {
  const allEmails: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const { items, nextCursor } = await listEmails(
      apiKey,
      campaignId,
      cursor || undefined,
      opts,
    );
    allEmails.push(...items);
    cursor = nextCursor;
    if (!cursor || items.length < (opts.limit ?? 100)) break;
  }

  return allEmails;
}

type CustomTagMappingPageOptions = {
  resourceIds?: string[];
};

export async function listCustomTagMappings(
  apiKey: string,
  cursor?: string,
  opts: CustomTagMappingPageOptions = {},
) {
  const params = new URLSearchParams();
  params.set("limit", "100");
  if (cursor) params.set("starting_after", cursor);
  if (opts.resourceIds?.length) {
    params.set("resource_ids", opts.resourceIds.join(","));
  }
  const res = await fetchWithRetry(
    `${API_BASE}/custom-tag-mappings?${params.toString()}`,
    { headers: headers(apiKey) },
  );
  const data = await res.json() as Record<string, unknown>;
  const items = (data.items || (Array.isArray(data) ? data : [])) as Array<Record<string, unknown>>;
  const nextCursor =
    (data.next_starting_after as string | undefined)
    ?? (data.next_cursor as string | undefined)
    ?? (data.starting_after as string | undefined)
    ?? null;
  return { items, nextCursor };
}

export async function listAllCustomTagMappings(
  apiKey: string,
  maxPages = 200,
  opts: CustomTagMappingPageOptions = {},
): Promise<Array<Record<string, unknown>>> {
  const allMappings: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const { items, nextCursor } = await listCustomTagMappings(apiKey, cursor || undefined, opts);
    allMappings.push(...items);
    cursor = nextCursor;
    if (!cursor || items.length < 100) break;
  }

  return allMappings;
}

// ── Per-account warmup analytics ──
// POST /accounts/warmup-analytics with { emails: [...] } (max 100 per call)
// Returns { email_date_data, aggregate_data } keyed by email.
export async function getWarmupAnalytics(
  apiKey: string,
  emails: string[],
): Promise<{
  email_date_data?: Record<
    string,
    Record<
      string,
      {
        sent?: number;
        received?: number;
        landed_inbox?: number;
        landed_spam?: number;
      }
    >
  >;
  aggregate_data?: Record<
    string,
    {
      sent?: number;
      received?: number;
      landed_inbox?: number;
      landed_spam?: number;
      health_score?: number;
      health_score_label?: string;
    }
  >;
}> {
  if (emails.length === 0) return {};
  const res = await fetchWithRetry(`${API_BASE}/accounts/warmup-analytics`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ emails }),
  });
  return (await res.json()) as {
    email_date_data?: Record<
      string,
      Record<
        string,
        {
          sent?: number;
          received?: number;
          landed_inbox?: number;
          landed_spam?: number;
        }
      >
    >;
    aggregate_data?: Record<
      string,
      {
        sent?: number;
        received?: number;
        landed_inbox?: number;
        landed_spam?: number;
        health_score?: number;
        health_score_label?: string;
      }
    >;
  };
}

// ── Per-account per-day analytics ──
// GET /accounts/analytics/daily — defaults to last 30 days if no range given.
// Returns array of { date, email_account, sent, bounced, ... }.
export async function getDailyAccountAnalytics(
  apiKey: string,
  opts: { startDate?: string; endDate?: string; emails?: string[] } = {},
): Promise<Array<Record<string, unknown>>> {
  const params = new URLSearchParams();
  if (opts.startDate) params.set("start_date", opts.startDate);
  if (opts.endDate) params.set("end_date", opts.endDate);
  if (opts.emails && opts.emails.length > 0) {
    for (const e of opts.emails) params.append("emails", e);
  }
  const qs = params.toString();
  const res = await fetchWithRetry(
    `${API_BASE}/accounts/analytics/daily${qs ? `?${qs}` : ""}`,
    { headers: headers(apiKey) },
  );
  const data = await res.json() as Record<string, unknown> | Array<Record<string, unknown>>;
  return (
    ("items" in data ? data.items : undefined) ||
    (Array.isArray(data) ? data : [])
  ) as Array<Record<string, unknown>>;
}

export async function listInboxPlacementTestsPage(
  apiKey: string,
  cursor?: string,
) {
  const params = new URLSearchParams();
  params.set("limit", "100");
  params.set("with_metadata", "true");
  if (cursor) params.set("starting_after", cursor);

  const res = await fetchWithRetry(
    `${API_BASE}/inbox-placement-tests?${params.toString()}`,
    { headers: headers(apiKey) },
  );
  const data = await res.json() as Record<string, unknown>;
  const items = (data.items || (Array.isArray(data) ? data : [])) as Array<Record<string, unknown>>;
  const nextCursor =
    (data.next_starting_after as string | undefined)
    ?? (data.next_cursor as string | undefined)
    ?? (data.starting_after as string | undefined)
    ?? null;
  return { items, nextCursor };
}

export async function listAllInboxPlacementTests(
  apiKey: string,
  maxPages = 20,
): Promise<Array<Record<string, unknown>>> {
  const tests: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const { items, nextCursor } = await listInboxPlacementTestsPage(apiKey, cursor || undefined);
    tests.push(...items);
    cursor = nextCursor;
    if (!cursor || items.length < 100) break;
  }

  return tests;
}

export async function listInboxPlacementAnalyticsPage(
  apiKey: string,
  opts: {
    testId: string;
    cursor?: string;
    dateFrom?: string;
    dateTo?: string;
    senderEmail?: string;
  },
) {
  const params = new URLSearchParams();
  params.set("limit", "100");
  params.set("test_id", opts.testId);
  if (opts.cursor) params.set("starting_after", opts.cursor);
  if (opts.dateFrom) params.set("date_from", opts.dateFrom);
  if (opts.dateTo) params.set("date_to", opts.dateTo);
  if (opts.senderEmail) params.set("sender_email", opts.senderEmail);

  const res = await fetchWithRetry(
    `${API_BASE}/inbox-placement-analytics?${params.toString()}`,
    { headers: headers(apiKey) },
  );
  const data = await res.json() as Record<string, unknown>;
  const items = (data.items || (Array.isArray(data) ? data : [])) as Array<Record<string, unknown>>;
  const nextCursor =
    (data.next_starting_after as string | undefined)
    ?? (data.next_cursor as string | undefined)
    ?? (data.starting_after as string | undefined)
    ?? null;
  return { items, nextCursor };
}

export async function listAllInboxPlacementAnalyticsForTest(
  apiKey: string,
  testId: string,
  maxPages = 20,
): Promise<Array<Record<string, unknown>>> {
  const analytics: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const { items, nextCursor } = await listInboxPlacementAnalyticsPage(apiKey, {
      testId,
      cursor: cursor || undefined,
    });
    analytics.push(...items);
    cursor = nextCursor;
    if (!cursor || items.length < 100) break;
  }

  return analytics;
}
