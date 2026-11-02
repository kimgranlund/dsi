# 0027 Structured mapping evidence and version stamps

Status: accepted, 2026-11-01 (owner choice: generated evidence plus stamps on new records).

## Context
The normalization spec (docs/planning/spec-alignment.md, L3) asks for mapping evidence as structured records, `{field, observed, expected, weight, agrees}`, and for each mapping to name the registry and resolver it was judged against. DSI's evidence was prose: L6 rationales and audit verdicts. The deterministic tests that produce the facts (usage graph, contrast ladders, boundary tests B3, B4 and B6, hue against intent, naming terms) already existed, but their results were used once and discarded.

## Decision
- `dsi-map evidence <scope>` writes `data/evidence/<product>/<version>.json`: one entry per approved color mapping, each with records `{test, field, observed, expected, agrees, weight?}`. It is generated, never hand-edited, and rebuilt after mappings or data change.
- Tests: `usage` (component CSS, decisive at a 70% majority: property, state, container), `B1` (a bound emphasis needs a contrast-ordered ladder), `B3` (surface needs a page sibling it differs from), `B4` (on-fill needs 4.5:1 on a bold sibling fill), `B6` (text when a separate icon family ships), `hue` (intent against hue ranges, first mode the token resolves in), `terms` (each facet the approved naming terms bind; multi-valued facets compare as sets and a broader terms value agrees).
- A test that cannot decide writes no record. Missing evidence is not disagreement.
- Every mapping and unmapped (noMatch) record a write adds or changes carries `provenance.registry` (`ontology@<sha1-12>` over `ontology/schemes/*.jsonld`) and `provenance.resolver` (`resolve@<sha1-12>` over `packages/resolve/src`). All writers go through `writeMappingFile` (`@dsi/schema`). Records written before this decision stay unstamped; a stamp is never back-filled, since it would claim a judgment against a registry it never saw.
- Token pages show the records under "Evidence".

## Consequences
- A disagreeing record is a review candidate, not a verdict. The first build found 329 mappings with one (of 1,836 approved color mappings); 95 of Primer's come from one term (`display`, a type style, also matching the `display.<hue>` color family).
- Content hashes are not SemVer: they say whether the registry changed, not how much. A registry release scheme (spec §7) would replace them.
- Evidence records are inputs for future golden-set suites over rules and boundary tests.
