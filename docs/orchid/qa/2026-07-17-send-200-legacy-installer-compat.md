# SEND-200 Legacy Installer Compatibility Release QA

## Scope

SEND-200 upgrades SendLens from `@orchid-labs/pluxx@0.1.32` to the released Pluxx root-cause fix `@orchid-labs/pluxx@0.1.33`, advances SendLens to unreleased `0.1.62`, and adds SendLens-owned regression coverage for generated release installers.

The SendLens behavior contract is unchanged: Instantly behavior, Smartlead V1 read-only boundaries, MCP response contracts, demo mode, and privacy/local-data guarantees remain as-is. The changed surface is generated host/install/release packaging.

## Upstream Pluxx Evidence

- Linear: PLUXX-333.
- Root fix PR: `orchidautomation/pluxx#443`, merged as `abd3d397a0f104d45a08407480e39e6703099cbc`.
- Release recovery PR: `orchidautomation/pluxx#444`, merged as `9cd18a219a482c46642387d701fc2b7383eab7b3`.
- Release workflow: `https://github.com/orchidautomation/pluxx/actions/runs/29544718087` succeeded.
- Published package: `@orchid-labs/pluxx@0.1.33`, npm `latest = 0.1.33`.
- GitHub release: `https://github.com/orchidautomation/pluxx/releases/tag/v0.1.33`.
- Independent release asset check: `orchid-labs-pluxx-0.1.33.tgz` hash matched npm integrity `sha512-TAo4+RCBp78AKaPRjNsnz9rbf8NvS17pkp6J8XzCYCGFTR6JS20FT5FMj1pjNOlqiboQo9UZHLHzpyh5fU8I+g==`.

## SendLens Local Validation

All commands below ran on branch `codex/SEND-200-legacy-installer-compat` after updating package manifests to `0.1.62` and Pluxx to `^0.1.33`.

- `npm run test:legacy-installer-compat` — passed. This builds real SendLens host bundles, asks Pluxx to generate fake GitHub release installers/assets, then runs the generated Claude Code, Cursor, Codex, and OpenCode installers against isolated fake homes.
  - Trusted pre-ownership SendLens manifests for all four hosts upgrade successfully.
  - Normal ownership ledgers are written after successful install.
  - Mismatched legacy identities fail closed for all four hosts.
  - Unrelated OpenCode namespaced skill collisions fail closed without replacing the legacy skill.
- `npm run test:plugin:smoke` — passed.
- `npm run validate:plugin` — passed.
- `npm run lint:plugin` — passed with existing translation/runtime warnings and `0 error(s)`.
- `npm run test:host-bundles` — passed.
- `npx pluxx test --target claude-code cursor codex opencode` — passed.
- `npx pluxx publish --github-release --dry-run --version 0.1.62 --allow-dirty` — passed; planned the four host archives, latest archives, installer scripts, release manifest, and checksums for `v0.1.62`.
- `npm run test:plugin` — passed.
- `npm run release:check` — passed, including full plugin tests, validate, lint, eval, host bundle inventory, and the new legacy installer regression. Eval retained the existing semantic warning (`54/100`, warning threshold `80`, failure threshold `48`).

## Release Verification Still Required

After the PR merges to `main`, the version-gated SendLens release workflow must publish `v0.1.62`. Closeout must verify:

- `v0.1.62` tag and GitHub Release exist.
- The latest release assets include the regenerated `install.sh`, `install-all.sh`, four per-host installers, four versioned archives, four latest archives, `release-manifest.json`, and `SHA256SUMS.txt`.
- Public `https://sendlens.app/install.sh` resolves to the new release.
- Released installer scripts contain the Pluxx legacy adoption logic from `0.1.33`.
- An isolated fake-home legacy upgrade against released assets succeeds, if practical.
