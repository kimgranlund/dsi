# 0021 Deciding tests for four vocabulary boundaries

Status: accepted, 2026-11-01 (owner decisions on the ranked boundary list, `docs/planning/boundaries.md`).

## Context
Mapping disagreements cluster on a few boundaries between neighboring facet values. Agents, the third opinion and Jev all reach about 60% on hard cases, because the ontology never said where these boundaries lie. One decision per boundary, written as a test on shipped facts, settles every token on it in every system, instead of one review card per token.

## Decision
Each test reads only names, descriptions and values per mode (`packages/mapper/src/boundary-rules.ts`):

- **B1, when emphasis binds.** Only in a ladder: two or more siblings (state words ignored) that differ only by a step word or number at one position, or the plain member beside its stepped siblings, whose contrast against the page orders the same way in every mode where the family's values change. Step words: subtlest to strongest, bold to boldest, muted, emphasis, secondary, tertiary, container, variant, low to highest, dim, bright. Translucent colors are composited over the page first. Categorical hue ramps follow the ramp rule instead.
- **B3, surface or general.** Usage surface requires a page-level token in the same system that the token differs from in some mode. The test only removes surface; it never adds it, because a page sibling is required for surface, not proof of it.
- **B4, on-fill.** On-fill means on a bold fill: the fill the system's naming pairs with the token (Material on-X with X, Polaris `-on-bg-fill` with `bg-fill`, Fluent `On<Brand>` with `<Brand>Background`, text/icon/fg with background) contrasts at least 3:1 with the page, and the token at least 4.5:1 on it. A description saying "non-bold" or "subtle background" means not on-fill. No pairing found means no change.
- **B6, text or foreground.** Text when the system ships a separate icon family at the same place in the name (`color.icon.*` beside `color.text.*`); foreground when one token colors both (fg, foreground, content).

`dsi-map boundary-rules color-v1` normalizes every queued answer by the tests and approves a token when all normalized answers agree, with the most cautious match and through the registry gate. Approved mappings are never changed: ones that break a test are written to `.cache/boundary-conflicts.txt` for review.

## Consequences
- First run: 42 queued tokens settled. 19 of them use new concepts, which the registry gate holds for the owner. 97 approved mappings conflict with a test; the largest groups are Primer `fgColor`/codeMirror text vs foreground (13) and emphasis on families that are not contrast-ordered ladders (Polaris 12, Fluent 12, Atlassian 10).
- The tests' wording goes into the mapping prompt and Jev's option descriptions. A validator check is deferred until the conflicts are reviewed, so that `pnpm check` does not fail on decisions taken before this ADR.
- B2 (word vs contrast order), B5 (graphics without a property), B7 (code surface) and B8 (neutral intent) remain open.

## Amendment, 2026-11-01 (owner decision: Jev in boundary tests)

- **B4 tie-break.** Where the code test finds no fill to pair with, `boundary-rules --jev` uses Jev's judgement of "this token colors text or icons on a bold, solid fill" against its negation, decided at a margin of 0.3 (98% accurate on 72% of balanced cases).
- **B6 refinements from triage.** Syntax, code-surface and link colors are text by nature, so B6 skips them. A system "ships icon colors" when any token name has an icon-color segment, not only at the same name position.
- **Conflict triage.** `dsi-map triage-conflicts` has Jev judge approved conflicts on B4 and B6 only. B1 and B3 stay for the owner: Jev's accuracy there is 76% and one-sided. After the refinements, 76 approved conflicts remain (59 B1, 11 B3, 6 B6).
- B7 can use Jev's "colors code" judgement (99 to 100%) as its deciding test once the owner decides B7.

## Amendment, 2026-11-01 (owner decisions on B5, B7, B8)

- **B5, graphics.** A token whose name says visual color, or whose description says it paints non-text graphics, binds the new `property/graphic` exactly (ADR 0022). First run: Spectrum's 25 `*-visual-color` tokens settled, and their 20 concepts registered.
- **B7, code surface.** Code-surface usage when the token lives under a code namespace (prettylights, codeMirror, diffBlob, syntax, or a code or syntax name segment) or its description names code. Otherwise Jev's "colors code" judgement decides at margin 0.3. Diff markup colors also bind syntax inserted, deleted or changed.
- **B8, neutral intent.** Neutral only when the system ships status versions of the same role: the name up to the neutral word, with danger, success, warning or info in its place, starts some token of the system. Plain structural grays get no intent. Jev is not used: it is at chance on this statement.
- B2 stays open pending a re-audit of its contradictions.
