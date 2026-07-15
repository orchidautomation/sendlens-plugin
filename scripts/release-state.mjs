import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function parseSemver(version) {
  const match = SEMVER_PATTERN.exec(version);
  if (!match) return null;

  const prerelease = match[4]?.split(".");
  if (prerelease?.some((identifier) => /^0\d+$/.test(identifier))) return null;

  return { match, prerelease };
}

function compareNumericStrings(left, right) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function compareSemver(left, right) {
  const leftVersion = parseSemver(left);
  const rightVersion = parseSemver(right);
  if (!leftVersion || !rightVersion) {
    throw new Error(`Versions must be valid semantic versions: "${left}" and "${right}"`);
  }

  const { match: leftMatch, prerelease: leftPre } = leftVersion;
  const { match: rightMatch, prerelease: rightPre } = rightVersion;

  for (let index = 1; index <= 3; index += 1) {
    const difference = compareNumericStrings(leftMatch[index], rightMatch[index]);
    if (difference !== 0) return difference;
  }

  if (!leftPre && !rightPre) return 0;
  if (!leftPre) return 1;
  if (!rightPre) return -1;

  const length = Math.max(leftPre.length, rightPre.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPre[index] === undefined) return -1;
    if (rightPre[index] === undefined) return 1;
    if (leftPre[index] === rightPre[index]) continue;
    const leftNumeric = /^\d+$/.test(leftPre[index]);
    const rightNumeric = /^\d+$/.test(rightPre[index]);
    if (leftNumeric && rightNumeric) {
      return compareNumericStrings(leftPre[index], rightPre[index]);
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPre[index] < rightPre[index] ? -1 : 1;
  }
  return 0;
}

export function assertMatchingVersions(packageVersion, lockVersion, lockRootVersion) {
  if (packageVersion !== lockVersion || packageVersion !== lockRootVersion) {
    throw new Error("package.json and package-lock.json versions must match");
  }
}

export function assertVersionAhead(candidateVersion, baseVersion) {
  if (compareSemver(candidateVersion, baseVersion) <= 0) {
    throw new Error(
      `Candidate version ${candidateVersion} must be greater than target-branch version ${baseVersion}`,
    );
  }
}

export function resolveReleaseState({
  packageVersion,
  lockVersion,
  lockRootVersion,
  releaseLookup,
  tagCommit,
  githubSha,
}) {
  assertMatchingVersions(packageVersion, lockVersion, lockRootVersion);
  if (releaseLookup.status === "error") {
    throw new Error(`GitHub release lookup failed: ${releaseLookup.message}`);
  }

  const tagName = `v${packageVersion}`;
  const releaseRequiresPromotion = releaseLookup.status === "found"
    && (releaseLookup.isDraft || releaseLookup.isPrerelease);

  if (tagCommit && tagCommit !== githubSha) {
    throw new Error(
      `Tag ${tagName} already points to ${tagCommit}, not ${githubSha}. Rerun the failed workflow for ${tagCommit} or advance the package version.`,
    );
  }

  if (releaseLookup.status === "found" && !releaseRequiresPromotion) {
    return {
      releaseNeeded: false,
      releaseRequiresPromotion: false,
      tagExists: Boolean(tagCommit),
      packageVersion,
      tagName,
      summary: `${tagName} is already published.`,
    };
  }

  return {
    releaseNeeded: true,
    releaseRequiresPromotion,
    tagExists: Boolean(tagCommit),
    packageVersion,
    tagName,
    summary: releaseLookup.status === "found"
      ? `${tagName} is not a production release and will be completed.`
      : `${tagName} is not published and will be released.`,
  };
}

function readManifestVersions() {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  return {
    packageVersion: packageJson.version,
    lockVersion: packageLock.version,
    lockRootVersion: packageLock.packages?.[""]?.version,
  };
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

function checkBaseVersion(baseRef) {
  const versions = readManifestVersions();
  assertMatchingVersions(versions.packageVersion, versions.lockVersion, versions.lockRootVersion);
  const basePackage = run("git", ["show", `${baseRef}:package.json`]);
  const baseLock = run("git", ["show", `${baseRef}:package-lock.json`]);
  if (basePackage.status !== 0 || baseLock.status !== 0) {
    throw new Error(`Could not read package manifests from ${baseRef}`);
  }
  const basePackageVersion = JSON.parse(basePackage.stdout).version;
  const parsedBaseLock = JSON.parse(baseLock.stdout);
  assertMatchingVersions(
    basePackageVersion,
    parsedBaseLock.version,
    parsedBaseLock.packages?.[""]?.version,
  );
  assertVersionAhead(versions.packageVersion, basePackageVersion);
  console.log(`Release version ${versions.packageVersion} is ahead of ${baseRef} (${basePackageVersion}).`);
}

function lookupRelease(tagName) {
  const result = run("gh", [
    "api",
    `repos/${process.env.GITHUB_REPOSITORY}/releases/tags/${tagName}`,
    "--jq",
    "{isDraft: .draft, isPrerelease: .prerelease}",
  ]);
  if (result.status === 0) {
    return { status: "found", ...JSON.parse(result.stdout) };
  }
  if (/\bHTTP 404\b/.test(result.stderr)) return { status: "not_found" };
  return { status: "error", message: result.stderr.trim() || `gh exited ${result.status}` };
}

function resolveForWorkflow() {
  const versions = readManifestVersions();
  const tagName = `v${versions.packageVersion}`;
  const tagResult = run("git", ["rev-list", "-n", "1", tagName]);
  const state = resolveReleaseState({
    ...versions,
    releaseLookup: lookupRelease(tagName),
    tagCommit: tagResult.status === 0 ? tagResult.stdout.trim() : "",
    githubSha: process.env.GITHUB_SHA,
  });
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required");
  for (const [key, value] of Object.entries({
    release_needed: state.releaseNeeded,
    release_requires_promotion: state.releaseRequiresPromotion,
    tag_exists: state.tagExists,
    package_version: state.packageVersion,
    tag_name: state.tagName,
  })) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${state.summary}\n`);
  }
  console.log(state.summary);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (process.argv[2] === "--check-base") {
      if (!process.argv[3]) throw new Error("--check-base requires a git ref");
      checkBaseVersion(process.argv[3]);
    } else {
      resolveForWorkflow();
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
