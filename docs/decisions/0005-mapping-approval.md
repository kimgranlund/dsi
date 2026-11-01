# 0005 Mapping approval: blind agreement, classifier vote, human review

Status: accepted, 2026-11-01

## Decision
- Two Claude Code agents on **different models** map each packet blind. A mapping is Approved when both give the same concept **and** match type with confidence >= 0.85.
- With the classifier as third vote (approved terms only, whole name explained, same concept, exact or close match) the bar is 0.6.
- Everything else is Proposed and goes to human review (the review page). Approved and Rejected records are never changed by agents; a rejected answer is never re-approved.
- Naming terms follow the same rule (two agents, agreement approves, the rest reviewed).
- The public site shows Approved mappings only.

## Consequences
color-v1 settled 508 tokens: 163 by agreement in three rounds, 2 with the classifier, 185 by human review. Human decisions are the evaluation set for future prompts and models (`dsi-map eval`).

## Amendment, 2026-11-01 (owner decision, adding four systems)
With about 1,100 color tokens queued after Atlassian, Primer, Spectrum and Fluent, mostly agreement below the bar:
- **Bar lowered**: two agents on different models agreeing on concept and match approve at confidence >= **0.7** (was 0.85). The classifier-vote bar stays 0.6.
- **Two of three**: tokens still contested get a third, blind agent on a third model family with web research; when its concept and match equal one of the first two answers (each >= 0.7), that answer is approved (`review.by: two-of-three`, method `two-of-three-v1`). The other answers are rejected with a note.
- Computed answers (`rank-rule`, `terms+classifier` for scales) remain deterministic and cite their ADRs.
- Every approval stays subject to the evidence audit; contradictions reopen for human review.

## Amendment, 2026-11-01 (owner decision, settle rules)

After the third opinion, still-contested tokens settle by rule (`dsi-map settle`), each recorded with its method:

- **Three agree on the concept** (`settle-three-v1`): approved with the most cautious match any of them gave (exact, then close, then broad or narrow). A broad/narrow split or any `related` answer stays queued.
- **Three agree on every facet but emphasis**: the contrast rank of ADR 0018 when it computes (`emphasis-rank-three-v1`); otherwise the shared concept without emphasis, matched `broad`, since the token is one member of it (`settle-broad-v1`).
- **Two of three** give the same concept and match at confidence 0.5 or higher (`settle-two-v1`): approved; the third answer is rejected with a note. These remain subject to the evidence audit.

Everything else goes to the review page.
