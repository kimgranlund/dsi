# audit-v1 instructions

You audit approved mappings from one design system's color tokens to DesignSystemsIndex canonical concepts. You are not told who approved each mapping, and it does not matter: judge each one only against evidence. Your job is to find mappings the evidence contradicts, not to re-map from taste.

## Input

`<product>.audit-packet.json` has, per approved mapping:

- `mapping`: the concept and match type under audit. Concepts read `dsi:concept/color/<facet>-<value>/...` (facets: intent, usage, property, emphasis, state); match types follow `packages/mapper/prompts/color-v1.md` (the token is the subject: `broad` = the token is a narrower case of the concept, `narrow` = the token covers more).
- `description`: the product's own description of the token, when it ships one. Strong evidence.
- `values`: alias chain and color per theme.
- `usedBy`: shipped tokens that alias this one, with the role their names indicate (`background`, `text`, `icon`, `border`). Strong evidence for the property facet.
- `observedUses`: where the system's own shipped component CSS uses the token: count, components, the dominant CSS property class (background, text, icon, border, ...) with its share, the dominant state with its share, and example rules. Strong evidence for property and state, cite it as kind `usage` with the component and selector as source. It does not speak to intent or emphasis by itself.
- `sameValueSiblings`: other approved tokens with identical values in every theme, and how they are mapped.
- `checks`: findings from deterministic checks (hue vs intent, property vs usage, on-fill contrast, classifier disagreement). A finding is a lead, not a verdict: some are expected (a neutral fill with brand-black hue, an experimental theme with low contrast).
- `docs`: the product's official color documentation. Fetch these pages and use what they say about specific tokens or roles; cite the URL.

Also apply `docs/decisions/0008-mapping-conventions.md`: a mapping that follows a recorded convention is supported unless the token's own evidence contradicts it.

## Verdicts

For every item write one verdict:

- `supported`: at least one piece of evidence (description, docs, usage, values) affirmatively fits the concept and match, and none contradicts it.
- `contradicted`: specific evidence shows the concept or match is wrong (wrong intent, property or usage; or `exact` where the evidence shows a narrower case). Give `suggested` (concept and match) that the evidence supports.
- `insufficient`: nothing beyond the name speaks to it. Do not guess.

Each verdict lists its `evidence` items: `kind` (usage, description, docs, value, sibling), `source` (token path, file or URL), and `says` (what it shows, quoted when possible). Keep notes short.

## Output

Write only the JSON file named in the packet's `output`, valid against `packages/schema/schemas/audit.schema.json`:

```json
{ "packet": "<packet.id>", "model": "<your model ID>", "at": "<ISO time>",
  "verdicts": [
    { "token": "text-error", "mappingId": "m-...", "verdict": "supported",
      "evidence": [{ "kind": "description", "source": "text-error", "says": "Error message text color" }] }
  ] }
```

One verdict per item. Check it with `node packages/mapper/src/cli.ts audit-check color-v1 <run> <product>`.
