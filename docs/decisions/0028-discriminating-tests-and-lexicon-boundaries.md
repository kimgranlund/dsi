# 0028 Discriminating tests on words, and four lexicon boundaries

Status: accepted, 2026-11-01 (owner decisions on the open lexicon items).

## Context
The normalization spec (docs/planning/spec-alignment.md, L2) asks each concept with siblings to say how to tell it from them. DSI's boundary tests B1 to B8 (ADR 0021, 0022) lived only as code and ADR prose. Four lexicon overlaps were open: icon vs icon size, size vs height and width, border vs focus ring, danger vs warning. Twelve syntax definitions said nothing beyond their label.

## Decision
- New property `dsi:discriminatingTest` (`discriminatingTest` in JSON-LD): one sentence per facet word, a test on shipped facts that names the sibling it separates from. The boundary tests are its code form; the sentences go to mappers, reviewers and Jev, and show on ontology pages as "How to tell it apart".
- Placed on 19 words: the emphasis scheme (B1), surface (B3), on-fill (B4), graphic (B5), text and foreground (B6), code surface (B7), neutral (B8), and the four boundaries below.
- Icon is the color of icons only; their dimensions are icon size.
- Size binds when one value sets both width and height; one dimension is height or width.
- Border and focus ring stay siblings: a focus ring is drawn only while the element has keyboard focus and is not part of layout. The CSS property does not decide (outline serves both).
- Danger means something is wrong or has failed; warning, that something may go wrong but nothing has failed. Severe sits between, caution below warning.
- Bare syntax definitions name their glyph or an example (square bracket, parenthesis, brace, variable, type, class and macro names, number, URL, heading, list, punctuation).

## Consequences
- Definition changes are wording only; no mapping changes. Approved danger mappings that mean "at risk" are review candidates if the evidence (ADR 0027) or an audit flags them.
- A validator check that every word with siblings has a test is deferred: today 19 of about 200 words have one.
