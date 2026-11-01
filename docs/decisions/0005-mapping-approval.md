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
