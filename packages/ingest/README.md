# @dsi/ingest

Turns a product's shipped package into DTCG native tokens: `sources/<product>/source.json` -> `data/native/<product>/<version>/`.

## Kind

Code. Its output in `data/native/` is generated: fix the adapter or the source config, never the output.

## Run

`node packages/ingest/src/cli.ts <product>` from the repo root. Downloads the exact pinned versions (main package and `dependencies`) with `npm pack --ignore-scripts` into `.cache/` (gitignored), runs the adapter named in the source, rewrites the version folder.

## Output

- `*.tokens.json`: DTCG 2025.10 token trees under native names. Mode-specific values go in `<group>.<theme>.tokens.json`; everything else is mode-independent.
- Every token carries `$extensions["io.nonoun.dsi"]`: product, package, version, source file, native name as shipped, theme, and `rawValue` (the computed value, also kept on aliases so they can be verified).
- `manifest.json`: package and dependency integrity hashes, themes, `defaultTheme` when a theme's values live in the base files, file list with token counts, counts, and notes.
- Themes: a theme resolves against the mode-independent files plus its theme file, theme values winning. A theme listed in `themeExtends` resolves against its parent theme first. Material and Carbon theme files hold every themed token; Polaris's theme files hold only overrides of its default (light) theme.
- Byte-stable: re-running the same version produces identical files (no timestamps, sorted keys).

## Rules

- **Aliases are proven, not guessed.** An alias is written only when the adapter can show the token references another token and the resolved values match. Otherwise the token is a literal and the reason is a manifest note.
- **Untyped is honest.** A literal that fits no DTCG type (CSS `font` shorthand, four-corner shape, `100%`) keeps its string value, has no `$type`, and is flagged `untyped`.
- **Never execute package code.** `--ignore-scripts`; Sass evaluation only.
- A new adapter adds `src/adapters/<name>.ts`, registers it in `src/cli.ts`, and ships a synthetic fixture test.

## Adapters

| Adapter | Product | Method |
|---|---|---|
| `material` | `@material/web` | Evaluates each `tokens/_md-*.scss` module twice: with real dependencies (values) and with placeholder dependencies (aliases). Skips `md-comp-test-table`. `sass-vars` entries read the newer `tokens/versions/latest` set into its own theme (`expressive`, which `themeExtends` light); names come from each variable's `///` M3 token-name comment, aliases only where `mod.$var` references resolve to equal values (ADR 0014). |
| `dtcg` | Carbon (`@carbon/themes` + colors, layout, motion) | Reads shipped DTCG 2025.10 files and one resolver. Keeps `{aliases}`, `$description`, `$deprecated` and foreign `$extensions`; resolves partial JSON Pointer `$ref`s to literals (noted as derived); inherits group `$type`. `nativeName` pattern per entry (`--cds-{path}`). `sass-module` entries read public Sass variables of packages that ship no DTCG (`@carbon/type`, `@carbon/grid`, `@carbon/styles`) by evaluating the module with the pinned packages linked in; `///` comments give descriptions and `@deprecated`. |
| `polaris` | `@shopify/polaris-tokens` | Values and `var(--p-x)` aliases from `dist/css/styles.css`; palette and size aliases from the token modules, **parsed with the TypeScript parser, never executed**, and accepted only when the palette value equals the CSS value. The palette and size scale are internal (`visibility: internal`); the size scale is stored in rem as the build ships it. |
| `atlassian` | `@atlaskit/tokens` | Generated JS modules whose body is one JSON array literal (`artifacts/tokens-raw/<theme>.js`, `palettes-raw/*.js`), read as JSON text, never executed. Aliases only where the token's `original.value` names a palette token of equal typed value. `[default]` path segments become `default`. Shadows become DTCG shadows, cubic-bezier motion DTCG transitions (keyframes kept under `com.atlassian`); font shorthands and `linear()` transitions stay untyped. Names from `token-names.js`. |
| `primer` | `@primer/primitives` | Built per-theme token lists (`dist/docs/functional/themes/<theme>.json`, `dist/docs/{base,functional}/**`) with resolved values; base color palettes from `src/tokens/base/color/**.json5`, layered per theme. An alias (the theme's override, else fallback, else original) is written only when its target equals the resolved value in that theme, which also proves each theme's palette layering. Colors are stored sRGB from the shipped hex; `em` dimensions and font shorthands stay untyped. |
| `spectrum` | `@adobe/spectrum-tokens` | One JSON file per group in `src/`, typed by each token's `$schema`. Color sets (light, dark, wireframe) become themes; scale sets give desktop as the default and mobile as a theme extending light. Aliases kept as shipped; font-weight keywords become numbers; drop shadows DTCG shadows; type styles DTCG typography composites of aliases. Deprecated tokens keep their replacement, private ones are internal. |

## Token applications

`node packages/ingest/src/apply-cli.ts <product>` reads `sources/<product>/applications.json` and the shipped component styles it names, and writes `data/applications/<product>/<version>.json`: one row per token `var()` in a declaration, with part, CSS property, state, media, chain, token, literal fallback, file and line (ADR 0015). Material and Polaris CSS are parsed with postcss; Carbon component Sass is compiled with spacing and radius variables configured to `var(--dsi-m-<name>)` markers; Polaris Card prop defaults are read from JS source text by an authored pattern. `within` keeps one component's rules out of a shared stylesheet, `defScope` limits component-local definitions to the default variant, `exclude` drops other variants.

## Checks

`corepack pnpm --filter @dsi/ingest check` (typecheck + tests). Output is validated by `@dsi/schema` (`corepack pnpm check` at the root).

## See also

`sources/README.md`, `data/README.md`, `packages/schema/README.md`.
