---
name: sendlens-launch-operator
description: "Use when the user wants a focused SendLens launch, resume, clone, scale, pause, or stop decision, including blocker review, QA, measurement, guardrails, or learning handoff. Broad diagnosis-to-launch requests start with sendlens-analyst."
compatibility: "Requires a host with the SendLens MCP server mounted. Provider access is read-only."
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
3. Separate blockers, warnings, and `passed_checks`; for every entry record the evidence class, source, scope, freshness, and material coverage limit.
4. Return `blocked`, `ready_with_warnings`, or `ready`.
5. Define initial volume, monitoring cadence, primary metric, guardrails, read window, and stop/iterate/scale thresholds. Record each threshold's value, source (`user_policy`, `provider_limit`, `historical_baseline`, or `experiment_hypothesis`), evidence scope, and rationale; never present an invented benchmark as observed evidence.
6. Record what must remain fixed for the experiment to teach anything.
7. Always produce the learning handoff; add a client-safe update when requested.

Do not rewrite the strategy or copy unless a readiness check exposes a specific contradiction. Route substantive redesign back to the owning skill. Do not claim a campaign is ready to scale from aggregate rank alone.

## Operator Handoff

```text
verdict:
- blocked | ready_with_warnings | ready

blockers_and_warnings:
- issue; evidence class; source; scope; freshness; coverage limit; required fix

passed_checks:
- check; evidence class; source; scope; freshness; coverage limit

launch_configuration:
- senders, schedule, volume, tracking, guardrails, personalization requirements

measurement:
- primary metric, guardrails, monitoring cadence, read window, review point

threshold_provenance:
- threshold; value; source; evidence scope; rationale

evidence_coverage:
- exact surfaces checked; sampled surfaces checked; unsupported or missing surfaces

decision_rules:
- stop, iterate, and scale conditions

learning_handoff:
- hypothesis, fixed variables, result to capture, next owner/action
```

## Example Requests

- "Is this campaign ready to launch tomorrow?"
- "Define the monitoring, stop, and scale rules."
- "Close out this campaign test and give me the learning handoff plus a client-safe update."

If required SendLens tools are missing, stop and tell the user to reload or reinstall the plugin/MCP server.

## Final QA Loop

Before returning, verify that every required check appears once under blockers, warnings, or `passed_checks`; evidence coverage distinguishes exact, sampled, support-gated, and missing surfaces; every numeric decision threshold has provenance; and the verdict follows the listed evidence. Keep provider operations read-only and expose no secrets, raw contact data, or private message bodies. Treat Smartlead Smart Delivery as support-gated: use authorized evidence when present, and never interpret missing or empty placement rows as healthy.
