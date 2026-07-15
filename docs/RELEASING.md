# Releasing SendLens

SendLens release automation is GitHub-release based and built around Pluxx.

The release workflow should:

1. verify the repo
2. build all host bundles
3. generate GitHub release assets through Pluxx
4. publish a versioned GitHub release with installers and archives

## Release Assets

Pluxx generates these assets for SendLens:

- `sendlens-claude-code-vX.Y.Z.tar.gz`
- `sendlens-claude-code-latest.tar.gz`
- `sendlens-cursor-vX.Y.Z.tar.gz`
- `sendlens-cursor-latest.tar.gz`
- `sendlens-codex-vX.Y.Z.tar.gz`
- `sendlens-codex-latest.tar.gz`
- `sendlens-opencode-vX.Y.Z.tar.gz`
- `sendlens-opencode-latest.tar.gz`
- `install-claude-code.sh`
- `install-cursor.sh`
- `install-codex.sh`
- `install-opencode.sh`
- `install.sh`
- `install-all.sh`
- `release-manifest.json`
- `SHA256SUMS.txt`

## Local Verification Before A Release

```bash
npm install
npm run ci:plugin
```

That runs:

- TypeScript build
- SendLens plugin tests
- Pluxx validate
- Pluxx lint
- full multi-target host build

## Behavior-Changing Release Gate

Before releasing a change that affects skills, agents, MCP response shape, evidence language, privacy boundaries, or client-safe wording, verify:

- the PR explains the affected SendLens workflow
- `docs/MCP_RESPONSE_CONTRACT.md` is updated for MCP shape changes
- prompt/package contracts cover the behavior
- evidence classes remain exact, sampled, reconstructed, hydrated, inferred, or unsupported as appropriate
- client-safe wording does not suppress material uncertainty
- host portability or generated bundle issues are routed to Pluxx
- a decision record exists for durable behavior or ownership changes

## Main-Branch Release Flow

Merging an unreleased package version into `main` starts the production release.
The pull request is the staging and review gate; release tags are created by
automation rather than pushed manually.

1. Create a named task branch from the latest `origin/main`.
2. Build and test the change in its isolated checkout.
3. Update both package manifests to the intended release version.
4. Rebase or update the task branch from current `main`, then push it and open a pull request into `main`.
5. Merge only after required checks and review pass.
6. Let the `main` workflow create the tag and GitHub Release.

Example:

```bash
git fetch origin main
git worktree add -b feat/example-release ../sendlens-example-release origin/main

cd ../sendlens-example-release

npm version patch --no-git-tag-version
git add package.json package-lock.json
git commit -m "feat: ship example change"
git push -u origin feat/example-release
```

After the PR merges, the GitHub Actions release workflow will:

- verify both package manifest versions match
- exit successfully without rebuilding when that version is already published
- run `npm ci`
- run `npm run release:check`
- run the full Pluxx target test gate
- dry-run the Pluxx release assets
- create the matching `vX.Y.Z` tag at the merged commit
- run `pluxx publish --github-release --version <version>`
- finish a matching draft release during recovery and verify it is public
- create or update the GitHub release with install scripts, archives, checksums, and manifest

The workflow is serialized and retains up to 100 pending main commits so release
runs cannot publish concurrently or silently replace a queued release. Manual recovery dispatches are accepted only
from `main`. If a tag was created but publishing
failed, rerun the failed workflow at the same commit; the workflow reuses the
matching tag. If that tag points at a different commit, the workflow fails and
requires either recovery from the original commit or a new version.

Every PR must advance the package version beyond the version currently on its
target branch. Two concurrent PRs can initially choose the same next version, so
branches must be updated from `main` before merge. Keep the required CI check
current through branch protection or a merge queue; the second PR must then
advance again before it can merge.

## Workflow Notes

- this repo does not publish an npm package today
- the public distribution surface is GitHub Releases
- `main` pushes without an unreleased package version are successful release no-ops
- direct installer URLs should always point at `/releases/latest/download/...`
- the hosted install URL should serve `https://sendlens.app/install.sh` as a redirect to the latest GitHub Release `install.sh` asset

## Typical Download Links

- `https://sendlens.app/install.sh`
- `https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install.sh`
- `https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-all.sh`
- `https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-claude-code.sh`
- `https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-cursor.sh`
- `https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-codex.sh`
- `https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-opencode.sh`
