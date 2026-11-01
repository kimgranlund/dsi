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

## Round 4 (2026-11-01): the external report's claims, the audit sweep, usage

- **Confidence bands hold for Choice.** Two-stage picks: 93 to 97% right at 0.85 or more, 50 to 60% from 0.5 to 0.85, 24 to 28% below 0.5 (e16, c2). Facet Choices: 99% at 0.85 or more. The three-tier branching the external report proposes fits Choice answers. It does not fit raw Noul scores, which are poorly calibrated: compare pairs instead. The report's price ($0.042 per million input tokens, output free), latency and "100% guaranteed" claims are not in docs.typesafe.ai and stay unverified.
- **Audit sweep (e23, 1,133 approved mappings, approved concept vs 3 nearest rivals).** The approved concept wins 91.4% of the time. Most losses are near-ties (77 of 98 within 0.1), so flags need a margin. At 0.2 or more, 11 mappings are flagged (1%), and they are real borderline calls: Primer `upsell` (discovery vs accent), Material `primary-container` (subtle vs strong), Polaris brand hover (emphasis step). Flags do not track the earlier auditor's verdicts (8.6% of contradicted vs 9.9% of supported), so the pre-screen finds different things.
- **Usage as one Noul per value** (e24): 51 to 53% vs 46 to 50% as one Choice. A small gain; usage stays the weak facet.
- **Review suggestions on the 171 queued tokens:** 32 picks at 0.85 or more. 12 match an agent's answer; 20 name a concept no agent proposed.

## Pre-screen audited (2026-11-01, strict haiku auditor, blind to Jev's suggestion)

Of the 11 flags, the auditor found 8 supported, 2 insufficient and 1 contradicted. The contradiction (Primer `fgColor.severe`: "Warning foreground", where the auditor suggests "Strong warning foreground", citing the description and Primer's color docs) is the rival Jev preferred. The three Primer `upsell` flags (discovery vs accent) were supported as approved. So the pre-screen's precision for real errors is about 1 in 11 at margin 0.2, with 2 more needing evidence: cheap at 1% of mappings, but only a second look, not a verdict.

## Round 5 (2026-11-01): data quality and pipeline shapes

Fresh, convention-free sample of 140 (seed 3), e12 settings as the baseline (joint 25%, usage 47%). The answer key now drops mappings the strict audit contradicts and tags each answer as judgment (201), convention (162) or agent (756). Responses are cached by request but re-asked when Jev serves a new model version (`--refresh` forces it).

- **Contrastive option descriptions win.** Saying what each usage value is *not*, and giving "none" concrete examples ("most text, icon and border tokens are general"), lifts usage from 47 to 61% and joint accuracy from 25 to 30% (r5-c). The descriptions are in `experiments/criteria-contrastive.json`; review suggestions use them.
- **Better definitions alone do nothing** (r5-b: 23% joint). The drafted L4 definitions are better documentation but not more decisive. What helps Jev is contrast between neighboring options.
- **Shipped-code evidence adds nothing** (r5-d): alias chains and consuming tokens leave every facet within a point.
- **Staged questions are within noise** (r5-f: 30.7 vs 30%).
- **Stated conventions do not help** (r5-e vs r5-e0): the 18 convention-matched tokens score 11% joint either way. Keep conventions as deterministic rules; don't expect Jev to apply them from a note.
- **The merged candidate list is worse than the agents.** Every agent answer plus Jev's top 5 lists the owner's answer 90% of the time, but Jev picks it 55% vs the agent majority's 61% (r5-g, 84 owner judgments). Jev does not settle disagreements the agents could not.
- **Naming words are weak.** Right dimension 58%, right value 40% (r5-h, 198 approved terms). Words without their token context are too ambiguous for one-shot Choice.
- **Sample-card gaps** (`dsi-jev gaps`): Fluent's page background is picked plausibly (`colorNeutralBackground1`, 0.68). Danger-label picks are weak or wrong for every system (0.19 to 0.62), and two systems have no "link" token names to choose from. Use it as a lead for review only at high confidence.

### Where this leaves the roles

Jev is a good **checker** (pairwise Noul, 94 to 96%) and a good **confident suggester** (Choice at 0.85 or more is right 93 to 99% of the time). It is not a better **judge of hard cases** than the agents. The levers that worked were all about the question: limiting options to the domain, contrastive descriptions, enforcing the grammar afterwards, and comparing instead of thresholding.

## Round 6 (2026-11-01): boundary statements, conflict triage, generated contrast

- **Boundary statements are Jev's best use so far.** Each statement is scored against its negation on balanced true/false approved mappings (seed 4). Accuracy when it answers, at margin 0.3:

  | Boundary | Both directions right | Answered | Accuracy |
  |---|---|---|---|
  | B7 "colors code" | 99.2% | 98% | 100% |
  | B4 "on a bold fill" | 84% | 72% | 98% |
  | B6 "colors both text and icons" | 79% | 48% | 100% |
  | B1 "one step of a ladder" | 65% | 59% | 76% |
  | B3 "a container on the page" | 72% | 38% | 89% |
  | B8 "neutral member of a status set" | 52% | 46% | 50% |

  B3 is one-sided: it is right on 95% of surfaces but only half the non-surfaces. Use Jev for B4, B6 and B7; not for B1, B3 or B8.
- **B4 tie-break in `boundary-rules --jev`.** Where the code test finds no fill, Jev's B4 judgement decides. It settled one more token on its first run, since most open on-fill tokens already had code evidence.
- **Conflict triage found test bugs first.** `dsi-map triage-conflicts` had Jev judge the B4 and B6 conflicts. It sided with the approvals on 23 of them, and they were a misfiring test:
  - Syntax, code and link colors are text whatever their names say.
  - Spectrum names icon colors `icon-color-*`, not in the same name position as text.

  After the fixes, approved conflicts fell from 97 to 76: 59 B1 and 11 B3 for the owner, plus 6 Polaris `color-text-*-on-bg-fill`, where Jev says foreground against the test's text.
- **Generated contrastive descriptions lose to hand-written ones.** Mechanical "<definition>; not <neighbor>; not general-purpose" text built from the boundary list gives 17.9% joint vs 25% for plain definitions and 32.1% for the hand-written set; intent drops from 78 to 65%. Combined, with hand-written text winning where both exist, it scores 33.6%, within noise. Contrast helps only when it is written as a real distinction.
- **Owner grading is wired.** `review --jev` saves its picks (`.cache/jev/review-picks.json`), and `apply-review` grades them against the owner's token decisions in `experiments/OWNER-SCORES.md`.

## After round 6 (2026-11-01): where Jev stops being needed

- **Observed usage answers property and state.** The token-usage graph (Spectrum, Primer with Primer React, Carbon, Polaris) agrees with approved mappings 93 to 97% on property and 84 to 94% on state where it is decisive. Those are the facets where Jev's facet classification was weakest, so ask Jev only for tokens no shipped component uses.
- **Neither reaches the hard queue.** Open and conflicting tokens are mostly ones no component references (ramps, data-viz, display, editor colors). Jev's suggestions and observed usage both cover few of them, so the owner's review remains the bottleneck.
- **Owner scores are pending.** `OWNER-SCORES.md` is written by the first `apply-review` after a `review --jev` round. Its first numbers decide whether the 0.85 preselect threshold holds.

