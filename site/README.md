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

## System pages

A "Group by" switch (remembered per browser) shows a system's tokens three ways:

- **System groups**: the structure stage's output (ADR 0011): the system's own groups and order where it ships them, otherwise name families.
- **Namespace**: canonical role from each token's approved mapping, by the most general facet it binds (usage, then intent, then syntax, then property); combined values fold into their first value; syntax roles form one Code namespace with subgroups per Lezer root tag. Designer order is kept inside groups.
- **Source color**: the palette token each alias chain ends at in the selected swatch mode: families (Gray, Blue...) with neutrals first, then by hue; subgroups per palette step.

## Rules

- Show only what the data says: a system with no approved mapping is "no answer (unknown)", never a guessed color. Nearest answers carry their label.
- The home specimen renders through `data/canonical/<product>.<mode>.css`; its legend names the canonical token behind each part and marks fallbacks.

## Checks

`corepack pnpm --filter @dsi/site check` (typecheck). Deploy: `npx wrangler deploy` from `site/` after a build.
