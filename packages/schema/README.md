# @dsi/schema

JSON Schemas for every authored and agent-authored data file, plus the validator that checks them against the ontology.

## Kind

Code. `schemas/*.schema.json` are the single authority for data shapes; `src/generated/types.ts` is generated from them (gitignored, run `pnpm --filter @dsi/schema types`).

## Schemas

| Schema | Validates |
|---|---|
| `catalog-entry.schema.json` | `catalog/<category>/<id>.json` |
| `source.schema.json` | `sources/<product>/source.json` |
| `mapping-file.schema.json` | `mappings/<product>/<version>.mappings.json` |
| `dtcg-extension.schema.json` | `$extensions["io.nonoun.dsi"]` on each token in `data/native` |
| `common.schema.json` | Shared definitions: slug, concept ref, SPDX, exact version, provenance |

## Two layers of validation

1. **Shape** (JSON Schema): structure, required fields, exact versions, review required for approved/rejected, `part` requires `component`, no stored `tier`.
2. **Meaning** (`src/validate.ts`, reads `ontology/`): category, target, facet values, match types and statuses exist in the right SKOS scheme; relations point at real catalog ids of the right category; only ingested categories have sources; Design Systems are ingested through an implementation.

Allowed values for categories, match types, statuses and facets live only in `ontology/`. Schemas use slugs or `dsi:` refs and never copy those lists as enums.

## Inputs and outputs

- Reads: `ontology/`, `catalog/`, `sources/`, `mappings/`.
- Writes: `src/generated/types.ts`.

## Checks

`pnpm --filter @dsi/schema check`: generate types, typecheck, tests (a valid fixture plus one negative control per rule), validate the repo.

A new rule gets a negative control in `test/validate.test.ts` that fails without it.
