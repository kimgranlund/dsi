# 0001 Product categories as layers of a stack

Status: accepted, 2026-10-31

## Context
Design systems sit next to adjacent things (headless libraries, styling engines, token tooling) that are often confused with them. The index has to say what each product is without forcing one organization's products into one bucket.

## Decision
Seven categories, defined in `ontology/schemes/categories.jsonld`: Token Format, Token Tooling, Token Set, Styling Engine, Headless Primitives, Component Library, Design System. Classify **products, not organizations** (Radix Primitives, Radix Themes and Radix Colors are three entries). Products relate through typed relations (`implements`, `builtOn`, `consumesTokensFrom`, `usesFormat`, `providesTokenSet`), each stating what it permits a consumer to infer. UI frameworks are not a category: they are values of `targets`. An Implementation is a catalog entity of a Design System, not a category. Only Design Systems, Component Libraries and Token Sets are ingested.

## Consequences
The catalog validator enforces category, relation-target and ingestion rules. A styling engine's default theme is cataloged as its own Token Set.
