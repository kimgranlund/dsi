# 0026 Competency questions decide which words exist

Status: accepted, 2026-11-01 (owner approval of the 18 questions).

## Context
The normalization spec (docs/planning/spec-alignment.md) roots its registry in competency questions: every concept and category boundary traces to a question, and a distinction no question needs is a deletion candidate. DSI's words traced only to ADRs and owner decisions.

## Decision
- `ontology/competency-questions.json` holds the questions (CQ-001 to CQ-018), each listing the whole facets or the facet values it needs.
- The validator refuses a facet value that no active question needs, and a question that names an unknown or deprecated value.
- A new word comes with the question that needs it. Retiring a question surfaces the words only it needed as deletion candidates.
- A question claims a whole facet only when it needs every value of it (state, emphasis, hue, style, component, part, syntax, mode). Claiming intent, usage or property wholesale would make the check vacuous; the first draft did, and the negative control caught it.

## Consequences
- Granularity disputes ("is this a new usage or a note?") are settled by asking which question needs the distinction.
