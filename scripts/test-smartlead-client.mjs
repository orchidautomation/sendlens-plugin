import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  SmartleadApiError,
  SmartleadClient,
  SMARTLEAD_ACCESS_PARAM,
  buildSmartleadUrl,
  parseRetryAfter,
  parseRetryDelayFromBody,
  parseSmartleadItems,
  parseSmartleadOffsetPage,
  redactSmartleadText,
  redactSmartleadUrl,
} = require("../build/plugin/smartlead-client.js");

const accessValue = "fixture-access-value";
const fixtureRoot = new URL("./fixtures/smartlead-client/", import.meta.url);

async function fixture(name) {
  return JSON.parse(await fs.readFile(new URL(name, fixtureRoot), "utf8"));
}

function responseJson(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function responseText(text, status = 200, headers = {}) {
  return new Response(text, { status, headers });
}

function nextImmediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function waitForFixtureSignal(label, predicate, maxTicks = 100) {
  for (let tick = 0; tick < maxTicks; tick++) {
    if (predicate()) return;
    await nextImmediate();
  }
  if (predicate()) return;
  throw new Error(`Timed out waiting for fixture signal: ${label}`);
}

function makeClient(fetchImpl, options = {}) {
  return new SmartleadClient({
    accessValue,
    fetchImpl,
    rateLimit: options.rateLimit ?? { disabled: true },
    retry: {
      attempts: 2,
      baseDelayMs: 10,
      maxDelayMs: 60_000,
      jitterRatio: 0,
      ...(options.retry ?? {}),
    },
    sleep: options.sleep,
    now: options.now,
    timeoutMs: options.timeoutMs,
  });
}

function assertAccessQuery(url) {
  const parsed = new URL(String(url));
  assert.equal(parsed.searchParams.get(SMARTLEAD_ACCESS_PARAM), accessValue);
  return parsed;
}

{
  const url = buildSmartleadUrl("/campaigns/", accessValue, { include_tags: true });
  assert.equal(url.origin, "https://server.smartlead.ai");
  assert.equal(url.pathname, "/api/v1/campaigns/");
  assert.equal(url.searchParams.get(SMARTLEAD_ACCESS_PARAM), accessValue);
  assert.equal(url.searchParams.get("include_tags"), "true");

  const redacted = redactSmartleadUrl(url, [accessValue]);
  assert.doesNotMatch(redacted, new RegExp(accessValue));
  assert.match(redacted, new RegExp(`${SMARTLEAD_ACCESS_PARAM}=`));
  assert.match(redactSmartleadText(`url?${SMARTLEAD_ACCESS_PARAM}=${accessValue}`, [accessValue]), /\[REDACTED\]/);
}

{
  const directCampaigns = await fixture("campaigns.direct-array.json");
  const wrappedCampaigns = await fixture("campaigns.wrapped-data.json");
  assert.equal(parseSmartleadItems(directCampaigns, ["campaigns"]).length, 2);
  assert.equal(parseSmartleadItems(wrappedCampaigns, ["campaigns"]).length, 2);

  const directClient = makeClient(async (url) => {
    const parsed = assertAccessQuery(url);
    assert.equal(parsed.pathname, "/api/v1/campaigns/");
    assert.equal(parsed.searchParams.get("include_tags"), "true");
    return responseJson(directCampaigns);
  });
  const directOut = await directClient.listCampaigns();
  assert.equal(directOut.length, 2);
  assert.equal(directOut[0].id, 101);
  assert.deepEqual(directOut[0].tags[0], { tag_id: 1, tag_name: "ICP A", tag_color: "#2563eb" });

  const wrappedClient = makeClient(async (url) => {
    const parsed = assertAccessQuery(url);
    assert.equal(parsed.pathname, "/api/v1/campaigns/");
    return responseJson(wrappedCampaigns);
  });
  const wrappedOut = await wrappedClient.listCampaigns();
  assert.equal(wrappedOut.length, 2);
  assert.equal(wrappedOut[1].id, 202);
}

{
  const pages = new Map([
    ["0", await fixture("campaign-leads.page-0.json")],
    ["2", await fixture("campaign-leads.page-2.json")],
    ["4", await fixture("campaign-leads.page-4.json")],
  ]);
  const calls = [];
  const client = makeClient(async (url) => {
    const parsed = assertAccessQuery(url);
    assert.equal(parsed.pathname, "/api/v1/campaigns/101/leads");
    const offset = parsed.searchParams.get("offset") ?? "0";
    calls.push(parsed.searchParams.toString());
    return responseJson(pages.get(offset) ?? { total: 5, offset: Number(offset), limit: 2, leads: [] });
  });

  const leads = await client.listAllCampaignLeads(101, { limit: 2 });
  assert.equal(leads.length, 5);
  assert.equal(leads[4].id, 1005);
  assert.deepEqual(
    calls.map((query) => new URLSearchParams(query).get("offset")),
    ["0", "2", "4"],
  );

  const parsedPage = parseSmartleadOffsetPage(await fixture("campaign-leads.page-0.json"), {
    offset: 0,
    limit: 2,
    itemKeys: ["leads"],
  });
  assert.equal(parsedPage.hasMore, true);
  assert.equal(parsedPage.nextOffset, 2);
  assert.equal(parsedPage.total, 5);

  const shortNonTerminalPage = parseSmartleadOffsetPage({
    total: 20,
    offset: 0,
    limit: 10,
    has_more: true,
    leads: [{ id: 1001 }, { id: 1002 }],
  }, {
    offset: 0,
    limit: 10,
    itemKeys: ["leads"],
  });
  assert.equal(shortNonTerminalPage.hasMore, true);
  assert.equal(shortNonTerminalPage.nextOffset, 10);
}

{
  const pages = new Map([
    ["0", await fixture("email-accounts.page-0.json")],
    ["2", await fixture("email-accounts.page-2.json")],
    ["4", await fixture("email-accounts.page-4-empty.json")],
  ]);
  const offsets = [];
  const client = makeClient(async (url) => {
    const parsed = assertAccessQuery(url);
    assert.equal(parsed.pathname, "/api/v1/email-accounts/");
    offsets.push(parsed.searchParams.get("offset"));
    return responseJson(pages.get(parsed.searchParams.get("offset") ?? "0") ?? []);
  });
  const accounts = await client.listAllEmailAccounts({ limit: 2, fetchCampaigns: true });
  assert.equal(accounts.length, 4);
  assert.equal(accounts[3].from_email, "sender-304@example.com");
  assert.deepEqual(offsets, ["0", "2", "4"]);
}

{
  const sequenceAggregate = await fixture("statistics.sequence-aggregate.json");
  const emailDetail = await fixture("statistics.email-detail.json");
  const sequencePage = parseSmartleadOffsetPage(sequenceAggregate, {
    offset: 0,
    limit: 1000,
    itemKeys: ["statistics"],
  });
  assert.equal(sequencePage.items.length, 2);
  assert.equal(sequencePage.items[0].sequence_number, 1);

  const detailPage = parseSmartleadOffsetPage(emailDetail, {
    offset: 0,
    limit: 1000,
    itemKeys: ["email_statistics"],
  });
  assert.equal(detailPage.items.length, 2);
  assert.equal(detailPage.items[0].lead_email, "lead-1001@example.com");
}

{
  const sleeps = [];
  let calls = 0;
  const client = makeClient(
    async (url) => {
      assertAccessQuery(url);
      calls++;
      if (calls === 1) {
        return responseJson({ message: "wait" }, 429, { "Retry-After": "2" });
      }
      return responseJson(await fixture("campaigns.direct-array.json"));
    },
    { sleep: async (ms) => { sleeps.push(ms); } },
  );
  const out = await client.listCampaigns();
  assert.equal(out.length, 2);
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [2000]);
}

{
  const sleeps = [];
  let calls = 0;
  const client = makeClient(
    async () => {
      calls++;
      if (calls === 1) {
        return responseJson({ retry_after: 1 }, 429);
      }
      return responseJson(await fixture("campaigns.direct-array.json"));
    },
    { sleep: async (ms) => { sleeps.push(ms); } },
  );
  await client.listCampaigns();
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [1000]);
  assert.equal(parseRetryDelayFromBody("retry after 250 ms"), 250);
  assert.equal(parseRetryAfter("0"), 0);
  assert.equal(parseRetryAfter("120"), 60_000);
}

{
  const controller = new AbortController();
  const sleeps = [];
  let calls = 0;
  const client = makeClient(
    async () => {
      calls++;
      return responseJson({ message: "wait" }, 429, { "Retry-After": "10" });
    },
    {
      retry: { attempts: 1 },
      sleep: async (ms) => {
        sleeps.push(ms);
        return new Promise(() => {});
      },
    },
  );

  const retrying = client.requestJson("/campaigns/", { signal: controller.signal });
  await waitForFixtureSignal("429 retry sleep", () => sleeps.length > 0);
  controller.abort();

  await assert.rejects(retrying, { name: "AbortError" });
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, [10_000]);
}

{
  const controller = new AbortController();
  const sleeps = [];
  let calls = 0;
  const client = makeClient(
    async () => {
      calls++;
      throw new Error("temporary network failure");
    },
    {
      retry: { attempts: 1, baseDelayMs: 123 },
      sleep: async (ms) => {
        sleeps.push(ms);
        return new Promise(() => {});
      },
    },
  );

  const retrying = client.requestJson("/campaigns/", { signal: controller.signal });
  await waitForFixtureSignal("network retry sleep", () => sleeps.length > 0);
  controller.abort();

  await assert.rejects(retrying, { name: "AbortError" });
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, [123]);
}

{
  const sleeps = [];
  let calls = 0;
  const client = makeClient(
    async () => {
      calls++;
      if (calls === 1) return responseJson({ code: "TEMPORARY" }, 502);
      return responseJson(await fixture("campaigns.direct-array.json"));
    },
    { sleep: async (ms) => { sleeps.push(ms); } },
  );
  const campaigns = await client.listCampaigns();
  assert.equal(campaigns.length, 2);
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [10]);
}

{
  const sleeps = [];
  let calls = 0;
  const client = makeClient(
    async () => {
      calls++;
      return new Promise(() => {});
    },
    {
      timeoutMs: 1,
      sleep: async (ms) => { sleeps.push(ms); },
    },
  );
  await assert.rejects(client.listCampaigns(), /timed out after 1ms/);
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [10, 20]);
}

{
  let calls = 0;
  const client = makeClient(
    async () => {
      calls++;
      return new Response(new ReadableStream({ start() {} }));
    },
    { timeoutMs: 1, retry: { attempts: 0 } },
  );
  await assert.rejects(client.listCampaigns(), /timed out after 1ms/);
  assert.equal(calls, 1);
}

{
  let calls = 0;
  const client = makeClient(async () => {
    calls++;
    return responseJson(Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })));
  });
  await assert.rejects(
    client.listAllEmailAccounts({ limit: 100, maxPages: 1 }),
    /exceeded the configured 1-page safety cap/,
  );
  assert.equal(calls, 1);
}

{
  let calls = 0;
  const page = Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }));
  const client = makeClient(async () => {
    calls++;
    return responseJson({ total: 300, offset: 0, limit: 100, email_accounts: page });
  });
  await assert.rejects(
    client.listAllEmailAccounts({ limit: 100 }),
    /did not advance beyond offset 100/,
  );
  assert.equal(calls, 2);
}

{
  const client = makeClient(async () => responseJson({
    has_more: true,
    offset: 0,
    limit: 100,
    email_accounts: [],
  }));
  await assert.rejects(
    client.listAllEmailAccounts({ limit: 100 }),
    /empty nonterminal page/,
  );
}

{
  let virtualNow = 0;
  const sleeps = [];
  let calls = 0;
  const client = makeClient(
    async () => {
      calls++;
      return responseJson(await fixture("campaigns.direct-array.json"));
    },
    {
      rateLimit: { perMinute: 100, burstPerSecond: 1, maxConcurrent: 8 },
      sleep: async (ms) => {
        sleeps.push(ms);
        virtualNow += ms;
      },
      now: () => virtualNow,
    },
  );
  await client.requestJson("/campaigns/");
  await client.requestJson("/campaigns/");
  assert.equal(calls, 2);
  assert.ok(sleeps.some((ms) => ms >= 1000), `expected burst gate sleep, got ${sleeps}`);
  assert.equal(client.getRateLimitStats().burst_limit, 1);
  assert.equal(client.getRateLimitStats().burst_window_ms, 1000);
  assert.equal(client.getRateLimitStats().throttled_count, 1);
}

{
  let virtualNow = 0;
  const sleeps = [];
  let calls = 0;
  const client = new SmartleadClient({
    accessValue,
    fetchImpl: async () => {
      calls++;
      return responseJson(await fixture("campaigns.direct-array.json"));
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      virtualNow += ms;
    },
    now: () => virtualNow,
    retry: { attempts: 0, jitterRatio: 0 },
  });

  for (let index = 0; index < 11; index++) {
    await client.requestJson("/campaigns/");
  }

  assert.equal(calls, 11);
  assert.deepEqual(sleeps, [2000]);
  assert.equal(client.getRateLimitStats().burst_limit, 10);
  assert.equal(client.getRateLimitStats().burst_window_ms, 2000);
  assert.equal(client.getRateLimitStats().limit_1s, 5);
  assert.equal(client.getRateLimitStats().limit_60s, 50);
}

{
  const traceDir = await fs.mkdtemp(path.join(os.tmpdir(), "sendlens-smartlead-trace-"));
  const previousTrace = process.env.SENDLENS_TRACE_REFRESH;
  const previousState = process.env.SENDLENS_STATE_DIR;
  process.env.SENDLENS_TRACE_REFRESH = "1";
  process.env.SENDLENS_STATE_DIR = traceDir;

  const client = makeClient(async (url) => {
    assertAccessQuery(url);
    return responseText(
      JSON.stringify({
        message: `bad ${SMARTLEAD_ACCESS_PARAM}=${accessValue}`,
        [SMARTLEAD_ACCESS_PARAM]: accessValue,
        lead_email: "customer-lead@example.com",
      }),
      400,
    );
  });

  try {
    await assert.rejects(
      () => client.requestJson("/campaigns/", { query: { include_tags: true } }),
      (error) => {
        assert.ok(error instanceof SmartleadApiError);
        const text = String(error);
        assert.doesNotMatch(text, new RegExp(accessValue));
        assert.doesNotMatch(text, /customer-lead@example\.com/);
        assert.match(text, /Provider error response body omitted/);
        return true;
      },
    );
    const trace = await fs.readFile(path.join(traceDir, "refresh-trace.log"), "utf8");
    assert.doesNotMatch(trace, new RegExp(accessValue));
    assert.doesNotMatch(trace, /customer-lead@example\.com/);
    assert.match(trace, /Provider error response body omitted/);
  } finally {
    if (previousTrace == null) delete process.env.SENDLENS_TRACE_REFRESH;
    else process.env.SENDLENS_TRACE_REFRESH = previousTrace;
    if (previousState == null) delete process.env.SENDLENS_STATE_DIR;
    else process.env.SENDLENS_STATE_DIR = previousState;
  }
}

{
  const sleeps = [];
  let calls = 0;
  const client = makeClient(
    async (_url, options = {}) => {
      calls++;
      const { signal } = options;
      if (signal.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      });
    },
    { sleep: async (ms) => { sleeps.push(ms); } },
  );
  const result = await client.validateAccess(1);
  assert.equal(result.status, "unreachable");
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
}

{
  let virtualNow = 0;
  const sleeps = [];
  let calls = 0;
  const controller = new AbortController();
  const client = makeClient(
    async () => {
      calls++;
      return responseJson(await fixture("campaigns.direct-array.json"));
    },
    {
      rateLimit: { perMinute: 100, burstLimit: 1, burstWindowMs: 1000, maxConcurrent: 8 },
      sleep: async (ms) => {
        sleeps.push(ms);
        return new Promise(() => {});
      },
      now: () => virtualNow,
      retry: { attempts: 0 },
    },
  );

  await client.requestJson("/campaigns/");
  const blocked = client.requestJson("/campaigns/", { signal: controller.signal });
  await waitForFixtureSignal("throttled prefetch sleep", () => sleeps.length > 0);
  controller.abort();

  await assert.rejects(blocked, { name: "AbortError" });
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, [1000]);
}

{
  const controller = new AbortController();
  const activeController = new AbortController();
  let calls = 0;
  const client = makeClient(
    async () => {
      calls++;
      return new Promise(() => {});
    },
    {
      rateLimit: { disabled: false, perMinute: 100, burstLimit: 100, burstWindowMs: 1000, maxConcurrent: 1 },
      retry: { attempts: 0 },
    },
  );

  const active = client.requestJson("/campaigns/", { signal: activeController.signal });
  await waitForFixtureSignal("active semaphore request", () => calls > 0);
  const queued = client.requestJson("/campaigns/", { signal: controller.signal });
  await waitForFixtureSignal("queued semaphore request", () => client.getRateLimitStats().queued_requests > 0);
  assert.equal(client.getRateLimitStats().queued_requests, 1);
  controller.abort();

  await assert.rejects(queued, { name: "AbortError" });
  assert.equal(calls, 1);
  assert.equal(client.getRateLimitStats().queued_requests, 0);
  activeController.abort();
  await assert.rejects(active, { name: "AbortError" });
}

{
  let captured = null;
  const client = makeClient(async (url, options = {}) => {
    const parsed = assertAccessQuery(url);
    captured = { pathname: parsed.pathname, method: options.method, body: options.body };
    return responseJson({ data: { "1001": [{ id: "message-1", direction: "inbound" }] } });
  });
  const out = await client.getBulkMessageHistory(101, [1001]);
  assert.deepEqual(Object.keys(out.data), ["1001"]);
  assert.equal(
    captured.pathname,
    "/api/v1/campaigns/101/message-history-for-leads/bbfbdsFGHlBr76ruhjvh6fhHL",
  );
  assert.equal(captured.method, "POST");
  assert.deepEqual(JSON.parse(String(captured.body)), { lead_ids: [1001] });
}

console.log("Smartlead client fixture tests passed");
