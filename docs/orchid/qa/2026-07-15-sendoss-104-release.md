# SendLens 0.1.51 Pluxx 0.1.32 release QA

Date: 2026-07-15

Issue: SENDOSS-104

Release branch: `codex/sendoss-104-pluxx-0-1-32-release`

## Release scope

- Upgrade Pluxx from `0.1.31` to `0.1.32` and SendLens from `0.1.50` to `0.1.51`.
- Add canonical skill metadata to all 15 commands.
- Align four command delegates with the launch, copy, and strategy specialists.
- Strengthen routing gates across all four supported hosts.
- Add semantic evaluation to CI and the tag-release gate.

No provider or MCP response behavior changed.

## Semantic evaluation baseline

Pluxx 0.1.32 reports 48/100. Routing, argument guidance, delegation, and cross-file consistency score 100/100. The remaining low scores are known manual-project rubric mismatches around taxonomy wording, realistic-example detection, and internal setup identifiers.

The project records 48 as the temporary failure floor and 80 as the warning threshold. CI now runs `pluxx eval`, so a total-score regression below 48 fails pull-request and release checks. The warning remains visible, and the baseline must be revisited when the rubric or authored workflows change.

## Review evidence

- Proof-first validation identified all 15 missing source and generated skill routes before metadata was added.
- Simplification review derived public-skill identity mappings from the canonical inventory.
- Correctness, testing, maintainability, project-standards, agent-native, learnings, and adversarial review covered the diff.
- Review fixed three gaps: evaluation was absent from `ci:plugin`; non-Codex bundles did not assert skill metadata; and four commands paired canonical skills with mismatched agents.
- The optional independent model pass was skipped because the required approval was unavailable.

## Validation

| Command | Result |
| --- | --- |
| `npm ci` | Passed; 0 vulnerabilities. |
| `npm run release:check` | Passed on the final diff, including full plugin tests, validation, lint, semantic evaluation, and host inventory. |
| `npm run eval:plugin` | Passed with 0 errors, 1 warning, and score 48/100. |
| `npm run test:host-bundles` | Passed for 5 skills, 15 commands, and 9 agents after review fixes. |
| `npx pluxx test --target claude-code cursor codex opencode` | Passed all four host manifests. |
| `npx --yes skills-ref validate skills/<skill>` | Passed all five public SendLens skills. |
| Consumer diagnostics | Passed all four hosts with expected local trust and environment warnings. |
| `git diff --check` | Passed. |

## Release mechanism

SendLens uses the tag-driven GitHub Release workflow, not npm. After the PR merges, tag `v0.1.51` must match `package.json`. The workflow reruns the release gate, diagnoses all host bundles, dry-runs the assets, and publishes the four host archives, installers, manifest, and checksums.

Public closeout requires a green workflow, expected asset inventory, valid checksums, healthy installer URLs, and a released-artifact install and registration check.
