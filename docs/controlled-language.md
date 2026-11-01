# Controlled language

The authority for how DSI writes meaning: the controlled natural languages (CNLs) used for concepts, names, definitions, match statements and rationales, and the shared lexicon under them. Facet values and their labels live in `ontology/schemes/`; this file says how those words may be combined and phrased. Decisions behind it: ADR 0019.

## Contents

1. Principles
2. Lexicon
3. L1 Concept IRI
4. L2 Canonical token name
5. L3 Concept name
6. L4 Definition
7. L5 Match statement
8. L6 Rationale
9. L7 Review question
10. Boundary tests (9a)
11. Concept registry
11. Enforcement
12. Classification and prior art

## 1. Principles

- **One word, one meaning.** A facet value has one prefLabel and one definition. Synonyms are altLabels, used for search only and never in names or definitions.
- **One meaning, one form.** Every concept has exactly one IRI, one canonical token name and one display name.
- **Words are closed, combinations are registered.** Models and reviewers choose words from the lexicon; they cannot coin new ones. A combination of words becomes a concept only once it is in the registry (section 10).
- **Native names are never rewritten.** A product's shipped names are evidence. They map onto the lexicon through term mappings (`mappings/<product>/terms.json`) and are never shown as canonical words.
- **Generated, not hand-phrased.** Names, match statements and review questions are produced by templates from structured data, so the same structure always reads the same way.

## 2. Lexicon

The lexicon is the set of facet values in `ontology/schemes/facets.jsonld`, `categories.jsonld` and `syntax.jsonld`. Each entry has:

| Field | Rule |
|---|---|
| IRI | `dsi:<facet>/<value>`; the value is lowercase kebab-case ASCII. |
| prefLabel | Sentence case, one to three words, no system names. |
| name form | The form used inside L3 names when it differs from the label (see L3). Recorded as `dsi:nameForm`. |
| definition | An L4 facet definition. |
| altLabel | Optional synonyms (Material "pressed", Primer "muted"). Search only. |
| scopeNote | Optional system-specific notes and boundary cases. |

A new word, or a changed meaning, updates `ontology/`, `docs/glossary.md` and an ADR in one change. A word is retired with `owl:deprecated`, never deleted.

## 3. L1 Concept IRI

The machine form of a concept. Formal, with no natural-language freedom.

```ebnf
concept  = "dsi:concept/" domain { "/" segment } ;
segment  = facet "-" value { "+" value } ;
facet    = "intent" | "usage" | "hue" | "syntax" | "component" | "part"
         | "property" | "style" | "emphasis" | "brightness" | "state" ;
```

- Facets appear in the order listed, each at most once, with at least one segment.
- Only `usage` and `state` take several values, joined with `+` and sorted alphabetically.
- Every value must be in its facet's scheme and not deprecated.
- `hue` requires usage `categorical`. `part` requires a `component` or usage `code-surface`.
- `emphasis-default` is never bound: the concept without emphasis is the default step. `property-opacity` belongs to the `opacity` domain (ADR 0019).

Example: `dsi:concept/color/intent-danger/property-background/emphasis-subtle/state-hover`.

## 4. L2 Canonical token name

The concept as a DTCG token name in canonical output: the facet values in L1 order, joined with `-`. Syntax values take a `code-` prefix so Lezer tag names (link, strong, emphasis) cannot collide with other facets.

Example: `danger-background-subtle-hover`.

## 5. L3 Concept name

The human name of a concept, used on the site, the review page and in the registry. It is an English noun phrase: modifiers first, then one head noun.

```ebnf
name     = [ state ] [ emphasis ] [ brightness ] [ style ] [ intent ] [ hue ]
           { usage } [ component ] [ part ] [ syntax ] head ;
head     = property | domain-noun ;
```

Rules:

1. **Head noun.** The property's name form (background, text, icon, border, padding). In the color domain, a property that is not itself colored paint takes "color" after it ("Overlay shadow color"), so it stays apart from the elevation concept ("Overlay shadow"). With no property, the domain noun: color, spacing, size, shape, type style, shadow, motion, layout value, opacity.
2. **Name forms.** Each word uses its name form:
   - States are participles: hovered, pressed (`state/active`), focused, disabled, selected, dragged, visited.
   - Compound modifiers are hyphenated: on-fill, code-surface, data-visualization, state-layer.
   - `emphasis/default` never appears, because it is never bound (section 3).
3. **Case.** Sentence case: the first word capitalized and the rest lowercase. No articles, no plurals, no punctuation except hyphens.
4. **Syntax.** A syntax value reads as `code <label>`, as in "Code keyword color".
5. **Uniqueness.** No two registered concepts share a name. A registered concept may override the generated name with its own prefLabel, but the override must still follow these rules.

Examples:

| IRI (after `dsi:concept/`) | Name |
|---|---|
| `color/intent-danger/property-background/emphasis-subtle/state-hover` | Hovered subtle danger background |
| `color/usage-categorical+on-fill/hue-gray/property-icon` | Gray categorical on-fill icon |
| `color/intent-accent` | Accent color |
| `color/usage-page/property-background` | Page background |
| `color/usage-code-surface/syntax-keyword` | Code-surface code keyword color |

## 6. L4 Definition

Definitions follow the genus-differentia form: what kind of thing it is, then what sets it apart.

**Facet value definitions** (hand-written):

- One sentence of at most 25 words, in the present tense.
- Opens with the genus as a noun phrase ("Brand or primary emphasis that ..."), and is not circular: it does not define the word by itself.
- No system names; those go in scopeNote. No examples; those go in `skos:example`.

**Registered concept definitions** are generated from this frame:

```
The <head>[ for <usage> use][ of the <component>[ <part>]][ for <syntax> code][, signaling <intent>][, in <hue>][, <style> style][, <brightness>][, at <emphasis> emphasis][, when <state>].
```

For example: "The background for page use, signaling danger, when hovered." A reviewer may replace it with a hand-written definition, which then follows the facet rules above.

## 7. L5 Match statement

How a mapping reads to a person. The subject is always the native token and the object always the concept (`ontology/schemes/mapping.jsonld`). There are exactly six frames:

| Match | Statement |
|---|---|
| exact | It means exactly "N". |
| close | It means "N", with a small nuance. (The nuance goes in the rationale.) |
| broad | It is one specific kind of "N". |
| narrow | It covers "N" and more. |
| related | It is only associated with "N". |
| unmapped | No shared concept fits it. |

`N` is the L3 name.

## 8. L6 Rationale

The note a model or reviewer attaches to a mapping, term or verdict. Semi-controlled, in the style of ASD-STE100:

1. One or two sentences, at most 40 words, active voice, present tense.
2. Sentence one is the claim: what the token is for, in lexicon words where they exist.
3. Sentence two is the evidence, starting `Evidence:` and naming its kind: name, description, value, docs (with URL), sibling, or convention (with ADR number).
4. A `close` match states its nuance. A departure from an ADR convention names the ADR.
5. No hedging words ("probably", "seems", "maybe"): uncertainty belongs in the confidence number.

Example: "Icon color on subtle gray accent fills, such as file-type icons. Evidence: description; sibling (accent.blue and 8 others approved as categorical icons)."

## 9. L7 Review question

Each review card asks one question, generated from the answers:

```
What does <token> mean?
The models agree it is about "<shared name>". They differ on <differences>. Pick the sentence that is true.
```

Differences are listed in this order, in these words: what it signals (intent), where it is used (usage), which hue, which component, which part, what part it colors (property), how strong it is (emphasis), which state, how closely it matches, and whether any concept fits. The options are L5 statements.

## 9a. Boundary tests (ADR 0021)

Where two facet values meet, a deciding test on shipped facts says which side a token is on. The tests are code (`packages/mapper/src/boundary-rules.ts`); their wording here and in ADR 0021 is the authority for prompts and option descriptions:

- **Emphasis** binds only in a contrast-ordered ladder (B1).
- **Surface** requires a page token the token differs from (B3).
- **On-fill** means on a bold fill, at 4.5:1 (B4).
- **Text** applies when the system ships a separate icon family; otherwise **foreground** (B6).
- **Graphic** is for tokens that paint non-text marks in general (B5, ADR 0022).
- **Code surface** is decided by code namespace or description, then Jev (B7).
- **Neutral** intent only beside status versions of the same role (B8).

## 10. Concept registry

`ontology/schemes/concepts.jsonld` lists every concept that may be used in an approved mapping. Each entry has its L1 IRI, its L3 name (generated, or a valid override) and an L4 definition (generated, or hand-written).

- **Reuse first.** A mapping must use a registered concept when one fits. The review page marks each option as "Shared", with the systems that use it, or as "New".
- **New concepts are gated.** A grammatical but unregistered concept cannot be approved by a rule (merge, tiebreak, settle, rank, scale roles). It waits in review, labeled "New concept", until the owner approves it. Approval registers it.
- **Seeding.** The registry was seeded with the 943 concepts in approved mappings (`packages/schema/src/register.ts --approved`). Owner approvals in `apply-review` register new concepts with generated names and definitions; edit `concepts.jsonld` to refine one.
- **Reconcile.** `dsi-map reconcile --dry` reports concepts only one system uses that sit one facet away from a shared concept. The first run (2026-11-01) found 29 such cases (a report that skipped the first facet showed 13), and the folds would lose meaning: on-fill text becoming plain text, strong tiles losing emphasis, AI and danger borders losing their intent. The owner chose to fold nothing: such concepts are precise positions only one system has, not drift. The run that found real drift was the name check: 19 pairs differing only by `emphasis-default` and 5 duplicated across domains, all resolved by the rules in section 3.

## 11. Enforcement

| Rule | Where | Status |
|---|---|---|
| L1 grammar, lexicon, order, co-occurrence, no `emphasis-default`, opacity domain | `parseConcept`, every proposal and `pnpm check` | enforced |
| L2 names | `canonicalNameOf` | enforced |
| L3 names | `conceptName`; tests in `packages/schema/test/language.test.ts` | enforced |
| L3 uniqueness | ontology loader (duplicate prefLabel within a scheme) | enforced |
| Registry membership of approved mappings | validator; registry gate in merge, tiebreak, settle, rank and map-scales | enforced |
| L4 generated definitions | `conceptDefinition` | enforced |
| L4 facet definitions: present, at most 25 words, no product names | validator (`validateRepo`); 126 written and owner-approved on 2026-11-01 | enforced |
| L5 and L7 frames | review page templates | built; the site does not show match statements yet |
| L6 rationale shape | `dsi-map check` warns; prompts teach it | warns |

## 12. Classification and prior art

Kuhn's PENS scheme rates a CNL from 1 to 5 on precision, expressiveness, naturalness and simplicity:

| CNL | P | E | N | S | Kind |
|---|---|---|---|---|---|
| L1 Concept IRI | 5 | 1 | 1 | 5 | formal notation |
| L2 Token name | 5 | 1 | 2 | 5 | formal notation |
| L3 Concept name | 4 | 1 | 4 | 5 | template noun phrase |
| L4 Definition | 3 | 2 | 5 | 4 | genus-differentia sentence |
| L5 Match statement | 4 | 1 | 5 | 5 | fixed sentence frames |
| L6 Rationale | 2 | 3 | 5 | 3 | simplified technical English |
| L7 Review question | 4 | 1 | 5 | 5 | fixed sentence frames |

Prior art:

- W3C SKOS (labels, definitions, notes, match types).
- ISO 704 and ISO 1087 terminology work (one concept per term; genus-differentia definitions).
- ASD-STE100 Simplified Technical English (sentence length, active voice, no hedging).
- T. Kuhn, "A Survey and Classification of Controlled Natural Languages", Computational Linguistics 40(1), 2014 (PENS).
