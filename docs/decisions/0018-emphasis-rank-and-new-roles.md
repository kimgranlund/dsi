# 0018 Seven emphasis steps by contrast rank; discovery, data-viz and code surfaces; inverse by value

Status: accepted, 2026-11-01 (owner decision after the ontology-gap research across seven systems).

## Context
Adding Atlassian, Primer, Spectrum and Fluent exposed gaps. Evidence (shipped values and descriptions):
- Atlassian uses up to seven emphasis words, and in status backgrounds the words contradict the values: `color.background.danger.default` = Red100 is the lightest, then subtler Red200, subtle Red300, bold Red700 (dark mirrors this). Fluent's numbered neutrals are not a lightness ladder; Primer and Spectrum use two steps.
- Atlassian `discovery` ("change or something new") has no intent; it is neither AI nor info.
- Atlassian `code.*`, Primer `codeMirror.*`/`diffBlob.*` are code and diff surfaces; `usage/code` was deprecated in favor of syntax roles.
- Atlassian `chart.*` and Primer `data.*` are chart palettes; ADR 0008 left them unmapped.
- Atlassian calls content on bold fills "inverse"; Primer, Fluent and Carbon use inverse for surfaces that flip between modes.

## Decision
- **Emphasis** gains `subtler` and `stronger` (seven steps). Steps are assigned by **contrast rank** against the page within a family, per mode; the native word maps exact only when its rank agrees, else close. Supersedes ADR 0008's ordered-level row.
- **Intents**: `discovery`, related to info and ai.
- **Usages**: `data-viz` (with categorical and hue for series palettes; numbered slots bind no hue; chart status colors bind their intent) and `code-surface` (a new value, so records that used the deprecated `usage/code` keep their meaning). Parts `gutter`, `line-number`, `line`. Diffs combine code-surface with syntax inserted, deleted or changed. Sequential and diverging ramps wait until a system ships them as tokens.
- **Inverse** only for surfaces that flip relative to the page between modes, or content on them; content contrasting with a bold fill is on-fill whatever its native word. Recorded as scope notes on both usages.

## Consequences
Mapping prompts carry the contrast-rank and inverse rules. Atlassian's queued tokens are re-mapped; Primer, Spectrum and Fluent are mapped under these rules.
