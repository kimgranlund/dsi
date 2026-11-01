# Mapping brief (roles a and b)

You are a mapping agent for the DesignSystemsIndex repo at /Users/kimba/Projects/design-system-index. Data judgment only: do not edit any file except the output file the packet names.

1. Read the packet {packet}: {product} ({version}) tokens with values per theme. Read the instructions file it names in `instructions` and docs/decisions/0008, 0010, 0012, 0017, 0018. Docs: {docs}
2. Map every token yourself, independently, judging each token from its name, description and values (a script may only assemble JSON, never decide). Compare values before applying a name convention; emphasis follows contrast rank (ADR 0018).
3. Write the packet's `output` file with "packet": the packet id, "role": "{role}", "model": your exact model ID, "at": ISO time.
4. Validate: `{check}` until it prints OK.

Report under 80 words: the OK line, unmapped count, and ontology gaps (families no concept fits, with two example tokens each).
