# Ontology

The canonical meaning layer: SKOS concept schemes in JSON-LD that every catalog entry, ingested token and mapping refers to by IRI.

## Kind

Authored. Changes here change meaning for every consumer; see Rules.

## Files

| File | Holds |
|---|---|
| `context.jsonld` | Shared JSON-LD context. **The only place the `dsi:` base IRI is bound.** |
| `vocab.jsonld` | Properties: catalog relations, facet bindings, tier, mapping fields. Each relation states what it permits a consumer to infer. |
| `schemes/categories.jsonld` | The 7 product categories |
| `schemes/targets.jsonld` | Implementation targets (UI frameworks live here, not as categories) |
| `schemes/tiers.jsonld` | Source, Scale, Semantic, System, Component, and the tier derivation rule |
| `schemes/facets.jsonld` | Facet dimensions and starter value schemes (domain, emphasis, intent, property, state, mode) |
| `schemes/mapping.jsonld` | Match types with fixed direction, review statuses |
| `schemes/canonical.jsonld` | Concept schemes for canonical concepts, one per domain |
| `concepts/` | (optional) Labels and definitions for notable compositional concepts |

## Canonical concepts

A canonical concept is a combination of facet values with a compositional IRI, so combinations are not enumerated by hand:

```
dsi:concept/<domain>/<facet>-<value>/<facet>-<value>...
dsi:concept/color/intent-danger/property-background/emphasis-strong/state-hover
```

- `<domain>` is a value of `dsi:scheme/domain`. Facet segments follow the fixed order **intent, usage, component, part, property, emphasis, state**; each value must exist in that facet's scheme (`dsi:scheme/<facet>`). At least one facet segment is required.
- **usage** and **state** may combine values with `+`, sorted alphabetically: `usage-inverse+link`, `state-hover+selected`. Other facets take one value.
- Component and part segments are reserved until their vocabularies exist.
- Mode is never a segment: it is context, not identity.
- The validator (`@dsi/schema`) checks grammar, order and every value. A compositional IRI does not need an entry in `concepts/`; add one only to give it a curated label or definition.

## SKOS everywhere

Every judgment in the repo is a SKOS mapping with the native side as subject:

| Native side | IRI | Mapped to | Authored in |
|---|---|---|---|
| Token | `dsi:native/<product>/<version>/<path>` in `dsi:scheme/native/<product>/<version>` | a canonical concept | `mappings/<product>/<version>.mappings.json` |
| Naming term | `dsi:vocab/<product>/<term>` in `dsi:scheme/vocab/<product>` | a facet value (`dsi:intent/danger`) | `mappings/<product>/terms.json` |

The JSON files are the authored copies. `node packages/resolve/src/skos-cli.ts` generates the RDF form, `data/skos/<product>/<version>.jsonld`, with approved records only: native tokens and terms as `skos:Concept`s, match types as `skos:exactMatch` / `closeMatch` / `broadMatch` / `narrowMatch` / `relatedMatch`, and every canonical concept in use materialized with its facet bindings. `corepack pnpm check` validates the export: valid JSON-LD, every `dsi:` reference defined, every mapping target a valid concept.

## Inputs and outputs

- Reads: nothing.
- Read by: `catalog/`, `mappings/`, `packages/mapper`, `packages/canon`, `site/`.

## Rules

- **IRIs are permanent.** Never rename or reuse one. To retire a concept, mark it deprecated in place and add a replacement.
- **Labels are not identity.** Change `prefLabel` freely; never change `id` to match it.
- **No native names as labels.** "Critical", "Error", "Destructive" are product terms. They belong in `mappings/` with a match type, not as `altLabel`s.
- **Unbound is not default.** A missing facet means "not specific to that dimension".
- **Mapping direction**: subject is the native token, object is the concept. `native skos:narrowMatch concept` means the native token is broader.
- A term change updates `docs/glossary.md` in the same change.
- The `dsi:` base is `https://dsi.nonoun.io/ontology/`, bound only in `context.jsonld`. Concept IRIs should resolve to explorer pages on the site.

## Checks

Until `pnpm check` exists: expand every file with `jsonld.toRDF` and check that each concept has `inScheme` and `prefLabel`, every `dsi:` reference resolves, prefLabels are unique per scheme, and `related` is symmetric.

## See also

`docs/glossary.md`, `docs/planning/PLAN.md` section 3.
