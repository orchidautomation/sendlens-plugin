import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertMatchingVersions,
  assertVersionAhead,
  compareSemver,
  resolveReleaseState,
} from "./release-state.mjs";

const base = {
  packageVersion: "1.2.3",
  lockVersion: "1.2.3",
  lockRootVersion: "1.2.3",
  githubSha: "new-sha",
};

assert.equal(compareSemver("1.2.4", "1.2.3"), 1);
assert.equal(compareSemver("1.2.3-beta.2", "1.2.3-beta.10"), -1);
assert.equal(
  compareSemver("9007199254740993.0.0", "9007199254740992.0.0"),
  1,
);
assert.equal(
  compareSemver(
    "1.2.3-beta.9007199254740993",
    "1.2.3-beta.9007199254740992",
  ),
  1,
);
for (const invalidVersion of [
  "1.2.3-",
  "1.2.3-alpha..1",
  "1.2.3-alpha.",
  "1.2.3+",
  "1.2.3+build..1",
  "1.2.3-alpha.01",
]) {
  assert.throws(
    () => compareSemver(invalidVersion, "1.2.3"),
    /valid semantic versions/,
  );
}
assert.equal(compareSemver("1.2.3+build.01", "1.2.3+build.2"), 0);
assert.doesNotThrow(() => assertVersionAhead("1.2.4", "1.2.3"));
assert.throws(() => assertVersionAhead("1.2.3", "1.2.3"), /must be greater/);
assert.throws(() => assertMatchingVersions("1.2.3", "1.2.2", "1.2.2"), /must match/);

assert.deepEqual(
  resolveReleaseState({
    ...base,
    releaseLookup: { status: "found", isDraft: false, isPrerelease: false },
    tagCommit: "new-sha",
  }),
  {
    releaseNeeded: false,
    releaseRequiresPromotion: false,
    tagExists: true,
    packageVersion: "1.2.3",
    tagName: "v1.2.3",
    summary: "v1.2.3 is already published.",
  },
);

for (const [releaseLookup, tagCommit, expected] of [
  [{ status: "not_found" }, "", { tagExists: false, releaseRequiresPromotion: false }],
  [{ status: "not_found" }, "new-sha", { tagExists: true, releaseRequiresPromotion: false }],
  [{ status: "found", isDraft: true, isPrerelease: false }, "new-sha", { tagExists: true, releaseRequiresPromotion: true }],
  [{ status: "found", isDraft: false, isPrerelease: true }, "new-sha", { tagExists: true, releaseRequiresPromotion: true }],
]) {
  const state = resolveReleaseState({ ...base, releaseLookup, tagCommit });
  assert.equal(state.releaseNeeded, true);
  assert.equal(state.tagExists, expected.tagExists);
  assert.equal(state.releaseRequiresPromotion, expected.releaseRequiresPromotion);
}

assert.throws(
  () => resolveReleaseState({ ...base, releaseLookup: { status: "not_found" }, tagCommit: "old-sha" }),
  /already points to old-sha/,
);
assert.throws(
  () => resolveReleaseState({
    ...base,
    releaseLookup: { status: "found", isDraft: false, isPrerelease: false },
    tagCommit: "old-sha",
  }),
  /already points to old-sha/,
);
assert.throws(
  () => resolveReleaseState({
    ...base,
    releaseLookup: { status: "error", message: "HTTP 503" },
    tagCommit: "",
  }),
  /lookup failed: HTTP 503/,
);

const releaseWorkflow = readFileSync(".github/workflows/release.yml", "utf8");
assert.match(releaseWorkflow, /queue: max/);
assert.match(releaseWorkflow, /if: github\.ref == 'refs\/heads\/main'/);
assert.match(releaseWorkflow, /node scripts\/release-state\.mjs/);
assert.match(releaseWorkflow, /pluxx test --target claude-code cursor codex opencode/);

console.log("OK: release-state decisions and version ordering");
