# @dsi/mapper

Maps native tokens to canonical concepts with two independent AI agents and merges their answers by agreement: `data/native` + `ontology/` -> `mappings/`.

## Kind

Code, plus agent instructions in `prompts/` and run scopes in `scopes/`. Its output in `mappings/` is agent-authored judgment, reviewable, never blindly regenerated.

## Run

From the repo root:

1. `node packages/mapper/src/cli.ts prepare <scope> <run>` writes `.cache/mapper/<run>/<product>.{a,b}.packet.json`: each in-scope token with native name, description, alias chain and value per theme, the allowed ontology values, and earlier rejected answers. Tokens already approved are left out.
2. Two Claude Code agents on **different models** each map one packet blind, following `prompts/<scope>.md`, and write `<product>.<role>.proposals.json`. Each checks its own file with `node packages/mapper/src/cli.ts check <scope> <run> <product> <role>`.
3. `node packages/mapper/src/cli.ts merge <scope> <run>` merges into `mappings/<product>/<version>.mappings.json`.
4. `node packages/mapper/src/cli.ts queue <scope>` lists what still needs a human decision.

## Approval rule

- **Approved** when both agents give the same concept **and** match type, both with confidence >= 0.85, and the answer was never rejected. `review.by` is `agreement`.
- **Agreed unmapped** when both say no concept fits: recorded in `unmapped` as approved, so it feeds the ontology backlog and is not asked again.
- **Everything else is Proposed** (each agent's answer kept) and goes to the human queue. A human approves or rejects by editing the record's `status` and adding `review`.
- Merge never touches Approved or Rejected records, refuses two proposal files from the same model, and never re-approves a rejected answer.
- The public site shows Approved mappings only.

## Scopes

| Scope | Covers |
|---|---|
| `color-v1` | Semantic and system color tokens: Material `md.sys.color.*`, Carbon `theme.tokens.json`, Polaris `color-*`. Palettes and component tokens are out of scope until hue and component vocabularies exist. |

## Checks

`corepack pnpm --filter @dsi/mapper check`. Mapping files are validated by `@dsi/schema` (`corepack pnpm check`).
