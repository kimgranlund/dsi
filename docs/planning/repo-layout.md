# Repo layout plan

Status: planned. Folders are created when their first file lands, each with a README from [the area template](../templates/area-readme.md).

## Stack

- TypeScript, pnpm workspaces.
- Ontology: SKOS in JSON-LD.
- Site: Vite + vanilla TS, static build deployed to Cloudflare.
- Query database: SQLite generated from the repo files in CI, served from Cloudflare D1, with FTS5 for search. A projection, never the source of truth.

## Tree

```
design-system-index/
├─ AGENTS.md                 Entry for any agent: purpose, invariants, task routes
├─ CLAUDE.md                 Imports AGENTS.md
├─ README.md                 Public project readme (when the site ships)
├─ package.json, pnpm-workspace.yaml
├─ docs/
│  ├─ README.md              Docs index
│  ├─ glossary.md            Authoritative project vocabulary
│  ├─ planning/              Working set: plans, open questions (temporary)
│  ├─ decisions/             ADRs, NNNN-title.md (durable)
│  └─ templates/             Area README template
├─ ontology/                 AUTHORED. SKOS JSON-LD concept schemes
│  ├─ context.jsonld         Shared @context
│  ├─ schemes/               categories, tiers, facets
│  └─ concepts/              color, space, typography, motion, components/<component>
├─ catalog/                  AUTHORED. One entry per product, all categories
│  └─ <category>/<product>.json   relations, implementations, license, links
├─ sources/                  AUTHORED. Ingestion config per product
│  └─ <product>/source.json  package, pinned version, entry files, adapter, upstream license
├─ mappings/                 AGENT-AUTHORED judgments, reviewable, never blindly regenerated
│  └─ <product>/<version>.mappings.json   match assertions, facet bindings, provenance, review state
├─ data/                     GENERATED. Reproducible from inputs, never hand-edited
│  ├─ native/<product>/<version>/*.tokens.json   DTCG, native names and values
│  ├─ canonical/             Canonical DTCG set + one resolver per product
│  └─ reports/               Validation and coverage reports
├─ packages/
│  ├─ schema/                JSON Schemas + TS types (catalog, source, mapping, DTCG $extensions)
│  ├─ ingest/                adapters/<product>.ts: sources -> data/native
│  ├─ mapper/                Agent mapping pipeline: ontology + native -> mappings
│  ├─ canon/                 ontology + mappings -> data/canonical
│  ├─ db/                    builds the SQLite query database (D1) from the repo files
│  └─ cli/                   `dsi ingest | map | build | validate`
└─ site/                     Vite + vanilla explorer, reads data/ at build time
```

## Pipeline

```
sources/ --ingest--> data/native --map (+ ontology/)--> mappings/ --canon--> data/canonical
                                                                  \--> db (SQLite / D1, + catalog/ + ontology/) --> site/
```

Mapping files are plain JSON validated by `@dsi/schema`; their SKOS/RDF form is a generated projection, not a second authored copy.

## Why this split

- **The database is derived.** Git files hold authority, review state and diffs; `packages/db` rebuilds SQLite from them on every build. Nothing writes to D1 except that build.

- **Authored, agent-authored and generated stay apart.** `data/` can be deleted and rebuilt. `mappings/` cannot: it holds judgments with review state, so the mapper merges into it and never overwrites an approved mapping.
- **catalog/ vs sources/**: every product gets a catalog entry; only products whose tokens are ingested (Design Systems, Component Libraries, Token Sets) get a source config.
- **ontology/ is the meaning authority.** `docs/glossary.md` explains project terms in prose and points to concept IDs once they exist.
- **UI Frameworks** never get catalog entries; they appear only as an implementation's `targets`.

## Build order

1. `docs/` entry system. Done.
2. `ontology/schemes` (done) + `packages/schema` (done).
3. `sources/` + `packages/ingest`: Material, Carbon, Polaris done.
4. `packages/mapper` + color-v1 scope: 3 agent rounds done; human review of the remaining queue in progress.
5. `packages/canon`, `data/canonical`.
6. `packages/db`: SQLite build in CI, D1 deploy, FTS5 search.
7. `site/`, then the remaining concept domains and component tokens.
