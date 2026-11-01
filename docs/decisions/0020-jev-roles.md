# 0020 Jev as audit pre-screen and review suggester

Status: accepted, 2026-11-01 (owner decision G9 after the pilot in `packages/jev/`).

## Context
Jev (TypeSafe System One) answers typed questions with probabilities, and it is not an Anthropic model. Our voters (opus, sonnet, fable) all are. The pilot (25+ experiments, `packages/jev/LESSONS.md`) measured it against 1,133 approved mappings and 84 owner judgments:
- It verifies well: the approved concept outscores its nearest rival 94 to 96% of the time.
- Its confident picks are reliable: 93 to 97% right at confidence 0.85 or more, covering about 45% of tokens.
- As a voter or tiebreaker on hard cases it matches the agents (62 vs 61%) without complementing them.

## Decision
- **Audit pre-screen.** `dsi-jev prescreen` scores each approved mapping against its 3 nearest registered rivals and flags those where a rival wins by 0.2 or more. `audit-prepare --only .cache/jev/prescreen.json` sends just those to the strict evidence audit first.
- **Review suggestions.** `dsi-map review --jev` shows Jev's two-stage pick on every card. At confidence 0.85 or more it may preselect an existing answer when no precedent or majority did, or offer its own concept as a separate option. Below 0.85 it is labeled weak.
- **Jev never approves.** It has no vote in merge, tiebreak or settle. Its answers carry the model version it reports (for example `jev-1.14.0`), and an owner decision made from a Jev pick records that in the review note.
- **Endpoint and key.** Only `api.typesafe.ai`; the key lives in the gitignored `.env.local`.

## Consequences
- The mapper depends on `@dsi/jev` (roles only; the lab stays separate).
- A Jev release can change answers; the cache is keyed by request, so re-running an experiment on a new release needs the cache cleared for that experiment.
- The pilot continues under the loop in `packages/jev/README.md`; a wider role needs new evidence and a new owner decision.

## Amendment, 2026-11-01 (owner decisions on B4 and B7, ADR 0021)

A third role, narrower than a vote: **boundary judge**. Jev judges one boundary statement against its negation (pairwise, margin 0.3) only on the boundaries where round 6 measured it reliable (`RELIABLE` in `packages/jev/src/roles.ts`: B4, B6, B7):

- `boundary-rules --jev`: where the code test finds no evidence, Jev's B4 ("on a bold, solid fill") or B7 ("colors code") judgement decides that one facet of an answer the agents already gave. Jev never introduces a concept, and the registry gate still holds new concepts for the owner.
- `triage-conflicts`: Jev's B4 and B6 judgements sort approved mappings that break a test into likely test bugs and owner decisions. It changes nothing by itself.

"No vote in merge, tiebreak or settle" still holds: Jev does not choose between agent answers. It only answers the deciding test on B4 and B7 where shipped facts are silent.

