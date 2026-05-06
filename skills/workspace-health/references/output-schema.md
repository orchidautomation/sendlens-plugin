# Output Schema Guidance

Keep SendLens answers compact and structured enough that a human can act on them without parsing tool details.

## Default Shape

Use this shape unless the skill defines a more specific one:

```text
Verdict:
- <one-line answer>

Evidence basis:
- <claim or metric> -- <evidence_class>; <source/tool>; <scope>; <important cap/caveat if material>

Findings:
- <finding with metric/sample and why it matters>

Actions:
- <ranked next action with owner or target when inferable>

Caveats:
- <only limitations that could change the answer>
```

## Evidence Basis Requirements

- Include the scope: workspace, tag, campaign name/ID, date/window, active-only or historical.
- Name the basis for any ranking: exact campaign aggregate, step `unique_reply_rate`, `opportunity_rate`, sampled lead evidence, reconstructed outbound, or hydrated reply body.
- Include `row_count`, sample size, truncation, or warnings when they materially affect confidence.
- Mark unsupported asks clearly instead of padding with generic advice.

## Language Rules

- Use "shows" for exact aggregates.
- Use "suggests", "directional", or "worth testing" for sampled evidence.
- Use "locally reconstructed" for rendered outbound.
- Use "fetched inbound reply" for hydrated reply text.
- Use "I would test" or "likely" for inference.
- Avoid "proves", "guarantees", "delivered text", "all leads", and "the ICP is" unless exact evidence actually supports it.
