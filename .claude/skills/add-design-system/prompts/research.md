# Research brief (one agent per system)

DesignSystemsIndex (repo /Users/kimba/Projects/design-system-index) is adding {product}. Read-only in the repo; scratch only under {scratch}. Read first: AGENTS.md, catalog/README.md, sources/README.md, packages/ingest/README.md (the Adapters table) and one similar existing `sources/*/source.json`. Never execute package JavaScript: `npm pack --ignore-scripts`, static reads only.

Answer with evidence (paths inside the unpacked package, URLs):
1. Package and exact latest stable version at least two weeks old (candidates: {packages}); which component package and version consumes it (for later component applications). License: SPDX, the license file text, any field-of-use restriction, whether token values may be republished.
2. Token format and layout: source of truth vs built output; DTCG or legacy; alias syntax; `$extensions`, descriptions, deprecations.
3. Themes and modes: every shipped theme, how they compose (override files, extends), which answer light / dark / increased-contrast; extra axes (platform scale, density, pointer, colorblind).
4. Tiers and counts: palette, semantic, component; counts by type (color, dimension, typography, shadow, motion).
5. Grouping and ordering evidence shipped with the tokens (docs metadata, categories).
6. Shipped CSS custom property names (the native-name pattern).
7. Recommended read path without execution: an existing adapter (gaps?) or a new one; pitfalls; the consumer output (built CSS/JSON) a second derivation can compare against.

Report under 600 words; mark anything unverified.
