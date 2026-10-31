# color-v1 mapping instructions

You map one design system's semantic and system **color** tokens to the DesignSystemsIndex canonical concepts. Another agent maps the same packet independently; a mapping is approved only when you both reach the same concept and match type. Judge each token on its own evidence. Do not guess what the other agent will say.

## Input

The packet (`<product>.packet.json`) has:

- `ontology`: every allowed facet value with its definition, the concept IRI grammar, and the match types.
- `tokens`: each token's path, native name, `$description` (when shipped), and for every theme the alias chain and the final color.
- `rejected`: earlier (token, concept, match) answers a reviewer rejected. Never give one of these again.

## Output

Write **only** a JSON file at the path the packet names in `output`, valid against `packages/schema/schemas/mapper-proposals.schema.json`:

```json
{
  "packet": "<packet.id>",
  "role": "<packet.role>",
  "model": "<your model ID>",
  "at": "<ISO 8601 time>",
  "proposals": [
    { "token": "support-error", "concept": "dsi:concept/color/intent-danger", "match": "close", "confidence": 0.9, "rationale": "Status color for errors across text, icons and borders; not limited to one property." },
    { "token": "syntax-keyword", "unmapped": true, "rationale": "Syntax highlighting roles (keyword, string, comment) have no concepts yet." }
  ]
}
```

Exactly one entry per token in the packet, in any order.

## Choosing the concept

A concept is `dsi:concept/color/<facet>-<value>/...` with facets in this order: **intent, usage, property, emphasis, state**. Use only values listed in the packet's ontology. Bind a facet only when the token's name, description or usage clearly fixes it; an unbound facet means "not specific to that dimension", never "default".

- **Intent** is what the color communicates (danger, warning, success, info, accent, neutral, destructive, ai). Bind it from meaning, not hue: a red palette step is not Danger.
- **Usage** is where it applies across components (page, surface, overlay, scrim, inverse, field, link, navigation, skeleton, code).
- **Property** is what it paints: background, text, icon, border, focus-ring, shadow. Material `on-X` tokens are text/icon on X; when a token covers both text and icons, leave property unbound.
- **Emphasis** is relative strength: subtle, default, strong. Use it for "secondary", "subdued", "container" (subtle background) or "strong", "emphasis", "bold" variants. Leave it unbound for the base token of a family.
- **State**: hover, active (pressed), focus, disabled, selected.

Prefer the most specific concept the evidence supports. Examples:

| Token | Concept | Match |
|---|---|---|
| Polaris `color-bg-fill-critical` | `dsi:concept/color/intent-danger/property-background` | exact |
| Polaris `color-text-critical` | `dsi:concept/color/intent-danger/property-text` | exact |
| Material `md.sys.color.error-container` | `dsi:concept/color/intent-danger/property-background/emphasis-subtle` | close |
| Carbon `text-secondary` | `dsi:concept/color/property-text/emphasis-subtle` | exact |
| Polaris `color-bg` | `dsi:concept/color/usage-page/property-background` | exact |
| Carbon `button-danger-primary` | (out of scope: component token) | |

## Match types

The subject is the native token, the object is the concept.

- `exact`: same meaning for every use.
- `close`: same meaning for comparison, with a known nuance (note it in the rationale).
- `broad`: the **concept is broader**; the token is a narrower case of it (e.g. a token only for one surface level).
- `narrow`: the **concept is narrower**; the token also covers other meanings (Material `error` is used for both danger status and destructive actions, so `error` -> Danger is `narrow`).
- `related`: associated, never interchangeable. Use it only when nothing better fits but a link is still useful.

## Confidence

Your probability that a careful designer familiar with this system would accept the concept **and** match type. 0.9+ when name, description and values all agree; 0.6 to 0.85 when you are inferring from the name alone or choosing between two plausible concepts. Below 0.5, prefer `unmapped` with a rationale.

## Unmapped

Use `"unmapped": true` when no allowed combination captures the token (syntax highlighting roles, data visualization palettes, avatar colors, brand illustration colors). Say which concept is missing: these become the ontology backlog.
