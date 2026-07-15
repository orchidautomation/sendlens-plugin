# SendLens Agent Instructions

## Product Context

- SendLens is a local-first, read-only outbound analytics plugin for AI hosts.
- The shipped provider is Instantly. Preserve existing Instantly behavior, MCP response contracts, demo mode, host bundles, and privacy guarantees unless an issue explicitly changes them.
- Smartlead work for the provider-parity project is V1 read-only only. Do not add campaign, lead, account, email, or webhook mutation paths.

## Workflow

- Use Linear as the source of truth for scoped work.
- Preserve Brandon's and other agents' local changes. Read `git status --short --branch` before editing and do not revert unrelated work.
- Treat `main` as the protected production branch and keep the original repo checkout as a clean, current mirror of `origin/main`. Do not implement directly on `main`.
- Start each substantive task from a freshly fetched `origin/main` in one named branch and one worktree. Prefer `codex/<issue-key>-<slug>` for Codex work and `feat/<slug>` or `fix/<slug>` for human-led work.
- Create the branch when creating the worktree. If Codex supplies a detached worktree, attach it to a meaningful task branch before editing or committing.
- Use pull-request checks and built host bundles as the staging gate; do not maintain a long-lived `develop` or `staging` branch unless the release model is explicitly changed.
- Build and run the task-appropriate local validation in the task worktree, then commit and push the task branch. Open a PR from that branch rather than pushing feature work to `main`.
- For Smartlead Provider Parity work, branch from `codex/smartlead-api-parity-map` and target PRs back to `codex/smartlead-api-parity-map`, not `main`, unless Brandon explicitly redirects.
- Link PRs and closeout comments back to Linear issue keys.
- For safe same-branch PRs in this `orchidautomation/sendlens-plugin` repo, add the GitHub label `ai:autofix-enabled` unless Brandon opts out or the branch cannot be safely repaired by automation.
- Keep review fixes on the same PR branch. Merge only after required checks and review pass.
- The PR author owns the release version bump. Any merge to `main` that should publish a new SendLens build must advance both package manifests to the same unreleased version.
- A push to `main` runs the version-gated release workflow. An already-published version is a successful no-op; an unreleased version must pass the full release checks before the workflow creates its tag and publishes the GitHub Release.
- After merge, delete the remote task branch, remove its worktree, delete the local task branch, and fast-forward the original `main` checkout from `origin/main`.
- Store durable Orchid artifacts under `docs/orchid/`.
- Keep temporary/raw agent outputs in .agent-artifacts/.

## Artifact Map

- Brainstorms and PRDs: `docs/orchid/brainstorms`, `docs/orchid/requirements`
- Implementation plans: `docs/orchid/plans`
- To-dos and handoffs: `docs/orchid/todos`
- Reviews and QA evidence: `docs/orchid/reviews`, `docs/orchid/qa`
- Work history and provenance summaries: `docs/orchid/history`
- Visual plans and recaps: `docs/orchid/visual-plans`, `docs/orchid/visual-recaps`
- Product pulse reports: `docs/orchid/pulse-reports`
- Durable decisions and reusable lessons: `docs/orchid/decisions`, `docs/orchid/solutions`

## Validation

- Repo guidance or artifact-structure only: run the Orchid repo preflight and `git diff --check`.
- Plugin/source changes: run `npm run test:plugin:smoke`, `npm run validate:plugin`, and `npm run lint:plugin`.
- Data model, provider, MCP response, evidence-language, or privacy-boundary changes: also run the relevant focused tests and prefer `npm run test:plugin` when feasible.
- Host bundle or release-surface changes: run the relevant host bundle validation before PR closeout.
- Say clearly in PR/Linear closeout when a heavier plugin validation tier was not run and why.

## Privacy And Safety

- Do not commit secrets, raw private transcripts, auth files, cookies, API tokens, browser session data, raw customer campaign data, or private outbound replies.
- Do not paste API keys or raw customer campaign data into issues, PRs, docs, or chat.
- Smartlead API keys are query-string credentials in checked docs; redact them from logs, traces, setup output, errors, fixtures, and comments.
- Keep temporary/raw agent outputs in .agent-artifacts/.
