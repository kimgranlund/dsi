# Sources

How to ingest each product's shipped tokens: `sources/<product>/source.json`.

## Kind

Authored.

## Rules

- Only products in an ingested category (Design System, Component Library, Token Set) have a source.
- Design Systems are ingested through one of their catalog `implementations` (shipped code is the source of truth).
- Pin an exact package version. Upgrading means changing the version here and re-running ingest; the previous version folder in `data/native/` stays for history.
- Record the upstream license and whether values may be republished (`redistribution`). `unknown` blocks publishing on the site.

## Checks

Shape: `packages/schema/schemas/source.schema.json`. Meaning: `corepack pnpm check`.

## See also

`packages/ingest/README.md`, `catalog/README.md`.
