# Operator Memory

Operator memory captures reusable SendLens operating lessons that are safe for the public OSS repository. It is not a customer notebook, private strategy log, CRM, or replacement for the local DuckDB cache.

See also: [schema](./SCHEMA.md), [generic playbooks](./PLAYBOOKS.md), [trust and privacy](../TRUST_AND_PRIVACY.md), and the [component catalog](../CATALOG.md).

## Public-Safe Rule

Operator memory may include:

- generic setup friction patterns
- public-safe troubleshooting heuristics
- evidence classification rules
- reusable copy, ICP, reply, launch QA, experiment, and deliverability playbooks
- synthetic examples
- links to public docs

Operator memory must not include:

- customer names, domains, email addresses, campaign names, lead data, reply text, screenshots, or exports
- API keys, env values, local file contents, DuckDB rows, or logs with private data
- exact private metrics from a workspace
- pricing, enterprise strategy, private customer discovery, or non-OSS roadmap notes
- internal Linear-only context that has not been cleared for public GitHub/docs

When in doubt, keep the memory generic or move it to the private operating system instead of the OSS repo.

## Files

- [SCHEMA.md](./SCHEMA.md): public-safe schema for memory entries.
- [PLAYBOOKS.md](./PLAYBOOKS.md): initial generic playbooks for common SendLens operator patterns.

## Review Checklist

Before committing operator memory:

- Replace real names and values with generic placeholders.
- Remove exact private metrics unless they are clearly synthetic.
- Remove raw reply language unless it is synthetic.
- Link to docs instead of copying private logs.
- Mark evidence type: exact, sampled, hybrid, reconstructed, fetched, or operator judgment.
- Confirm the entry can be useful to a stranger installing the OSS plugin.
