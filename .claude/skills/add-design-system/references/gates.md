# Owner gates

## What this file contains
- How to ask (format, batching, what never needs asking)
- G1 License, G2 Package and version, G3 Themes to modes
- G4 Queued words, G5 Ontology change, G6 Rule or policy change
- G7 Review decisions, G8 Push and production deploy

Freedom: Low. The owner decides; you gather the evidence and recommend.

## How to ask

- AskUserQuestion, one round per stage boundary, batching every open gate of that stage. Each question: the decision in one line, then options with **your recommendation first** and labelled "(recommended)", each option with its consequence in one line and the evidence (file path, URL, count).
- Never ask what a check or a rule already decides (approval bars, model families, no-execution). Never ask permission to stop on a failed check: stop and report (two strikes rule).
- Record each answer where it lives: source config, ADR, mapping review, or the commit message. A decision that changes a rule becomes an ADR (new, or an amendment of the one it changes) in the same change as the code.

## G1 License (stage 1)

Evidence: `package/LICENSE` text and `package.json` `license` from the packed tarball; the product's site license page; any field-of-use restriction (Polaris: Shopify-integrated apps only; Atlassian ADS license vs the npm Apache-2.0).
Default: permissive OSI license -> `redistribution: permitted`, no question needed beyond confirming. Restricted or conflicting -> recommend publishing only if the npm package's own license permits redistribution of the values (ADR 0016 reasoning); otherwise recommend ingesting without publishing.
Outcome: `license` in `source.json`; restricted + publish -> `publishOverride` (who, when, why) and an ADR like 0009 / 0016.

## G2 Package and version (stage 1)

Evidence: candidate packages, which one the product's own components consume, publish dates, whether one is legacy (Spectrum: `@adobe/spectrum-tokens` is the source of truth vs older CSS packages).
Default: the package the shipped components consume, newest version at least two weeks old, exact pin.
Ask when: two plausible packages, a major version newer than the components use, or only prereleases exist (Fluent `1.0.0-alpha.*`).

## G3 Themes to modes (stage 1, before ingest)

Evidence: shipped theme list, color-scheme metadata, which themes are overrides of which, extra axes (Primer 14 themes; Spectrum desktop/mobile scale; Material expressive set; Polaris experimental themes; density or pointer variants).
Default: ingest every shipped theme as native; map light, dark and increased-contrast to the themes the product labels so; a parallel newer set becomes a mode that `themeExtends` its base (ADR 0014); platform scales become a theme extending light.
Ask as: one question per ambiguous canonical mode, plus one for extra axes (ingest as theme / ingest default only / skip).

## G4 Queued words (stage 4)

Evidence: words still proposed after the tiebreak, with both agents' answers and example tokens (the review page Naming terms tab).
Default: put them on the review page (G7); do not decide them yourself.

## G5 Ontology change (stage 5)

Trigger: both mapping agents report the same gap, agents split on a whole family, or most of a family is agreed unmapped.
Evidence: a research agent (`prompts/gaps.md`) on how all indexed systems name and use the concept, with citations and shipped token names.
Default: recommend the smallest change that makes the family mappable without inventing cross-system steps (precedents: hue facet 0017; seven-step emphasis, discovery, data-viz, code-surface, inverse rule 0018; numbered-ramp rule 0018 amendment). Options: new facet value(s) / mapping rule only / leave unmapped.
Outcome: ADR + `ontology/` + `docs/glossary.md` in one change (one authority per fact), validated, then re-map the affected family in a new run.

## G6 Rule or policy change (stages 7, 9)

Trigger: an audit contradiction pattern or a probe finding traced to a rule (merge, classifier, resolver), not to individual judgments.
Evidence: the pattern with 2-3 examples (token, values, current concept, suggested), and the rule's code location.
Default: fix the rule and re-derive; recommend amending the ADR that owns it (precedent: ADR 0006 amendment after the specimen probe).

## G7 Review decisions (stage 8)

Ask once: "The review page has N tokens, W words and D disputes queued: <artifact URL>. Tell me when done." Do not pre-fill decisions. Apply only decisions with `at` after this round's publish.

## G8 Push and production deploy (stage 9)

Evidence: commits since origin (`git log --oneline origin/main..`), preview URL, full check result, probe result.
Ask: two separate options or one question with "push and deploy / push only / neither yet". Approval applies to this push and this deploy only; a later change needs a new yes.
