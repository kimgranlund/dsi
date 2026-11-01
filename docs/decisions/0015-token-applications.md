# 0015 The component tier is shown through token applications

Status: accepted, 2026-11-01 (owner chose tokens + applications, Card/Button/Text field/Table first, default variant with all states, anatomy + rulers).

## Context
Tier 5 (component) is defined by binding the component facet (ADR 0003), but few component decisions ship as component tokens. Material Web ships 1,766 `md.comp.*` tokens yet none for card padding; Carbon ships 78 component tokens, all color, and its card padding is `$spacing-05` written in Sass; Polaris ships a handful (`space-card-padding`) and sets Card padding through a JavaScript prop default. Card padding, gaps and heights mostly exist as **applications**: places where a component's shipped styles use a token.

## Decision
- An **application** is one CSS declaration in a component's shipped styles that uses a token: selector, CSS property, state, media, the `var()` chain as shipped (component-local properties such as `--_leading-space` or `--pc-button-gap` followed to the token they wrap), the token, the literal fallback, file and line. They are generated into `data/applications/<product>/<version>.json` by `dsi-apply` from `sources/<product>/applications.json`.
- Read without running package code: Material Web's compiled `.css`, Polaris `build/esm/styles.css`, Carbon's component Sass compiled with Sass variables configured to markers (`$spacing-05: var(--dsi-m-spacing-05)`) so token identity survives compilation. Polaris Card prop defaults are read from the shipped JS source text by an authored pattern and marked `prop-default`.
- Which native component answers a `dsi:component` (Carbon Card exact, Tile close) and which selectors are which parts are **authored judgments** in the applications config, with evidence. Component-local definitions are scoped to the default variant (`defScope`), so other variants do not leak in; layout context (Carbon size, density) resolves to its `:root` default.
- A **slot** is part + role (+ axis for padding/margin, + state): `dsi:concept/<domain>/component-<c>/part-<p>/property-<role>[/state-<s>]`. The role comes deterministically from the CSS property and the token type. New values: component `text-field`; parts container, label, supporting-text, input, icon, indicator, header, body, footer, row; properties `padding`, `gap`, `margin` (narrower than spacing).
- A computed value (`calc`, `max` over several tokens) is evaluated to px from the component's own resolved tokens and lists its inputs. A slot a system does not tokenize is unknown; a component a system does not ship (Material Web has no table) is absent, with evidence.

## Consequences
- `/component/<id>` shows an anatomy drawing, then each part's slots with one column per system: value drawn to scale, token link, the chain and the CSS rule as provenance.
- First pass: default variant only. Other variants, densities and sizes, and Material's labs status, are later work.
