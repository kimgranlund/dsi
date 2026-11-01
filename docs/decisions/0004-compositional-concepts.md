# 0004 Canonical concepts are compositional

Status: accepted, 2026-10-31

## Decision
A canonical concept is a combination of facet values with a compositional IRI, `dsi:concept/<domain>/<facet>-<value>/...`, in the fixed order intent, usage, component, part, property, emphasis, state. Values must exist in the facet's scheme. Usage and state may combine two values with `+`, sorted alphabetically (`usage-inverse+link`). Component and part are reserved until their vocabularies exist. An unbound facet means "not specific to that dimension", never "default".

Ontology IRIs are permanent (`https://dsi.nonoun.io/ontology/`). A value is retired with `owl:deprecated`, never deleted: old records stay readable, new references are refused.

## Consequences
Combinations are not enumerated by hand; the validator checks grammar, order and values. Facet values added so far came from evidence across at least two systems (see 0008).
