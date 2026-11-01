# Data

Generated output. **Never hand-edit.** Change the inputs (`sources/`, `ontology/`, `mappings/`, an adapter) and rebuild.

## Kind

Generated, committed so that upstream changes show up as reviewable diffs and the mapper and site can run offline.

| Path | Produced by | From |
|---|---|---|
| `native/<product>/<version>/` | `@dsi/ingest` | `sources/<product>/source.json` + the npm package |
| `classified/<product>/<version>.json` | `@dsi/classify run` | `mappings/<product>/terms.json` + `native/` |
| `skos/<product>/<version>.jsonld` | `@dsi/resolve` (`skos-cli.ts`) | approved records in `mappings/` + `native/` + `ontology/` |
| `canonical/` | `@dsi/canon` (planned) | `ontology/` + `mappings/` + `native/` |
| SQLite / D1 (not in git) | `@dsi/db` (planned) | everything above + `catalog/` + `ontology/` |

## Checks

`corepack pnpm check` validates `native/`: provenance on every token, DTCG value shapes, aliases resolve in every theme, no cycles, manifest matches files.
