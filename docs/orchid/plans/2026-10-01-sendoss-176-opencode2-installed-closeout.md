# SENDOSS-176 OpenCode 2 installed closeout

## Goal and dependency

Complete the installed OpenCode acceptance left open by SENDOSS-161. The SendLens source fix is merged, but released SendLens 0.1.93 still uses `@orchid-labs/pluxx@0.1.41`. Pluxx PR #509 prepares 0.1.46 with the merged OpenCode 2 generator and installer repairs. Do not change the SendLens dependency or claim an installed pass until 0.1.46 exists on npm and the matching GitHub release is verified.

## Work sequence

1. Verify the immutable Pluxx 0.1.46 npm package, GitHub tag, release asset, and registry integrity after the trusted release workflow passes.
2. Pin `@orchid-labs/pluxx` to the exact published version in `package.json` and `package-lock.json`. Advance both SendLens package versions to the same unreleased patch version for a PR into `main`.
3. Rebuild all four host bundles from `pluxx.config.ts`. Update the public OpenCode limitation only after the generated V2 bundle and installed host have been checked. Do not hand-edit generated output.
4. Run `npm run test:plugin:smoke`, `npm run validate:plugin`, `npm run lint:plugin`, `npm run test:host-bundles`, `npm run test:legacy-installer-compat`, and relevant Pluxx OpenCode checks. Run the full plugin suite when feasible. Record exact versions and any skipped gate.
5. Commit, push, and open a SendLens PR linked to SENDOSS-176 and SENDOSS-161. Preserve the existing MCP, Instantly, demo, and privacy contracts. Review and required PR checks gate merge. Release only from verified `main` after merge.
6. Install the released SendLens OpenCode artifact in a clean, credential-free OpenCode 2 profile. Record sanitized plugin discovery, `opencode mcp list`, and a mounted `setup_doctor` call. Confirm the launcher resolves the runtime and workspace without private provider data. If startup fails, identify the first failing boundary and repair the owning layer on a new issue branch.
7. Update SENDOSS-176 and PLUXX-341 with exact release and installed evidence. Close the delivery gate only when the installed MCP and doctor criteria pass. Keep SENDOSS-161's source completion distinct from this rollout proof.

## Rollback and limits

If source or host validation fails, keep the consumer release unpublished and fix the branch. If the installed profile fails after release, preserve the sanitized failure evidence, leave the delivery gate open, and ship a corrected version. Do not use real provider credentials, campaign data, or private replies in proof artifacts.
