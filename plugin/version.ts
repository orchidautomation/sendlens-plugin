// PLUGIN_VERSION is generated at build time by scripts/generate-version.mjs
// from package.json. The generated module lives at
// plugin/_generated/version.generated.ts and is git-ignored.
//
// Why a generated module instead of a runtime read:
// - Installed host bundles (dist/codex, dist/cursor, dist/claude-code)
//   do not include package.json in the published tree.
// - A runtime read against __dirname would walk up the filesystem
//   and resolve to "0.0.0-unknown" for real installed users.
//
// See scripts/generate-version.mjs for the source of truth.
export { PLUGIN_VERSION } from "./_generated/version.generated";
