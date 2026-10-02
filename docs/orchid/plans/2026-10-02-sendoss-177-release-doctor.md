# SENDOSS-177 release doctor repair

## Evidence and objective

PR #112 merged to `2ffd6b12d313ab9dfc2c80649c3e3c4a1a72c83b`, and merge-SHA CI passed. The version-gated release run `36954225529` failed before tag creation at `Diagnose built host bundles`: Pluxx 0.1.46 requires a readable Codex plugin inventory, but the release runner has no Codex CLI. The same doctor call passed in PR CI after `.github/workflows/ci.yml` supplied an isolated empty inventory. Restore the release gate without weakening its bundle checks.

## Change

1. Give the release workflow's Codex bundle doctor the same narrow, diagnosable `codex plugin list --json` fixture as PR CI. Keep the Claude, Cursor, Codex, and OpenCode diagnostics.
2. Advance both package manifests from the unpublished 0.1.94 build to 0.1.95 for a new PR into `main`. Update public OpenCode setup text to name the version that can actually release. Preserve the 0.1.94 candidate QA record and note why its published-artifact follow-up moved to 0.1.95.
3. Run the exact release doctor step locally, release-state tests, host-bundle checks, plugin smoke/validate/lint, and PR CI. After merge, require merge-SHA CI, the release workflow's immutable tag and published assets, then reinstall that released artifact and repeat the mounted OpenCode MCP and `setup_doctor` proof.

## Boundaries and rollback

The fixture models an empty CI inventory; it does not claim a live Codex installation. It exits on any other Codex command and reports the unsupported arguments. No provider, MCP response, privacy, or installer runtime behavior changes. If release checks fail, repair in another feature PR; do not push to `main` or manually bypass the failed gate. SENDOSS-176 stays open until the published OpenCode artifact passes installed acceptance.
