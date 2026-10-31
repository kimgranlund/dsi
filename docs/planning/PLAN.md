# DesignSystemsIndex: Project Plan

Status: draft, in discovery. Last updated 2026-10-31.

Terms: [glossary](../glossary.md) is authoritative. Repo organization: [repo-layout.md](repo-layout.md).

## 1. Purpose

Document token-level details of popular design systems (Material, Carbon, Polaris, ...), normalized so the same concept (e.g. "Danger") can be compared across systems that natively call it "Critical", "Error", "Destructive", etc.

## 2. Category taxonomy (decided)

Layers in a stack. Each product gets one primary category; products relate through typed relations. Classify products, not organizations (Radix spans Headless Primitives, Component Libraries, Token Sets).

| Category | Definition | Examples |
|---|---|---|
| Token Formats | Specs for expressing tokens | DTCG |
| Token Tooling | Transforms tokens, ships no values | Style Dictionary, Terrazzo, Tokens Studio |
| Token Sets | Standalone token values, no components | Open Props, Radix Colors |
| Styling Engines | Turn tokens into styles; may ship a default token set | PandaCSS, Tailwind, StyleX |
| Headless Primitives | Behavior and accessibility, no visual opinion | Radix Primitives, Melt, Zag, React Aria |
| Component Libraries | Styled components without a governing design language | shadcn/ui, Chakra, Mantine, MUI |
| Design Systems | Governed design language: tokens, guidance, components | Material, Carbon, Polaris |
| UI Frameworks | **Excluded.** Recorded only as an Implementation's `targets` attribute | React, Vue, Svelte, SolidJS, Web Components |

Sub-entity: **Implementation** of a Design System (e.g. Material Web, Angular Material), since shipped tokens can diverge from the spec.

Relations (initial): `implements`, `built-on`, `consumes-tokens-from`, `uses-format`, `provides-token-set`.

## 3. Token normalization architecture (decided)

Three layers:

1. **Native layer**: each system's tokens in DTCG, native names and values preserved, provenance in `$extensions`. Never renamed.
2. **Concept layer**: canonical ontology, built with `/context:knowledge-modeling`.
3. **Mapping layer**: typed, bidirectional links native token <-> concept.

Decisions:
- **Faceted concepts**: intent x property x emphasis x state x mode (e.g. Danger / bg / strong / hover / dark).
- **Typed matches**: SKOS-style `exact`, `close`, `broader`, `narrower`, `related`.
- Primitives (e.g. `red-60`) map to scales, not intents, unless a system has only primitives.
- **Danger and Destructive are two intents**, linked as related. Danger views list Destructive tokens as related, not equal.
- Schemes are modeled in `ontology/` (categories, targets, tiers, facets, match types, review status).

### 3a. Tier ladder (decided)

| # | Tier | Binds | Example |
|---|---|---|---|
| 1 | Source | raw value | `--plum-12`, `md.ref.palette.error40`, Carbon `$red-60` |
| 2 | Scale (optional) | hue + relative step | `--plum-strong` |
| 3 | Semantic | intent (danger, accent, neutral) | `--danger-strong`, `md.sys.color.error`, Polaris `bg-fill-critical` |
| 4 | System | usage (heading-text, surface) | `--system-heading-text`, Carbon `text-primary` |
| 5 | Component | component + part | `--button-danger-bg`, `md.comp.filled-button.*` |

Rules:
- **Tier is derived from bound facets**, not hand-labeled. A token may span tiers (Material `on-error-container` = Semantic + System).
- **Chains may skip tiers**; most systems go Source -> Semantic.
- **Alias edges are mode-scoped**: (token, mode) -> token, via DTCG aliases + resolver/modes.
- **Two graphs**: the *alias graph* (vertical, within one system, ingested from source) and the *mapping graph* (horizontal, across systems via concepts, curated).

### 3b. Canonical token set (decided)

The concept layer is published as its own DTCG token set (e.g. canonical `--danger-strong`). Each ingested design system acts as a theme/resolver supplying values through mappings, enabling "render this in Carbon vs Polaris".

## 4. Sources, depth, versions (decided)

- **Source of truth: shipped code.** Ingest from published packages/repos. Spec divergence is recorded as a note, not a second native layer.
- **Depth: everything, including component tokens** (e.g. `md.comp.filled-button.container.color`). Consequence: the concept layer needs a component anatomy facet (component x part, e.g. Button / container) on top of intent x property x emphasis x state x mode.
- **Versions: pin latest major, keep history.** Every record carries source package + version + extraction date so older majors can be added later.
- **v1 scope: 3 systems**: Material, Carbon, Polaris. Ingested: Material Web 2.5.0, Carbon Elements (@carbon/themes 11.84.0), Polaris tokens 9.4.2.
- **Polaris license (decided 2026-10-31)**: the Polaris license limits use to apps that integrate with Shopify. The owner chose to ingest and publish anyway, accepting the risk; recorded as `publishOverride` in `sources/polaris/source.json`.
- **Internal tokens count**: shipped-but-not-public tokens (Polaris palette, size scale) are ingested with `visibility: internal`, because they are the real Source tier.

## 5. Explorer UI (intent)

Show a consistent canonical label (e.g. "Danger") and how each design system represents it, including native name, value, and match type.

## 6. Product and operations (decided)

- **Audience**: the author, designers, developers, AI agents.
- **Query database (decided)**: SQLite built in CI from the repo files and served from Cloudflare D1, with FTS5 full-text search and recursive CTEs for alias chains and mappings. Git files stay the source of truth; the database is a projection. An RDF store (SPARQL) is deferred until external users need it.
- **Form**: public, searchable website hosted on Cloudflare at `dsi.nonoun.io`. Ontology IRIs use `https://dsi.nonoun.io/ontology/`.
- **Mapping authorship**: AI agents propose and write mappings through a pipeline: ingest -> map (against the SKOS scheme) -> store as DTCG-compatible data.
- **Approval rule (decided)**: two Claude Code agents on different models map each packet blind; a mapping is approved when both give the same concept and match type with confidence >= 0.85. Disagreements go to a human queue. The public site shows approved mappings only.
- **Concepts are compositional**: `dsi:concept/<domain>/<facet>-<value>/...` in a fixed facet order, validated against the facet schemes.
- **License**: MIT for this project.
- **Component Libraries** are a full category with token ingestion, like Design Systems.
- **v1 done when**: a searchable website is live.

## 7. Open questions

- Color ontology backlog from color-v1 rounds 1-3 (each raised by 2+ agents): a `control` usage for interactive fills (Polaris bg-fill, Carbon interactive); a tertiary emphasis step in three-step families; a layer index beyond emphasis (Carbon layer 01-03 borders and fields); helper and placeholder text roles; severity between warning and danger (Carbon caution-major); gradient stops; surface brightness (Material surface-bright, -dim, -variant); syntax-highlighting roles; avatar and categorical palettes; translucent tint fills.

- Carbon typography: `@carbon/type` ships no DTCG file; ingest from its Sass/JS or wait for upstream.
- Polaris shadows and Material/Polaris CSS shorthands are untyped strings; parse into DTCG `shadow`/`typography` composites later.

- Align mode files with the DTCG Resolver module (today: per-theme files plus manifest.json).
- Typing CSS `font` shorthands and multi-corner shapes (13 untyped Material tokens): parse into DTCG composites, or keep untyped.

- Canonical hue names (scale facet) and usage values: deferred to the color concepts work.

- Unmatched canonical tokens: leave unresolved, fall back to the broader match with a flag, or derive a value.
- Upstream licenses of ingested token values (MIT covers our code and mappings, not third-party values).
- Component anatomy vocabulary: whose part names become canonical.
- Entry depth for Headless Primitives, Styling Engines, Token Tooling, Token Formats (catalog entry only vs ingestion).
