# @dsi/ingest

Turns a product's shipped package into DTCG native tokens: `sources/<product>/source.json` -> `data/native/<product>/<version>/`.

## Kind

Code. Its output in `data/native/` is generated: fix the adapter or the source config, never the output.

## Run

`node packages/ingest/src/cli.ts <product>` from the repo root. Downloads the exact pinned version with `npm pack --ignore-scripts` into `.cache/` (gitignored), runs the adapter named in the source, rewrites the version folder.

## Output

- `*.tokens.json`: DTCG 2025.10 token trees under native names. Mode-specific values go in `<group>.<theme>.tokens.json`; everything else is mode-independent.
- Every token carries `$extensions["io.nonoun.dsi"]`: product, package, version, source file, native name as shipped, theme, and `rawValue` (the computed value, also kept on aliases so they can be verified).
- `manifest.json`: package integrity hash, file list with token counts, counts, and per-token notes.
- Byte-stable: re-running the same version produces identical files (no timestamps, sorted keys).

## Rules

- **Aliases are proven, not guessed.** An alias is written only when the adapter can show the token references another token and the resolved values match. Otherwise the token is a literal and the reason is a manifest note.
- **Untyped is honest.** A literal that fits no DTCG type (CSS `font` shorthand, four-corner shape, `100%`) keeps its string value, has no `$type`, and is flagged `untyped`.
- **Never execute package code.** `--ignore-scripts`; Sass evaluation only.
- A new adapter adds `src/adapters/<name>.ts`, registers it in `src/cli.ts`, and ships a synthetic fixture test.

## Adapters

| Adapter | Product | Method |
|---|---|---|
| `material` | `@material/web` | Evaluates each `tokens/_md-*.scss` module twice: with real dependencies (values) and with placeholder dependencies (aliases). Skips `md-comp-test-table`. |

## Checks

`corepack pnpm --filter @dsi/ingest check` (typecheck + tests). Output is validated by `@dsi/schema` (`corepack pnpm check` at the root).

## See also

`sources/README.md`, `data/README.md`, `packages/schema/README.md`.
