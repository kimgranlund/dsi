# terms-scale-v1 vocabulary instructions

You map one design system's **naming vocabulary for non-color foundation tokens** (geometry, typography, motion) to DesignSystemsIndex facet values. A classifier then decomposes every token name with these terms, so one good term settles a whole scale. Another agent maps the same packet blind; a term is approved only when you both give the same term, concept and match type.

## What matters here

Non-color tokens are **scales**: `space-100 .. space-3200`, `corner-small .. corner-full`, `duration-fast-01`. The index maps each token to its **role** (Spacing, Corner radius, Font size, Duration...) and orders the steps by their actual values. Steps are never given canonical names.

- **Role words** map to a `property` value: `space` / `spacing` -> `dsi:property/spacing`; `border-radius` / `corner` -> `dsi:property/corner-radius`; `font-size` / `size` (in a typescale) -> `dsi:property/font-size`; `duration` -> `dsi:property/duration`; `ease` / `easing` -> `dsi:property/easing`. Multi-word roles (`border-radius`, `line-height`, `z-index`) are one term.
- **Type roles** in typography (display, headline, title, heading, body, label) map to `usage` values. Material `on-surface`-style roles do not occur here.
- **State words** (hover, pressed/active, focus, dragged, disabled) map to `state` values, e.g. Material `hover-state-layer-opacity`.
- **Step words** name positions on a scale: `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, `small`, `medium`, `large`, `fast`, `moderate`, `slow`, `extra-small`, numbers, `full`, `none`, `0`. Answer them with `"ignore": "step"`.
- **Noise** (`md`, `sys`, `ref`, product prefixes) is `"ignore": "noise"`.
- **Style words** (ADR 0014) map to `style`: Carbon `productive` -> `dsi:style/productive` (exact), `expressive` -> `dsi:style/expressive` (exact); Material easing sets `standard` -> `dsi:style/productive` and `emphasized` -> `dsi:style/expressive` (close: Material's names). A word that names a type style family rather than a motion style follows the same rule (`productive-heading`, `expressive-heading`).
- **Component words** map to `component` values (`button`, `card`, `table`, `button-group`), and anatomy words to `part` (`cell`), only when the ontology lists them.
- **Spring words**: `stiffness` -> `dsi:property/spring-stiffness`, `damping` -> `dsi:property/spring-damping`; spring names (`default`, `fast`, `slow`, `spatial`, `effects`) are steps.
- **Corner sides** (`top`, `start`, `end`) on a corner token pick which corners round: they are steps; the classifier files four-value corners under Corner shape.

## Input and output

The packet (`<product>.<role>.packet.json`) lists `ontology` (allowed values; each property value names its domain), `vocabulary` (every word and recurring word sequence in the names, with counts and examples) and `derived` (candidates, if any). Write only the JSON file named in the packet's `output`, valid against `packages/schema/schemas/term-proposals.schema.json`, answering **every single word**:

```json
{ "packet": "<packet.id>", "role": "<packet.role>", "model": "<your model ID>", "at": "<ISO time>",
  "terms": [
    { "term": "space", "concept": "dsi:property/spacing", "match": "exact", "confidence": 0.95, "rationale": "Spacing scale." },
    { "term": "border-radius", "concept": "dsi:property/corner-radius", "match": "exact", "confidence": 0.95, "rationale": "Corner rounding." },
    { "term": "lg", "ignore": "step", "rationale": "Scale position." }
  ] }
```

Check it with `node packages/classify/src/cli.ts vocab-check <product> <run> <role>`.

## Rules

- Map a word to a role only when it names that role in this product's token names; when a word is ambiguous across families (Polaris `size` names the internal size scale, Material `size` is a typescale font size), add the multi-word sequence that disambiguates (`font-size`, `typescale-...`) instead of mapping the bare word.
- `match` follows the token-mapping meaning: `exact` when the word always means that role; `close` with a nuance; `broad` when the word names a narrower case (`fluid-spacing` is a narrower kind of spacing).
- Confidence is your probability that a designer familiar with this system would accept the term as written.
