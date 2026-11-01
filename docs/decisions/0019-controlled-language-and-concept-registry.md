# 0019 Controlled language and a concept registry

Status: accepted, 2026-11-01 (owner decisions).

## Context
Facet words are a closed list enforced by `parseConcept`, but which combinations of them exist is not controlled. Any grammatical stack of facets became a concept: 726 of 965 concepts in approved mappings are used by one system only. Reviewers could not tell a shared concept from a newly coined one. Names were facet labels glued together, with no phrase rules.

## Decision
- `docs/controlled-language.md` is the authority for linguistic rules. It defines seven CNLs: concept IRI (L1), canonical token name (L2), concept name (L3), definition (L4), match statement (L5), rationale (L6) and review question (L7), over one lexicon (the facet schemes).
- **Concept registry** (`ontology/schemes/concepts.jsonld`): a concept may appear in an approved mapping only once it is registered, with an L3 name and an L4 definition. Rules (merge, tiebreak, settle, rank, scale roles) cannot approve an unregistered concept; such answers wait in review as "New concept" until the owner approves them, which registers them.
- **Reuse first.** The review page marks options as Shared (with the systems that use them) or New, and suggestions prefer Shared.
- **Reconcile pass.** `dsi-map reconcile` finds concepts one system uses that sit one facet away from a shared one. On its first run most folds would have lost meaning, so the owner chose to fold nothing and to register every approved concept as it is.
- **No `emphasis-default`.** The concept without emphasis is the default step (26 mappings moved). Opacity concepts live in the opacity domain. In the color domain, shadow is named "shadow color".
- **Name template (L3):** "[state] [emphasis] [brightness] [style] [intent] [hue] [usage] [component] [part] [syntax] head". States are participles (active reads "pressed"), and the head is the property or a domain noun. Names are sentence case and unique.

## Consequences
- The validator gains registry membership, name uniqueness and definition checks. The mapper gains a registry gate and a `reconcile` command. The site and review page show L3 names.
- Facet values gain an optional `dsi:nameForm`.
- Rationales follow L6. `dsi-map check` warns about rationales that break it but does not refuse them.
- Primer's 8 `shadow.*` tokens, settled into color-domain shadow this morning, moved to elevation: they are composite shadows.

## Amendment, 2026-11-01: emphasis/default retired

The lexicon still held `emphasis/default`, defined as "not implied by an unbound facet", the opposite of this ADR's rule, and Atlassian's term `default` was approved to it. The owner retired the value: `emphasis/default` is `deprecated`, and `default` is a noise word for Primer and Atlassian (their term mappings to it are rejected). The validator refuses any proposed or approved term mapping to a deprecated value; rejected records keep their history.

## Amendment, 2026-11-01: L4 generated definitions

The first frame ("The <head> for <usage> use, signaling <intent>...") followed the rules by the letter, but it defined the thing instead of its color ("The text, signaling danger") and was circular for one-facet concepts ("Duration: The duration."). The owner approved a new frame (docs/controlled-language.md section 6): a domain-aware genus ("The color of text..."), one-facet concepts take their value's own definition, and usage and color properties read as a phrase stored on the word (`dsi:phrase`). All registered definitions were regenerated; the longest is 20 words.

