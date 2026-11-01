# 0011 Token groups and order come from the best shipped evidence

Status: accepted, 2026-11-01

## Context
Token lists read best when grouped the way a designer would group them, with an order that progresses from the base color outward. Each system ships different evidence for that.

## Decision
A structure stage (`dsi-classify structure`) groups and orders every product's semantic and mapped tokens, using in precedence:

1. **Shipped groups**: groups the product declares (Carbon `src/tokens/v11TokenGroup.ts`, parsed not executed), in the designer's order. Tokens the groups do not cover join the shipped group of their name family, or form name families.
2. **Shipped order**: the authored order of the product's token source (Polaris base modules), inside name families.
3. **Name families**: the first meaningful word of the name; pairing prefixes (Material `on-`, `inverse-`) are found from the data (a word that prefixes three or more other token names) and sort right after their base, closest pair first.

Inside a group with no shipped order, tokens follow the canonical progression: level, variant, emphasis, pairing, state (base, hover, active, focus, selected, disabled). A family whose emphasis runs both below and above its base reads as a ramp (lowest, low, base, high, highest). In large groups, a following word that is not a state, emphasis or level forms a subgroup labeled with the product's own word. Group labels keep the product's words; the canonical meaning is shown beside them (Primary means Accent), except short abbreviations (bg, nav) shown as their meaning.

## Consequences
Every group records whether it is shipped or name-derived and whether its order is shipped or derived, and the site says so. Shipped evidence is written to `data/native/<product>/<version>/structure.json` at ingest; the result to `data/structure/`.
