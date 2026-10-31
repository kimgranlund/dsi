# Mappings

Agent-authored judgments linking native tokens to canonical concepts: `mappings/<product>/<version>.mappings.json`.

## Kind

Agent-authored, human-reviewable. Written by `@dsi/mapper merge`; never regenerated wholesale.

## Records

| Field | Holds |
|---|---|
| `mappings[]` | token -> concept with a SKOS match type, confidence, rationale, provenance, status |
| `unmapped[]` | tokens no canonical concept fits yet (ontology backlog) |
| `noEquivalent[]` | concepts this product version has no token for (absence of a record means unknown) |

Statuses: `proposed` (candidate), `approved` (adopted; by agent agreement or a human), `rejected` (kept so it is never proposed again), `superseded` (replaced, kept for history).

## Rules

- To approve or reject by hand: set `status` and add `review: { by, at, note? }`. Never delete a rejected record.
- Match direction: the token is the subject, the concept the object; `narrow` means the concept is narrower than the token.
- Only approved mappings feed the canonical token set and the public site.

## Checks

`corepack pnpm check` (shape, concept grammar, statuses, match types, review on approved/rejected).
