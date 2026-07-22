# SendLens commercial docs site QA — 2026-07-22

## Branch selection

- Inspected `origin/codex/sendoss-95-filter-instantly-analytics-refresh` first because Brandon called it the “instantly” branch.
- Determined it was an older Instantly analytics implementation branch, not the current docs attempt.
- Inspected `origin/codex/mintlify-docs-plan` and found the implementation-ready Mintlify public docs plan.
- Continued from `origin/codex/mintlify-docs-plan` on implementation branch `codex/commercial-docs-site`.

## Scope implemented

- Added `docs-site/` as the Mintlify source root so public docs do not publish repo-internal `docs/orchid/` artifacts.
- Added a customer-facing IA for install/getting-started, setup, trust/privacy, evidence, providers, workflows, use cases, comparisons, commercial placeholders, release story, reference, deploy, and closed-source transition.
- Kept install guidance centered on `https://sendlens.app/install.sh` and avoided private source checkout or direct private release asset assumptions.
- Added `scripts/check-docs-site.mjs` and `npm run docs:check` for repeatable public-safety, navigation, redirect, frontmatter, secret-shape, and internal-link checks.

## Validation

Commands run from repo root unless noted:

```bash
/home/brandon/.codex/plugins/cache/personal/orchid-agent-stack/0.1.0+codex.20260621000222/scripts/repo-preflight.sh .
cd docs-site && npx mint@4.2.726 validate
cd docs-site && npx mint@4.2.726 broken-links
npm run docs:check
git diff --check
```

Results:

- Repo preflight: passed with one warning: `.agent-artifacts` missing.
- Mintlify validate: passed with `mint@4.2.726`.
- Mintlify broken-links: passed with `mint@4.2.726`.
- Local docs check: passed, 37 MDX pages.
- Diff hygiene: passed.

## Public/private boundary audit

`npm run docs:check` checks for:

- accidental references to internal Orchid docs paths,
- `.agent-artifacts`,
- private repo GitHub URLs,
- private process wording that should not be in public docs,
- likely pasted secret values,
- missing navigation pages,
- broken root-relative internal links,
- redirects pointing to missing pages.

No raw customer data, secrets, private issue text, or provider mutation guidance was added.

## Open decisions

- Final pricing/package names and limits are placeholders pending approved commercial terms.
- Final public release/download channel is still open; docs use `https://sendlens.app/install.sh` as the canonical installer until an approved channel is confirmed.
- Final production docs URL remains a deployment decision.

## Follow-up CI fix — 2026-07-22

After opening PR #86, CI surfaced two actionable failures:

- `plugin-checks` required the candidate package version to be greater than the PR target branch version.
- `site-checks` failed `npm audit --omit=dev --audit-level=high` because Next's optional `sharp` dependency resolved to a vulnerable `<0.35.0` version.

Fixes applied:

- Bumped root `package.json` and `package-lock.json` to `0.1.75`.
- Added a site package override for `sharp@0.35.3` and regenerated `site/package-lock.json`.

Additional validation run:

```bash
npm run docs:check
node scripts/release-state.mjs --check-base origin/codex/mintlify-docs-plan
npm run site:ci
cd docs-site && npx mint@4.2.726 validate
cd docs-site && npx mint@4.2.726 broken-links
git diff --check
/home/brandon/.codex/plugins/cache/personal/orchid-agent-stack/0.1.0+codex.20260621000222/scripts/repo-preflight.sh .
```

Results:

- Docs check: passed.
- Release state check: passed; `0.1.75` is ahead of target branch `0.1.72`.
- Site CI: passed, including lint, typecheck, tests, build, and production audit with 0 vulnerabilities.
- Mintlify validate and broken links: passed.
- Diff hygiene: passed.
- Repo preflight: passed with the existing `.agent-artifacts` missing warning.

## Blocks review fix — 2026-07-22

Blocks PR Review flagged valid public-safety and documentation quality issues after the CI fix. Follow-up changes:

- Hardened `scripts/check-docs-site.mjs` to catch query-string credential shapes such as `?api_key=...`, `apikey`, `token`, and `access_token`.
- Added Mintlify JSX `href="/..."` validation to the internal-link checker.
- Avoided false positives for Markdown image links and known asset paths.
- Added the Smartlead query-string suppression caveat beside `SENDLENS_SMARTLEAD_API_KEY` in configuration reference.
- Retitled/expanded the MCP page as an overview with tool families and full evidence-class response expectations.
- Replaced generic duplicated workflow prompts with role-specific examples and evidence expectations.
- Replaced quickstart “skills” terminology with “workflows”.

Validation after these review fixes:

```bash
npm run docs:check
node scripts/release-state.mjs --check-base origin/codex/mintlify-docs-plan
cd docs-site && npx mint@4.2.726 validate
cd docs-site && npx mint@4.2.726 broken-links
npm run site:ci
git diff --check
/home/brandon/.codex/plugins/cache/personal/orchid-agent-stack/0.1.0+codex.20260621000222/scripts/repo-preflight.sh .
```

Results:

- Docs check: passed.
- Release state check: passed.
- Mintlify validate and broken-links: passed.
- Site CI: passed, including production audit with 0 vulnerabilities.
- Diff hygiene: passed.
- Repo preflight: passed with the existing `.agent-artifacts` missing warning.

## Provider-positioning audit — 2026-07-22

Brandon flagged that SendLens should not be represented as only "Instantly analytics" because the product also supports Smartlead.

Audit and fixes:

- Re-scanned `docs-site/` for Instantly-only language, "Instantly analytics", "Instantly-focused", "shipped provider", and "mature provider" wording.
- Rewrote provider setup and concepts pages to describe Instantly and Smartlead as supported read-only provider paths, with all-provider normalization when both are configured.
- Preserved Smartlead caveats: SendLens Smartlead support is read-only, Smart Delivery can be support-gated, query-string credentials are sensitive, and empty/unsupported evidence does not prove deliverability health.
- Rewrote the release-story page so the story is provider-normalized instead of Instantly-first.
- Updated the Instantly comparison page to mention all-provider comparison with Smartlead where both providers are configured.

Validation:

```bash
npm run docs:check
cd docs-site && npx mint@4.2.726 validate
cd docs-site && npx mint@4.2.726 broken-links
git diff --check
/home/brandon/.codex/plugins/cache/personal/orchid-agent-stack/0.1.0+codex.20260621000222/scripts/repo-preflight.sh .
```

Results:

- Docs check: passed.
- Mintlify validate and broken-links: passed.
- Diff hygiene: passed.
- Repo preflight: passed with the existing `.agent-artifacts` missing warning.
