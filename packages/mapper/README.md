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
5. `node packages/mapper/src/cli.ts review <scope> <run> <out.html> [vocab run]` renders the review page, with a Naming terms tab when a vocabulary run (`.cache/classify/<run>`) is given (template in `review/review.html`): each queued token with its colors per theme and both agents' answers. Publish it as a private artifact with the `db` and `user` capabilities; decisions are stored in its `decisions` collection.
6. Export the `decisions` and `term-decisions` collections (ArtifactData `list`) to JSON and run `node packages/mapper/src/cli.ts apply-review <scope> <decisions.json> <reviewer>`: accept makes the chosen answer Approved and the rest Rejected; custom adds an Approved mapping by the reviewer; no-concept-fits adds an Approved unmapped record; reject-both rejects every answer so the token is asked again.

## Audit

Agreement is not truth, so approved mappings (whoever approved them) are audited against evidence independent of every judge:

1. `node packages/mapper/src/cli.ts audit-prepare <scope> <run>` runs deterministic checks and writes one packet per product (`.cache/audit/<run>/`). Checks: intent vs hue; property vs how shipped tokens use the token (alias graph); WCAG contrast of on-fill content against its paired fill; approved terms contradicting a mapping; approved terms most of their own tokens disagree with; tokens identical in every theme mapped to different intents.
2. An auditor agent on a model that mapped none of them (`prompts/audit-v1.md`) judges every approved mapping blind to who approved it: supported, contradicted (with a suggested concept) or insufficient, citing shipped descriptions, usage, values and the product's official docs. `audit-check` validates its file.
3. `audit-merge` writes `mappings/<product>/<version>.audit.json` and lists the disputes; disputes reopen on the review page for a human decision.

## Approval rule

- **Approved** when both agents give the same concept **and** match type, both with confidence >= 0.85, and the answer was never rejected. `review.by` is `agreement`.
- **Approved with the classifier's vote** at confidence >= 0.6 when, in addition, the match is exact or close and `@dsi/classify` reaches the same concept from approved terms alone, explaining the whole token name. `review.by` is `agreement+classifier`. Re-running `merge` on an earlier run re-applies the rule to its queued tokens.
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
