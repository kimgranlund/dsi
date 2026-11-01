# 0019 Controlled language and a concept registry

Status: accepted in part, 2026-11-01. The owner approved the registry, reuse-first, the reconcile pass and a defined name template. The CNL rules in `docs/controlled-language.md` await ratification.

## Context
Facet words are a closed list enforced by `parseConcept`, but which combinations of them exist is not controlled. Any grammatical stack of facets became a concept: 726 of 965 concepts in approved mappings are used by one system only. Reviewers could not tell a shared concept from a newly coined one. Names were facet labels glued together, with no phrase rules.

## Decision
- `docs/controlled-language.md` is the authority for linguistic rules. It defines seven CNLs: concept IRI (L1), canonical token name (L2), concept name (L3), definition (L4), match statement (L5), rationale (L6) and review question (L7), over one lexicon (the facet schemes).
- **Concept registry** (`ontology/schemes/concepts.jsonld`): a concept may appear in an approved mapping only once it is registered, with an L3 name and an L4 definition. Rules (merge, tiebreak, settle, rank, scale roles) cannot approve an unregistered concept; such answers wait in review as "New concept" until the owner approves them, which registers them.
- **Reuse first.** The review page marks options as Shared (with the systems that use them) or New, and suggestions prefer Shared.
- **Reconcile pass.** Before seeding, a concept used by one system folds into a shared concept as `broad` when dropping exactly one facet reaches it, the system maps nothing else there, and no other token of the system would fold to the same place. Other cases stay or go to review.
- **Name template (L3):** "[state] [emphasis] [brightness] [style] [intent] [hue] [usage] [component] [part] [syntax] head". States are participles, `emphasis/default` is omitted, and the head is the property or a domain noun. Names are sentence case and unique.

## Consequences
- The validator gains registry membership, name uniqueness and definition checks. The mapper gains a registry gate and a `reconcile` command. The site and review page show L3 names.
- Facet values gain an optional `dsi:nameForm`.
