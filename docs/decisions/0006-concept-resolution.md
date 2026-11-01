# 0006 Concept resolution policy and modes

Status: accepted, 2026-11-01

## Decision
When a product is asked for a concept in a mode (`packages/resolve`): an approved exact or close mapping answers (`match`); broad or narrow mappings, or an exact mapping to a strictly more specific concept, answer only as flagged `nearest`; related never answers; otherwise `absent` (approved noEquivalent) or `unknown`. No value is ever invented.

Each source declares which native theme represents each canonical mode (`modes` in `sources/<product>/source.json`), chosen from the product's shipped color-scheme metadata: Material light/dark; Carbon white/g100; Polaris light, dark-experimental, light-high-contrast-experimental.

## Amendment, 2026-11-01 (owner decision after the specimen root-cause probe)
A homepage probe (Playwright, computed colors and contrast per system and mode) traced unreadable sample buttons to this policy, not to the data: Material maps `primary` to Accent and `error` to Danger (broader than Accent background), so the resolver skipped them and answered with `primary-fixed` and `error-container`, pale variants paired with white on-fill labels; and Atlassian's card was answered by `elevation.surface.container.hovered`.

- A mapping to a **broader** concept answers a narrower one as `nearest` only when the missing facets are the **property** alone (Accent answers Accent background: the token is that meaning's color for any property). Never across usage, emphasis or state: Danger never answers Danger on-fill text.
- A **state variant** (hover, active, selected, visited, dragged, disabled) never answers a stateless concept: a hovered surface is not a surface. The cell is unknown instead.
- Ranking: direct, then broader (fewest missing facets), then narrower (fewest added facets).
- A candidate token with no value in the asked theme is skipped.

## Amendment, 2026-11-01 (owner decision, foreground and narrow answers)

- `property/text` and `property/icon` are narrower than `property/foreground` (`skos:broader`). When asked for text or icon, the resolver may answer with a foreground token (`via: broader-property`), ranked after direct answers and before broader concepts. Primer `fgColor.*` and Fluent `Foreground*` color text and icons together.
- A `narrow` mapping to a more specific concept now counts as a nearest answer: the token covers that concept and more, so it covers the requested one too. Within each kind of answer, narrow ranks after exact and close.
