---
name: "targeting-diagnosis"
description: "Turn campaign evidence into audience redefinition, targeting decisions, and next-play recommendations."
---

# Targeting Diagnosis

Turn campaign evidence into audience redefinition, targeting decisions, and next-play recommendations.

## Tools In This Skill

- `workspace_snapshot`
- `analysis_starters`
- `load_campaign_data`
- `analyze_data`
- `list_columns`
- `search_catalog`

## Usage

- Use this when the user asks who to target next, whether the current audience is wrong, how to redefine targeting, or what plays to test from the observed campaign evidence.
- Do not use this as a second ICP-signal command. `icp-signals` finds segment and payload correlations; `targeting-diagnosis` decides what to do with those signals.
- Start with `workspace_snapshot` unless the user already named one campaign or Instantly tag.
- Keep the first read active-only by default. Include inactive or historical campaigns only when the user explicitly asks.
- If no campaign is named, pick the one campaign where a targeting decision would be most useful: meaningful volume, enough reply or opportunity signal, or a clear underperformance problem.
- Run `load_campaign_data` before making campaign-specific targeting recommendations.
- Pull `analysis_starters(topic="campaign-performance")`, `analysis_starters(topic="reply-patterns")`, and `analysis_starters(topic="icp-signals")` as needed before custom analysis.
- Use `campaign_overview` and campaign aggregate tables for exact performance baselines.
- Use `lead_evidence`, `reply_context`, and `lead_payload_kv` for sampled lead and payload evidence. Keep sampled-evidence caveats explicit.
- Use `icp-signals` style payload analysis to identify candidate segments, but frame the final answer as a targeting hypothesis and next test plan.
- Incorporate user-provided business context when available: product, current customer base, ACV, sales motion, vertical focus, buying committee, constraints, or strategic bets.
- If business context is missing, say which assumptions are being made and separate "observed campaign evidence" from "business-context assumptions."
- Recommend 2-3 next plays in a lightweight GTM format: audience, signal/enrichment, message angle, test setup, and success metric.
- Keep the plays execution-ready but do not require any external PlayKit or Clay tool to exist in the host session.
- Do not invent market facts, exact buyer pains, or public company evidence. If external research is unavailable, mark those items as assumptions or user-supplied context.
- End with a compact decision: keep, narrow, split, exclude, or retest the audience.

## Output Shape

Return:

- observed evidence
- targeting diagnosis
- audience redefinition
- next plays
- confidence and caveats

## Example Requests

- "Who should we target next?"
- "Is our targeting wrong?"
- "Based on this campaign, how should we redefine the audience?"
- "What plays should we run next from what is working?"
- "Turn the ICP signals into a targeting plan."
