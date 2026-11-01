# @dsi/resolve

The one place that turns tokens and concepts into values. Used by the mapper today and by canon, the database build and the site next.

## Kind

Code. Reads `data/native/`, `mappings/` and `ontology/`; writes nothing.

## Token resolution

`resolve(set, theme, path)` follows aliases through the theme's file, then the mode-independent files, and resolves aliases nested inside composite values (a transition's `duration`, a shadow's `color`). It reports `cycle` or `unresolved` instead of guessing. `themeFor(set, mode)` picks the theme a source declares for a canonical mode (`sources/<product>/source.json` `modes`).

## Concept resolution

`resolveConcept(ontology, set, mappings, concept, mode)` answers how one product represents a canonical concept. Only Approved records count.

| Status | When |
|---|---|
| `match` | an exact or close mapping to the concept |
| `nearest` | only broad or narrow mappings to it, or an exact/close mapping to a strictly more specific concept (same facets plus more). Always flagged, never shown as equal. |
| `absent` | an approved `noEquivalent` says the product has no such token |
| `unknown` | nothing approved either way, or no theme for the asked mode |

Related mappings never answer. A mapping to a broader concept never answers a narrower one. No value is ever invented.

## Run

From the repo root:

- `node packages/resolve/src/cli.ts token carbon support-error dark`
- `node packages/resolve/src/cli.ts concept dsi:concept/color/intent-danger/property-text dark`

## Checks

`corepack pnpm --filter @dsi/resolve check`.
