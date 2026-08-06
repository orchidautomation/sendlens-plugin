#!/usr/bin/env node
// SENDOSS-163 — Instantly live response-shape validation harness.
// Read-only. Makes live Instantly read calls using SENDLENS_INSTANTLY_API_KEY
// from the environment (never logged/committed), captures SANITIZED STRUCTURAL
// shapes only (keys + type tags; zero real customer values), and writes fixtures
// to scripts/fixtures/instantly-client/. Also emits an evidence summary.
//
// Privacy contract: no email, name, domain, id, body, or credential value is
// written. Scalars become type tags; arrays collapse to a single redacted item.

import fs from "node:fs/promises";

const KEY = process.env.SENDLENS_INSTANTLY_API_KEY;
if (!KEY || KEY.length < 8) {
  console.error("Missing SENDLENS_INSTANTLY_API_KEY in env. Aborting without writing fixtures.");
  process.exit(2);
}
const BASE = "https://api.instantly.ai/api/v2";
const OUT = new URL("./fixtures/instantly-client/", import.meta.url);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEXID_RE = /^[a-f0-9]{16,}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?Z?)?$/;

function shapeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length ? [shapeOf(v[0])] : [];
  if (typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) o[keyTag(k)] = shapeOf(v[k]);
    return o;
  }
function keyTag(k) {
    if (EMAIL_RE.test(k)) return "<email_key>";
    if (UUID_RE.test(k) || HEXID_RE.test(k)) return "<id_key>";
    if (/\s/.test(k)) return "<label_key>";
    if (ISO_RE.test(k)) return "<date_key>";
    return k;
  }
  if (typeof v === "string") {
    if (EMAIL_RE.test(v)) return "<email>";
    if (UUID_RE.test(v)) return "<id>";
    if (HEXID_RE.test(v)) return "<id>";
    if (ISO_RE.test(v)) return "<date>";
    return "<str>";
  }
  if (typeof v === "number") return "num";
  if (typeof v === "boolean") return "bool";
  return typeof v;
}

function envelopeOf(parsed) {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return Object.keys(parsed);
  return Array.isArray(parsed) ? ["<array>"] : ["<scalar>"];
}

async function call(name, url, init = {}) {
  try {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" } });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { _body: text.slice(0, 60) }; }
    return { name, http_status: res.status, parsed };
  } catch (e) {
    return { name, http_status: 0, error: String(e.message) };
  }
}

const evidence = { provider: "instantly", generated_at: "<date>", smartlead: "beta/live-untested", endpoints: [] };

// Lookup phase: real ids/emails for scoped endpoints.
const camp = await call("campaigns", `${BASE}/campaigns?limit=1`);
const acc = await call("accounts", `${BASE}/accounts?limit=1`);
const campaignId = camp.parsed?.items?.[0]?.id;
const accountEmail = acc.parsed?.items?.[0]?.email;
const ipt = await call("inbox-placement-tests", `${BASE}/inbox-placement-tests?limit=1`);
const testId = ipt.parsed?.items?.[0]?.id;

const gets = [
  ["campaigns", `${BASE}/campaigns?limit=1`],
  ["accounts", `${BASE}/accounts?limit=1`],
  ["subsequences", campaignId ? `${BASE}/subsequences?limit=1&parent_campaign=${campaignId}` : null],
  ["campaign-analytics", `${BASE}/campaigns/analytics`],
  ["lead-lists", `${BASE}/lead-lists?limit=1`],
  ["custom-tags", `${BASE}/custom-tags?limit=1`],
  ["emails", `${BASE}/emails?limit=1`],
  ["lead-labels", `${BASE}/lead-labels?limit=1`],
  ["custom-tag-mappings", `${BASE}/custom-tag-mappings?limit=1`],
  ["inbox-placement-tests", `${BASE}/inbox-placement-tests?limit=1`],
  ["inbox-placement-analytics", testId ? `${BASE}/inbox-placement-analytics?limit=1&test_id=${testId}` : null],
  ["campaign-details", campaignId ? `${BASE}/campaigns/${campaignId}` : null],
  ["campaign-analytics-steps", campaignId ? `${BASE}/campaigns/analytics/steps?campaign_id=${campaignId}` : null],
  ["campaign-analytics-daily", campaignId ? `${BASE}/campaigns/analytics/daily?campaign_id=${campaignId}` : null],
  ["accounts-analytics-daily", accountEmail ? `${BASE}/accounts/analytics/daily?account_id=${accountEmail}` : null],
].filter(([, url]) => url);

const posts = [
  ["leads-list", `${BASE}/leads/list`, { method: "POST", body: JSON.stringify({ limit: 1 }) }],
  ["accounts-warmup-analytics", accountEmail ? `${BASE}/accounts/warmup-analytics` : null, accountEmail ? { method: "POST", body: JSON.stringify({ emails: [accountEmail] }) } : null],
].filter(([, url]) => url);

const results = [];
for (const [name, url] of gets) results.push(await call(name, url));
for (const [name, url, init] of posts) results.push(await call(name, url, init));

await fs.mkdir(OUT, { recursive: true });
for (const r of results) {
  const shape = r.parsed !== undefined ? shapeOf(r.parsed) : { _error: r.error };
  await fs.writeFile(new URL(`${r.name}.shape.json`, OUT), JSON.stringify({ endpoint: r.name, http_status: r.http_status, shape }, null, 2) + "\n");
  evidence.endpoints.push({
    name: r.name,
    http_status: r.http_status,
    envelope_keys: r.http_status === 200 ? envelopeOf(r.parsed) : [],
    item_keys: r.http_status === 200 && r.parsed?.items?.[0] ? Object.keys(r.parsed.items[0]) : [],
    state: r.http_status === 200 ? "answerable" : (r.http_status === 404 ? "unsupported" : "blocked"),
  });
}
await fs.writeFile(new URL("_evidence.json", OUT), JSON.stringify(evidence, null, 2) + "\n");

const ok = results.filter((r) => r.http_status === 200).length;
const bad = results.filter((r) => r.http_status !== 200).length;
console.log(`Instantly shape validation: ${ok} ok, ${bad} non-200. Fixtures written to scripts/fixtures/instantly-client/`);
for (const r of results) console.log(`  ${r.name.padEnd(28)} HTTP ${r.http_status}`);
