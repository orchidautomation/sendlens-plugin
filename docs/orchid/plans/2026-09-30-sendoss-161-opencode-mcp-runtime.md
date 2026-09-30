# SENDOSS-161: installed OpenCode MCP runtime repair

## Observed boundaries

- Released SendLens 0.1.91 installed into an isolated OpenCode profile with no provider credentials.
- OpenCode 2.0.20 discovers the generated bundle and wrapper but rejects both V1-style plugin exports before MCP registration. This belongs to the Pluxx generator and is tracked in PLUXX-355.
- Independently, a direct stdio initialize request through the installed Pluxx launcher reached `build/plugin/server.js` and closed. The OpenCode host package declares `type: module`, while SendLens compiles that runtime as CommonJS.
- The generated MCP command also used a relative `./scripts/start-mcp.sh` path, which depends on the host's working directory.

## SendLens change

1. Generate a nested `build/plugin/package.json` declaring `type: commonjs` on every plugin build; Pluxx passes it into each host bundle.
2. Use a plugin-root placeholder for the MCP startup script so the generated launcher resolves it independently of the selected workspace's working directory.
3. Extend the released-style installer regression to load the installed wrapper, start its configured MCP command from a separate synthetic workspace, complete stdio initialize, list `setup_doctor`, and call it in zero-key demo mode.
4. Explain the distinct OpenCode 2 host API limitation in public setup and troubleshooting guidance.

## Validation and release boundary

Run plugin smoke, Pluxx validate/lint/test for OpenCode, all-host build and inventory, bundle config-loader checks, and the released-style installer test. The installed wrapper/stdio test proves the SendLens runtime repair. OpenCode 2's `mcp list` cannot pass until PLUXX-355 ships and SendLens is rebuilt, released, and reinstalled. Keep SENDOSS-161 open through that installed-host acceptance step. Do not use private provider data or hand-edit generated bundles.

## Rollback

Revert the SendLens source PR if a host regression appears. The OpenCode 2 compatibility work remains separately owned by Pluxx; do not claim this source PR alone restores OpenCode 2 support.
