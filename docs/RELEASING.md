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

## Tag-Based Release Flow

1. Update `package.json` version.
2. Commit and push the version bump.
3. Push the matching tag.

Example:

```bash
git checkout main
git pull --ff-only

npm version patch --no-git-tag-version
git add package.json
git commit -m "Release 0.1.1"
git push origin main

git tag v0.1.1
git push origin v0.1.1
```

The GitHub Actions release workflow will then:

- run `npm ci`
- run `npm run release:check`
- verify the tag matches `package.json`
- run `pluxx publish --github-release --version <version>`
- create or update the GitHub release with install scripts, archives, checksums, and manifest

## Workflow Notes

- this repo does not publish an npm package today
- the public distribution surface is GitHub Releases
- direct installer URLs should always point at `/releases/latest/download/...`

## Typical Download Links

- `https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-all.sh`
- `https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-claude-code.sh`
- `https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-cursor.sh`
- `https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-codex.sh`
- `https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-opencode.sh`
