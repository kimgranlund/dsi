# 0008 Mapping conventions from color-v1 review

Status: accepted, 2026-11-01; the fixed-token row is superseded and the secondary row qualified by [0010](0010-fixed-tokens-and-secondary-direction.md)

## Context
Three agent rounds and one human review of 508 color tokens settled how recurring naming patterns map. Agents read these before mapping (`packages/mapper/prompts/color-v1.md`, `packages/classify/prompts/terms-v1.md`).

## Decision

| Pattern | Maps to | Match | Examples |
|---|---|---|---|
| Content on a filled or container background | `usage-on-fill` + property; `emphasis-subtle` for light containers | exact | Material `on-error`, `on-error-container`; Carbon `text-on-color` |
| One token for text and icons | `property-foreground` | | Material `on-surface` |
| Ordered levels of one family | subtle / default / strong (subtlest / strongest at the ends of 4+ steps) | close | Carbon `layer-01..03`; Material `surface-container-*` |
| "secondary" variant | `emphasis-subtle` | exact (Polaris), close (Carbon) | Polaris `color-bg-fill-critical-secondary`; Carbon `link-secondary` |
| "tertiary" variant | `emphasis-subtle` | broad | Polaris `color-bg-fill-tertiary` |
| Secondary and tertiary accent roles | `intent-accent` | broad | Material `secondary`, `tertiary` |
| Theme-invariant "fixed" tokens | same concept and match as the counterpart | | Material `primary-fixed` |
| Neutral fills with no intent | `property-background` | broad | Polaris `color-bg-fill` |
| "brand" | `intent-accent` | close | Polaris `color-bg-fill-brand` |
| "interactive" | `intent-accent` | close | Carbon `interactive`, `border-interactive` |
| Links on inverse surfaces | `usage-inverse+link` | exact | Carbon `link-inverse-*` |
| Helper and placeholder text | `property-text/emphasis-subtle` (placeholder adds `usage-field`) | close | Carbon `text-helper`, `text-placeholder` |
| Severity between warning and danger | `intent-caution` | broad | Carbon `support-caution-major` |
| Gradient stops and decorative AI layers | `intent-ai/property-background` | broad | Carbon `ai-aura-*` |
| Syntax highlighting, avatars, data-viz palettes | unmapped | | Carbon `syntax-*`, Polaris avatar colors |

## Consequences
New systems are mapped against these conventions first; a conflicting pattern needs a new ADR, not a silent exception.
