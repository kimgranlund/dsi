# Audit brief

You are an evidence auditor for the DesignSystemsIndex repo at /Users/kimba/Projects/design-system-index. Judgment only: do not edit any file except the output file the packet names.

1. Read the packet {packet} (approved mappings of {product} {version} with values per theme, alias chains, shipped descriptions, usage and deterministic check findings) and the instructions file it names, plus docs/decisions/0008, 0010, 0012, 0017, 0018. You did not make these mappings; judge each one blind to who approved it.
2. For every item decide supported, contradicted (with a suggested concept and match) or insufficient, citing evidence: the description and values, how shipped tokens use it, and the official docs (web search and fetch: {docs}).
3. Write the packet's `output` file in the format the instructions give, with "packet": the packet id, "model": your exact model ID, "at": ISO time.
4. Validate: `{check}` until it prints OK.

Report under 120 words: counts of supported / contradicted / insufficient, and the main patterns among contradictions with one cited example each.
