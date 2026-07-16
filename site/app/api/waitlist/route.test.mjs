import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
  createWaitlistPostHandler,
  resetWaitlistRateLimitsForTests
} from "./route.js";

const fixedNow = Date.parse("2026-07-16T18:00:00.000Z");

function requestFor(body, headers = {}) {
  return new Request("https://sendlens.app/api/waitlist", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 Chrome/126",
      "x-forwarded-for": "203.0.113.44",
      ...headers
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

function validPayload(overrides = {}) {
  return {
    name: "Leia Organa",
    email: "LEIA@rebel.example",
    company: "Rebel Alliance",
    title: "General",
    teamType: "internal",
    tools: ["Instantly"],
    useCase: "Find campaign patterns.",
    formStartedAt: fixedNow - 5000,
    website: "",
    ...overrides
  };
}

async function json(response) {
  return response.json();
}

beforeEach(() => {
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
  resetWaitlistRateLimitsForTests();
});

afterEach(() => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  resetWaitlistRateLimitsForTests();
});

test("stores a minimized waitlist record for a valid request", async () => {
  const writes = [];
  const handler = createWaitlistPostHandler({
    now: () => fixedNow,
    putRecord: async (...args) => writes.push(args)
  });

  const response = await handler(requestFor(validPayload()));
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { ok: true });

  assert.equal(writes.length, 1);
  const [key, body, options] = writes[0];
  assert.equal(key, "waitlist/1784224800000-leia-rebel-example.json");
  assert.deepEqual(options, {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false
  });

  const stored = JSON.parse(body);
  assert.equal(stored.email, "leia@rebel.example");
  assert.equal(stored.company, "Rebel Alliance");
  assert.equal(stored.requestContext.userAgentFamily, "chrome");
  assert.equal(stored.requestContext.retentionDays, 90);
  assert.match(stored.requestContext.signalHash, /^[a-f0-9]{24}$/);
  assert.equal(Object.hasOwn(stored, "forwardedFor"), false);
  assert.equal(Object.hasOwn(stored, "userAgent"), false);
});

test("rejects malformed JSON", async () => {
  const handler = createWaitlistPostHandler({ now: () => fixedNow });
  const response = await handler(requestFor("{bad json"));
  assert.equal(response.status, 400);
  assert.deepEqual(await json(response), { error: "Submission must be valid JSON." });
});

test("rejects oversized request bodies before storage", async () => {
  let called = false;
  const handler = createWaitlistPostHandler({
    now: () => fixedNow,
    putRecord: async () => {
      called = true;
    }
  });

  const response = await handler(requestFor("x".repeat(8193)));
  assert.equal(response.status, 413);
  assert.equal(called, false);
  assert.deepEqual(await json(response), { error: "Submission is too large." });
});

test("rejects invalid required input", async () => {
  const handler = createWaitlistPostHandler({ now: () => fixedNow });
  const response = await handler(requestFor(validPayload({ email: "not-email" })));
  assert.equal(response.status, 400);
  assert.deepEqual(await json(response), { error: "A valid work email is required." });
});

test("bounds bot-like submissions with honeypot and timing controls", async () => {
  const handler = createWaitlistPostHandler({ now: () => fixedNow });

  const honeypot = await handler(requestFor(validPayload({ website: "https://bot.example" })));
  assert.equal(honeypot.status, 400);
  assert.deepEqual(await json(honeypot), { error: "We could not accept that submission." });

  const tooFast = await handler(requestFor(validPayload({ formStartedAt: fixedNow - 100 })));
  assert.equal(tooFast.status, 429);
  assert.equal(tooFast.headers.get("retry-after"), "2");
  assert.deepEqual(await json(tooFast), { error: "Please wait a moment before submitting." });
});

test("rate limits burst traffic by client signal", async () => {
  const handler = createWaitlistPostHandler({
    now: () => fixedNow,
    putRecord: async () => {}
  });

  for (let index = 0; index < 5; index += 1) {
    const response = await handler(
      requestFor(validPayload({ email: `person-${index}@example.com` }))
    );
    assert.equal(response.status, 200);
  }

  const limited = await handler(requestFor(validPayload({ email: "person-6@example.com" })));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "3600");
  assert.deepEqual(await json(limited), { error: "Please wait before trying again." });
});

test("rate limits replayed email submissions", async () => {
  const handler = createWaitlistPostHandler({
    now: () => fixedNow,
    putRecord: async () => {}
  });

  assert.equal((await handler(requestFor(validPayload()))).status, 200);
  assert.equal((await handler(requestFor(validPayload()))).status, 200);

  const replay = await handler(requestFor(validPayload()));
  assert.equal(replay.status, 429);
  assert.equal(replay.headers.get("retry-after"), "600");
  assert.deepEqual(await json(replay), { error: "Please wait before trying again." });
});

test("returns a sanitized error when storage is not configured", async () => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  const handler = createWaitlistPostHandler({ now: () => fixedNow });

  const response = await handler(requestFor(validPayload()));
  assert.equal(response.status, 503);
  assert.deepEqual(await json(response), {
    error: "Waitlist storage is temporarily unavailable."
  });
});

test("returns a sanitized error when upstream storage fails", async () => {
  const handler = createWaitlistPostHandler({
    now: () => fixedNow,
    putRecord: async () => {
      throw new Error("secret backend detail");
    }
  });

  const response = await handler(requestFor(validPayload()));
  assert.equal(response.status, 500);
  assert.deepEqual(await json(response), { error: "Waitlist submission failed." });
});
