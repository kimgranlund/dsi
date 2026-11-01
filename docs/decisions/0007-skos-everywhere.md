# 0007 Every judgment is a SKOS mapping

Status: accepted, 2026-11-01

## Decision
Token mappings and naming-term mappings are SKOS mappings with the native side as subject (`dsi:native/<product>/<version>/<path>`, `dsi:vocab/<product>/<term>`) and a canonical concept or facet value as object. Match types are the five SKOS mapping properties; the direction is fixed (`narrow` means the concept is narrower than the token). The authored copies are JSON; `data/skos/` is the generated RDF form, validated on every check.
