# SENDOSS-76 Smartlead No-Key Testing Plan

Date: 2026-07-01

## Scope

This plan covers Smartlead provider parity validation when no live Smartlead API key is available. It is release-blocking for docs, demo fixtures, and MCP response contracts, but it does not prove live Smartlead response shapes.

## Required Local Validation

- Use only synthetic fixtures, mocked HTTP responses, and `.invalid` domains.
- Run provider setup tests for `instantly`, `smartlead`, and `all` modes.
- Run Smartlead client tests for query auth redaction, offset pagination, 429/retry handling, and fixture response shapes.
- Run ingest/view tests that prove provider-qualified campaign IDs, campaign-name ambiguity, provider capabilities, and unsupported Smartlead inbox placement.
- Run demo workspace tests that prove provider-aware synthetic data and no secret/customer data.
- Run MCP and prompt contract tests so agents preserve provider labels and evidence caveats.

## Minimum Command Set

```bash
git diff --check
npm run test:mcp-response-contract
npm run test:prompt-contracts
npm run test:demo
npm run test:provider-workspace-views
npm run test:plugin
npm run validate:plugin
npm run lint:plugin
```

## Live Validation Deferred

When a real Smartlead key is available, run a bounded read-only validation pass:

- one `/campaigns/` probe with key redaction verified in all output;
- one bounded campaign list, account list, campaign analytics, leads page, and message-history check against a non-sensitive workspace;
- compare live shapes to `docs/SMARTLEAD_PROVIDER_CONTRACT.md`;
- open follow-up issues for mismatches before promoting Smartlead parity to `main`.

## Residual Risk

No live Smartlead key is available for SENDOSS-76. The current release can prove local response contracts, privacy redaction, provider-aware fixtures, and unsupported capability language, but it cannot prove that every live Smartlead account returns exactly the same response shape as the checked docs and synthetic fixtures.
