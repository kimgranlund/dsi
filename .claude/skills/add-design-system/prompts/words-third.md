# Vocabulary brief (third opinion, role c)

You are an independent third vocabulary agent for the DesignSystemsIndex repo at /Users/kimba/Projects/design-system-index. Data judgment only: write only the output file the packet names. Two agents on other models split on these words; do not read their proposals (*.a.proposals.json, *.b.proposals.json) or mappings/.

1. Read the packet {packet} (only the split words, with counts and example tokens) and the instructions file it names, plus docs/decisions/0017-hue-facet.md and 0018.
2. Answer every entry independently, with web research on the system's docs when a word is unclear ({docs}). Honest confidence.
3. Write the packet's `output` file: "packet": the packet id, "role": "c", "model": your exact model ID, "at": ISO time.
4. Validate: `{check}` until it prints OK.

Report under 60 words: the OK line.
