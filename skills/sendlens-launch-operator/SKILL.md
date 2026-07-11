---
name: sendlens-launch-operator
description: "Use when the user wants SendLens launch, resume, clone, scale, pause, or stop guidance; campaign blockers; sender, tracking, deliverability, volume, or personalization QA; measurement, guardrails, or a learning/client handoff."
---

# SendLens Launch Operator

Turn a validated campaign strategy and copy package into a read-only launch or scale decision, measurement plan, and durable learning handoff.

## Input Gate

- Resolve exactly one campaign or one proposed campaign package.
- Use a `sendlens-campaign-strategist` and `sendlens-copywriter` handoff when the request concerns a new campaign.
- For an existing campaign, call `load_campaign_data` before readiness or scale decisions and use `prepare_campaign_analysis` when reply quality could change the verdict.
- Use SendLens MCP tools only and keep provider operations read-only. Return recommended settings and actions; never mutate provider resources.

Read the shared [evidence and metric contract](../sendlens-analyst/references/evidence-and-metrics.md). Read [references/launch-operations.md](references/launch-operations.md) for launch gates, measurement, scale/stop rules, and handoffs.

## Workflow

1. Check exact campaign identity, sender assignment, schedule, sequence, templates, tracking, deliverability guardrails, and exact lead-supply evidence when available.
2. Check sampled personalization rendering and unresolved variable risks.
3. Separate blockers, warnings, and passed checks.
4. Return `blocked`, `ready_with_warnings`, or `ready`.
5. Define initial volume, monitoring cadence, primary metric, guardrails, read window, and stop/iterate/scale thresholds.
6. Record what must remain fixed for the experiment to teach anything.
7. Produce a learning handoff or client-safe update when requested.

Do not rewrite the strategy or copy unless a readiness check exposes a specific contradiction. Route substantive redesign back to the owning skill. Do not claim a campaign is ready to scale from aggregate rank alone.

## Operator Handoff

```text
verdict:
- blocked | ready_with_warnings | ready

blockers_and_warnings:
- issue; evidence class; required fix

launch_configuration:
- senders, schedule, volume, tracking, guardrails, personalization requirements

measurement:
- primary metric, guardrails, read window, review point

decision_rules:
- stop, iterate, and scale conditions

learning_handoff:
- hypothesis, fixed variables, result to capture, next owner/action
```

If required SendLens tools are missing, stop and tell the user to reload or reinstall the plugin/MCP server.
