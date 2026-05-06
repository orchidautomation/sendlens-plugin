# `cold-email-best-practices`

Applies SendLens cold-email policy rules and benchmark framing when critiquing campaigns or suggesting changes.

Related: [catalog](../CATALOG.md), [trust and privacy](../TRUST_AND_PRIVACY.md), [synthetic examples](../examples/SYNTHETIC_OUTPUTS.md).

## Use When

- The user asks whether settings or copy are healthy.
- Recommendations need a cold-outbound operating lens.
- Another skill has evidence but needs policy framing for what to change.

## Primary Surfaces

- Skill source: `skills/cold-email-best-practices/SKILL.md`
- Command: `/cold-email-best-practices`
- MCP tools: none required by the skill itself

## Rules

- Reply rate matters more than open rate for cold outbound.
- Bounce rate above 2% deserves attention; above 5% is a red flag.
- Open tracking and link tracking should stay off for cold outbound unless there is a specific reason.
- Text-only usually beats polished HTML for cold email.
- Auto-replies should be separated from human replies.
- Recommendations should be concise, specific, and tied to campaign evidence.

## Output Shape

- Policy read.
- Evidence-backed concerns.
- Specific changes.
- What not to optimize for.
- Caveats where the policy is not enough without workspace evidence.

## Evidence Boundaries

This skill provides an operating lens. It should not replace SendLens evidence when campaign data is available. Treat tracking warnings as best-practice guidance, not as hard Instantly API errors.
