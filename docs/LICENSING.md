# SendLens Licensing And Commercial Enforcement

This page explains the intended license transition for future commercial SendLens releases. It is an implementation and product-planning document, not legal advice. Qualified counsel must review the commercial license, EULA, privacy terms, refund terms, and order forms before launch.

## Current transition rule

- Existing SendLens versions already distributed under MIT remain MIT.
- The commercial license in `LICENSE` is intended for future commercial versions only.
- The preserved MIT text lives in `LICENSE-MIT-LEGACY.txt`.
- Do not claim that prior MIT clones, forks, tags, or copies can be retroactively restricted.
- Update the final MIT tag/version in `LICENSE` before merging if another MIT release ships first.

## Why not rely on source secrecy alone?

Source secrecy is not the durable moat. The durable commercial value is the maintained product relationship:

- signed installers and release provenance;
- host compatibility across ChatGPT/Codex, Claude, Cursor, OpenCode, and future hosts;
- provider API drift maintenance;
- read-only privacy and evidence contracts;
- local DuckDB analysis surfaces;
- cross-provider Instantly and Smartlead normalization;
- privacy-safe `analyze_data` and catalog guardrails;
- packaged specialist skills and workflows;
- support, onboarding, and upgrade path.

Commercial builds can be proprietary or source-available, but the pricing story should not be “pay for hidden prompts.” It should be “pay for the maintained, supported outbound intelligence layer.”

## Recommended billing and entitlement stack

Use Autumn for product, purchase, and entitlement state; Stripe for payments; and WorkOS or equivalent identity for login/OAuth. Autumn is not the license by itself. The license/EULA/order form is the legal contract; Autumn is the operational entitlement system.

Recommended commercial objects:

| Object | Purpose |
| --- | --- |
| WorkOS user/org | Identity, login, org membership, OAuth subject |
| Autumn customer | Billing/entitlement owner |
| Stripe checkout/payment | Payment collection and receipts |
| `sendlens_access` feature | Base right to use commercial SendLens |
| `sendlens_seat` quantity | Named-user count for teams/agencies |
| `sendlens_client_workspace` quantity | Active client/workspace allowance for agencies |
| Device activation records | Recoverable device limit and abuse signal |
| Signed local license lease | Offline-capable local entitlement proof |

The local runtime should verify a short-lived signed lease rather than calling Autumn before every tool invocation. The hosted control plane may see identity, entitlement, payment, license version, device activation, and minimal operational metadata. It must not receive provider credentials, raw campaigns, replies, or DuckDB files for the local-first product.

## Agency abuse controls

Agencies can try to share one login across many operators. Do not rely on any single control; combine contract, packaging, product enforcement, and support policy.

### Contract controls

- Individual licenses are for one named human only.
- Individual licenses exclude agency, client-service, service-bureau, resale, outsourcing, and managed-service use.
- Agency plans require named seats and an active-client/workspace allowance.
- Shared login/license use is a breach and can terminate access.
- Support is available only to named licensed users.

### Product controls

- Bind activation to a WorkOS user/org and Autumn entitlement.
- Issue signed local license leases with user, org, plan, seat, device, workspace/client allowance, expiry, and license-version claims.
- Enforce a small recoverable device limit for individual licenses.
- Require team/agency plans to register org domain, allowed users, and client/workspace allowance.
- Rate-limit activations, reactivations, device resets, and lease refreshes.
- Revoke or shorten leases on refund, chargeback, abuse, or suspicious activation patterns.
- Keep privacy-safe activation logs that exclude provider credentials and campaign data.

### Packaging controls

- Personal plan: one named user, small device allowance, no client-service use.
- Team plan: multiple named users for one company’s own outbound workspaces.
- Agency plan: named users plus a licensed number of active client workspaces.
- Managed/private plan: explicit client-service, deployment, support, SLA, and data-processing terms.

### Practical expectations

Local software can be patched or shared by determined users. The goal is not perfect DRM. The goal is to make honest use easy, casual abuse inconvenient, and serious abuse clearly outside the license and support relationship.

## Open launch decisions

Resolve these before commercial launch:

- final MIT tag/version;
- final repository destination for future proprietary code;
- launch price and upgrade policy;
- named-user and device allowance;
- team and agency plan boundaries;
- client/workspace allowance for agencies;
- refund, transfer, and reset policy;
- offline grace period and lease duration;
- support/update commitments;
- counsel-reviewed EULA and privacy terms.
