# 0013 Geometry, typography and motion map as roles; steps stay native

Status: accepted, 2026-10-31 (owner chose "roles + value-aligned scales"; typography and motion are their own categories).

## Context
Non-color tokens are mostly scales: `spacing-400`, `shape.corner-medium`, `font-size-350`, `motion-duration-200`. Mapping each step to its own concept would invent a cross-system step vocabulary that no system shares (Carbon `spacing-05` is 16px, Polaris `space-400` is 16px, Material has no spacing scale). Step names are native and their values are the comparison.

## Decision
- A scale token maps to one **role concept** per property: `dsi:concept/<domain>/property-<role>`, e.g. `space/property-spacing`, `shape/property-corner-radius`, `typography/property-font-size`, `motion/property-duration`. The 21 role values live in `facet/property`; each names its domain with `dsi:inDomain`. The `layout` domain holds breakpoint and z-index.
- Match type is `broad`: each step covers one point of the role's scale, so the concept is broader than the token (`ontology/schemes/mapping.jsonld`; the token is the subject). Corrected 2026-11-01: the first text said narrow and map-scales-v1 wrote exact; map-scales-v2 supersedes those mappings.
- The step is not a facet of the concept. It stays in the native name and value; the site aligns steps across systems by value on one ruler.
- Mapping is deterministic (`classify map-scales`, method `map-scales-v1`): a token maps only when its whole name is explained by approved terms (role words, noise, step words) and its DTCG type fits the role (`ROLE_TYPES`). Anything else is a leftover with a reason, for agents or review. Step words are agreed in vocab rounds (`ignore: step`), as noise words are.
- Named members of a role are step words too: easing curves (`emphasized`, `entrance`, `productive`, `ease-in`), keyframes (`fade`, `bounce`) and font families (`brand`, `plain`). They pick one member and stay native; comparing them across systems would need a new facet (owner decision, 2026-11-01).
- Type-style roles (heading, body, label, with display/headline/title narrower than heading) bind `usage`, so `typography/usage-body/property-font-size` is a role too.
- Color concepts keep their per-token mappings; `@dsi/canon` emits color only.

## Consequences
- Concept pages for roles show each system's whole scale, drawn to the same value axis. An outlier step ("full" radius 9999px) is capped and drawn hatched.
- Systems with a role but no approved tokens read as unknown, not absent.
- A future step vocabulary (t-shirt sizes, numeric) stays possible as a new facet without remapping: role mappings stay valid.
