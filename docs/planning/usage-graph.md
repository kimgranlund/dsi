# Token-usage graph: first measurement

Working note (2026-11-01). Hypothesis: grounding mappings in how each system's own component CSS uses its tokens unlocks a step change in quality.

## What was built

- `node packages/ingest/src/usage-cli.ts <product>` reads the component CSS packages listed in `sources/<product>/usage.json`. Packages are fetched with `npm pack --ignore-scripts`; the CSS is parsed with postcss and never executed.
- Every `var(--token)` use is recorded with component, selector, CSS property, state (from `:hover`, `.is-selected` and the like) and the background set in the same rule. Component-level custom properties are followed to the token they end at.
- Output: `data/usage/<product>/<version>.json`.
- `dsi-map usage-check color-v1 <product>` derives evidence per token: the property class it colors, its dominant state, whether content sits on a background, and container kind. It compares that with approved mappings; evidence counts only when 70% or more of uses agree.

## Results

| | Spectrum (45 `@spectrum-css/*` packages) | Primer (`@primer/css` 22.3.3) |
|---|---|---|
| Uses / tokens used | 7,107 / 727 | 6,012 / 168 |
| Approved color mappings with usage | 108 of 251 (43%) | 48 of 445 (11%) |
| Property agrees, where decisive | 96.8% of 62 | 100% of 43 |
| State agrees, where decisive | 90.7% of 75 | 97.6% of 41 |
| Container (surface/overlay) agrees | 20% of 5 | 14% of 7 |
| Open queue tokens with usage | 2 of 25 | 3 of 26 |
| "Insufficient" audits with usage | 61 of 117 | 0 of 3 |
| Boundary conflicts with usage | 4 of 9 | 0 of 8 |

## What it means

- **The evidence is accurate.** Where usage is decisive, approved mappings agree with the system's own code 91 to 100% of the time. Most state disagreements are palette ramp steps that components use directly in hover rules.
- **It does not reach the hard tokens.** The tokens still open, and most conflicts, are tokens no shipped component uses directly:
  - Spectrum: numbered intent ramps and unused semantic variants.
  - Primer: `display.*` ramps, data-viz, prettylights, codeMirror and diffBlob. These belong to GitHub's app and Primer React, not `@primer/css`.

  The hypothesis does not hold for the current queue.
- **Where it pays:**
  - Audit evidence: 61 Spectrum "insufficient" verdicts can now be judged against the system's own code.
  - State and property for systems with full component CSS.
  - New systems, which can start from observed usage.
- **The container heuristic is weak.** Badges, tooltips and toasts read as overlays. Needs selector roles, not word lists, before it counts.

## Next options

1. Re-audit the 61 Spectrum insufficient verdicts with usage evidence in the packets.
2. Widen coverage where component CSS exists: Primer React's CSS, Carbon (compiled Sass), Polaris, Material Web. Measure again.
3. Follow aliases: a ramp token used through a semantic token that aliases it gains indirect evidence. Weaker; label it as such.

## Re-audit with usage evidence (2026-11-01, run audit-u1)

Audit packets now carry `observedUses` (component, selector, property class, state) when a usage graph exists, and `audit-merge --partial` replaces only the re-audited verdicts, each with a `rerun` record of the verdict it replaced. The 61 Spectrum mappings whose earlier verdict was insufficient and that have observed uses were re-audited blind by claude-haiku-5-5 (a family that mapped none of Spectrum): 60 supported, 1 insufficient (`notice-background-color-default`, a single badge use), 0 contradicted. Spectrum's audit is now 201 supported, 57 insufficient, 1 contradicted. The support is for property and state; usage does not speak to intent or emphasis.
