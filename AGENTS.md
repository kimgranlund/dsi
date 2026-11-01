# DesignSystemsIndex

A public, searchable index of design-system tokens. Each system's shipped tokens are ingested as DTCG, mapped to a canonical SKOS ontology, and shown under consistent labels (e.g. "Danger" across Material `error`, Carbon `support-error`, Polaris `critical`).

## Start here

1. Read this file.
2. Find your task in **Routes** and read the listed sources before acting.
3. Read the README of every area you will touch. A missing README means the area is not built yet: create it from `docs/templates/area-readme.md` in the same change.
4. Unknown term? `docs/glossary.md` is authoritative.

## Routes

| Task | Read first | Then |
|---|---|---|
| Scope, priorities, open questions | `docs/planning/PLAN.md` | `docs/decisions/README.md` |
| Repo structure, where a file goes | `docs/planning/repo-layout.md` | area README |
| Add a design system or component library | `catalog/README.md`, `sources/README.md` | `packages/ingest/README.md` |
| Wrong or missing ingested token | `sources/<product>/source.json` | `packages/ingest/README.md` |
| Add or change a concept, facet, tier, category | `docs/glossary.md`, `ontology/README.md` | `docs/decisions/` |
| Write, review or fix mappings | `mappings/README.md`, `docs/decisions/0008-mapping-conventions.md` | `packages/mapper/README.md` |
| Classify tokens from their names, term mappings | `packages/classify/README.md` | `mappings/README.md` |
| Resolve a token's value or a concept per product and mode | `packages/resolve/README.md` | `ontology/README.md` |
| Canonical token output | `packages/canon/README.md` | `packages/resolve/README.md` |
| Query database, search | `packages/db/README.md` | `docs/planning/repo-layout.md` |
| Explorer site | `site/README.md` | `packages/schema/README.md` |
| Data file shape or validation rule | `packages/schema/README.md` | `ontology/README.md` |

## Invariants

- **Shipped code is the source of truth.** Native token names and values are never renamed or edited; spec divergence is a note.
- **`data/` is generated.** Change the input (`sources/`, `ontology/`, `mappings/`, an adapter) and rebuild. Never hand-edit it.
- **Mappings are judgments.** Each carries a SKOS match type (`exact`, `close`, `broad`, `narrow`, `related`; see `ontology/schemes/mapping.jsonld` for direction), confidence, provenance (agent, model, date, source version) and review status. Re-running the mapper never overwrites an approved mapping.
- **Tier is derived from bound facets**, not hand-labeled.
- **One authority per fact.** A new or changed term updates `docs/glossary.md` and `ontology/` in the same change.
- **Plans are temporary.** `docs/planning/` is working state; a ratified decision becomes an ADR in `docs/decisions/`.
- **UI Frameworks are not catalog entries**, only an implementation's `targets`.
- **Record upstream licenses** per source. Project license is MIT; it does not relicense third-party token values.

## Checks

`corepack pnpm check` from the root (or `pnpm check` with pnpm installed). Runs each package's `check`: today, `@dsi/schema` generates types, typechecks, runs tests and validates `ontology/`, `catalog/`, `sources/`, `mappings/`.
