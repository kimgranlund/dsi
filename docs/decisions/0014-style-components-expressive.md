# 0014 Style facet, component values and the expressive token set

Status: accepted, 2026-11-01 (owner decisions after the evidence research on Carbon, Material and Polaris scale tokens).

## Context
Research agents checked our scale mappings against each system's docs and shipped source. Mappings were right; the gaps were modeling and ingestion:

- Carbon splits motion and type into two *styles*, productive and expressive ("productive is significantly faster than expressive"); Material splits easing into standard and emphasized. ADR 0013 treated these words as step names, so the split could not be compared.
- Polaris ships component-only tokens (`shadow-button-*`, `space-card-*`); the ontology had no component values.
- Material Web 2.5.0 ships two token sets: `v0_192`, which its components consume, and `versions/latest` (M3 34.0.21), with springs, more corner sizes, an emphasized type scale, tracking, and focus/pressed opacities of 0.1 instead of 0.12.
- Carbon typography, breakpoints and z-index ship only as Sass (`@carbon/type`, `@carbon/grid`, `@carbon/styles`).

## Decision
- New identity facet **style** (`dsi:scheme/style`: productive, expressive), ordered after property. Carbon productive/expressive map exact; Material standard/emphasized map close.
- **Component** and **part** get value schemes holding only what shipped tokens name (button, button-group, card, table; cell). A part needs a component.
- New values: `state/dragged`; `property/corner-shape` (four radii; the classifier files an untyped four-value corner under it); `property/spring-stiffness` and `spring-damping` (motion).
- Material's newer set is ingested as theme **expressive** and mode `dsi:mode/expressive`, which **extends light** (`themeExtends`): its tokens override light where their M3 name matches a consumed token's path, and the rest are new. Variable-font axis tokens are not ingested. Shipped code stays the truth: light and dark are what components use.
- Sass-only packages are read by evaluating their public module variables (`sass-module` entries), never by running package JavaScript. References inside Sass maps are not proven, so those values are literals.

## Consequences
- Carbon gains about 300 typography, breakpoint and z-index tokens; Material gains 242 expressive tokens.
- Direction words (entrance, exit, accelerate, decelerate) remain step words; comparing them would be a further facet.
