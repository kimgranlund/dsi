# Lessons from earlier rounds

## What this file contains
- L1-L6 mapping and vocabulary
- L7-L9 rules, records and tooling
- L10-L12 ingest and verification
- L13 site and probe

Each lesson: what failed, why, the fix now in place. Rounds: Material, Carbon, Polaris (color-v1 r1-r3, scale rounds), then Atlassian, Primer, Spectrum, Fluent 2 (atl1-2, w2, w3).

## Mapping and vocabulary

- **L1 Disagreement signals an ontology gap.** Atlassian categorical colors: both agents agreed on the concept for 448 of 475 tokens but at about 0.5 confidence because the hue was lost, so nothing approved. Fix: model the gap (hue facet, ADR 0017), then re-run. Same for seven-step emphasis, discovery, data-viz and code surfaces (ADR 0018). Do not lower confidence bars to push a family through.
- **L2 Judge each token; do not encode pattern tables.** Name patterns mislead where values contradict the names (Atlassian status backgrounds: `default` is the lightest, ADR 0018). Fix: short briefs that point at the ADRs as conventions, values per theme in the packet, agreement plus checks as the filter, contrast rank computed (`rank-emphasis`) rather than briefed.
- **L3 A script may assemble, never decide.** A rule script that decides answers turns two blind judgments into one, so agreement no longer means anything. Every brief says so.
- **L4 Scale roles must not carry color facets.** The audit found scale-role mappings carrying color emphasis or intent. Fixed in the rules (not per token) and the mappings re-derived with `map-scales`.
- **L5 The third opinion must be blind.** The tiebreak agent must not read the first two answers or `mappings/`; the CLI refuses a third file from the same model as a or b.
- **L6 Word tiebreak packets hold only split words.** The third model answers only what the first two split on (commit d870c13); a full packet would re-open settled words. `vocab-third` writes only the split words; `vocab-check ... c` checks only those.

## Rules, records and tooling

- **L7 Validate a new ADR rule against the validator before shipping it.** ADR 0018 said code parts bind with code-surface, but the validator still required a component for any part; the Primer agents found it blocked them. Fix: rule and validator changed together, ADR text corrected.
- **L8 Re-derived mappings need `superseded` + `supersededBy`.** When map-scales v2 replaced v1 records (ADR 0013 correction), the old records had to stay as history and point at their replacement; `map-scales` now sets both. Any new re-derivation must do the same.
- **L9 Merges, audits and tiebreaks must skip products without files.** Merging a wave run with one product's proposals still missing once required moving a file aside. Now `merge` and `audit-merge` skip products without files and say so; `tiebreak` takes one product. Keep runs per product or per wave.

## Ingest and verification

- **L10 Verify by a second derivation.** The adapter's own tests passed while values were wrong: Atlassian shadows lost their alpha, Primer transitions differed from the built CSS. Only comparing against the package's consumer output (built CSS, `variables.json`, alias files read as text) found them.
- **L11 Adapter pitfalls** (details in `adapters.md`): `[default]` segments, palette layering proven per theme, `em` and `linear()` untyped, JSON text must not start with `{`.
- **L12 Legacy vs source-of-truth packages.** Spectrum ships several token packages; the research gate (G2) picked `@adobe/spectrum-tokens` as the source of truth over the legacy packages; ask, do not assume, when a product ships several.

## Site and probe

- **L13 Probe computed colors, not screenshots.** Unreadable specimen buttons came from the resolver policy (broader concepts and state variants answering), not from data (ADR 0006 amendment). The Playwright probe reads computed colors and contrast per part, system and mode, and names the token chain. Headless Chrome's minimum window is 500px: narrower "screenshots" are crops, not a mobile layout.
