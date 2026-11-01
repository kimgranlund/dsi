# Jev lessons

Durable findings about using Jev for DSI mapping, each with the experiments that show it. Hypotheses that did not hold stay here too, marked as such. Raw numbers: `experiments/RESULTS.md`.

## Before any call (2026-11-01, from building the lab)

- **Use the official endpoint only.** docs.typesafe.ai lists `api.typesafe.ai/v1/systemone`. A Hugging Face community post points to another domain (thejevai.com) and is not official.
- **Limit choices to what the domain uses.** Offering every facet value gave color tokens typography usages (heading, body) as options. Criteria now come from values that registered color concepts use: 10 intents, 16 usages, 15 hues, 8 properties, 7 emphases, 8 states, plus none.
- **Jev answers one question at a time, in isolation.** Facet Choices cannot see each other, so combinations must be assembled and validated afterwards (`parseConcept`). Usage is multi-valued; a single Choice can only name one member.
- **Request size.** A full-state, six-facet request is about 1,400 input tokens; the 70-item matrix experiment is about 97,000.

## Rounds 1 to 3 (2026-11-01, jev-1.14.0, 1,338 calls, 1.73M input and 0.43M output tokens)

Sample: 70 approved exact/close color mappings per experiment, stratified by product (seed 1), confirmed on seed 2. The tiebreak benchmark uses 84 owner judgments with rejected alternatives on record.

### What works

- **Verify with Noul: the strongest pattern.** "This token means <name>: <definition>" scores the right concept above its nearest registered neighbor 94% of the time, and 96% on seed 2 (e10, c3). Absolute Noul values are poorly calibrated (only 73 to 77% of right answers score above 0.5), so compare pairs; don't threshold. Use: an audit pre-screen that flags approved mappings where a neighbor outscores the approved concept.
- **Choose among registered concepts.** One Choice among k candidates that include the right one: 93% at k=5, 89% at k=10, calibrated (ECE about 8%) (e08, e09). This is the ceiling for any reuse-first step.
- **Two-stage reuse-first, without help.** Rank registered concepts by the product of per-facet probabilities, then one Choice among the top k. At k=20 it is right 60 to 64% of the time, with the right answer in the list 86 to 93% of the time. **At confidence 0.8 or more it is right 88 to 94% of the time, covering 47% of tokens** (e16, c2). Use: preselect the review page's suggestion when confident; never approve.
- **Siblings in the state help a little** (joint 16 vs 10%; e04). JSON vs text and labels vs definitions make no difference (e05, e06).

### What does not

- **Facet-by-facet classification.** Six independent Choices: 10 to 16% of tokens fully right (e01 to e07). Jev rarely answers "none": it names a gray token's hue as gray even when the token isn't categorical, and gives plain tokens a usage. Enforcing the grammar afterwards (no hue without categorical usage) brings it to 27%, and adding 0.3 to p(none) to 34% (29% on seed 2) (e11, e12, c1). Usage stays at 45 to 50%. Renaming "none" to "general" changes nothing (e13).
- **The none boost and grammar inside two-stage ranking.** They help the single best guess but hurt ranking: the right answer's hit rate fell from 81 to 64% (e20).
- **Family concepts as candidates.** Crowds out better ones: 47% vs 59% (e21).
- **Tiebreaking the hard cases.** Over the owner's answer plus the rejected agent answers, Jev matches the agent majority (62 vs 61%) and is no better where they disagree (52 vs 48%, n=21) (e17, e18). These are cases where the owner overrode everyone, so neither is a good predictor.

### Benchmark lessons

- **Exclude rule-derived decisions from judgment benchmarks.** 190 Primer ramp and 20 Atlassian "bolder" approvals came from owner rules, and the right answer is a convention no token shows. Including them made extra distractors look like they raised accuracy from 37 to 68%.
- **Grade on the owner tier as well.** Rule-approved gold inherits the agents' biases.

### Recommended roles, smallest first (owner decision G9)

1. **Audit pre-screen** (Noul pairs): flag approved mappings whose nearest neighbor outscores them, for the strict evidence audit.
2. **Review suggestions** (two-stage, k=20, confidence 0.8 or more): show Jev's pick on cards with no precedent.
3. Not a voter in merge or tiebreak yet: no benchmark shows it beats or complements the agents.

### Next experiments

- Noul audit over all 1,133 approved exact/close mappings: how many does it flag, and how many of those does the strict auditor confirm?
- Usage as one Noul per value (it is multi-valued, which a single Choice cannot express).
- Two-stage on the 171 queued tokens: how often its confident pick matches the owner's eventual decision.
