# Glossary

Authoritative project vocabulary. Once `ontology/` exists, each term also lists its concept ID; the ontology then owns the formal definition and this file stays the prose explanation.

## Categories

Layers in a stack. Classify products, not organizations.

| Term | Definition | Examples |
|---|---|---|
| Token Format | Spec for expressing tokens | DTCG |
| Token Tooling | Transforms tokens, ships no values | Style Dictionary, Terrazzo, Tokens Studio |
| Token Set | Standalone token values, no components | Open Props, Radix Colors |
| Styling Engine | Turns tokens into styles; may ship a default token set | PandaCSS, Tailwind, StyleX |
| Headless Primitives | Behavior and accessibility, no visual opinion | Radix Primitives, Melt, Zag, React Aria |
| Component Library | Styled components without a governing design language | shadcn/ui, Chakra, Mantine, MUI |
| Design System | Governed design language: tokens, guidance, components | Material, Carbon, Polaris |
| UI Framework | Out of scope; only an implementation's `targets` | React, Vue, Svelte |
| Implementation | A shipped codebase of a design system | Material Web, Angular Material |

## Tiers

| # | Tier | Binds | Example |
|---|---|---|---|
| 1 | Source | raw value | `--plum-12` |
| 2 | Scale (optional) | hue + relative step | `--plum-strong` |
| 3 | Semantic | intent | `--danger-strong` |
| 4 | System | usage | `--system-heading-text` |
| 5 | Component | component + part | `--button-danger-bg` |

## Model terms

| Term | Definition |
|---|---|
| Native token | A token as the product ships it, stored in DTCG with its native name |
| Concept | A canonical meaning in the ontology, e.g. Danger |
| Facet | One dimension of a concept: intent, property, emphasis, state, mode, component, part |
| Mapping | A typed SKOS link between a native token and a concept |
| Match type | `exact`, `close`, `broader`, `narrower`, `related` |
| Alias graph | References between tokens inside one product (vertical) |
| Mapping graph | Links from native tokens to concepts, across products (horizontal) |
| Canonical token set | The concept layer emitted as DTCG; each product resolves it as a theme |
