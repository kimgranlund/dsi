# Glossary

Prose explanation of project vocabulary. Formal definitions and IDs live in `ontology/` (`dsi:` prefix, see `ontology/context.jsonld`); when the two disagree, the ontology wins and this file is fixed.

## Categories

Layers in a stack. Classify products, not organizations.

| Term | ID | Definition | Examples |
|---|---|---|---|
| Token Format | `category/token-format` | Spec for expressing tokens | DTCG |
| Token Tooling | `category/token-tooling` | Transforms tokens, ships no values | Style Dictionary, Terrazzo, Tokens Studio |
| Token Set | `category/token-set` | Standalone token values, no components | Open Props, Radix Colors |
| Styling Engine | `category/styling-engine` | Turns tokens into styles; may ship a default token set | PandaCSS, Tailwind, StyleX |
| Headless Primitives | `category/headless-primitives` | Behavior and accessibility, no visual opinion | Radix Primitives, Melt, Zag, React Aria |
| Component Library | `category/component-library` | Styled components without a governing design language | shadcn/ui, Chakra, Mantine, MUI |
| Design System | `category/design-system` | Governed design language: tokens, guidance, components | Material, Carbon, Polaris |
| UI Framework | `target/*` | Not a category or product; only a value of `targets` | React, Vue, Svelte |
| Implementation | (catalog entity) | A shipped codebase of a design system, linked by `implements`; not a category | Material Web, Angular Material |

## Tiers

| # | Tier | ID | Binds | Example |
|---|---|---|---|---|
| 1 | Source | `tier/source` | raw value | `--plum-12` |
| 2 | Scale (optional) | `tier/scale` | hue + relative step | `--plum-strong` |
| 3 | Semantic | `tier/semantic` | intent | `--danger-strong` |
| 4 | System | `tier/system` | usage | `--system-heading-text` |
| 5 | Component | `tier/component` | component (usually with a part) | `--button-danger-bg` |

## Model terms

| Term | Definition |
|---|---|
| Native token | A token as the product ships it, stored in DTCG with its native name |
| Concept | A canonical meaning: a facet combination with a compositional IRI, e.g. `dsi:concept/color/intent-danger/property-background` (Danger background) |
| Facet | One dimension of a concept: domain, scale, step, emphasis, intent, property, usage, component, part, state (identity facets) and mode (context facet) |
| Mapping | A typed SKOS link between a native token and a concept |
| Match type | `match/exact`, `close`, `broad`, `narrow`, `related` (SKOS mapping properties; subject is always the native token) |
| Intent | Hue-independent meaning, e.g. `intent/danger` (status) vs `intent/destructive` (action), linked as related; `intent/ai` marks AI content |
| Usage | Where a token applies across components: `usage/page`, `surface`, `overlay`, `scrim`, `inverse`, `on-fill`, `field`, `link`, `navigation`, `skeleton` (`code` deprecated) |
| Foreground | `property/foreground`: one token coloring both text and icons; `property/text` and `property/icon` are for one only |
| Emphasis | `subtlest`, `subtle`, `default`, `strong`, `strongest`: relative strength within a family |
| Alias graph | References between tokens inside one product (vertical) |
| Mapping graph | Links from native tokens to concepts, across products (horizontal) |
| Canonical token set | The concept layer emitted as DTCG; each product resolves it as a theme |
