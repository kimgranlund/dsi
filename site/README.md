# Explorer site

The public explorer at `dsi.nonoun.io`: Vite + vanilla TypeScript, static, on Cloudflare.

## Kind

Code. Reads only `site/public/data/`, which `@dsi/db` exports from the query database (gitignored, rebuilt before every build).

## Run

```
cd site
corepack pnpm run data     # build the SQLite database and export site/public/data/
corepack pnpm run dev      # local dev server
corepack pnpm run build    # typecheck + production build -> site/dist/
```

## Routes

Path-based, served by the single-page fallback (`wrangler.jsonc`): `/` home with the specimen, `/concept/<name>`, `/system/<id>`, `/token/<product>/<path>`, `/ontology`, `/ontology/<facet>/<value>`, and `/ontology/concept/...`, so ontology IRIs under `https://dsi.nonoun.io/ontology/` resolve to pages.

## Rules

- Show only what the data says: a system with no approved mapping is "no answer (unknown)", never a guessed color. Nearest answers carry their label.
- The home specimen renders through `data/canonical/<product>.<mode>.css`; its legend names the canonical token behind each part and marks fallbacks.

## Checks

`corepack pnpm --filter @dsi/site check` (typecheck). Deploy: `npx wrangler deploy` from `site/` after a build.
