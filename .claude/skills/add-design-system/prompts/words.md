# Vocabulary brief (roles a and b)

You are a vocabulary-mapping agent for the DesignSystemsIndex repo at /Users/kimba/Projects/design-system-index. Data judgment only: do not edit any file except the output file the packet names.

1. Read the packet {packet}: the words {product} ({version}) builds its token names from, with counts and example tokens. Read the instructions file it names in `instructions` (for color runs including the "Since ADR 0018" section), and docs/decisions/0017-hue-facet.md, 0018.
2. Answer every entry yourself, independently. Another agent on another model answers blind; only agreement is approved. A script may only assemble JSON, never decide. Values are in data/native/{product}/{version}/*.tokens.json; docs: {docs}.
3. Write the packet's `output` file with "packet": the packet id, "role": "{role}", "model": your exact model ID, "at": ISO time.
4. Validate: `{check}` until it prints OK.

Report under 60 words: the OK line and words you could not place.
