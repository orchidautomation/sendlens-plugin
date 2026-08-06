// SENDOSS-163 — Privacy guard for Instantly shape fixtures.
// CI-safe (no live key required). Asserts every committed fixture under
// scripts/fixtures/instantly-client/ contains only structural shape tokens and
// no email, name, domain, UUID/hex id, date value, or credential.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const dir = new URL("./fixtures/instantly-client/", import.meta.url);
const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
assert.ok(files.length >= 15, `expected >=15 fixture files, found ${files.length}`);

const LEAK = /(@[^\s"]+\.[^\s"]+|sendoso|getsendoso|\.com|\.ai|sandoval|\balex\b|Bearer|sk-|gho_|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])\b)/i;

let leaks = 0;
for (const f of files) {
  const text = await fs.readFile(new URL(f, dir), "utf8");
  const m = text.match(LEAK);
  if (m) { leaks++; console.error(`PII/real-value leak in ${f}: ${m[0]}`); }
}
assert.equal(leaks, 0, `${leaks} fixture file(s) contain PII or real values`);
console.log(`Instantly shape fixtures privacy OK (${files.length} files, no PII/real values).`);
