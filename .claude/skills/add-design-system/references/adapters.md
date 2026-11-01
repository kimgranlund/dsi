# Adapters: picking or writing one

## What this file contains
- Decision: reuse or write
- Formats seen so far and the adapter that reads each
- Writing a new adapter (steps, required tests)
- Theme and mode mapping
- Pitfalls found in earlier ingests

Freedom: Medium. Goal: every shipped token under its native name, values equal to the package's own built output, aliases proven. Constraints: never execute package code; never rename or edit native names or values; byte-stable output. Authority for adapter behavior: `packages/ingest/README.md` (its Adapters table). This file adds the choosing and the pitfalls.

## Reuse or write

1. Does the package ship DTCG 2025.10 JSON (`$value`, `$type`, color objects)? -> `dtcg` (Carbon). Sass-only sibling packages -> `sass-module` entries of `dtcg`.
2. Does it ship per-theme resolved JSON plus a palette source? -> look at `primer` (resolved lists + palette json5, layered per theme).
3. Does it ship one JSON file per group with `$schema`-typed tokens and sets? -> `spectrum`.
4. Generated JS whose body is one JSON literal? -> read as JSON text like `atlassian`.
5. Themes built only in JS? -> static syntax-tree evaluation like `fluent` (`packages/ingest/src/static-eval.ts`); extend the interpreter only with pure constructs, and let anything else throw.
6. Built CSS custom properties are the only complete source? -> CSS parse like `polaris`, with aliases from the token modules parsed (TypeScript parser), never run.

If none fits, write a new adapter. Prefer the most built, most complete shipped artifact for values and the source files for alias proofs.

## Formats seen

| Product | Package | Values from | Aliases from | Themes |
|---|---|---|---|---|
| Material | `@material/web` 2.5.0 | Sass modules evaluated with real deps | same modules with placeholder deps | light, dark, expressive (extends light; `versions/latest`) |
| Carbon | `@carbon/themes` 11.84.0 + colors, layout, motion, type, grid, styles | shipped DTCG + one resolver; Sass modules | `{aliases}`; Sass map refs are not proven | white, g10, g90, g100 |
| Polaris | `@shopify/polaris-tokens` 9.4.2 | `dist/css/styles.css` | `var(--p-x)`; palette from parsed TS modules | light + experimental themes (overrides only) |
| Atlassian | `@atlaskit/tokens` 20.6.1 | `artifacts/tokens-raw/<theme>.js` as JSON text | `original.value` naming a palette token of equal value | 8 incl. increased-contrast, legacy, brand-refresh |
| Primer | `@primer/primitives` 11.10.0 | `dist/docs/**` resolved lists | theme override, else fallback, else original, when equal | 14 |
| Spectrum | `@adobe/spectrum-tokens` 15.6.0 | `src/*.json` per group | as shipped | light, dark, wireframe; desktop default, mobile extends light |
| Fluent 2 | `@fluentui/tokens` 1.0.0-alpha.24 | ESM modules via static-eval | palette module paths | web and teams light/dark, high contrast, v21 |

## Writing a new adapter

- [ ] `packages/ingest/src/adapters/<name>.ts` implementing `Adapter` (`packages/ingest/src/adapter.ts`)
- [ ] Registered in `ADAPTERS` in `packages/ingest/src/cli.ts`
- [ ] Synthetic fixture test (no real package) covering one alias proof, one rejected alias, one untyped literal, one theme override
- [ ] Row in the `packages/ingest/README.md` Adapters table, same change
- [ ] `corepack pnpm --filter @dsi/ingest check` via gate_lock, then ingest and `node packages/schema/src/cli.ts .`
- Exit: validator clean and verify-ingest finds no unexplained mismatch. Loop: mismatch -> adapter fix -> re-ingest -> re-verify.

## Theme and mode mapping

Goal: each canonical mode (`light`, `dark`, `increased-contrast`, `expressive`) answered by the native theme the product's own color-scheme metadata says (ADR 0006). Every other shipped theme is still ingested as a native theme. Constraints: a theme listed in `themeExtends` resolves against its parent first; a theme whose file holds only overrides needs `defaultTheme` or `themeExtends`. Ask G3 when the product ships extra axes (density, platform scale, colorblind sets) or more than one candidate per mode.

Precedents: Primer light / dark / light-high-contrast out of 14; Spectrum desktop default, mobile extends light; Material expressive extends light; Atlassian light-increased-contrast; Fluent web-light / web-dark / teams-high-contrast.

## Pitfalls (each cost a re-ingest)

- **`[default]` path segments** (Atlassian `color.text.[default]`) become `default`; brackets must not reach names or paths.
- **Palette layering per theme must be proven**, not assumed: Primer themes swap palettes; an alias is kept only where its target equals the resolved value in that theme, which proves the layering.
- **`em` dimensions and `linear()` easing stay untyped.** DTCG dimension is px/rem only; `linear()` is not a cubic-bezier. Font shorthands stay untyped.
- **JSON text must not start with `{`** when a module body is read as a JSON array literal: check the first token and fail loudly on anything else, or a wrong export is parsed silently.
- **Shadow alpha** (Atlassian): composite shadows must keep the color's alpha; verify-ingest caught a dropped alpha.
- **Transitions** (Primer): duration + easing composites must match the built CSS; verify-ingest caught a mismatch.
- **Sass map references are not proofs**: values from Sass maps are literals.
- **Pointer or platform variants** with the same names (Primer `size-coarse.json`) are not ingested as a second default; record the choice in `modesNote`.
