# color-v1 mapping instructions

You map one design system's semantic and system **color** tokens to the DesignSystemsIndex canonical concepts. Another agent maps the same packet independently; a mapping is approved only when you both reach the same concept and match type. Judge each token on its own evidence. Do not guess what the other agent will say.

## Input

The packet (`<product>.packet.json`) has:

- `ontology`: every allowed facet value with its definition, the concept IRI grammar, and the match types.
- `tokens`: each token's path, native name, `$description` (when shipped), and for every theme the alias chain and the final color.
- `rejected`: earlier (token, concept, match) answers a reviewer rejected. Never give one of these again.

## Conventions

Read `docs/decisions/0008-mapping-conventions.md` first. It records how recurring patterns were settled in review (secondary, tertiary, layers, on-fill, fixed tokens, links on inverse, neutral fills). Follow it unless the token's own evidence clearly contradicts it, and say so in the rationale when you depart.

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

A concept is `dsi:concept/color/<facet>-<value>/...` with facets in this order: **intent, usage, syntax, property, emphasis, brightness, state**. Use only values listed in the packet's ontology. Bind a facet only when the token's name, description or usage clearly fixes it; an unbound facet means "not specific to that dimension", never "default".

- **Intent** is what the color communicates (danger, warning, caution, success, info, accent, neutral, highlight, destructive, ai). Caution is a milder warning (Polaris caution, Carbon support-caution-minor); highlight marks editor focus regions and text selection (Polaris emphasis, Carbon highlight). Bind intent from meaning, not hue: a red palette step is not Danger.
- **Usage** is where it applies across components (page, surface, overlay, scrim, inverse, on-fill, field, link, navigation, skeleton, categorical). `on-fill` is content placed on a strong filled background of an intent or accent (Material `on-error`, Polaris `*-on-bg-fill`, Carbon `*-on-color`).
- **Property** is what it paints: background, foreground, text, icon, border, focus-ring, shadow. Use `foreground` when one token colors both text and icons (Material `on-*`, most "content" tokens); `text` or `icon` only when the token is limited to one.
- **Emphasis** is relative strength: subtlest, subtle, default, strong, strongest. Use subtle/strong for "secondary", "subdued", "container" (subtle background) or "strong", "emphasis", "bold" variants; use subtlest and strongest only for the ends of families with more than three steps (Material `surface-container-lowest` .. `-highest`; Carbon `layer-01` .. `layer-03` map to subtle, default, strong). Leave emphasis unbound for the base token of a family.
- **State**: hover, active (pressed), focus, disabled, selected, visited.
- **Combining**: usage and state may hold two values joined with `+`, sorted alphabetically: `usage-inverse+link` (link on an inverse surface), `state-hover+selected`. No other facet combines.

Prefer the most specific concept the evidence supports. Examples:

| Token | Concept | Match |
|---|---|---|
| Polaris `color-bg-fill-critical` | `dsi:concept/color/intent-danger/property-background` | exact |
| Polaris `color-text-critical` | `dsi:concept/color/intent-danger/property-text` | exact |
| Material `md.sys.color.error-container` | `dsi:concept/color/intent-danger/property-background/emphasis-subtle` | close |
| Carbon `text-secondary` | `dsi:concept/color/property-text/emphasis-subtle` | exact |
| Polaris `color-bg` | `dsi:concept/color/usage-page/property-background` | exact |
| Material `md.sys.color.on-error` | `dsi:concept/color/intent-danger/usage-on-fill/property-foreground` | exact |
| Material `md.sys.color.surface-container-highest` | `dsi:concept/color/usage-surface/property-background/emphasis-strongest` | close |
| Material `md.sys.color.secondary` | `dsi:concept/color/intent-accent` | broad |
| Carbon `button-danger-primary` | (out of scope: component token) | |

## Match types

The subject is the native token, the object is the concept.

Pick by this test, in order:

1. Would every use of the token be correct use of the concept, and vice versa? `exact`.
2. Is the token **one specific case** of the concept (one of several accent colors, one surface level the concept does not distinguish, one component's use)? `broad`. Never `close` for this.
3. Does the token **also** cover meanings outside the concept? `narrow`.
4. Same meaning, but with a nuance a designer would mention (a slightly different scope, a platform-specific twist)? `close`.
5. Only associated? `related`.

- `exact`: same meaning for every use.
- `close`: same meaning for comparison, with a known nuance (note it in the rationale).
- `broad`: the **concept is broader**; the token is a narrower case of it (e.g. a token only for one surface level).
- `narrow`: the **concept is narrower**; the token also covers other meanings (Material `error` is used for both danger status and destructive actions, so `error` -> Danger is `narrow`).
- `related`: associated, never interchangeable. Use it only when nothing better fits but a link is still useful.

## Confidence

Your probability that a careful designer familiar with this system would accept the concept **and** match type. 0.9+ when name, description and values all agree; 0.6 to 0.85 when you are inferring from the name alone or choosing between two plausible concepts. Below 0.5, prefer `unmapped` with a rationale.

## Special cases

- **Secondary and tertiary accents** (Material `secondary`, `tertiary` and their containers): map to the accent concept with `broad`; there is one accent intent.
- **Theme-invariant "fixed" tokens** (Material `*-fixed`, `*-fixed-dim`, `on-*-fixed`): the counterpart is the **container** role, frozen at its light-theme value (`primary-fixed` = `primary-container` in light; `on-primary-fixed` = `on-primary-container`). Give the container's concept and match (`primary-fixed` -> accent background, subtle emphasis), and say "fixed across themes" in the rationale. Check the values: they show the counterpart. Invariance itself is not a concept (ADR 0010).
- **Content on intent containers** (Material `on-error-container`, `on-primary-container`): `usage-on-fill` with `emphasis-subtle`, property `foreground`.
- **Syntax highlighting** (Carbon `syntax-*`): `dsi:concept/color/syntax-<lezer-tag>/property-text`, exact; values are the @lezer/highlight tags (ADR 0012).
- **Categorical palettes** (Polaris avatar colors, Atlassian `accent.<hue>`, Primer `display.<hue>`, Carbon tags): `usage-categorical` (+ `on-fill` for their text), plus the **hue** facet when the token names its hue: `dsi:concept/color/usage-categorical/hue-blue/property-background/emphasis-strong`. Use the canonical hue the native name means (`exact` when the names agree; `close` when the native hue is a neighbor such as coral -> red, plum -> purple, pine -> green, olive -> lime, lemon -> yellow, auburn -> brown, cool-gray -> gray). Numbered chart slots without a hue name (`chart.categorical.1`) get no hue. Hue never binds without usage categorical (ADR 0017).
- **Brightness** (Material surface-dim/bright): the `brightness` facet, not emphasis.
- **Warning severity** (Carbon support-caution-minor/major): Warning, and Warning with strong emphasis; Polaris caution (milder than warning) is Caution.
- **Prominence words** (secondary, tertiary): lower prominence as the product defines it, even when the color is darker (ADR 0012).

## Unmapped

Use `"unmapped": true` when no allowed combination captures the token (syntax highlighting roles, data visualization palettes, avatar colors, brand illustration colors). Say which concept is missing: these become the ontology backlog.
