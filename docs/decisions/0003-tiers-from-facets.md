# 0003 Tiers are derived from facets

Status: accepted, 2026-10-31

## Decision
Five tiers: Source, Scale, Semantic, System, Component (`ontology/schemes/tiers.jsonld`). A token holds every tier whose defining facets it binds; Source only when no other tier is held. Tier is never hand-labeled and is independent of alias position. Mode is a context facet: it selects a value but never changes identity or tier.
