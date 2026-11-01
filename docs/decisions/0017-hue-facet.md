# 0017 Categorical colors bind a canonical hue

Status: accepted, 2026-11-01 (owner decision after the Atlassian color-v1 round).

## Context
Categorical color sets (Atlassian `color.background.accent.<hue>.<step>`, Primer `display.<hue>.*`, Carbon tag colors, Polaris avatar colors) carry their meaning in the hue: a blue tag must stay blue. Without a hue facet every member collapsed to one concept ("Categorical background, strong"); in the Atlassian round both agents agreed on that concept for 448 of 475 tokens but lowered confidence to about 0.5 because the hue was lost, so nothing could be approved.

## Decision
- New identity facet **hue** (`dsi:scheme/hue`): red, orange, yellow, lime, green, teal, cyan, blue, indigo, purple, magenta, pink, brown, gray. Facet order: after usage.
- Hue binds **only together with `usage/categorical`** (checked by `parseConcept`): status and brand colors stay intents whatever their hue.
- Native hue names map `exact` when they agree and `close` to the nearest canonical hue otherwise (coral -> red, plum -> purple, pine -> green, olive -> lime, lemon -> yellow, auburn -> brown, cool-gray -> gray). Numbered chart slots without a hue name get no hue.

## Consequences
Categorical concepts are compositional, e.g. `dsi:concept/color/usage-categorical/hue-blue/property-background/emphasis-strong`, so the same hue slot compares across systems. This also opens the PLAN item "canonical hue names", scoped to categorical use; palette (Source tier) hues remain separate.
