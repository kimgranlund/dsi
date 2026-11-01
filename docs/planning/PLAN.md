# DesignSystemsIndex: Project Plan

Status: draft, in discovery. Last updated 2026-10-31.

Terms: [glossary](../glossary.md) is authoritative. Repo organization: [repo-layout.md](repo-layout.md).

## 1. Purpose

Document token-level details of popular design systems (Material, Carbon, Polaris, ...), normalized so the same concept (e.g. "Danger") can be compared across systems that natively call it "Critical", "Error", "Destructive", etc.

## 2. Decided (see ADRs)

Ratified decisions live in [docs/decisions](../decisions/README.md); this plan keeps only what is open.

- Categories as layers, products not organizations: [0001](../decisions/0001-product-categories.md)
- Native / concept / mapping layers, shipped code wins: [0002](../decisions/0002-normalization-layers.md)
- Tiers derived from facets: [0003](../decisions/0003-tiers-from-facets.md)
- Compositional concepts, permanent IRIs at `https://dsi.nonoun.io/ontology/`: [0004](../decisions/0004-compositional-concepts.md)
- Mapping approval (two agents, classifier vote, human review): [0005](../decisions/0005-mapping-approval.md)
- Concept resolution and modes: [0006](../decisions/0006-concept-resolution.md)
- SKOS everywhere: [0007](../decisions/0007-skos-everywhere.md)
- Mapping conventions from review: [0008](../decisions/0008-mapping-conventions.md)
- Polaris license override: [0009](../decisions/0009-polaris-license.md)

Product: public, searchable explorer at `dsi.nonoun.io` on Cloudflare; audience is the owner, designers, developers and AI agents; v1 is done when the searchable site is live. Stack: TypeScript pnpm monorepo, Vite + vanilla site, SQLite built in CI and served from D1. Project license MIT; upstream licenses recorded per source. v1 systems: Material Web 2.5.0, Carbon Elements 11.84.0, Polaris tokens 9.4.2 (all ingested; 508 semantic color tokens mapped).

## 3. Open questions

- Color ontology backlog from color-v1 rounds 1-3 (each raised by 2+ agents): a `control` usage for interactive fills (Polaris bg-fill, Carbon interactive); a tertiary emphasis step in three-step families; a layer index beyond emphasis (Carbon layer 01-03 borders and fields); helper and placeholder text roles; severity between warning and danger (Carbon caution-major); gradient stops; surface brightness (Material surface-bright, -dim, -variant); syntax-highlighting roles; avatar and categorical palettes; translucent tint fills.

- Carbon typography: `@carbon/type` ships no DTCG file; ingest from its Sass/JS or wait for upstream.
- Polaris shadows and Material/Polaris CSS shorthands are untyped strings; parse into DTCG `shadow`/`typography` composites later.

- Align mode files with the DTCG Resolver module (today: per-theme files plus manifest.json).
- Typing CSS `font` shorthands and multi-corner shapes (13 untyped Material tokens): parse into DTCG composites, or keep untyped.

- Canonical hue names (scale facet) and usage values: deferred to the color concepts work.

- Upstream licenses of ingested token values (MIT covers our code and mappings, not third-party values).
- Component anatomy vocabulary: whose part names become canonical.
- Entry depth for Headless Primitives, Styling Engines, Token Tooling, Token Formats (catalog entry only vs ingestion).
