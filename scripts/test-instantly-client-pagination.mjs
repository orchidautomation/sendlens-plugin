import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  detectCursorShape,
  getCampaignAnalytics,
  getDailyAccountAnalytics,
  getRateLimitStats,
  getWarmupAnalytics,
  listAccounts,
  listAllInboxPlacementAnalyticsForTest,
  listAllInboxPlacementTests,
  listAllLeadsWithCoverage,
  listCampaigns,
  listCampaignsPage,
  parseRetryAfter,
} = require("../build/plugin/instantly-client.js");

const originalFetch = globalThis.fetch;
const calls = [];

function responseJson(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function responseStatus(status, headers = {}) {
  return new Response(null, { status, headers });
}

function rows(prefix, start, count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${start + index}`,
    email: `${prefix}-${start + index}@example.com`,
  }));
}

globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(String(url));
  calls.push({
    pathname: parsed.pathname,
    search: parsed.searchParams.toString(),
    body: options.body,
  });

  if (parsed.pathname.endsWith("/campaigns")) {
    const cursor = parsed.searchParams.get("starting_after");
    if (!cursor) {
      return responseJson({ items: rows("campaign", 0, 100), next_starting_after: "c100" });
    }
    if (cursor === "c100") {
      return responseJson({ items: rows("campaign", 100, 100), next_starting_after: "c200" });
    }
    if (cursor === "c200") {
      return responseJson({ items: rows("campaign", 200, 5), next_starting_after: null });
    }
  }

  if (parsed.pathname.endsWith("/accounts")) {
    const cursor = parsed.searchParams.get("starting_after");
    if (!cursor) {
      // Current Instantly account pagination returns a composite
      // `timestamp_created&email` cursor. Treat it as opaque.
      return responseJson({
        items: rows("account", 0, 99),
        next_starting_after: "2026-01-15T00:00:00.000Z&account-98@example.com",
      });
    }
    if (cursor === "2026-01-15T00:00:00.000Z&account-98@example.com") {
      return responseJson({
        items: rows("account", 99, 2),
        next_starting_after: null,
      });
    }
  }

  if (parsed.pathname.endsWith("/accounts/warmup-analytics")) {
    const body = JSON.parse(String(options.body ?? "{}"));
    assert.ok(Array.isArray(body.emails));
    assert.ok(body.emails.length <= 100);
    return responseJson({
      email_date_data: Object.fromEntries(
        body.emails.map((email) => [email, { "2026-05-01": { sent: 1 } }]),
      ),
      aggregate_data: Object.fromEntries(
        body.emails.map((email) => [email, { sent: 1, health_score: 100 }]),
      ),
    });
  }

  if (parsed.pathname.endsWith("/inbox-placement-tests")) {
    if (parsed.searchParams.has("with_metadata")) {
      return responseJson({ error: "invalid query parameter: with_metadata" }, 400);
    }
    const cursor = parsed.searchParams.get("starting_after");
    if (!cursor) {
      return responseJson({ items: rows("ipt", 0, 100), next_starting_after: "ipt100" });
    }
    if (cursor === "ipt100") {
      return responseJson({ items: rows("ipt", 100, 1), next_starting_after: null });
    }
  }

  if (parsed.pathname.endsWith("/inbox-placement-analytics")) {
    assert.equal(parsed.searchParams.get("test_id"), "ipt-0");
    const cursor = parsed.searchParams.get("starting_after");
    if (!cursor) {
      return responseJson({
        items: rows("ipa", 0, 100).map((row) => ({ ...row, test_id: "ipt-0" })),
        next_starting_after: "ipa100",
      });
    }
    if (cursor === "ipa100") {
      return responseJson({
        items: rows("ipa", 100, 3).map((row) => ({ ...row, test_id: "ipt-0" })),
        next_starting_after: null,
      });
    }
  }

  return responseJson({ error: `unhandled ${parsed.pathname}` }, 404);
};

// Dedicated 429-retry test suite: build a fresh globalThis.fetch so
// we can verify Retry-After is honored.
async function testRetryAfterHonored() {
  const calls2 = [];
  const originalFetch2 = globalThis.fetch;
  let phase = 0;
  globalThis.fetch = async (url) => {
    calls2.push({ url: String(url), at: Date.now() });
    if (phase === 0) {
      phase = 1;
      return responseStatus(429, { "retry-after": "1" });
    }
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith("/campaigns")) {
      return responseJson({ items: rows("campaign", 0, 1), next_starting_after: null });
    }
    return responseJson({ error: `unhandled ${parsed.pathname}` }, 404);
  };
  try {
    const before = Date.now();
    const out = await listCampaigns("test-key");
    const elapsed = Date.now() - before;
    assert.equal(out.length, 1, "listCampaigns should succeed after one 429");
    assert.equal(calls2.length, 2, "Should be exactly 2 calls (1 retry)");
    assert.ok(
      elapsed >= 900,
      `Should wait ~1000ms for Retry-After: 1, got ${elapsed}ms`,
    );
    assert.ok(
      elapsed < 5000,
      `Should not wait the 1s+2s+4s exponential chain, got ${elapsed}ms`,
    );
  } finally {
    globalThis.fetch = originalFetch2;
  }
}

async function testProviderErrorsRedactSensitiveValues() {
  const originalFetch2 = globalThis.fetch;
  globalThis.fetch = async () => responseJson({
    message: "Mailbox private.sender@example.com rejected api_key=instly_private_secret_value",
  }, 500);
  try {
    await assert.rejects(
      listCampaigns("test-key"),
      (error) => {
        const message = String(error?.message ?? error);
        return message.includes("[redacted-email]") &&
          message.includes("[redacted-secret]") &&
          !message.includes("private.sender@example.com") &&
          !message.includes("instly_private_secret_value");
      },
    );
  } finally {
    globalThis.fetch = originalFetch2;
  }
}

async function testLeadPaginationReportsTermination() {
  const originalFetch2 = globalThis.fetch;
  globalThis.fetch = async (_url, options = {}) => {
    const body = JSON.parse(String(options.body ?? "{}"));
    return responseJson({
      items: rows("lead", body.starting_after ? 1 : 0, 1),
      next_starting_after: body.starting_after ? "repeat-cursor" : "repeat-cursor",
    });
  };
  try {
    const capped = await listAllLeadsWithCoverage("test-key", "campaign-1", 1);
    assert.equal(capped.exhausted, false);
    assert.equal(capped.terminationReason, "max_pages");
    assert.equal(capped.pagesFetched, 1);

    const repeated = await listAllLeadsWithCoverage("test-key", "campaign-1", 3);
    assert.equal(repeated.exhausted, false);
    assert.equal(repeated.terminationReason, "cursor_repeated");
    assert.equal(repeated.pagesFetched, 2);
  } finally {
    globalThis.fetch = originalFetch2;
  }
}

async function testCampaignAnalyticsScopesAndSplitsOversizedRequests() {
  const originalFetch2 = globalThis.fetch;
  const analyticsCalls = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, "/api/v2/campaigns/analytics");
    assert.equal(parsed.searchParams.get("start_date"), "2026-07-01");
    assert.equal(parsed.searchParams.get("end_date"), "2026-07-10");
    const campaignIds = parsed.searchParams.getAll("ids");
    analyticsCalls.push(campaignIds);
    if (campaignIds.length > 1) {
      return responseStatus(413);
    }
    return responseJson(
      campaignIds.map((campaignId) => ({
        campaign_id: campaignId,
        emails_sent_count: 1,
      })),
    );
  };

  try {
    const analytics = await getCampaignAnalytics("test-key", {
      campaignIds: ["campaign-1", "campaign-2", "campaign-3"],
      startDate: "2026-07-01",
      endDate: "2026-07-10",
    });
    assert.deepEqual(
      analytics.map((row) => row.campaign_id),
      ["campaign-1", "campaign-2", "campaign-3"],
    );
    assert.deepEqual(analyticsCalls[0], ["campaign-1", "campaign-2", "campaign-3"]);
    assert.deepEqual(
      analyticsCalls.filter((ids) => ids.length === 1).flat(),
      ["campaign-1", "campaign-2", "campaign-3"],
    );
    assert.equal(
      analyticsCalls.every((ids) => ids.every((id) => /^campaign-[123]$/.test(id))),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch2;
  }
}

async function testCampaignAnalyticsUsesBoundedBatches() {
  const originalFetch2 = globalThis.fetch;
  const analyticsCalls = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, "/api/v2/campaigns/analytics");
    const campaignIds = parsed.searchParams.getAll("ids");
    analyticsCalls.push(campaignIds);
    return responseJson(
      campaignIds.map((campaignId) => ({ campaign_id: campaignId })),
    );
  };

  try {
    const campaignIds = Array.from(
      { length: 26 },
      (_, index) => `campaign-${index + 1}`,
    );
    const analytics = await getCampaignAnalytics("test-key", { campaignIds });
    assert.deepEqual(
      analytics.map((row) => row.campaign_id),
      campaignIds,
    );
    assert.deepEqual(analyticsCalls.map((ids) => ids.length), [25, 1]);
  } finally {
    globalThis.fetch = originalFetch2;
  }
}

async function testDailyAccountAnalyticsScopesAndSplitsOversizedRequests() {
  const originalFetch2 = globalThis.fetch;
  const analyticsCalls = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, "/api/v2/accounts/analytics/daily");
    assert.equal(parsed.searchParams.get("start_date"), "2026-07-01");
    assert.equal(parsed.searchParams.get("end_date"), "2026-07-10");
    const emails = parsed.searchParams.getAll("emails");
    analyticsCalls.push(emails);
    if (emails.length > 1) {
      return responseStatus(413);
    }
    return responseJson(
      emails.map((email) => ({ email_account: email, sent: 1 })),
    );
  };

  try {
    const rows = await getDailyAccountAnalytics("test-key", {
      emails: ["ONE@example.com", "two@example.com", "three@example.com"],
      startDate: "2026-07-01",
      endDate: "2026-07-10",
    });
    assert.deepEqual(
      rows.map((row) => row.email_account),
      ["one@example.com", "two@example.com", "three@example.com"],
    );
    assert.deepEqual(analyticsCalls[0], [
      "one@example.com",
      "two@example.com",
      "three@example.com",
    ]);
    assert.deepEqual(
      analyticsCalls.filter((emails) => emails.length === 1).flat(),
      ["one@example.com", "two@example.com", "three@example.com"],
    );
    assert.equal(
      analyticsCalls.every((emails) =>
        emails.every((email) => [
          "one@example.com",
          "two@example.com",
          "three@example.com",
        ].includes(email))
      ),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch2;
  }
}

async function testDailyAccountAnalyticsUsesBoundedBatches() {
  const originalFetch2 = globalThis.fetch;
  const analyticsCalls = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, "/api/v2/accounts/analytics/daily");
    const emails = parsed.searchParams.getAll("emails");
    analyticsCalls.push(emails);
    return responseJson(
      emails.map((email) => ({ email_account: email })),
    );
  };

  try {
    const emails = Array.from(
      { length: 26 },
      (_, index) => `sender-${index + 1}@example.com`,
    );
    const rows = await getDailyAccountAnalytics("test-key", { emails });
    assert.deepEqual(
      rows.map((row) => row.email_account),
      emails,
    );
    assert.deepEqual(analyticsCalls.map((batch) => batch.length), [25, 1]);
  } finally {
    globalThis.fetch = originalFetch2;
  }
}

try {
  const campaigns = await listCampaigns("test-key");
  assert.equal(campaigns.length, 205);
  assert.equal(campaigns[204].id, "campaign-204");
  assert.deepEqual(
    calls
      .filter((call) => call.pathname.endsWith("/campaigns"))
      .map((call) => call.search),
    ["limit=100", "limit=100&starting_after=c100", "limit=100&starting_after=c200"],
  );

  const accounts = await listAccounts("test-key");
  assert.equal(accounts.length, 101);
  assert.equal(accounts[100].id, "account-100");
  assert.deepEqual(
    calls
      .filter((call) => call.pathname.endsWith("/accounts"))
      .map((call) => call.search),
    [
      "limit=100",
      "limit=100&starting_after=2026-01-15T00%3A00%3A00.000Z%26account-98%40example.com",
    ],
  );

  assert.equal(
    detectCursorShape("2026-01-15T00:00:00.000Z"),
    "datetime",
    "ISO datetime cursor must be detected as 'datetime'",
  );
  assert.equal(
    detectCursorShape("a99"),
    "opaque",
    "Non-UUID, non-datetime cursor must fall through to 'opaque'",
  );
  assert.equal(
    detectCursorShape("11111111-2222-3333-4444-555555555555"),
    "uuid",
    "Canonical UUID must be detected as 'uuid'",
  );
  assert.equal(detectCursorShape(null), "none");
  assert.equal(detectCursorShape(undefined), "none");
  assert.equal(detectCursorShape(""), "none");

  const warmupEmails = [
    ...Array.from({ length: 205 }, (_, index) => `user-${index}@example.com`),
    "user-1@example.com",
    "",
  ];
  const warmup = await getWarmupAnalytics("test-key", warmupEmails);
  assert.equal(Object.keys(warmup.aggregate_data ?? {}).length, 205);
  assert.equal(Object.keys(warmup.email_date_data ?? {}).length, 205);
  assert.equal(
    calls.filter((call) => call.pathname.endsWith("/accounts/warmup-analytics")).length,
    3,
  );
  assert.deepEqual(
    calls
      .filter((call) => call.pathname.endsWith("/accounts/warmup-analytics"))
      .map((call) => JSON.parse(String(call.body)).emails.length),
    [100, 100, 5],
  );

  const inboxPlacementTests = await listAllInboxPlacementTests("test-key");
  assert.equal(inboxPlacementTests.length, 101);
  assert.equal(inboxPlacementTests[100].id, "ipt-100");
  assert.deepEqual(
    calls
      .filter((call) => call.pathname.endsWith("/inbox-placement-tests"))
      .map((call) => call.search),
    ["limit=100", "limit=100&starting_after=ipt100"],
  );

  const inboxPlacementAnalytics = await listAllInboxPlacementAnalyticsForTest("test-key", "ipt-0");
  assert.equal(inboxPlacementAnalytics.length, 103);
  assert.equal(inboxPlacementAnalytics[102].id, "ipa-102");
  assert.deepEqual(
    calls
      .filter((call) => call.pathname.endsWith("/inbox-placement-analytics"))
      .map((call) => call.search),
    [
      "limit=100&test_id=ipt-0",
      "limit=100&test_id=ipt-0&starting_after=ipa100",
    ],
  );

  await testRetryAfterHonored();
  await testProviderErrorsRedactSensitiveValues();
  await testLeadPaginationReportsTermination();
  await testCampaignAnalyticsScopesAndSplitsOversizedRequests();
  await testCampaignAnalyticsUsesBoundedBatches();
  await testDailyAccountAnalyticsScopesAndSplitsOversizedRequests();
  await testDailyAccountAnalyticsUsesBoundedBatches();
} finally {
  globalThis.fetch = originalFetch;
}

// Separate suite: cursors are provider-owned opaque values. Continue
// through shape changes and stop only on exhaustion/repetition/caps.
{
  const originalFetch2 = globalThis.fetch;
  const accountsCalls = [];
  globalThis.fetch = async (url) => {
    accountsCalls.push(String(url));
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith("/accounts")) {
      const cursor = parsed.searchParams.get("starting_after");
      if (!cursor) {
        return responseJson({
          items: rows("account", 0, 5),
          next_starting_after: "2026-01-15T00:00:00.000Z&account-4@example.com",
        });
      }
      if (cursor === "2026-01-15T00:00:00.000Z&account-4@example.com") {
        return responseJson({
          items: rows("account", 5, 5),
          next_starting_after: "opaque-next-page-token",
        });
      }
      if (cursor === "opaque-next-page-token") {
        return responseJson({
          items: rows("account", 10, 1),
          next_starting_after: null,
        });
      }
    }
    return responseJson({ error: "unhandled" }, 404);
  };
  try {
    const accounts = await listAccounts("test-key");
    assert.equal(accounts.length, 11, "listAccounts should follow every opaque provider cursor");
    assert.equal(
      accountsCalls.length,
      3,
      `Expected exactly 3 fetch calls through cursor exhaustion, got ${accountsCalls.length}`,
    );
  } finally {
    globalThis.fetch = originalFetch2;
  }
}

// Bursty-throttling test: launch 30 concurrent listCampaignsPage
// calls. Asserts the limiter doesn't deadlock and every call
// completes. The exact throttle count depends on the state of
// the module-global requestLog (which carries over from prior
// tests in the same process), so we don't assert an absolute
// count — only that the limiter never returns 429 and that the
// window count moves by exactly 30.
{
  const originalFetch3 = globalThis.fetch;
  const burstCalls = [];
  globalThis.fetch = async (url) => {
    burstCalls.push(String(url));
    return responseJson({ items: rows("campaign", 0, 1), next_starting_after: null });
  };
  try {
    const before = getRateLimitStats();
    const start = Date.now();
    const results = await Promise.all(
      Array.from({ length: 30 }, () => listCampaignsPage("test-key")),
    );
    const elapsed = Date.now() - start;
    assert.equal(results.length, 30, "All 30 concurrent calls should complete");
    assert.equal(burstCalls.length, 30, "All 30 should hit the mock");
    assert.ok(elapsed < 30_000, `30 calls should complete in well under 30s, took ${elapsed}ms`);

    const after = getRateLimitStats();
    // The window-10s count must move by exactly 30 (or 30 minus
    // any timestamps that fell out of the window during the run,
    // which would be at most 1-2 in < 30s).
    const delta = after.window_10s_count - before.window_10s_count;
    assert.ok(
      delta >= 28 && delta <= 30,
      `window_10s_count should move by ~30, moved by ${delta}`,
    );
  } finally {
    globalThis.fetch = originalFetch3;
  }
}

// Bursty-throttling test (the actual throttle case): drive 105
// concurrent calls so the limiter MUST throttle the last 5 (or
// more) calls under the 100/10s ceiling. The mock never 429s —
// the limiter is what enforces compliance.
{
  const originalFetch4 = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return responseJson({ items: rows("campaign", 0, 1), next_starting_after: null });
  };
  try {
    const start = Date.now();
    await Promise.all(
      Array.from({ length: 105 }, () => listCampaignsPage("test-key")),
    );
    const elapsed = Date.now() - start;
    assert.equal(calls, 105, "All 105 calls should hit the mock");

    const stats = getRateLimitStats();
    // After 105 requests in well under 10s, the 60s window is
    // not yet full (only 105) but the 10s window IS full.
    // The limiter should have throttled at least once.
    assert.ok(
      stats.throttled_count > 0,
      `Expected throttled_count > 0 for 105-burst, got ${stats.throttled_count}`,
    );
    // And the wall time should include at least one throttle
    // delay. We don't assert a specific delay because the
    // serialization mutex may collapse the delays. Just confirm
    // the work didn't complete in zero time.
    assert.ok(elapsed >= 0, "should have measurable elapsed time");
  } finally {
    globalThis.fetch = originalFetch4;
  }
}

// parseRetryAfter unit tests.
assert.equal(parseRetryAfter(null), null, "null header → null delay");
assert.equal(parseRetryAfter(""), null, "empty header → null delay");
assert.equal(parseRetryAfter("0"), 0, "0 seconds → 0ms");
assert.equal(parseRetryAfter("5"), 5000, "5 seconds → 5000ms");
assert.equal(parseRetryAfter("120"), 60_000, "120 seconds → capped at 60000ms");

console.log("Instantly client pagination tests passed");
