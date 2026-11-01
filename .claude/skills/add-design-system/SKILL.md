---
name: add-design-system
description: Add a design system (or a new upstream version of one) to DesignSystemsIndex end to end - research, ingest, verify, vocabulary, mapping, tiebreak, audit, review, ship - with owner decision gates and stage Workflows for the agent fan-out. Use when asked to add, onboard, ingest or re-ingest a design system, component library or token set. NOT for fixing one wrong token (see AGENTS.md route "Wrong or missing ingested token"), editing the ontology alone, or site-only work.
---

# Add a design system

## When to use
- Adding a product (Design System, Component Library, Token Set) to the index.
- Re-ingesting a new pinned version of a product already indexed (runbook §11).
- Not for: one wrong token, ontology-only changes, site features, UI Frameworks (never catalog entries).

## Stages and gates (in order)
| # | Stage | Freedom | Gate (owner decides) | Reference | Workflow |
|---|---|---|---|---|---|
| 1 | Research | High | G1 license, G2 package, G3 themes to modes | runbook §1, gates §G1-G3 | none (one `prompts/research.md` agent) |
| 2 | Ingest | Medium | - | runbook §2, adapters.md | none |
| 3 | Verify ingest | Low | - | runbook §3 | `workflows/verify-ingest.js` |
| 4 | Vocabulary | Low (cmds) / High (agents) | G4 queued words go to review | runbook §4 | `workflows/words.js`, `workflows/tiebreak.js` (kind words) |
| 5 | Mapping | Low / High | G5 ontology change from gaps | runbook §5, gates §G5 | `workflows/map.js` |
| 6 | Tiebreak and settle | Low | - | runbook §6 | `workflows/tiebreak.js` (kind map), then `settle` |
| 6b | Jev pre-screen and suggestions | Low | G9 (decided: ADR 0020, no vote) | runbook §12 | none |
| 7 | Audit | Low / High | G6 rule changes (ADR) | runbook §7, gates §G6 | `workflows/audit.js` |
| 8 | Review | Low | G7 owner's review decisions | runbook §8, gates §G7 | none (artifact) |
| 9 | Ship | Low | G8 push + production deploy | runbook §9, gates §G8 | none |

Freedom: **Low** = run the exact commands, no improvising. **Medium** = goal + constraints + known pitfalls, you choose the means. **High** = goal + evidence standard only; agents judge.

## Hard rules
1. **Never execute package code.** `npm pack --ignore-scripts`; read JSON/CSS/Sass as data; JS only through the syntax-tree interpreter (`packages/ingest/src/static-eval.ts`) or as JSON text. Applies to you and every agent.
2. **Aliases are proven, not guessed.** Write an alias only when the referenced token resolves to an equal value; otherwise a literal plus a manifest note.
3. **Two different model families** for every blind pair (role a `opus`, role b `sonnet`); the third opinion and the auditor are a third family (`fable`) that mapped none of it. The CLIs refuse same-model files; never work around that.
4. **Agents judge each token; scripts never decide.** A script may assemble JSON an agent decided. Agreement plus checks enforce quality, not pattern tables.
5. **Never push or deploy production without fresh owner approval** in this conversation. Approval never carries over from an earlier push or session. Preview deploy is allowed.
6. **Heavy gates through the lock**: `python3 /Users/kimba/.claude/plugins/cache/nonoun/sdlc/1.0.2/scripts/gate_lock.py run --name <what> -- <cmd>` (full check, site build, Playwright probe).
7. **Two strikes**: after two failed root-cause fixes of the same check, stop and tell the owner what failed, what you tried, and the evidence.
8. **`data/` is generated**; native names and values are never edited; approved mappings are never overwritten (AGENTS.md invariants).
9. Owner questions go through AskUserQuestion, recommendation first (gates.md).
10. **Controlled language** (`docs/controlled-language.md`, ADR 0019): concepts come from the registry (`ontology/schemes/concepts.jsonld`); a new combination waits for the owner; never bind `emphasis-default`; rationales follow L6.

## Where things live
- Steps and exact commands: `references/runbook.md` (the one authority for steps).
- Adapter choice, formats seen, pitfalls: `references/adapters.md`.
- Each owner decision, its evidence and default: `references/gates.md`.
- What failed before and the fix: `references/lessons.md`. Read it before stages 2, 5 and 7.
- Agent briefs: `prompts/*.md` (placeholders in `{braces}` are filled by the workflow or by you).
- Stage workflows: `workflows/*.js`, run with the Workflow tool `{scriptPath, args}`; syntax-check edits with `node .claude/skills/add-design-system/workflows/check.mjs`.
- Specimen probe: `scripts/probe-specimens.cjs` (runbook §9).

## Stage checklists

Copy the checklist of the current stage into your task list. Each has an exit criterion and a feedback loop: run the check, fix the cause, re-run.

### 1 Research (High)
- [ ] One agent with `prompts/research.md` (product, candidate package)
- [ ] Gates G1 license, G2 package, G3 themes to modes answered by the owner
- Exit: package + exact version (newest at least two weeks old), license with redistribution, format, themes/modes, no-execution read path, consumers. Loop: unverified items go back to the agent once, then to the owner.

### 2 Ingest (Medium)
- [ ] Catalog entry, `sources/<p>/source.json`, adapter (runbook §2, adapters.md)
- [ ] `node packages/ingest/src/cli.ts <p>` runs; manifest notes read
- [ ] `mappings/<p>/terms.json` scopes + empty `<version>.mappings.json`; `classify run <p>`
- [ ] Rebuild skos, canon; `node packages/schema/src/cli.ts .` clean
- Exit: validator clean; scope counts in `classify run` match the research counts. Loop: validator issue -> fix adapter/source -> re-ingest -> re-validate.

### 3 Verify ingest (Low)
- [ ] `workflows/verify-ingest.js` with `{product, version, consumer, scratch}`
- [ ] Every mismatch pattern explained or fixed in the adapter, re-ingested, re-verified
- Exit: zero unexplained mismatches. Loop: fix -> ingest -> workflow again.

### 4 Vocabulary (Low / High)
- [ ] `workflows/words.js` `{product, version, run, docs}` for the color run, then a run name containing `scale`
- [ ] `workflows/tiebreak.js` `{kind: "words", product, version, run}` for each run
- Exit: both checks OK for a, b, c; merge and tiebreak printed counts; leftovers queued for G4. Loop: the workflow re-prompts once; a second failure goes to you.

### 5 Mapping (Low / High)
- [ ] Product added to `packages/mapper/scopes/color-v1.json`
- [ ] `workflows/map.js` `{product, version, run, docs}` (also runs `rank-emphasis` and `map-scales`; runbook §5)
- [ ] Agent gap reports read; G5 if they point at the ontology
- Exit: merge counts recorded; gaps answered or queued. Loop: agents split on a family -> suspect an ontology gap (lessons L1) before re-mapping.

### 6 Tiebreak and settle (Low)
- [ ] `workflows/tiebreak.js` `{kind: "map", product, version, run, firstRun, docs}`
- [ ] `settle color-v1 <run> <p> <firstRun>` (three agree, emphasis-only splits, two of three at 0.5; runbook §6)
- Exit: tiebreak and settle counts printed; remaining queue size known; new-concept answers held by the registry gate counted.

### 6b Jev pre-screen and suggestions (ADR 0020)
- [ ] `node packages/jev/src/lab.ts prescreen`; audit the flags first (`audit-prepare --only .cache/jev/prescreen.json`)
- [ ] Render the review page with `--jev`
- Exit: flags audited; Jev picks on the cards. Jev never approves.

### 7 Audit (Low / High)
- [ ] `workflows/audit.js` `{product, version, run, docs}`
- [ ] Contradiction patterns traced to a rule or prompt; G6 for rule changes
- Exit: `audit-merge` wrote `<version>.audit.json`; disputes listed. Loop: a pattern -> fix the rule -> re-derive -> re-audit that product.

### 8 Review (Low)
- [ ] Render, publish to the existing review artifact, owner decides (G7)
- [ ] Export decisions newer than the publish, `apply-review`, re-merge, `map-scales`
- Exit: queue empty or owner-deferred; validator clean.

### 9 Ship (Low)
- [ ] Rebuild data, full check via gate_lock, golden-set gate (`corepack pnpm eval`), site build, probe, preview deploy
- [ ] G8 before `git push` and production deploy
- Exit: owner approved and both done, or stopped at preview with the URL reported.
