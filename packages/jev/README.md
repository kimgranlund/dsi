# @dsi/jev

An experiment lab for TypeSafe's Jev model (System One: state plus typed questions in, typed answers with probabilities out; https://docs.typesafe.ai) as a voter in DSI mapping. It measures Jev against approved mappings before Jev gets any role in the pipeline.

## Roles (ADR 0020)

- `node packages/jev/src/lab.ts prescreen`: flags approved mappings a registered rival outscores by 0.2 or more; `audit-prepare --only .cache/jev/prescreen.json` audits them first.
- `dsi-map review ... --jev`: Jev's two-stage pick on each review card (preselects at 0.85 or more, never approves). Code: `src/roles.ts`.
- `dsi-map boundary-rules --jev`: boundary judge. Jev's B4 or B7 statement judgement (margin 0.3) decides that facet where the code test finds no evidence (ADR 0020 amendment, ADR 0021).
- `dsi-map triage-conflicts`: Jev's B4 and B6 judgements sort approved conflicts into likely test bugs and owner decisions.

## Kind

A tool package. It writes nothing under `mappings/`, `ontology/` or `data/`. Results go to `.cache/jev/` (gitignored); the experiment log and lessons are committed here.

## Run

```
node packages/jev/src/lab.ts gold                                   # gold set: approved exact/close color mappings
node packages/jev/src/lab.ts run packages/jev/experiments/e01-facets-full.json --dry   # request preview, token estimate
node packages/jev/src/lab.ts run packages/jev/experiments/e01-facets-full.json         # real calls (cached)
packages/jev/experiments/matrix.sh                                  # every experiment, then a comparison table
node packages/jev/src/lab.ts compare e01-facets-full e04-facets-siblings
node packages/jev/src/lab.ts errors e01-facets-full property        # most common confusions
node packages/jev/src/lab.ts show e01-facets-full <token>           # one item: state, gold, answers
node packages/jev/src/lab.ts gaps --products fluent,spectrum        # Jev's pick for sample-card parts a system lacks
```

- **Key:** `TYPESAFE_API_KEY` in the environment or in the gitignored `.env.local` at the repo root. It is never logged or written elsewhere.
- **Endpoint:** `https://api.typesafe.ai/v1/systemone`, the one docs.typesafe.ai lists. Never send the key to another host.
- **Cache:** every response is stored by a hash of its request (`.cache/jev/responses/`). Re-running costs nothing, and `--offline` refuses to call.
- **Data sent:** public token names, descriptions and values from open-source packages, plus the ontology's own words.

## Experiments

An experiment is a JSON file: `sample` (size, seed, tier `owner`/`rule`/`all`, products), `state` (`name`, `name+desc`, `full`, `full+siblings`; `text` or `json`) and `questions`:

- `facets`: one Choice per facet. Criteria are the facet values that registered color concepts use, plus `none`; `definition` or `label` criteria; `plain` or `rich` instructions.
- `registry`: one Choice among k registered concepts (the gold one plus the k-1 nearest): reuse first.
- `noul`: Noul scores for the gold concept and its nearest neighbor(s); right when gold scores higher.
- `two-stage`, `staged`, `merged`, `owner-choice`, `usage-noul`, `words`: see `src/tasks.ts` and the round notes in `LESSONS.md`.
- `criteriaFile` replaces option descriptions; `state.evidence` adds alias chain and consuming tokens; `state.conventions` adds lines from `experiments/conventions.json`. Samples can be limited to a tier: `judgment`, `convention`, `agent`, `no-convention`.

Metrics (`src/metrics.ts`): per-facet accuracy, joint accuracy (every facet right), expected calibration error, and accuracy with coverage at confidence thresholds, by product and by tier (owner-reviewed is the gold tier).

## Loop

The lab is built for a bounded improve loop. Each round:

1. State a hypothesis as a new experiment file, changing one thing from the current best.
2. Run it (same seed and sample as the best, so the comparison is paired) and `compare`.
3. Read `errors` and `show` for the biggest confusion. Decide whether it is a state, question, ontology or gold problem.
4. Keep the change when joint accuracy or calibration improves by 2 points or more. Otherwise record why not.
5. Promote what held up to `LESSONS.md`, with the experiment names and numbers.

Stop after two rounds without a 2-point gain, then confirm the best configuration on a fresh seed and on the owner tier before proposing any pipeline role.

## Checks

`pnpm check` here: typecheck plus metric tests. No test calls the API.
