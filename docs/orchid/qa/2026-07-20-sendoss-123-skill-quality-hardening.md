# SENDOSS-123 skill quality hardening QA

Date: 2026-07-20

Branch: `codex/sendoss-123-skill-quality-hardening`

Baseline: `e7397ca6077e90f5f003dd22129ff7ea1a552d83` (`origin/main`, SendLens `0.1.70`)

Candidate version: `0.1.71`

## Scope and safety

This change hardens the five existing public skills—analyst, campaign strategist, copywriter, launch operator, and setup—without adding a sixth skill. It adds self-contained routing and output contracts, an executable eval harness, public-installer recovery when both MCP and Pluxx are absent, host-safe recovery documentation, and focused setup-doctor contract corrections. It does not change provider HTTP clients, container transport behavior, or provider mutation boundaries.

All committed eval fixtures are synthetic and public-safe. Raw host events, model responses, downloaded installer material, and intermediate reports remain in ignored local scratch; this document contains aggregate results only.

The contracts were reconciled with the public Agent Skills [specification](https://agentskills.io/specification), [creation best practices](https://agentskills.io/skill-creation/best-practices), [description optimization guidance](https://agentskills.io/skill-creation/optimizing-descriptions), and [evaluation guidance](https://agentskills.io/skill-creation/evaluating-skills).

## Executable skill evidence

The committed contract suite covers 115 trigger cases (45 positive and 70 negative), split into 60 train and 55 validation cases; 25 output cases (five per skill); 16 cross-skill routing cases; and five one-per-skill host output cases. Opaque case IDs and a baseline SHA snapshot keep the host comparison blind and reproducible.

The final three-run Codex host evaluation used all five skills, the 55-case validation cohort, and the five designated host output cases from 2026-07-20T19:19:18Z through 2026-07-20T19:36:34Z:

| Measure | Baseline | Candidate |
|---|---:|---:|
| Trigger attempts passed | 150/165 (90.91%) | 165/165 (100%) |
| Output cases under the then-current deterministic checker | 4/15 (26.67%) | 13/15 (86.67%) |
| Objective checks under the then-current deterministic checker | 98/120 (81.67%) | 117/120 (97.50%) |

The two candidate output failures were false negatives for word-form counts: “Eight positives” and “only one positive.” After correcting those bounded patterns, the exact same 15 ignored candidate responses were regraded locally with the final committed checker: 15/15 output cases and 120/120 objective checks passed. No host response was regenerated or edited for that regrade. The earlier three-run process therefore retains `quality_passed: false` under its pre-fix checker; a second full three-run host invocation was intentionally not performed. A separate focused live host proof for the analyst and launch-operator cases completed green at 2/2 candidate output cases, 20/20 objective checks, and 21/21 candidate trigger cases.

Codex JSONL usage accounting was available for every trigger batch in the final full run. Raw usage records and responses remain ignored.

## Installer and recovery evidence

The public installer downloaded from `https://sendlens.app/install.sh` had SHA-256 `954df962869d995b02115af6180e5d9f132cbeb8af6240803172632e7643ba55` during validation. Static and isolated execution checks confirmed that it:

- requires `curl`, `bash`, `mktemp`, `node`, and network access;
- neither requires nor executes a preinstalled global Pluxx CLI;
- reports an exact missing command;
- uses a cleaned temporary directory and public GitHub release manifest;
- succeeds with a deliberately failing `pluxx` executable earlier on `PATH`;
- rejects corrupted release checksums.

The live isolated installer check refreshed the installed Codex SendLens bundle as a side effect. Its nine installed files were verified byte-for-byte against the public `0.1.70` bundle after the run.

## Validation record

| Gate | Result |
|---|---|
| Full plugin suite, including smoke, setup-doctor, prompt/routing, skill contracts, public installer, runtime, and agentic proof | Passed |
| `npm run validate:plugin` | Passed |
| `npm run lint:plugin` | Passed with 46 existing Pluxx translation/inheritance warnings and no errors |
| `npm run eval:plugin` | Passed the configured gate; semantic score 70/100 remains advisory |
| `npm run test:legacy-installer-compat` | Passed, including no-global-Pluxx and corruption paths |
| `npm run test:host-bundles` | Passed: five skills, 15 commands, nine agents across Claude Code, Cursor, Codex, and OpenCode |
| Official `skills-ref validate` for all five skills | Passed |
| Orchid repo preflight | Passed with zero failures and zero warnings |
| `git diff --check` | Passed |
| CE Proof publication | Not published: the environment disclosure policy blocked uploading repository-derived QA content to the external service; this committed document is canonical |

Independent correctness, maintainability, and test-coverage review passes were run after implementation. Their valid findings were fixed, including path/reference containment, baseline snapshot integrity, deterministic numeric phrasing, corruption proof, and installed-module inventory targeting; no actionable finding remained. The optional cross-model review path was unavailable under the environment's disclosure policy and was not retried.

## Residual uncertainty

The final output checker is proven against the exact three-run candidate responses, but the full three-run host command was not re-executed after the last deterministic pattern correction. Host model behavior is inherently nondeterministic, so the committed one-per-skill smoke cases and repeatable runner remain the release regression surface. The Pluxx semantic score and its 46 host-translation warnings are pre-existing advisory signals, not validation failures.
