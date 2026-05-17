import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  getWarmupAnalytics,
  listAccounts,
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
      return responseJson({ items: rows("account", 0, 99), next_cursor: "a99" });
    }
    if (cursor === "a99") {
      return responseJson({ items: rows("account", 99, 2), next_cursor: null });
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
    ["limit=100", "limit=100&starting_after=a99"],
  );

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
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Instantly client pagination tests passed");
