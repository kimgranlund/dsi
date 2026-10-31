# Catalog

One JSON entry per product, in every category: `catalog/<category>/<id>.json`. The category folder matches the slug of the entry's `category` (e.g. `dsi:category/design-system` -> `design-system/`).

## Kind

Authored.

## Rules

- Classify products, not organizations. One primary category per entry; connect products with `relations` (`implements`, `builtOn`, `consumesTokensFrom`, `usesFormat`, `providesTokenSet`; meanings in `ontology/vocab.jsonld`).
- Only Design Systems have `implementations`. A third-party library implementing a design system (MUI for Material) is its own Component Library entry with `relations.implements`.
- UI frameworks are never entries; use `targets`.
- File name equals `id`.

## Checks

Shape: `packages/schema/schemas/catalog-entry.schema.json`. Meaning (categories, targets, relation targets): `corepack pnpm check`.

## See also

`sources/README.md`, `docs/glossary.md`.
