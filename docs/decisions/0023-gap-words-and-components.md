# 0023 Words for fixed, transparent, terminal and done colors; eight components and six parts

Status: accepted, 2026-11-01 (owner decision G5 on the modeling-gap inventory).

## Context
233 approved mappings said "no concept fits". About 100 were stale: the concepts they lacked (discovery, data-viz, code-surface, highlight) were added later (ADR 0018). The rest named real gaps: colors that keep one value in every theme (Spectrum static-black and static-white, Material fixed roles, Primer black and white), deliberately transparent slots (Fluent, Primer, Polaris), the ANSI terminal palette (Primer), a completed or merged status distinct from success (Primer done), and component tokens with no component or part (Spectrum track, Carbon chat and toggle, Fluent and Polaris scrollbar, Polaris checkbox, radio and tooltip).

## Decision
- New usage values: `usage/fixed`, `usage/transparent`, `usage/terminal`. New intent `intent/done`, related to success. Definitions are in `ontology/schemes/facets.jsonld`.
- Grammar (L1): hue binds with usage categorical or terminal.
- New components: slider, progress-bar, toggle, scrollbar, chat, checkbox, radio, tooltip. New parts: track, thumb, bubble, prompt, avatar, tail.
- Primer sponsors stays unmapped: a product feature color, not a shared role.
- The stale unmapped tokens and the tokens these words cover are re-opened (`dsi-map reopen`) and re-mapped blind by two model families. Their answers go through merge, settle and the boundary rules. New concepts wait for the owner (ADR 0019).

## Consequences
- The registry grows only through owner approval of the re-mapped answers.
- Component tokens of these components become tier-5 concepts, as Card and Button tokens are.
