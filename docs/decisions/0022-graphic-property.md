# 0022 A graphic property for non-text marks

Status: accepted, 2026-11-01 (owner decision on boundary B5).

## Context
Spectrum ships `*-visual-color` tokens (accent, the status colors, and every categorical hue) that paint non-text graphics: icons, status-light dots, meter and progress fills, and chart marks. No property fit. Icon is too narrow for meters and dots, and leaving the property unbound loses that these tokens color marks, not text or surfaces. 25 tokens were queued on this boundary, and every answer split on it.

## Decision
- New value `property/graphic` (Graphic): "The color of non-text marks: icons, status dots, illustrations, and meter or chart fills." A token only for icons still binds `property/icon`.
- Boundary test B5 (`packages/mapper/src/boundary-rules.ts`): a token binds graphic when its name says visual color (`visual-color`) or its description says it paints non-text graphics. `boundary-rules` swaps icon for graphic in such answers, or adds graphic when the property is unbound.
- The concepts this produces are owner-approved by this decision and registered directly (ADR 0019).

## Consequences
- Jev's option list gains graphic, since it uses the property values registered color concepts use.
- Other systems' icon tokens are unchanged.
