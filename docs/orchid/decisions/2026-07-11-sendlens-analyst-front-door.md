# Decision: Five Focused Skills, One Effortless Flow

Date: 2026-07-11
Linear: `SEND-199`

## Decision

SendLens exposes five public Agent Skills:

- `sendlens-analyst` for performance, deliverability, reply, ICP, and copy diagnosis plus broad orchestration
- `sendlens-campaign-strategist` for campaign audience, exclusions, offer, angle, sequence architecture, personalization, CTA, and experiment strategy
- `sendlens-copywriter` for evidence-backed subjects, bodies, CTAs, follow-ups, sequences, and meaningful variants
- `sendlens-launch-operator` for readiness, scale/stop rules, measurement, and learning or client handoff
- `sendlens-setup` for installation, runtime, cache, refresh, and demo readiness

Broad prompts start with the analyst and continue automatically through the downstream skills required by the request. Focused prompts activate only the owning skill, with the minimum prerequisite evidence work when needed.

Legacy slash commands remain compatibility shortcuts and preserve specialist-agent routing where the host supports it.

## Why

One broad business skill made the user experience simple but blurred distinct jobs and trigger boundaries. Five focused skills preserve progressive disclosure, reduce irrelevant prompt loading, and let focused requests go directly to the right workflow.

The analyst still prevents orchestration friction. A user can ask what is working, what to run next, what to write, and how to launch it in one prompt without manually invoking four skills.

## Shared Contracts

- All skills use the same read-only SendLens MCP data layer.
- `sendlens-analyst` owns the shared evidence, metric, schema, join, reply, ICP, and copy-diagnostic references.
- Focused skills link to that shared contract and add only their job-specific procedure.
- Pluxx owns host-specific command and agent translation; portable skill frontmatter remains Agent Skills compliant.

## Guardrails

- Provider operations remain read-only.
- Broad aggregates shortlist campaigns but cannot prove a winner.
- Premium claims require one-campaign hydration and honest evidence labels.
- Strategy cannot bypass stronger sender, deliverability, supply, or readiness constraints.
- Copy cannot fabricate proof, quantified lift, capabilities, urgency, or reply language.
- Launch and scale decisions require blockers, measurement, guardrails, and stop/iterate/scale rules.

## Consequences

- Automatic broad workflows remain effortless.
- Focused strategy, drafting, launch, and setup prompts load less irrelevant guidance.
- Trigger evals must test both positive intent and near-miss ownership boundaries.
- Existing command users retain familiar entrypoints.
