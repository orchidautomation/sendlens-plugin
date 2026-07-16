import { createHash } from "node:crypto";

import { put } from "@vercel/blob";

const MAX_BODY_BYTES = 8192;
const MAX_TOOLS = 8;
const MIN_SUBMIT_MS = 1500;
const CLIENT_WINDOW_MS = 60 * 60 * 1000;
const CLIENT_LIMIT = 5;
const EMAIL_WINDOW_MS = 10 * 60 * 1000;
const EMAIL_LIMIT = 2;
const MAX_TRACKED_KEYS = 1000;

const FIELD_LIMITS = {
  name: 120,
  email: 254,
  company: 160,
  title: 120,
  teamType: 40,
  useCase: 1200,
  tool: 80
};

// Best-effort defense in depth for repeated requests handled by one warm
// server process. This is deliberately not treated as a globally shared quota.
const processLocalRateLimitState = new Map();

export const runtime = "nodejs";

function sanitize(value, maxLength = 200) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function slugify(value) {
  return sanitize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function jsonError(message, status, headers = {}) {
  return Response.json({ error: message }, { status, headers });
}

function stableHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function firstForwardedIp(headers) {
  const forwarded = headers.get("x-forwarded-for") || "";
  return forwarded.split(",")[0]?.trim() || "";
}

function coarseIpScope(ipAddress) {
  if (!ipAddress) {
    return "unknown";
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ipAddress)) {
    const octets = ipAddress.split(".");
    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  }

  if (ipAddress.includes(":")) {
    return `${ipAddress.split(":").slice(0, 3).join(":")}::/48`;
  }

  return "unknown";
}

function userAgentFamily(userAgent) {
  const value = userAgent.toLowerCase();
  if (!value) return "unknown";
  if (value.includes("chrome")) return "chrome";
  if (value.includes("safari")) return "safari";
  if (value.includes("firefox")) return "firefox";
  if (value.includes("edge")) return "edge";
  return "other";
}

function requestSignal(request) {
  const ipScope = coarseIpScope(firstForwardedIp(request.headers));
  const agentFamily = userAgentFamily(request.headers.get("user-agent") || "");
  return {
    agentFamily,
    hash: stableHash(`${ipScope}|${agentFamily}`)
  };
}

function pruneRateLimitState(now) {
  if (processLocalRateLimitState.size <= MAX_TRACKED_KEYS) {
    return;
  }

  for (const [key, entry] of processLocalRateLimitState.entries()) {
    if (entry.resetAt <= now) {
      processLocalRateLimitState.delete(key);
    }
  }
}

function checkRateLimit(key, limit, windowMs, now) {
  const current = processLocalRateLimitState.get(key);
  if (!current || current.resetAt <= now) {
    processLocalRateLimitState.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false, resetAt: now + windowMs };
  }

  current.count += 1;
  if (current.count > limit) {
    return { limited: true, resetAt: current.resetAt };
  }

  return { limited: false, resetAt: current.resetAt };
}

function retryAfterSeconds(resetAt, now) {
  return String(Math.max(1, Math.ceil((resetAt - now) / 1000)));
}

async function parsePayload(request) {
  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return { error: jsonError("Submission is too large.", 413) };
  }

  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    return { error: jsonError("Submission is too large.", 413) };
  }

  try {
    return { payload: JSON.parse(body || "{}") };
  } catch {
    return { error: jsonError("Submission must be valid JSON.", 400) };
  }
}

function normalizedPayload(payload) {
  const tools = Array.isArray(payload.tools)
    ? payload.tools
        .slice(0, MAX_TOOLS)
        .map((entry) => sanitize(entry, FIELD_LIMITS.tool))
        .filter(Boolean)
    : [];

  return {
    name: sanitize(payload.name, FIELD_LIMITS.name),
    email: sanitize(payload.email, FIELD_LIMITS.email).toLowerCase(),
    company: sanitize(payload.company, FIELD_LIMITS.company),
    title: sanitize(payload.title, FIELD_LIMITS.title),
    teamType: sanitize(payload.teamType, FIELD_LIMITS.teamType),
    tools,
    useCase: sanitize(payload.useCase, FIELD_LIMITS.useCase)
  };
}

function validatePayload(payload, now) {
  if (sanitize(payload.website, 120)) {
    return jsonError("We could not accept that submission.", 400);
  }

  const startedAt = Number(payload.formStartedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0) {
    return jsonError("Submission is missing timing metadata.", 400);
  }
  if (now - startedAt < MIN_SUBMIT_MS) {
    return jsonError("Please wait a moment before submitting.", 429, {
      "Retry-After": "2"
    });
  }

  const record = normalizedPayload(payload);
  if (!record.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) {
    return jsonError("A valid work email is required.", 400);
  }

  if (!record.company) {
    return jsonError("Company is required.", 400);
  }

  return null;
}

export function resetWaitlistRateLimitsForTests() {
  processLocalRateLimitState.clear();
}

export function createWaitlistPostHandler({ putRecord = put, now = () => Date.now() } = {}) {
  return async function POST(request) {
    const currentTime = now();
    pruneRateLimitState(currentTime);

    try {
      const { payload, error } = await parsePayload(request);
      if (error) {
        return error;
      }

      const validationError = validatePayload(payload, currentTime);
      if (validationError) {
        return validationError;
      }

      const signal = requestSignal(request);
      const record = normalizedPayload(payload);
      const emailKey = stableHash(record.email);

      const clientLimit = checkRateLimit(
        `client:${signal.hash}`,
        CLIENT_LIMIT,
        CLIENT_WINDOW_MS,
        currentTime
      );
      if (clientLimit.limited) {
        return jsonError("Please wait before trying again.", 429, {
          "Retry-After": retryAfterSeconds(clientLimit.resetAt, currentTime)
        });
      }

      const emailLimit = checkRateLimit(
        `email:${emailKey}`,
        EMAIL_LIMIT,
        EMAIL_WINDOW_MS,
        currentTime
      );
      if (emailLimit.limited) {
        return jsonError("Please wait before trying again.", 429, {
          "Retry-After": retryAfterSeconds(emailLimit.resetAt, currentTime)
        });
      }

      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        console.error("waitlist.storage_missing");
        return jsonError("Waitlist storage is temporarily unavailable.", 503);
      }

      const storedRecord = {
        submittedAt: new Date(currentTime).toISOString(),
        ...record,
        source: "sendlens.app",
        requestContext: {
          signalHash: signal.hash,
          userAgentFamily: signal.agentFamily,
          retentionDays: 90
        }
      };

      const key = `waitlist/${currentTime}-${slugify(record.email)}.json`;

      await putRecord(key, JSON.stringify(storedRecord, null, 2), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false
      });

      return Response.json({ ok: true });
    } catch {
      console.error("waitlist.unexpected_error");
      return jsonError("Waitlist submission failed.", 500);
    }
  };
}

export const POST = createWaitlistPostHandler();
