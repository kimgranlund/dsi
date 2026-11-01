# @dsi/classify

Deterministic classification of every native token from its name, using per-product term mappings: `mappings/<product>/terms.json` + `data/native/` -> `data/classified/<product>/<version>.json`.

## Kind

Code. Its term files are judgments (proposed / approved / rejected, like token mappings); its output in `data/classified/` is generated.

## Term mappings

`mappings/<product>/terms.json` holds:

- `noise`: words with no meaning in names (`md`, `sys`, `color`).
- `scopes`: first matching rule (path prefix or source file) sets a token's scope: palette, foundation, semantic, component.
- `terms`: native words (one or more, joined by `-`) mapped to a facet value with a match type, e.g. Polaris `critical` -> intent `danger`. Longer terms override shorter ones on the same facet, so exceptions are expressible: `on-bg-fill` -> property `foreground` beats `bg` -> `background`.

## Run

From the repo root:

- `node packages/classify/src/cli.ts derive <product>`: learn candidate terms from approved token mappings (support >= 2, precision >= 0.9), as Proposed with their evidence. Never changes approved or rejected terms.
- `node packages/classify/src/cli.ts eval <product>`: leave-one-out accuracy on approved exact/close mappings (each token classified with terms learned without it).
- `node packages/classify/src/cli.ts run <product>`: classify every token (scope, facets, candidate concept, unexplained words).

## How it decides

Every term found anywhere in the name contributes (not a greedy split, which let `fill-critical` swallow `critical`). Per facet the longest term wins; equal-length disagreement is a conflict on single-valued facets and combines on usage and state. Only approved terms count as a vote; proposed terms may be used as hints.

## Checks

`corepack pnpm --filter @dsi/classify check`. Term files are validated by `@dsi/schema`.
