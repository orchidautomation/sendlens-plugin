# SendLens Skill Docs

These pages explain the shipped SendLens skills from a public, user-facing perspective. Runtime behavior is still defined by `skills/<skill>/SKILL.md`.

See the [component catalog](../CATALOG.md), [trust and privacy](../TRUST_AND_PRIVACY.md), and [synthetic examples](../examples/SYNTHETIC_OUTPUTS.md) for adjacent context.

## Core Workflow

| Skill | Best first use |
| --- | --- |
| [sendlens-setup](./sendlens-setup.md) | First-run setup, doctor checks, host bundle verification, and demo-mode guidance |
| [workspace-health](./workspace-health.md) | Broad workspace triage and next-action diagnosis |
| [campaign-performance](./campaign-performance.md) | Campaign, step, variant, runway, and sequence performance |
| [account-manager-brief](./account-manager-brief.md) | Client-safe update plus internal action queue |
| [campaign-launch-qa](./campaign-launch-qa.md) | Launch, scale, resume, clone, or handoff readiness |
| [experiment-planner](./experiment-planner.md) | Next test design with metric, guardrail, and stop condition |

## Specialist Analysis

| Skill | Best first use |
| --- | --- |
| [copy-analysis](./copy-analysis.md) | Template, subject/body, and personalization analysis |
| [icp-signals](./icp-signals.md) | Campaign-scoped lead segment and payload-variable hypotheses |
| [reply-patterns](./reply-patterns.md) | Positive, negative, neutral, and fetched reply-body patterns |
| [cold-email-best-practices](./cold-email-best-practices.md) | Policy and benchmark lens for recommendations |

## Shared Operating Model

- Start broad with `workspace_snapshot` when the user asks what is happening.
- Use `sendlens-setup` before analysis when the install, runtime, local state, host bundle, or demo mode needs verification.
- Pick one campaign before deep copy, ICP, reply, or experiment analysis.
- Use `analysis_starters` before custom SQL for common questions.
- Use `load_campaign_data` before one-campaign specialist work.
- Use `fetch_reply_text` only when actual reply body text is needed.
- Preserve evidence boundaries: exact, sampled, hybrid, reconstructed, and fetched.
