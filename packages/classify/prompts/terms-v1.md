# terms-v1 vocabulary instructions

You map one design system's **naming vocabulary** (the words its color token names are built from) to DesignSystemsIndex facet values. A classifier then decomposes every token name with these terms, so one good term settles dozens of tokens. Another agent maps the same packet blind; a term is approved only when you both give the same term, facet, value and match type.

## Input

`<product>.<role>.packet.json` lists:

- `ontology`: allowed values per facet (intent, usage, property, emphasis, state) with definitions.
- `vocabulary`: every word and two/three-word sequence that appears in the product's semantic color token names, with how many tokens use it and example tokens. Noise words already known are removed.
- `derived`: candidate terms learned from approved token mappings, with evidence (support = tokens containing the term, agree = how many bind that value). Evidence, not instructions: drop a candidate that is a coincidence.

## Conventions

Read `docs/decisions/0008-mapping-conventions.md`: terms must agree with the conventions settled in review (for example `secondary` -> `dsi:emphasis/subtle`, `brand` and `interactive` -> `dsi:intent/accent`).

## Output

Write only the JSON file named in the packet's `output`, valid against `packages/schema/schemas/term-proposals.schema.json`:

```json
{ "packet": "<packet.id>", "role": "<packet.role>", "model": "<your model ID>", "at": "<ISO time>",
  "terms": [
    { "term": "critical", "concept": "dsi:intent/danger", "match": "exact", "confidence": 0.95, "rationale": "Polaris's name for the danger status." },
    { "term": "bg", "concept": "dsi:property/background", "match": "exact", "confidence": 0.95, "rationale": "Abbreviation of background." },
    { "term": "on-bg-fill", "concept": "dsi:usage/on-fill", "match": "exact", "confidence": 0.9, "rationale": "Content placed on a filled background." },
    { "term": "on-bg-fill", "concept": "dsi:property/text", "match": "exact", "confidence": 0.9, "rationale": "Overrides bg: every Polaris on-bg-fill token colors text, not the fill (approved in review)." },
    { "term": "avatar", "ignore": "no-concept", "rationale": "Avatar palette; no facet fits." }
  ] }
```

## Rules

- **Answer every single word** in `vocabulary` (map it, or `ignore` it with a reason). Multi-word sequences are optional: add one only when it means something different from its words, typically an exception that must override a shorter term (`on-bg-fill` overrides `bg`).
- `concept` is a facet-value concept from the packet's `ontology` (`dsi:intent/danger`, `dsi:property/background`). One term may bind several facets (one entry each). A longer term overrides a shorter one on the same facet, so choose the property a multi-word term binds by what the tokens using it actually color (text only, or text and icons).
- `match` says how the word's meaning relates to the facet value, as for token mappings: `exact` when the word always means that value in this product's names; `close` with a nuance; `broad` when the word is one specific case of the value; never use a term for a value it only sometimes implies.
- Do not map hue names (red, blue) to intents. Component and part names (button, field, tab) are `ignore: component`.
- Confidence is your probability that a designer familiar with this system would accept the term as written.
