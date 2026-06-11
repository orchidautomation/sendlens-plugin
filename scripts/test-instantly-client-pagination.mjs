import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  detectCursorShape,
  getWarmupAnalytics,
  listAccounts,
  listAllInboxPlacementAnalyticsForTest,
  listAllInboxPlacementTests,
  listCampaigns,
} = require("../build/plugin/instantly-client.js");

const originalFetch = globalThis.fetch;
const calls = [];

function responseJson(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
      // Instantly's /accounts returns a *datetime* cursor in
      // `next_starting_after`, unlike /campaigns which returns a UUID.
      return responseJson({
        items: rows("account", 0, 99),
        next_starting_after: "2026-01-15T00:00:00.000Z",
      });
    }
    if (cursor === "2026-01-15T00:00:00.000Z") {
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
      "limit=100&starting_after=2026-01-15T00%3A00%3A00.000Z",
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
} finally {
  globalThis.fetch = originalFetch;
}

// Separate suite: listAccounts must STOP paginating when the cursor
// shape changes away from datetime. Without this, a future Instantly
// API change would silently skip rows.
{
  const originalFetch2 = globalThis.fetch;
  const accountsCalls = [];
  globalThis.fetch = async (url) => {
    accountsCalls.push(String(url));
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith("/accounts")) {
      const cursor = parsed.searchParams.get("starting_after");
      if (!cursor) {
        // First page is fine, returns a datetime cursor.
        return responseJson({
          items: rows("account", 0, 5),
          next_starting_after: "2026-01-15T00:00:00.000Z",
        });
      }
      if (cursor === "2026-01-15T00:00:00.000Z") {
        // Second page returns a UUID (unexpected!). The client
        // should detect this and stop.
        return responseJson({
          items: rows("account", 5, 5),
          next_starting_after: "11111111-2222-3333-4444-555555555555",
        });
      }
      if (cursor === "11111111-2222-3333-4444-555555555555") {
        // If the client doesn't stop, this third page would
        // return more data. The test below asserts we never get
        // here.
        return responseJson({
          items: rows("account", 10, 100),
          next_starting_after: null,
        });
      }
    }
    return responseJson({ error: "unhandled" }, 404);
  };
  try {
    const accounts = await listAccounts("test-key");
    assert.equal(accounts.length, 10, "listAccounts should stop after detecting wrong cursor shape");
    assert.equal(
      accountsCalls.length,
      2,
      `Expected exactly 2 fetch calls (1st page + 2nd page that returned the bad cursor), got ${accountsCalls.length}`,
    );
  } finally {
    globalThis.fetch = originalFetch2;
  }
}

console.log("Instantly client pagination tests passed");
