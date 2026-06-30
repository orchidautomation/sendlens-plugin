# SendLens Orchid Artifact Map

This repo is prepared for Orchid Agent Stack workflows. Commit durable planning,
review, QA, decision, and provenance artifacts here when they will help future
SendLens work.

- `brainstorms/` stores early thinking, PRDs, and problem framing.
- `requirements/` stores scoped source summaries and requirements.
- `plans/` stores implementation plans and CE plans.
- `todos/` stores durable handoffs and task breakdowns that do not belong in Linear yet.
- `decisions/` stores ADRs and durable product/architecture decisions.
- `solutions/` stores reusable solved-problem writeups and compound learning.
- `reviews/` stores document/code review summaries.
- `history/` stores curated Entire-backed work history, provenance summaries, and "what happened" writeups.
- `pulse-reports/` stores product pulse reports.
- `visual-plans/` stores BuilderIO/Agent-Native visual plan MDX artifacts.
- `visual-recaps/` stores BuilderIO/Agent-Native visual recap MDX artifacts.
- `qa/` stores QA notes, screenshots, and release/deploy evidence.

Do not commit secrets, auth material, raw customer campaign exports, private
reply transcripts, or local browser/session data in any artifact.

Keep raw, private, temporary, or bulky agent outputs in `.agent-artifacts/`, which should be gitignored.
