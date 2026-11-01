# @dsi/db

The query database and the site's static data. Repo files -> `.cache/db/dsi.sqlite` (SQLite with FTS5, Node's built-in `node:sqlite`) -> `site/public/data/`.

## Kind

Code. Both outputs are generated and gitignored; CI rebuilds them. Nothing writes to the database except `build`.

## Run

From the repo root: `node packages/db/src/cli.ts build`, then `node packages/db/src/cli.ts export`.

## Tables

`products`, `tokens`, `token_values` (per theme, with alias chain), `modes`, `concepts`, `mappings`, `unmapped`, `terms`, `coverage` (concept x product x mode), and `search` (FTS5 over products, concepts and semantic or mapped tokens). Only Approved mappings, unmapped records and terms are loaded.

## Static export (v1 site)

`meta.json` (products, modes, counts, facet values), `concepts.json` (every canonical concept with each system's answer per mode), `tokens.<product>.json` (semantic and mapped tokens: values and alias chains per theme, mappings), `search.json`, and `canonical/*.css`. v1 serves these from Cloudflare static assets; the same database goes to D1 when the agent API needs live queries.

## Checks

`corepack pnpm --filter @dsi/db check`.
