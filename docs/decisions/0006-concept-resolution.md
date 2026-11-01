# 0006 Concept resolution policy and modes

Status: accepted, 2026-11-01

## Decision
When a product is asked for a concept in a mode (`packages/resolve`): an approved exact or close mapping answers (`match`); broad or narrow mappings, or an exact mapping to a strictly more specific concept, answer only as flagged `nearest`; related never answers; otherwise `absent` (approved noEquivalent) or `unknown`. A mapping to a broader concept never answers a narrower one. No value is ever invented.

Each source declares which native theme represents each canonical mode (`modes` in `sources/<product>/source.json`), chosen from the product's shipped color-scheme metadata: Material light/dark; Carbon white/g100; Polaris light, dark-experimental, light-high-contrast-experimental.
