# 2026-05-07 SendLens And Pluxx Ownership Boundary

## Context

The Superpowers review surfaced two different kinds of robustness work:

- product behavior that makes SendLens a trustworthy outbound analyst
- host portability that makes plugins behave consistently across platforms and agent hosts

Mixing those concerns would push cross-platform and cross-agent complexity into each product plugin.

## Decision

SendLens owns product behavior:

- MCP-first workflow routing
- SendLens skill and agent guidance
- evidence classes and exactness language
- MCP response semantics
- outbound-analysis prompt behavior
- client-safe output rules

Pluxx owns portability and host mechanics:

- Windows/macOS/Linux hook behavior
- host adapters
- generated manifests and bundles
- installer and packaging behavior
- cross-agent compatibility
- host-specific startup delivery

## Consequences

SendLens can define five focused public skill contracts without implementing host-specific injection mechanics. Pluxx provides the abstraction that delivers product startup contracts and legacy command routing across hosts.

When an issue is about install, generated bundle shape, shell wrappers, host discovery, or cross-agent behavior, route it to Pluxx. When an issue is about evidence, MCP semantics, SendLens skills, or outbound-analysis behavior, keep it in SendLens.

## Validation

- `skills/sendlens-analyst/SKILL.md` states the product behavior contract and ownership boundary.
- `scripts/test-prompt-contracts.mjs` checks that the contract preserves MCP-first routing, no-fallback rules, evidence classes, campaign-strategy gating, and Pluxx ownership language.
- GitHub issue and PR templates include SendLens-vs-Pluxx ownership checks.
