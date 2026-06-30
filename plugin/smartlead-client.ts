import { appendTraceLog } from "./debug-log";

export const SMARTLEAD_API_BASE = "https://server.smartlead.ai/api/v1";
export const SMARTLEAD_ACCESS_PARAM = ["api", "key"].join("_");

const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;
const DEFAULT_RETRY_MAX_DELAY_MS = 60_000;
const DEFAULT_RETRY_JITTER_RATIO = 0.2;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 50;
const DEFAULT_BURST_LIMIT = 10;
const DEFAULT_BURST_WINDOW_MS = 2000;
const DEFAULT_MAX_CONCURRENT = 8;
const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_MAX_PAGES = 200;
const BULK_MESSAGE_HISTORY_SUFFIX = "bbfbdsFGHlBr76ruhjvh6fhHL";

type SmartleadFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
type SleepFn = (ms: number) => Promise<void>;
type NowFn = () => number;
type QueryValue = string | number | boolean | null | undefined;
type QueryParams = Record<string, QueryValue | QueryValue[]>;

export interface SmartleadRateLimitConfig {
  perMinute?: number;
  burstLimit?: number;
  burstWindowMs?: number;
  /**
   * Compatibility alias for callers that configured the first client version.
   * Prefer burstLimit + burstWindowMs for new Smartlead rate-limit settings.
   */
  burstPerSecond?: number;
  maxConcurrent?: number;
  disabled?: boolean;
}

export interface SmartleadRetryConfig {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  statuses?: number[];
}

export interface SmartleadClientOptions {
  accessValue: string;
  baseUrl?: string;
  fetchImpl?: SmartleadFetch;
  sleep?: SleepFn;
  now?: NowFn;
  rateLimit?: SmartleadRateLimitConfig;
  retry?: SmartleadRetryConfig;
}

export interface SmartleadRequestOptions extends Omit<RequestInit, "body"> {
  query?: QueryParams;
  json?: unknown;
  body?: RequestInit["body"];
}

export interface SmartleadOffsetPage<T extends Record<string, unknown> = Record<string, unknown>> {
  items: T[];
  total: number | null;
  offset: number;
  limit: number;
  nextOffset: number;
  hasMore: boolean;
}

export interface SmartleadAccessValidation {
  status: "valid" | "invalid" | "unreachable";
  message: string;
  http_status?: number;
  returned_campaigns?: number;
}

export interface SmartleadRateLimitStats {
  window_burst_count: number;
  window_60s_count: number;
  burst_limit: number;
  burst_window_ms: number;
  limit_60s: number;
  throttled_count: number;
  active_requests: number;
  queued_requests: number;
  window_1s_count: number;
  limit_1s: number;
}

type RequiredRetryConfig = Required<Omit<SmartleadRetryConfig, "statuses">> & {
  statuses: Set<number>;
};

type RequiredRateLimitConfig = Required<Omit<SmartleadRateLimitConfig, "burstPerSecond">>;

export class SmartleadApiError extends Error {
  status: number;
  url: string;
  body: string;

  constructor(status: number, redactedUrl: string, redactedBody: string) {
    const bodyPreview = redactedBody.length > 2000
      ? `${redactedBody.slice(0, 2000)}...`
      : redactedBody;
    super(`Smartlead API ${status} for ${redactedUrl}: ${bodyPreview}`);
    this.name = "SmartleadApiError";
    this.status = status;
    this.url = redactedUrl;
    this.body = redactedBody;
  }
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function abortError(signal?: AbortSignal | null) {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const error = new Error(reason == null ? "The operation was aborted." : String(reason));
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal | null) {
  if (signal?.aborted) throw abortError(signal);
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function appendQuery(url: URL, query: QueryParams = {}) {
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item == null) continue;
        url.searchParams.append(key, String(item));
      }
      continue;
    }
    if (value == null) continue;
    url.searchParams.set(key, String(value));
  }
}

export function buildSmartleadUrl(
  path: string,
  accessValue: string,
  query: QueryParams = {},
  baseUrl = SMARTLEAD_API_BASE,
) {
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(cleanPath, normalizeBaseUrl(baseUrl));
  appendQuery(url, query);
  url.searchParams.set(SMARTLEAD_ACCESS_PARAM, accessValue);
  return url;
}

export function redactSmartleadUrl(input: string | URL, values: string[] = []) {
  const raw = String(input);
  try {
    const url = new URL(raw);
    if (url.searchParams.has(SMARTLEAD_ACCESS_PARAM)) {
      url.searchParams.set(SMARTLEAD_ACCESS_PARAM, "[REDACTED]");
    }
    return redactSmartleadText(url.toString(), values);
  } catch {
    return redactSmartleadText(raw, values);
  }
}

export function redactSmartleadText(input: string, values: string[] = []) {
  let out = input;
  for (const value of values) {
    if (!value) continue;
    out = out.split(value).join("[REDACTED]");
  }
  out = out.replace(/([?&]api_key=)[^&\s"'<>]+/gi, "$1[REDACTED]");
  out = out.replace(/(["']api_key["']\s*:\s*["'])[^"']+(["'])/gi, "$1[REDACTED]$2");
  out = out.replace(/(\bapi_key\s*[:=]\s*)[^,\s"'<>}]+/gi, "$1[REDACTED]");
  return out;
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.min(asNumber * 1000, DEFAULT_RETRY_MAX_DELAY_MS);
  }
  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) {
    return Math.max(0, Math.min(asDate - now, DEFAULT_RETRY_MAX_DELAY_MS));
  }
  return null;
}

function coerceRetryMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.min(value * 1000, DEFAULT_RETRY_MAX_DELAY_MS);
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.min(parsed * 1000, DEFAULT_RETRY_MAX_DELAY_MS);
    }
  }
  return null;
}

function findRetrySeconds(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/retry[-_]?after|retry[-_]?seconds|retry[-_]?in/i.test(key)) {
      const coerced = coerceRetryMs(nested);
      if (coerced != null) return coerced;
    }
    const nestedValue = findRetrySeconds(nested);
    if (nestedValue != null) return nestedValue;
  }
  return null;
}

export function parseRetryDelayFromBody(body: string): number | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const fromJson = findRetrySeconds(parsed);
    if (fromJson != null) return fromJson;
  } catch {
    // Fall through to text matching.
  }
  const match = trimmed.match(/retry(?:\s|-|_)?(?:after|in)?\s*:?\s*(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec|secs|seconds?|m|mins?|minutes?)?/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const unit = (match[2] ?? "seconds").toLowerCase();
  if (unit.startsWith("ms") || unit.startsWith("millisecond")) {
    return Math.min(amount, DEFAULT_RETRY_MAX_DELAY_MS);
  }
  if (unit === "m" || unit.startsWith("min")) {
    return Math.min(amount * 60_000, DEFAULT_RETRY_MAX_DELAY_MS);
  }
  return Math.min(amount * 1000, DEFAULT_RETRY_MAX_DELAY_MS);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readNumber(record: Record<string, unknown> | null, keys: string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

export function parseSmartleadItems<T extends Record<string, unknown> = Record<string, unknown>>(
  payload: unknown,
  itemKeys: string[] = [],
): T[] {
  if (Array.isArray(payload)) return payload as T[];

  const keys = [
    ...itemKeys,
    "items",
    "leads",
    "campaigns",
    "email_accounts",
    "emailAccounts",
    "statistics",
    "messages",
    "results",
    "rows",
  ];
  const record = asRecord(payload);
  if (!record) return [];

  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as T[];
  }

  const data = record.data;
  if (Array.isArray(data)) return data as T[];
  const dataRecord = asRecord(data);
  if (dataRecord) {
    for (const key of keys) {
      if (Array.isArray(dataRecord[key])) return dataRecord[key] as T[];
    }
  }

  return [];
}

export function unwrapSmartleadRecord<T extends Record<string, unknown> = Record<string, unknown>>(
  payload: unknown,
  preferredKeys: string[] = [],
): T {
  const record = asRecord(payload);
  if (!record) return {} as T;
  for (const key of preferredKeys) {
    const value = asRecord(record[key]);
    if (value) return value as T;
  }
  const data = asRecord(record.data);
  if (data) return data as T;
  return record as T;
}

export function parseSmartleadOffsetPage<T extends Record<string, unknown> = Record<string, unknown>>(
  payload: unknown,
  opts: { offset: number; limit: number; itemKeys?: string[] },
): SmartleadOffsetPage<T> {
  const root = asRecord(payload);
  const dataRecord = asRecord(root?.data);
  const items = parseSmartleadItems<T>(payload, opts.itemKeys ?? []);
  const total = readNumber(root, ["total", "total_count", "totalCount", "count"])
    ?? readNumber(dataRecord, ["total", "total_count", "totalCount", "count"]);
  const offset = readNumber(root, ["offset"])
    ?? readNumber(dataRecord, ["offset"])
    ?? opts.offset;
  const limit = readNumber(root, ["limit"])
    ?? readNumber(dataRecord, ["limit"])
    ?? opts.limit;
  const explicitHasMore = root?.has_more ?? root?.hasMore ?? dataRecord?.has_more ?? dataRecord?.hasMore;
  const nextOffset = offset + limit;
  const hasMore = typeof explicitHasMore === "boolean"
    ? explicitHasMore && items.length > 0
    : total != null
      ? nextOffset < total && items.length > 0
      : items.length >= limit && items.length > 0;

  return { items, total, offset, limit, nextOffset, hasMore };
}

class SlidingWindowLimiter {
  private readonly config: RequiredRateLimitConfig;
  private readonly sleep: SleepFn;
  private readonly now: NowFn;
  private readonly timestamps: number[] = [];
  private chain: Promise<void> = Promise.resolve();
  private throttledCount = 0;

  constructor(config: RequiredRateLimitConfig, sleep: SleepFn, now: NowFn) {
    this.config = config;
    this.sleep = sleep;
    this.now = now;
  }

  async acquire(signal?: AbortSignal | null) {
    if (this.config.disabled) return;
    throwIfAborted(signal);
    let release!: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    const wait = this.chain;
    this.chain = wait.catch(() => undefined).then(() => next);
    try {
      await abortable(wait, signal);
      throwIfAborted(signal);
      const waitMs = this.computeWaitMs();
      if (waitMs > 0) {
        this.throttledCount++;
        await appendTraceLog("smartlead.http.throttled", {
          waitMs,
          inBurstWindow: this.countInWindow(this.config.burstWindowMs),
          in60s: this.countInWindow(60_000),
          burstLimit: this.config.burstLimit,
          burstWindowMs: this.config.burstWindowMs,
          limit60s: this.config.perMinute,
        });
        await abortable(this.sleep(waitMs), signal);
      }
      throwIfAborted(signal);
      this.prune();
      this.timestamps.push(this.now());
    } finally {
      release();
    }
  }

  stats(activeRequests: number, queuedRequests: number): SmartleadRateLimitStats {
    this.prune();
    return {
      window_burst_count: this.countInWindow(this.config.burstWindowMs),
      window_60s_count: this.countInWindow(60_000),
      burst_limit: this.config.burstLimit,
      burst_window_ms: this.config.burstWindowMs,
      limit_60s: this.config.perMinute,
      throttled_count: this.throttledCount,
      active_requests: activeRequests,
      queued_requests: queuedRequests,
      window_1s_count: this.countInWindow(1000),
      limit_1s: Math.max(1, Math.floor(this.config.burstLimit * 1000 / this.config.burstWindowMs)),
    };
  }

  private computeWaitMs() {
    this.prune();
    return Math.max(
      this.findWindowFreeTime(this.config.burstWindowMs, this.config.burstLimit),
      this.findWindowFreeTime(60_000, this.config.perMinute),
    );
  }

  private prune() {
    const cutoff = this.now() - Math.max(60_000, this.config.burstWindowMs);
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
  }

  private countInWindow(windowMs: number) {
    const cutoff = this.now() - windowMs;
    let count = 0;
    for (let index = this.timestamps.length - 1; index >= 0; index--) {
      if (this.timestamps[index] >= cutoff) count++;
      else break;
    }
    return count;
  }

  private findWindowFreeTime(windowMs: number, limit: number) {
    if (limit <= 0 || this.timestamps.length < limit) return 0;
    const index = this.timestamps.length - limit;
    return Math.max(0, this.timestamps[index] + windowMs - this.now());
  }
}

class Semaphore {
  private readonly maxConcurrent: number;
  private active = 0;
  private readonly queue: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    signal?: AbortSignal | null;
    onAbort?: () => void;
  }> = [];

  constructor(maxConcurrent: number) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
  }

  async acquire(signal?: AbortSignal | null) {
    throwIfAborted(signal);
    if (this.active < this.maxConcurrent) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const entry = { resolve, reject, signal, onAbort: undefined as (() => void) | undefined };
      entry.onAbort = () => {
        const index = this.queue.indexOf(entry);
        if (index >= 0) this.queue.splice(index, 1);
        reject(abortError(signal));
      };
      signal?.addEventListener("abort", entry.onAbort, { once: true });
      this.queue.push(entry);
    });
  }

  release() {
    this.active--;
    const next = this.queue.shift();
    if (next) {
      if (next.onAbort) next.signal?.removeEventListener("abort", next.onAbort);
      this.active++;
      next.resolve();
    }
  }

  stats() {
    return { active: this.active, queued: this.queue.length };
  }
}

function normalizeRateLimit(config: SmartleadRateLimitConfig = {}): RequiredRateLimitConfig {
  const usePerSecondAlias = config.burstPerSecond != null
    && config.burstLimit == null
    && config.burstWindowMs == null;
  return {
    perMinute: config.perMinute ?? DEFAULT_RATE_LIMIT_PER_MINUTE,
    burstLimit: config.burstLimit ?? config.burstPerSecond ?? DEFAULT_BURST_LIMIT,
    burstWindowMs: config.burstWindowMs ?? (usePerSecondAlias ? 1000 : DEFAULT_BURST_WINDOW_MS),
    maxConcurrent: config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
    disabled: config.disabled ?? false,
  };
}

function normalizeRetry(config: SmartleadRetryConfig = {}): RequiredRetryConfig {
  return {
    attempts: config.attempts ?? DEFAULT_RETRY_ATTEMPTS,
    baseDelayMs: config.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
    maxDelayMs: config.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS,
    jitterRatio: config.jitterRatio ?? DEFAULT_RETRY_JITTER_RATIO,
    statuses: new Set(config.statuses ?? [429, 500, 503]),
  };
}

function rateLimitHeaders(headers: Headers) {
  const values: Record<string, string> = {};
  for (const key of [
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
    "ratelimit-limit",
    "ratelimit-remaining",
    "ratelimit-reset",
  ]) {
    const value = headers.get(key);
    if (value != null) values[key] = value;
  }
  return values;
}

export class SmartleadClient {
  private readonly accessValue: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: SmartleadFetch;
  private readonly sleep: SleepFn;
  private readonly now: NowFn;
  private readonly retry: RequiredRetryConfig;
  private readonly limiter: SlidingWindowLimiter;
  private readonly semaphore: Semaphore;

  constructor(options: SmartleadClientOptions) {
    const accessValue = options.accessValue.trim();
    if (!accessValue) {
      throw new Error("Smartlead access value is required.");
    }
    this.accessValue = accessValue;
    this.baseUrl = options.baseUrl ?? SMARTLEAD_API_BASE;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    this.retry = normalizeRetry(options.retry);
    const rateLimit = normalizeRateLimit(options.rateLimit);
    this.limiter = new SlidingWindowLimiter(rateLimit, this.sleep, this.now);
    this.semaphore = new Semaphore(rateLimit.maxConcurrent);
  }

  buildUrl(path: string, query: QueryParams = {}) {
    return buildSmartleadUrl(path, this.accessValue, query, this.baseUrl);
  }

  redactUrl(input: string | URL) {
    return redactSmartleadUrl(input, [this.accessValue]);
  }

  redactText(input: string) {
    return redactSmartleadText(input, [this.accessValue]);
  }

  getRateLimitStats() {
    const { active, queued } = this.semaphore.stats();
    return this.limiter.stats(active, queued);
  }

  async request(path: string, options: SmartleadRequestOptions = {}): Promise<Response> {
    const url = this.buildUrl(path, options.query);
    const redactedUrl = this.redactUrl(url);
    const init = this.toRequestInit(options);

    for (let attempt = 1; ; attempt++) {
      const startedAt = this.now();
      await appendTraceLog("smartlead.http.request", {
        attempt,
        method: init.method ?? "GET",
        path: url.pathname,
        query: this.redactUrl(url).split("?")[1] ?? "",
      });

      await this.limiter.acquire(init.signal);
      await this.semaphore.acquire(init.signal);
      let response: Response;
      try {
        throwIfAborted(init.signal);
        response = await this.fetchImpl(url, init);
      } catch (error) {
        this.semaphore.release();
        if (isAbortError(error)) {
          throw error;
        }
        if (attempt <= this.retry.attempts) {
          const delayMs = this.backoffDelay(attempt);
          await appendTraceLog("smartlead.http.retry", {
            attempt,
            error: this.redactText(error instanceof Error ? error.message : String(error)),
            delayMs,
            path: url.pathname,
          });
          await abortable(this.sleep(delayMs), init.signal);
          continue;
        }
        throw error instanceof Error
          ? new Error(this.redactText(error.message))
          : new Error("Smartlead request failed.");
      }
      this.semaphore.release();

      if (this.retry.statuses.has(response.status) && attempt <= this.retry.attempts) {
        const body = await response.text().catch(() => "");
        const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"), this.now());
        const bodyRetryMs = retryAfterMs == null ? parseRetryDelayFromBody(body) : null;
        const delayMs = retryAfterMs ?? bodyRetryMs ?? this.backoffDelay(attempt);
        await appendTraceLog("smartlead.http.retry", {
          attempt,
          status: response.status,
          delayMs,
          retryAfterMs,
          bodyRetryMs,
          path: url.pathname,
          elapsedMs: this.now() - startedAt,
          rateLimit: rateLimitHeaders(response.headers),
        });
        await abortable(this.sleep(delayMs), init.signal);
        continue;
      }

      if (!response.ok) {
        const body = this.redactText(await response.text().catch(() => ""));
        await appendTraceLog("smartlead.http.error", {
          attempt,
          status: response.status,
          path: url.pathname,
          elapsedMs: this.now() - startedAt,
          body,
          rateLimit: rateLimitHeaders(response.headers),
        });
        throw new SmartleadApiError(response.status, redactedUrl, body);
      }

      await appendTraceLog("smartlead.http.response", {
        attempt,
        status: response.status,
        path: url.pathname,
        elapsedMs: this.now() - startedAt,
        rateLimit: rateLimitHeaders(response.headers),
      });
      return response;
    }
  }

  async requestJson<T = unknown>(path: string, options: SmartleadRequestOptions = {}): Promise<T> {
    const response = await this.request(path, options);
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  async validateAccess(timeoutMs = 5000): Promise<SmartleadAccessValidation> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const payload = await this.requestJson("/campaigns/", {
        signal: controller.signal,
        query: { include_tags: true },
      });
      const campaigns = parseSmartleadItems(payload, ["campaigns"]);
      return {
        status: "valid",
        message: `Smartlead accepted the access value and returned ${campaigns.length} campaign row${campaigns.length === 1 ? "" : "s"} in the probe.`,
        returned_campaigns: campaigns.length,
      };
    } catch (error) {
      if (error instanceof SmartleadApiError) {
        if (error.status === 401 || error.status === 403) {
          return {
            status: "invalid",
            message: `Smartlead rejected the access value with HTTP ${error.status}.`,
            http_status: error.status,
          };
        }
        return {
          status: "unreachable",
          message: `Smartlead credential probe returned HTTP ${error.status}; retry setup or refresh when connectivity is healthy.`,
          http_status: error.status,
        };
      }
      return {
        status: "unreachable",
        message:
          error instanceof Error
            ? `Smartlead credential probe could not complete: ${this.redactText(error.message)}.`
            : "Smartlead credential probe could not complete.",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async listCampaigns(opts: { includeTags?: boolean; clientId?: string } = {}) {
    const query: QueryParams = { include_tags: opts.includeTags ?? true };
    if (opts.clientId) query.client_id = opts.clientId;
    const payload = await this.requestJson("/campaigns/", { query });
    return parseSmartleadItems(payload, ["campaigns"]);
  }

  async getCampaign(campaignId: string | number) {
    const payload = await this.requestJson(`/campaigns/${encodeURIComponent(String(campaignId))}`, {
      query: { include_tags: true },
    });
    return unwrapSmartleadRecord(payload, ["campaign"]);
  }

  async getCampaignSequences(campaignId: string | number) {
    const payload = await this.requestJson(`/campaigns/${encodeURIComponent(String(campaignId))}/sequences`);
    return parseSmartleadItems(payload, ["sequences"]);
  }

  async getCampaignAnalytics(campaignId: string | number) {
    const payload = await this.requestJson(`/campaigns/${encodeURIComponent(String(campaignId))}/analytics`);
    return unwrapSmartleadRecord(payload, ["analytics"]);
  }

  async getCampaignAnalyticsByDate(
    campaignId: string | number,
    opts: { startDate: string; endDate: string },
  ) {
    return this.requestJson(`/campaigns/${encodeURIComponent(String(campaignId))}/analytics-by-date`, {
      query: { start_date: opts.startDate, end_date: opts.endDate },
    });
  }

  async listCampaignStatisticsPage(
    campaignId: string | number,
    opts: {
      offset?: number;
      limit?: number;
      emailSequenceNumber?: number;
      emailStatus?: string;
      sentTimeGt?: string;
      sentTimeLt?: string;
    } = {},
  ) {
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 1000;
    const query: QueryParams = {
      offset,
      limit,
      email_sequence_number: opts.emailSequenceNumber,
      email_status: opts.emailStatus,
      sent_time_gt: opts.sentTimeGt,
      sent_time_lt: opts.sentTimeLt,
    };
    const payload = await this.requestJson(`/campaigns/${encodeURIComponent(String(campaignId))}/statistics`, {
      query,
    });
    return parseSmartleadOffsetPage(payload, {
      offset,
      limit,
      itemKeys: ["statistics", "email_statistics", "data"],
    });
  }

  async listAllCampaignStatistics(
    campaignId: string | number,
    opts: { limit?: number; maxPages?: number } = {},
  ) {
    return this.listOffsetPaginated(`/campaigns/${encodeURIComponent(String(campaignId))}/statistics`, {
      limit: opts.limit ?? 1000,
      maxPages: opts.maxPages,
      itemKeys: ["statistics", "email_statistics", "data"],
    });
  }

  async listCampaignMailboxStatisticsPage(
    campaignId: string | number,
    opts: { offset?: number; limit?: number; startDate?: string; endDate?: string; timezone?: string } = {},
  ) {
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 20;
    const payload = await this.requestJson(
      `/campaigns/${encodeURIComponent(String(campaignId))}/mailbox-statistics`,
      {
        query: {
          offset,
          limit,
          start_date: opts.startDate,
          end_date: opts.endDate,
          timezone: opts.timezone,
        },
      },
    );
    return parseSmartleadOffsetPage(payload, {
      offset,
      limit,
      itemKeys: ["mailbox_statistics", "statistics", "data"],
    });
  }

  async listAllCampaignMailboxStatistics(
    campaignId: string | number,
    opts: { limit?: number; maxPages?: number; startDate?: string; endDate?: string; timezone?: string } = {},
  ) {
    return this.listOffsetPaginated(
      `/campaigns/${encodeURIComponent(String(campaignId))}/mailbox-statistics`,
      {
        limit: opts.limit ?? 20,
        maxPages: opts.maxPages,
        query: {
          start_date: opts.startDate,
          end_date: opts.endDate,
          timezone: opts.timezone,
        },
        itemKeys: ["mailbox_statistics", "statistics", "data"],
      },
    );
  }

  async listCampaignEmailAccounts(campaignId: string | number) {
    const payload = await this.requestJson(`/campaigns/${encodeURIComponent(String(campaignId))}/email-accounts`);
    return parseSmartleadItems(payload, ["email_accounts", "accounts"]);
  }

  async listEmailAccountsPage(
    opts: { offset?: number; limit?: number; fetchCampaigns?: boolean } = {},
  ) {
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? DEFAULT_PAGE_LIMIT;
    const payload = await this.requestJson("/email-accounts/", {
      query: {
        offset,
        limit,
        fetch_campaigns: opts.fetchCampaigns,
      },
    });
    return parseSmartleadOffsetPage(payload, {
      offset,
      limit,
      itemKeys: ["email_accounts", "accounts"],
    });
  }

  async listAllEmailAccounts(opts: { limit?: number; maxPages?: number; fetchCampaigns?: boolean } = {}) {
    return this.listOffsetPaginated("/email-accounts/", {
      limit: opts.limit ?? DEFAULT_PAGE_LIMIT,
      maxPages: opts.maxPages,
      query: { fetch_campaigns: opts.fetchCampaigns },
      itemKeys: ["email_accounts", "accounts"],
    });
  }

  async getEmailAccountWarmupStats(emailAccountId: string | number) {
    return this.requestJson(`/email-accounts/${encodeURIComponent(String(emailAccountId))}/warmup-stats`);
  }

  async listCampaignLeadsPage(
    campaignId: string | number,
    opts: {
      offset?: number;
      limit?: number;
      status?: string;
      emailStatus?: string;
      leadCategoryId?: string | number;
    } = {},
  ) {
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? DEFAULT_PAGE_LIMIT;
    const payload = await this.requestJson(`/campaigns/${encodeURIComponent(String(campaignId))}/leads`, {
      query: {
        offset,
        limit,
        status: opts.status,
        emailStatus: opts.emailStatus,
        lead_category_id: opts.leadCategoryId,
      },
    });
    return parseSmartleadOffsetPage(payload, { offset, limit, itemKeys: ["leads"] });
  }

  async listAllCampaignLeads(
    campaignId: string | number,
    opts: { limit?: number; maxPages?: number; status?: string; emailStatus?: string; leadCategoryId?: string | number } = {},
  ) {
    return this.listOffsetPaginated(`/campaigns/${encodeURIComponent(String(campaignId))}/leads`, {
      limit: opts.limit ?? DEFAULT_PAGE_LIMIT,
      maxPages: opts.maxPages,
      query: {
        status: opts.status,
        emailStatus: opts.emailStatus,
        lead_category_id: opts.leadCategoryId,
      },
      itemKeys: ["leads"],
    });
  }

  async getLead(leadId: string | number) {
    const payload = await this.requestJson(`/leads/${encodeURIComponent(String(leadId))}`);
    return unwrapSmartleadRecord(payload, ["lead"]);
  }

  async lookupLeadByEmail(email: string) {
    const payload = await this.requestJson("/leads/", { query: { email } });
    return parseSmartleadItems(payload, ["leads"]);
  }

  async getMessageHistory(
    campaignId: string | number,
    leadId: string | number,
    opts: { eventTimeGt?: string; showPlainTextResponse?: boolean } = {},
  ) {
    const payload = await this.requestJson(
      `/campaigns/${encodeURIComponent(String(campaignId))}/leads/${encodeURIComponent(String(leadId))}/message-history`,
      {
        query: {
          event_time_gt: opts.eventTimeGt,
          show_plain_text_response: opts.showPlainTextResponse ?? true,
        },
      },
    );
    return parseSmartleadItems(payload, ["messages"]);
  }

  async getBulkMessageHistory(
    campaignId: string | number,
    leadIds: Array<string | number>,
    opts: { eventTimeGt?: string; showPlainTextResponse?: boolean } = {},
  ) {
    return this.requestJson(
      `/campaigns/${encodeURIComponent(String(campaignId))}/message-history-for-leads/${BULK_MESSAGE_HISTORY_SUFFIX}`,
      {
        method: "POST",
        query: {
          event_time_gt: opts.eventTimeGt,
          show_plain_text_response: opts.showPlainTextResponse ?? true,
        },
        json: { lead_ids: leadIds },
      },
    );
  }

  async getOverallStats(opts: { startDate: string; endDate: string; timezone?: string; campaignIds?: Array<string | number>; clientId?: string | number }) {
    return this.requestJson("/analytics/overall-stats-v2", {
      query: {
        start_date: opts.startDate,
        end_date: opts.endDate,
        timezone: opts.timezone,
        campaign_ids: opts.campaignIds?.join(","),
        client_id: opts.clientId,
      },
    });
  }

  async getCampaignPerformanceStats(opts: { startDate: string; endDate: string; timezone?: string; limit?: number; offset?: number; campaignIds?: Array<string | number>; clientId?: string | number }) {
    return this.requestJson("/analytics/campaign/overall-stats", {
      query: {
        start_date: opts.startDate,
        end_date: opts.endDate,
        timezone: opts.timezone,
        limit: opts.limit,
        offset: opts.offset,
        campaign_ids: opts.campaignIds?.join(","),
        client_id: opts.clientId,
      },
    });
  }

  async getProviderPerformanceStats(opts: { startDate: string; endDate: string; timezone?: string; campaignIds?: Array<string | number>; clientId?: string | number }) {
    return this.requestJson("/analytics/mailbox/provider-wise-overall-performance", {
      query: {
        start_date: opts.startDate,
        end_date: opts.endDate,
        timezone: opts.timezone,
        campaign_ids: opts.campaignIds?.join(","),
        client_id: opts.clientId,
      },
    });
  }

  private async listOffsetPaginated(
    path: string,
    opts: { query?: QueryParams; itemKeys?: string[]; limit: number; maxPages?: number },
  ) {
    const all: Array<Record<string, unknown>> = [];
    let offset = 0;
    const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
    const seenOffsets = new Set<number>();

    for (let page = 0; page < maxPages; page++) {
      if (seenOffsets.has(offset)) break;
      seenOffsets.add(offset);
      const payload = await this.requestJson(path, {
        query: {
          ...opts.query,
          offset,
          limit: opts.limit,
        },
      });
      const parsed = parseSmartleadOffsetPage(payload, {
        offset,
        limit: opts.limit,
        itemKeys: opts.itemKeys,
      });
      all.push(...parsed.items);
      if (!parsed.hasMore) break;
      offset = parsed.nextOffset;
    }

    return all;
  }

  private toRequestInit(options: SmartleadRequestOptions): RequestInit {
    const headers = new Headers(options.headers);
    if (!headers.has("accept")) headers.set("accept", "application/json");
    let body = options.body;
    if (options.json !== undefined) {
      body = JSON.stringify(options.json);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
    }
    return {
      ...options,
      headers,
      body,
    };
  }

  private backoffDelay(attempt: number) {
    const base = Math.min(
      this.retry.baseDelayMs * Math.pow(2, attempt - 1),
      this.retry.maxDelayMs,
    );
    if (this.retry.jitterRatio <= 0) return base;
    return Math.min(
      this.retry.maxDelayMs,
      Math.round(base + (Math.random() * base * this.retry.jitterRatio)),
    );
  }
}

export function createSmartleadClient(
  accessValue: string,
  options: Omit<SmartleadClientOptions, "accessValue"> = {},
) {
  return new SmartleadClient({ ...options, accessValue });
}
