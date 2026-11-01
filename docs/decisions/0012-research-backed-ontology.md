# 0012 Research-backed facets and conventions

Status: accepted, 2026-11-01. Supersedes the "direction shown by values" rule of [0010](0010-fixed-tokens-and-secondary-direction.md) for prominence words.

## Context
Researchers read each system's official documentation and source (cited per item) to close the concept gaps the mapping rounds left.

## Decision
- **Syntax facet from Lezer.** Carbon's 88 `syntax-*` tokens are the `@lezer/highlight` tags in kebab case (carbon PRs #21047, #21230, #22037; https://lezer.codemirror.net/docs/ref/#highlight.tags). A `syntax` facet adopts the tag set with Lezer's parent hierarchy (`ontology/schemes/syntax.jsonld`, generated from @lezer/highlight 1.2.1), plus Lezer's six modifiers and four Carbon-only heads. Syntax tokens map deterministically to `syntax-<tag>/property-text`, exact. In canonical token names syntax values are prefixed `code-` (Lezer's `link`, `strong`, `emphasis` would collide).
- **Categorical usage.** Polaris avatar colors are a categorical palette assigned by name hash: `usage-categorical`, broad (each token is one slot).
- **Brightness facet.** Material surface-dim and surface-bright keep their relative brightness in light and dark themes (m3.material.io/styles/color/roles): `brightness-dim` / `brightness-bright`, independent of emphasis.
- **Warning ladder.** Carbon's status indicators make caution-minor a regular warning (same value as support-warning) and caution-major a serious warning: Warning (exact) and Warning with strong emphasis (close). Polaris caution, milder than warning, stays Caution.
- **Prominence follows the product's definition.** Polaris defines secondary and tertiary as lower levels of prominence for every element (polaris-react-archive color-tokens.mdx), so secondary borders are subtle even though their colors are darker.
- **Material shipped groups.** material-web documents each token's group and description in `tokens/versions/latest/sass/_md-sys-color.scss`; ingest reads both. The file is alphabetical, so group order comes from the M3 roles page and token order from the progression (ADR 0011).

## Consequences
112 mappings changed (90 Carbon, 20 Polaris, 2 Material), each superseding the previous record with the source cited in its rationale. Polaris 9.4.2 is the final polaris-tokens release (repo archived; Polaris web components ship no token set).
