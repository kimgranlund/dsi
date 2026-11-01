# 0010 Fixed tokens follow their container role; "secondary" direction is checked per property

Status: accepted, 2026-11-01 (owner took all 23 audit suggestions and rejected the terms `brand` -> on-fill, `primary` -> default emphasis and `on-bg-fill` -> text). Supersedes the "fixed" row of 0008 and qualifies its "secondary" row.

## Context
The evidence audit (`mappings/*/2.5.0.audit.json`, auditor claude-fable-5-1) contradicted 23 of 350 approved color mappings. Two causes were conventions, not individual judgments:

- The mapping prompt said a fixed token maps "like its non-fixed counterpart" and named `secondary` as the counterpart of `secondary-fixed`. The values show otherwise: `primary-fixed` is `primary90` (`#eaddff`) in every theme, exactly `primary-container` in light; `on-primary-fixed` equals `on-primary-container` in light. M3 describes fixed roles as fill colors used against surfaces.
- 0008 records Polaris "secondary" as subtle emphasis. That holds for fills and surfaces, but Polaris secondary borders are darker than the base border (`color-border-critical-secondary` = red.14 vs `color-border-critical` = red.8; `color-border-magic-secondary` = purple.11 vs purple.6).

## Decision
- A fixed token's counterpart is the **container** role at its light-theme value: `*-fixed` -> the accent background with subtle emphasis; `on-*-fixed` -> on-fill foreground with subtle emphasis; match as for the container (exact for primary, broad for secondary and tertiary accents).
- "secondary" and "tertiary" give the emphasis **direction shown by the values** relative to the family's base token: lighter fills/surfaces -> subtle; darker borders -> strong. Mappers compare values before applying a name convention.

## Consequences
The mapping prompt names the container counterpart and tells agents to check values. Future audits keep checking direction mechanically.
