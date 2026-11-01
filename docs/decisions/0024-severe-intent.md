# 0024 A severe intent between warning and danger

Status: accepted, 2026-11-01 (owner decision after the semantic text sweep).

## Context
`intent/caution` is defined as a milder level of warning. Primer `severe` ("high-priority warnings", orange) and Carbon `support-caution-major` (orange) sit between warning and danger. They were approved as warning, while their term mappings pointed at caution, so the terms, the mappings and the lexicon contradicted each other.

## Decision
- New value `intent/severe` (Severe): "Status serious enough to need prompt attention: stronger than a warning, short of danger." Related to warning and danger.
- Caution keeps its meaning (milder than warning).
- Primer `severe.*` (5 mappings) and Carbon `support-caution-major` move to severe; Primer's term `severe` maps to it exactly.

## Consequences
- Status intents read caution < warning < severe < danger where a system ships all four levels.
