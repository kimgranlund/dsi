# 0025 Brand-specific levels stay native

Status: accepted, 2026-11-01 (owner decision after the vocabulary corpus comparison).

## Context
Source ramps (Material tonal palettes, Atlassian Orange250, Primer display scales) have consistent ranges and steps across systems. Semantic and scale levels are often brand-specific: Fluent's numbered slots (Background1..6), Carbon's layering model (layer-01..03), Material's secondary and tertiary roles. ADR 0018's amendment ranked numbered ladders by contrast and spread them over the seven emphasis steps, which forced a system's own scale into a functional one: 104 approved mappings (Fluent 93, Carbon 11) bound an emphasis step no native word named.

## Decision
- Source ramps map only to hue and step (ADR 0013, ADR 0017), never to an intent or emphasis.
- A brand-specific level (a numbered slot, a layer number, a role order such as secondary or tertiary) is never forced to a functional level. The token keeps its functional role, binds no emphasis, and is matched `broad`; the step stays native. A brand-specific role with no functional reading (Primer sponsors) stays unmapped or `related`.
- Emphasis binds only from a native emphasis word, ranked by contrast where the words allow (ADR 0018, boundary B1). This replaces ADR 0018's numbered-ladder amendment; `rank-emphasis` no longer ranks numbered ladders.
- The 104 forced mappings were re-derived to broad members without emphasis.

## Consequences
- Cross-system emphasis views show only systems that name emphasis; Fluent and Carbon layers appear as members of the role.
