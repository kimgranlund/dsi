# Alignment with the Design System Normalization Platform spec

Working note, 2026-11-01. Compares DSI with `design-system-normalization-spec.md` (Draft v0.1, supplied by the owner, not in the repo). Planning state: a ratified change becomes an ADR.

## Summary

Closely aligned on structure: definition layers above evidence layers, SKOS crosswalk, `noMatch` as a recorded outcome, syntactic-only adapters, a governed registry. DSI is token-first and diverges in four places: no competency questions, name-led resolution, unstructured mapping evidence, and no golden-set regression gate.

## Layer by layer

| Spec layer | DSI today | Fit |
|---|---|---|
| L0 Competency questions | 18 questions in `ontology/competency-questions.json` (ADR 0026); the validator refuses a facet value no question needs | Done (values; composed concepts trace through their facets) |
| L1 Metamodel | Tokens, modes/themes, aliases; component tier through token applications (ADR 0015). No Guideline, Pattern or Platform entities | Partial (token-scoped by design) |
| L2 Concept registry | `ontology/schemes/concepts.jsonld`: facet-composed IRI as identity, prefLabel, generated L4 definition, broader/related, proposed (registry gate) and deprecated status, owner approval | Strong |
| L2 `discriminatingTest` | Boundary tests B1–B8 exist as code and ADR 0021, not stored per concept | Partial |
| L2 `externalAnchors` | DTCG types; Lezer highlight tags for syntax. No WAI-ARIA anchors (components are shallow) | Partial |
| L2 altLabels | On facet words (from the corpus comparison), not on composed concepts | Partial |
| L5 Adapters | Syntactic only; never assign concepts; never execute package code | Strong |
| L4 IR | DTCG with nativeName, modes, alias chains, consumers (`usedBy`, usage graph `data/usage/`). No GuidanceIR, no ComponentIR (ARIA, keyboard, parts) | Tokens strong; rest missing |
| L6 Snapshots | Pinned package versions, cached packs (`.cache/npm`), provenance to token path. No content-addressed snapshot IDs or byte spans | Partial |
| L3 Mapping record | SKOS match types, `noMatch` (approved unmapped), confidence, review status, superseded history | Strong |
| L3 Evidence | Prose rationales (L6) and audit evidence (kind, source, says). Not structured `{field, observed, expected, weight, agrees}`; no registry or resolver version on mappings | Partial |
| L3 "Signature first, names last" | The reverse: agents and the classifier lean on names and descriptions; values (contrast rank, boundary tests) and the usage graph are the behavioral evidence | Largest gap |
| L3 One-to-many | Narrow mappings allowed, ranked after exact/close (ADR 0006 amendment); one approved mapping per token in practice | Partial |
| L3 Determinism | Rules deterministic and approved decisions frozen; agent passes are not | Partial |
| §6 Query layer | Explorer: concept coverage across systems, value comparison. No gap analysis, contradiction finder or system diff over time | Partial |
| §7 Governance | Registry gate (new concepts wait for the owner), ADRs, validator. No SemVer on the registry; ontology grows per system | Partial |
| §8 Golden set, regression gate | `evals/`: approved exact/close mappings gate the classifier per product before push and deploy (`corepack pnpm eval`) | Done for the classifier; rules and boundary tests not yet suites |
| §9 Cross-cutting | Schema checks strong (JSON Schemas, validator); review queue strong; provenance and versioning partial; drift via re-ingest (runbook §11) | Partial |
| §10 Onboarding | `add-design-system` skill follows the same steps. Ontology still changes per system (ADRs 0023–0025), against the spec's "no L0–L2 changes" criterion | Partial (early phase) |

## Where DSI goes further

- Facet-composed concept identity: a structured signature, stronger than a prose definition.
- Controlled language L1–L7 (docs/controlled-language.md): names, definitions, match statements and rationales generated from structure.
- Blind agreement of two model families, a third opinion from a third family, and an evidence audit.
- ADR 0025: brand-specific scales are never forced into a functional level, the spec's "names never determine identity" applied to levels.

## Candidate work, in order of value

1. **Competency questions (L0).** A `CQ-*` registry; every facet value and concept family links to at least one. Gives a deletion test and settles granularity disputes.
2. **Structured mapping evidence (L3).** Emit usage-graph agreement, contrast rank and boundary-test results as `{field, observed, expected, agrees}` records; stamp each mapping with the registry and resolver versions.
3. **Per-concept discriminating tests (L2).** Store the boundary-test wording on concepts with siblings.
4. **Golden-set regression gate (§8).** Re-run rules and the classifier against approved mappings on every change; block on a drop beyond tolerance.

Larger, separate: content-addressed snapshots with spans (L6), guidance extraction with span grounding (GuidanceIR), component signatures (ARIA role, keyboard, focus, parts).
