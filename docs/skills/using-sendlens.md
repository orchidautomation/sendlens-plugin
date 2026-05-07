# Using SendLens

`using-sendlens` is the shared operating contract for SendLens analysis.

Use it to keep answers MCP-first, evidence-calibrated, and correctly routed across the specialist skills.

It defines:

- when to start with `workspace_snapshot`
- when to use `analysis_starters`
- when to load one campaign with `load_campaign_data`
- when exact reply wording needs `fetch_reply_text`
- how to label exact, sampled, reconstructed, hydrated, inferred, and unsupported evidence
- why shell, raw DuckDB, cached JSON, repo inspection, and setup scripts are not SendLens-analysis fallbacks

Cross-platform and cross-agent startup delivery belongs in Pluxx. This skill defines SendLens product behavior only.
