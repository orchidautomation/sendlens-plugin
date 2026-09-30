# SENDOSS-161 OpenCode MCP diagnosis and source candidate

## Released artifact reproduction

- OpenCode 2.0.20 and released SendLens 0.1.91 were installed into an isolated profile and synthetic workspace with no provider keys or customer data.
- `opencode plugin list` discovered both the generated bundle directory and wrapper. OpenCode startup rejected both before MCP registration because the generated V1-style modules lack the V2 default plugin definition with `id` and `setup` or `effect`; `opencode mcp list` reported no servers. A free `opencode/space-bunny-free` session found no SendLens tool. A separate free model endpoint was unavailable, so it supplied no MCP evidence.
- Bypassing the host loader to initialize the installed stdio MCP exposed a second failure: `build/plugin/server.js` is CommonJS under the OpenCode package's `type: module`, producing `MCP error -32000: Connection closed`. The generated command also used a workspace-relative startup script path.
- The OpenCode 2 generator/API mismatch is [PLUXX-355](https://linear.app/orchid-automation/issue/PLUXX-355). The SendLens source repair here does not make OpenCode 2 load the plugin.

## Source candidate validation

- `npm run test:plugin:smoke`: passed, including HTTP, privacy, configuration, schema, and setup contracts.
- `npm run validate:plugin`: passed.
- `npm run lint:plugin`: 0 errors; 46 existing host-translation warnings.
- `npx pluxx test --target opencode`: passed for the generated OpenCode bundle; this does not test the OpenCode 2 host API.
- `npm run build:hosts`, host bundle inventory, and bundled config-loader checks: passed for all four hosts.
- `npm run test:legacy-installer-compat`: passed. Its OpenCode path installs a generated release-style artifact, loads the installed V1 wrapper, starts its MCP command from a separate synthetic workspace, completes the stdio initialize handshake, lists `setup_doctor`, and calls it in zero-key demo mode. This proves the CommonJS and working-directory repairs in the installed artifact without contacting a provider.
- `git diff --check`: passed. No private paths, API values, campaign data, or reply content were used in fixtures or reported evidence.

## Delivery and remaining gate

This source candidate still requires review, PR checks, merge, release, and reinstall. OpenCode 2 support additionally requires PLUXX-355 to ship, followed by a new SendLens build/release and `opencode mcp list` plus `setup_doctor` proof on the installed host. Until then, public setup guidance names the OpenCode 2 limitation and directs users to the other supported hosts.
