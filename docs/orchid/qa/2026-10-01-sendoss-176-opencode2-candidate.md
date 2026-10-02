# SENDOSS-176 OpenCode 2 candidate QA

## Source and dependency

- SendLens candidate: `0.1.94`, pinned to published `@orchid-labs/pluxx@0.1.46` in both manifests.
- Pluxx tag `v0.1.46` resolves to trusted main `80f67d2486e437e82839b06f2b7b9f9589b82b91`. The first tag run passed release checks and npm publish, then timed out before npm propagation. Trusted immutable-tag recovery [36939945059](https://github.com/orchidautomation/pluxx/actions/runs/36939945059) passed and published the GitHub release.
- npm and GitHub tarballs compare byte-for-byte at SHA-256 `33df432d9fed01d0ece0e51faa1d8902a0f8f9f2f01917225cb57023be6f9bea`. The npm registry integrity is `sha512-ecitpbU6zUm38NwKYHfeDjsrBPVlw0DcOfMkxw3EG32sWJUHhvy9Xy3v/bJOuYAv7Dpl4uU+r54y3Bq7t5gH/w==`.

## Candidate checks

- `npm run build:hosts`: passed for Claude Code, Cursor, Codex, and OpenCode. The generated OpenCode entry has a V2 default definition with `id: "sendlens"` and `setup(ctx)`.
- `npm run test:plugin:smoke`: passed with child-process access. The first sandboxed run hit an MCP child-process restriction and is not counted.
- `npm run validate:plugin`: passed. `npm run lint:plugin`: passed with 0 errors and 46 documented host-translation warnings.
- `npx pluxx test --target opencode`: passed.
- `npm run test:legacy-installer-compat`: passed after updating its synthetic Codex plugin inventory and OpenCode V2 wrapper assertions. It starts the installed MCP launcher and calls `setup_doctor` in credential-free demo mode.
- `npm run test:host-bundles`: passed. `npm run test:plugin`: passed, including MCP response contracts, demo agentic routing proof, and runtime bootstrap.
- `npm run test:container-config`: passed. `npm run eval:plugin`: passed with 0 errors, 1 semantic score warning, and 9 informational messages. `git diff --check`: passed.

## Isolated OpenCode host

In a temporary, credential-free home and workspace, `pluxx install --target opencode --trust` installed the candidate. The isolated profile used a separate service port because the default port was occupied by another local OpenCode service. OpenCode 2.0.20 `plugin list` discovered `sendlens` as a local plugin. After service startup, `opencode mcp list` reported `sendlens connected`; the isolated service log recorded 13 MCP tools. The first list call ran before the plugin finished loading and returned no servers, so the final connected readback is the accepted observation.

The free model's first attempts used an incorrect tool name and then guessed through shell/code; neither is counted as proof. A later OpenCode `execute` catalog search found `tools.sendlens.setup_doctor`. The actual mounted call `await tools.sendlens.setup_doctor({})` completed and returned `schema_version: sendlens_setup_doctor.v1`, `demo_mode: true`, and `setup_status: ready_with_warnings`. The raw isolated demo session remains temporary outside the repository. No provider credentials or customer data were used.

OpenCode 2 reported that it cannot register bundled specialist agents natively. Public setup guidance now describes that limitation without claiming agent parity.

## Remaining boundary

This is a locally installed **candidate**, not the published SendLens artifact. After PR review, merge, release, and reinstall of 0.1.94, repeat plugin discovery, `opencode mcp list`, and the mounted `setup_doctor` call. Keep SENDOSS-176 open until that exact released-artifact proof is recorded.
