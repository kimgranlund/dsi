# 0002 Native, concept and mapping layers; shipped code is the truth

Status: accepted, 2026-10-31

## Decision
- **Native layer** (`data/native/`): each product's tokens in DTCG 2025.10 under their native names, generated from the pinned shipped package. Never renamed or edited. Every token carries provenance (`$extensions["io.nonoun.dsi"]`).
- **Concept layer** (`ontology/`): canonical meaning as SKOS.
- **Mapping layer** (`mappings/`): typed links from native to canonical. Agent-authored, human-reviewable, never regenerated wholesale.
- When a spec and shipped code disagree, **shipped code wins**; divergence is a note. Design Systems are ingested through an implementation.
- An alias is written only when proven (the referenced token resolves to the same value); everything else is a literal with a note. Literals no DTCG type fits stay untyped strings.

## Consequences
Upgrading a product means a new version folder; old versions stay. Output is byte-stable, so upstream changes are reviewable diffs.
