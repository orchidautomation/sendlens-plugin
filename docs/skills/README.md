# SendLens Workflow Docs

SendLens exposes five focused public skills. Broad requests still feel like one workflow because `sendlens-analyst` orchestrates the downstream strategy, copy, and launch skills automatically.

See the [component catalog](../CATALOG.md), [trust and privacy](../TRUST_AND_PRIVACY.md), and [synthetic examples](../examples/SYNTHETIC_OUTPUTS.md) for adjacent context.

## Public Skills

| Skill | Best first use |
| --- | --- |
| [sendlens-analyst](./sendlens-analyst.md) | Diagnose performance, deliverability, replies, ICP, and copy; orchestrate broad end-to-end requests |
| [sendlens-campaign-strategist](./sendlens-campaign-strategist.md) | Turn validated findings into audience, exclusions, offer, angle, sequence architecture, and experiment strategy |
| [sendlens-copywriter](./sendlens-copywriter.md) | Draft evidence-backed subjects, bodies, CTAs, sequences, and meaningful variants |
| [sendlens-launch-operator](./sendlens-launch-operator.md) | Gate launch/scale, define measurement and stop rules, and record learnings or client handoffs |
| [sendlens-setup](./sendlens-setup.md) | First-run setup, doctor checks, host bundle verification, and zero-key demo seeding |

## Legacy Workflow Commands

| Workflow | Best first use |
| --- | --- |
| [using-sendlens](./using-sendlens.md) | MCP-first routing, evidence calibration, and fallback boundaries |
| [workspace-health](./workspace-health.md) | Broad workspace triage and next-action diagnosis |
| [campaign-performance](./campaign-performance.md) | Campaign, step, variant, runway, and sequence performance |
| [copy-analysis](./copy-analysis.md) | Template, subject/body, and personalization analysis |
| [icp-signals](./icp-signals.md) | Campaign-scoped lead segment and payload-variable hypotheses |
| [reply-patterns](./reply-patterns.md) | Positive, negative, neutral, and fetched reply-body patterns |
| [cold-email-best-practices](./cold-email-best-practices.md) | Policy and benchmark lens for recommendations |
| [campaign-launch-qa](./campaign-launch-qa.md) | Launch, scale, resume, clone, or handoff readiness |
| [experiment-planner](./experiment-planner.md) | Next test design with metric, guardrail, and stop condition |
| [account-manager-brief](./account-manager-brief.md) | Client-safe update plus internal action queue |

## Shared Operating Model

- Use `sendlens-analyst` for diagnosis and broad orchestration; use focused skills directly for focused requests.
- Start broad with `workspace_snapshot` when the user asks what is happening.
- Use `sendlens-setup` only when the install, runtime, local state, host bundle, or zero-key demo path needs verification.
- Pick one campaign before deep copy, ICP, reply, or experiment analysis.
- Use `analysis_starters` before custom SQL for common questions.
- Use `load_campaign_data` before one-campaign specialist work.
- Use `prepare_campaign_analysis` when one-campaign working/not-working analysis needs enough exact reply body evidence.
- Use `fetch_reply_text` only when a low-level manual reply body fetch is enough.
- Preserve evidence boundaries: exact, sampled, hybrid, reconstructed, and fetched.
- Run strategist → copywriter → launch operator after diagnosis when a broad request spans the full chain.
