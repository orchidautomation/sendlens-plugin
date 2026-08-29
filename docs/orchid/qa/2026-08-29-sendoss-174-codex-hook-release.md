# SENDOSS-174 — Codex SessionStart hook release QA

Date: 2026-08-29

Issue: [SENDOSS-174](https://linear.app/orchid-automation/issue/SENDOSS-174/rebuild-and-release-sendlens-codex-sessionstart-hook-after-pluxx-345)

Compiler fix: [PLUXX-345](https://linear.app/orchid-automation/issue/PLUXX-345/fix-codex-generated-hooks-when-codex-plugin-root-is-unset)

Prior resolution: completed SENDOSS-56 (Codex hook path regression reopened after the original fix shipped).

Release branch: `codex/sendoss-174-ready-pluxx-0.1.41`

## Release scope

- Consume the verified `@orchid-labs/pluxx@0.1.41` compiler release and pin it as the exact `devDependencies` entry.
- Regenerate the four SendLens host bundles from `pluxx.config.ts` so the generated Codex `SessionStart` descriptor routes through `${PLUGIN_ROOT}` instead of the Codex-Desktop-unavailable `${CODEX_PLUGIN_ROOT}`.
- Add an installed-artifact regression test that reads and executes the exact generated Codex descriptor from an unrelated workspace, with `CODEX_PLUGIN_ROOT` absent, in a credential-free fixture.
- Advance SendLens from `0.1.87` to the next still-unreleased patch: `0.1.88`.

No provider, MCP response, evidence language, refresh semantic, or commercial-repository behavior changed.

## Compiler fix readback (PLUXX-345)

The release gate was held until every precondition from the pinned plan read back successfully:

- npm reports exact `@orchid-labs/pluxx@0.1.41` with integrity `sha512-m08Sr20N2SzohxySOSETpuQQlVVEFqyubreONy2KTWvzz4JHr4nPueXgOmYJeKC1Tmuij3Odqwk767hvhK+YcA==`.
- Lockfile integrity matches the authenticated registry result byte-for-byte after `npm install`.
- Pluxx tag/release `v0.1.41` bound to merge `0379d2c646ad9b83fb31016d9d553ba5dea96e76` exists, with GitHub Actions release run `33254601754` reported green.
- npm and GitHub tarballs share SHA-256 `25e0039ad63f10a79970d8028c56461f9813cbfb522088be93beba18bde6508e`.
- Isolated registry probe `npx --yes @orchid-labs/pluxx@0.1.41 --version` returned `0.1.41`.
- Release receipt `orchid.release.receipt/v1` with digest `9f12122842a778fe86ae06093cc9b3e5b92416c9a41f055a5e3f21bb15f7b8cb` confirmed.

## Bundle inspection

Generated Codex descriptor in `dist/codex/hooks/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${PLUGIN_ROOT}/hooks/pluxx-hook-command-1.mjs\""
          }
        ]
      }
    ]
  }
}
```

`dist/codex/.codex/hooks.generated.json` carries the same `node "${PLUGIN_ROOT}/hooks/pluxx-hook-command-1.mjs"` companion mirror. Neither descriptor references `${CODEX_PLUGIN_ROOT}` and neither collapses to a literal `/hooks/...` path; both route through `${PLUGIN_ROOT}/hooks/`.

The generated wrapper (`dist/codex/hooks/pluxx-hook-command-1.mjs`) sets `process.env.PLUGIN_ROOT` and `process.env.PLUXX_PLUGIN_ROOT` from either the host-supplied env var or its own on-disk location under the bundle `hooks/` directory before spawning the configured `bash "${PLUXX_PLUGIN_ROOT}/scripts/session-start.sh"` command. The shell-script entry point is unchanged.

## Installed-artifact regression test

`scripts/test-host-bundle-inventory.mjs` now enforces the PLUXX-345 reachability contract for the generated `SessionStart` descriptor before declaring the host-bundle inventory green:

- Both `dist/codex/hooks/hooks.json` and `dist/codex/.codex/hooks.generated.json` must reference only one `SessionStart` entry whose command uses `${PLUGIN_ROOT}` and never `${CODEX_PLUGIN_ROOT}`.
- The literal command, with `${PLUGIN_ROOT}` resolved against a fresh bundle copy, must execute from an unrelated workspace and exit `0` with the existing safe-skip message when credentials are absent. Codex Desktop-equivalent (`PLUGIN_ROOT` set, `CODEX_PLUGIN_ROOT` absent) and host-without-`PLUGIN_ROOT` (wrapper discovers its own plugin root) scenarios are both asserted.
- Demo-mode bootstrap (`SENDLENS_DEMO_MODE=1` and `=true`) must exit `0`, surface `Demo mode loaded synthetic workspace`, and materialize the synthetic DuckDB workspace, all without `CODEX_PLUGIN_ROOT` and without exposing any provider credential.

`scripts/test-legacy-installer-compat.mjs` no longer hardcodes `0.1.38`; it asserts that the pinned SendLens Pluxx devDependency is `0.1.41` or newer so any future compiler regression on the Codex hook packaging path fails the maintained installer gate.

## Validation

| Command | Result |
| --- | --- |
| `npm ci` | Passed; lockfile integrity matches the verified Pluxx `0.1.41` registry readback. |
| `npm run build:hosts` | Passed with `0 error(s), 46 warning(s)` and a `Core-four mapping:` summary, including the explicit Codex hook degradation row. |
| `npm run test:host-bundles` | Passed for `5 skills, 15 commands, 9 agents`, including the new `assertCodexHookManifestReachability` invariant. |
| `npm run test:legacy-installer-compat` | Passed; updated Pluxx floor (`0.1.41+`) accepted; trusted/untrusted legacy install, mismatch, and corruption paths keep their fail-closed behaviour. |
| `npm run test:release-state` | Passed; `0.1.88` is greater than the latest published tag and both `package.json` and `package-lock.json` versions match. |
| `node scripts/release-state.mjs --check-base origin/main` | Passed; `0.1.88` is strictly ahead of `0.1.87` on `main`. |
| `npx pluxx --version` | Reported `0.1.41`. |
| `npx pluxx doctor` | Passed; `0 error(s), 1 warning(s)`, retaining the documented `hooks-trust-required` install-time opt-in. |
| `npx pluxx test --target claude-code cursor codex opencode` | Passed across the four host manifests. |
| `npx pluxx doctor --consumer ./dist/<host>` | Passed for `claude-code`, `cursor`, `codex`, and `opencode`. |

Smoke execution of the installed wrapper:

```bash
$ HOME=/tmp/sendlens-hook-reachability/home bash -lc \
    'node /workspace/dist/codex/hooks/pluxx-hook-command-1.mjs </dev/null'
[sendlens] SENDLENS_INSTANTLY_API_KEY is not set for SENDLENS_PROVIDER=instantly; skipping session-start refresh. Existing local DuckDB cache remains available.
[sendlens] Run /sendlens-setup in your AI host to initialize a zero-key synthetic demo workspace, or configure the key before running refresh_data.
$ echo $?
0
```

`CODEX_PLUGIN_ROOT` is intentionally unset throughout this proof; the wrapper resolves its plugin root on its own.

Demo-mode proof:

```bash
$ PLUGIN_ROOT=/workspace/dist/codex \
  SENDLENS_DEMO_MODE=1 \
  SENDLENS_STATE_DIR=/tmp/sendlens-hook-reachability/demo-state \
  SENDLENS_DB_PATH=/tmp/sendlens-hook-reachability/demo-state/workspace-cache.duckdb \
  HOME=/tmp/sendlens-hook-reachability/home \
  node /workspace/dist/codex/hooks/pluxx-hook-command-1.mjs
[sendlens] Demo mode loaded synthetic workspace. Local DuckDB path: /tmp/sendlens-hook-reachability/demo-state/workspace-cache.duckdb
$ ls /tmp/sendlens-hook-reachability/demo-state
refresh-status.json
workspace-cache.duckdb
```

No provider credentials, customer payloads, or `instly_*`/`sk_*` keys appear in any of the surfaces touched during this evidence collection.

## Release mechanism

SendLens distribution is GitHub-Release-driven, not npm. After the PR merges into `main`, the version-gated release workflow is expected to:

1. Verify `0.1.88` is strictly ahead of the previously published tag and that both `package.json` and `package-lock.json` versions still match.
2. Run `npm run release:check` (the full plugin CI gate) on the merged commit.
3. Run the maintained Pluxx target smoke checks across the four hosts.
4. Dry-run Pluxx release assets, then create the matching `v0.1.88` tag and publish the four host archives plus installers, manifest, and checksums.

## Future operator checklist (post-merge)

- Re-read the `v0.1.88` GitHub Release artifact SHA-256 and confirm it matches the locally built `dist/` checksum.
- Install the Codex installer into a fresh Codex Desktop cache and re-run the literal `node "${PLUGIN_ROOT}/hooks/pluxx-hook-command-1.mjs"` command from a fresh thread with no `CODEX_PLUGIN_ROOT`.
- Capture the `SendLens setup` skill roving smoke proof on a fresh Codex Desktop thread and archive it next to this file before opening the post-merge closeout receipt.
- Keep `PLUXX-345` linked from the closeout comment so the regression trail stays intact for SENDOSS-174.
