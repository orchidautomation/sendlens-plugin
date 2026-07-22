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
