# SENDOSS-175: Private Entire Checkpoints

## Goal

Configure Orchid Relay and Entire safely for the public `orchidautomation/sendlens-plugin` repository by storing checkpoints in a separate private same-owner repository.

## Scope

- Create `orchidautomation/sendlens-plugin-checkpoints` as a private GitHub repository.
- Run the reviewed Orchid repo setup path with the private checkpoint destination.
- Use Entire CLI 0.10.6 with the `branch` checkpoint backend.
- Refresh Codex hooks and enroll durable checkpoint-publication consent.
- Add the missing repository policy only after verifying its Linear team and GitHub issue mode.

## Validation

- Orchid repo preflight reports zero failures.
- Entire is installed, authenticated, enabled, and configured for the private destination.
- Effective automatic session publication is enabled.
- Durable checkpoint consent validates.
- The public source remote has no Entire checkpoint refs.
- `git diff --check` passes and the original `main` checkout remains clean.

## Delivery

Commit the configuration on `codex/sendoss-175-private-entire-checkpoints`, push it, open a PR to `main`, link `SENDOSS-175`, and add `ai:autofix-enabled`.
