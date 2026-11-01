# Runbook: add a design system

## What this file contains
- §0 Conventions (paths, run names, how to run a workflow)
- §1 Research
- §2 Ingest
- §3 Verify ingest
- §4 Vocabulary (color words, scale words, word tiebreak)
- §5 Mapping (color-v1, rank-emphasis, map-scales)
- §6 Tiebreak (two of three)
- §7 Audit
- §8 Review
- §9 Ship
- §10 Rebuild sequence (used by several stages)
- §11 Re-ingest a new upstream version

This file is the one authority for steps. Rationale lives in the ADRs named inline; history in `lessons.md`.

## §0 Conventions

- All commands run from the repo root `/Users/kimba/Projects/design-system-index`. `<p>` = product id (`primer`), `<v>` = pinned version.
- Run names are unique per round and never reused: color words `terms-<p>1`, scale words `terms-scale-<p>1` (the word `scale` in the run name switches `vocab-prepare` to foundation tokens and `prompts/terms-scale-v1.md`), color mapping `color-v1-<p>1`, its tiebreak `color-v1-<p>1c`, audit `audit-<p>1`. Bump the digit for a new round.
- Packets and proposals live in `.cache/classify/<run>/` and `.cache/mapper/<run>/`; audit packets in `.cache/audit/<run>/`. `.cache/` is gitignored.
- Workflows: Workflow tool with `scriptPath: "/Users/kimba/Projects/design-system-index/.claude/skills/add-design-system/workflows/<name>.js"` and `args` as a JSON object. They never push, deploy or approve owner gates. Each returns counts; record them in your report.
- Gate the heavy commands: `G=/Users/kimba/.claude/plugins/cache/nonoun/sdlc/1.0.2/scripts/gate_lock.py; python3 $G run --name <what> -- <cmd>`.
- Validator (fast): `node packages/schema/src/cli.ts .`. Full check: `python3 $G run --name check -- env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm check`.

## §1 Research

Freedom: High. Goal: enough verified evidence to write the source config and answer G1-G3.

1. Spawn one agent (Agent tool, any strong model) with `prompts/research.md`, filled with the product and candidate package(s). It is read-only in the repo and writes scratch only under the session scratchpad.
2. Read its report. Anything marked unverified that a gate depends on: send it back once (SendMessage), then put it to the owner as unverified.
3. Ask gates G1 (license), G2 (package and version), G3 (themes to modes, extra axes) in one AskUserQuestion round (gates.md).
4. Restricted or unclear license the owner accepts -> write an ADR like 0009/0016 in the same change as the source.

Exit: package, exact version, license + redistribution, format, themes and their mode mapping, read path without execution, component consumers (for later applications) all known.

## §2 Ingest

Freedom: Medium. Goal: `data/native/<p>/<v>/` holds every shipped token under its native name, values that match the package's own built output, aliases only where proven. Constraints: hard rules 1, 2, 8. Pitfalls: `adapters.md`.

1. Catalog entry `catalog/<category>/<p>.json` (`catalog/README.md`): Design Systems carry `implementations`; frameworks only as `targets`.
2. `sources/<p>/source.json` (`sources/README.md`, schema `packages/schema/schemas/source.schema.json`): `product`, `implementation`, `package` (exact version), `dependencies` (each pinned), `entries` (path + format), `themes`, `modes` (canonical mode -> native theme), `themeExtends` (theme -> parent), `modesNote`, `adapter`, `license` (`spdx`, `url`, `redistribution`, `notes`; `publishOverride` only with an ADR).
3. Adapter: reuse one if the format matches (`adapters.md` table); otherwise `packages/ingest/src/adapters/<name>.ts`, register in `packages/ingest/src/cli.ts`, synthetic fixture test, README adapter row.
4. `node packages/ingest/src/cli.ts <p>`. Read `manifest.json` notes and counts; every literal-instead-of-alias note needs a reason.
5. `mappings/<p>/terms.json`: `product`, `noise: []`, `scopes` (first match wins; `pathPrefix` or `file` -> palette, foundation, semantic, component), `terms: []`. Copy the shape of `mappings/primer/terms.json`.
6. Empty `mappings/<p>/<v>.mappings.json`: `{ "product", "implementation", "sourceVersion": "<v>", "mappings": [], "unmapped": [] }`.
7. `node packages/classify/src/cli.ts run <p>` and read the scope counts; adjust scopes until palette / foundation / semantic / component match the research.
8. Rebuild per §10 and validate. Then `corepack pnpm --filter @dsi/ingest check` via gate_lock if the adapter changed.

Exit: validator clean; scope counts plausible against research; manifest notes all explained.

## §3 Verify ingest

Freedom: Low. Run `workflows/verify-ingest.js` with `{product: "<p>", version: "<v>", consumer: "<the package's built CSS/JSON/alias files, from research, with themes to compare>", scratch: "<session scratchpad>"}`. A sonnet agent runs `prompts/verify-ingest.md` (a second derivation from the package's own consumer output, compared token by token); when it reports mismatch patterns, an opus agent reproduces each one and names a likely cause. `ok` is true only with zero mismatches.

- A mismatch pattern is a real defect until shown otherwise. Fix the adapter (never `data/`), re-ingest (§2.4), re-run the workflow. Found before: Atlassian shadow alpha, Primer transitions (lessons L10).
- An explained difference (normalization, a theme the consumer output does not ship) goes into the source `modesNote` or a manifest note.

Exit: zero unexplained mismatches; counts reported.

## §4 Vocabulary

Freedom: Low for commands, High for the agents' word judgments.

1. Color words: Workflow `words.js` with `{product, version, run: "terms-<p>1", docs}`. It runs `vocab-prepare`, two blind agents (`prompts/words.md`, opus a, sonnet b), `vocab-check <p> <run> a|b` after each (one re-prompt on failure), then `vocab-merge`.
2. Word tiebreak: Workflow `tiebreak.js` with `{kind: "words", product, version, run: "terms-<p>1", docs}`: `vocab-third` writes a role-c packet of the split words, a fable agent answers (`prompts/words-third.md`), `vocab-check <p> <run> c`, `vocab-tiebreak`.
3. Scale words: repeat 1-2 with `run: "terms-scale-<p>1"`.
4. `node packages/classify/src/cli.ts run <p>`; read unexplained words. Words still proposed go to review (§8, G4) with `--words-only` when no tokens are queued.

Manual equivalents (when a workflow is unavailable):
```
node packages/classify/src/cli.ts vocab-prepare <p> <run>
node packages/classify/src/cli.ts vocab-check <p> <run> a   # and b
node packages/classify/src/cli.ts vocab-merge <p> <run>
node packages/classify/src/cli.ts vocab-third <p> <run>
node packages/classify/src/cli.ts vocab-check <p> <run> c
node packages/classify/src/cli.ts vocab-tiebreak <p> <run>
```

Exit: checks OK for a, b, c; merge and tiebreak counts recorded.

## §5 Mapping

Freedom: Low for commands, High for the agents.

1. Add the product to `packages/mapper/scopes/color-v1.json` (`version`, and `pathPrefix` or `provenanceFile`, optional `exclude`): semantic and system color tokens; categorical, data-viz and code-surface sets are in scope since ADRs 0017/0018; palettes and component tokens are not.
2. Workflow `map.js` with `{product, version, run: "color-v1-<p>1", docs: "<official color docs URL>"}`: `prepare color-v1 <run>`, two blind agents (`prompts/map.md`), `check color-v1 <run> <p> a|b` after each with one re-prompt, then `merge color-v1 <run>` (agreement at 0.7, classifier vote at 0.6; ADR 0005 amended; skips products without proposals), then the two computed steps below. It returns merge counts, the first line of each computed step, and both agents' reports.
3. Emphasis by contrast rank (ADR 0018 amended), run by the workflow: `rank-emphasis color-v1 <run> <p>` settles tokens where both agents agree on everything but emphasis; numbered ladders spread over the seven steps.
4. Non-color scale roles (ADR 0013), run by the workflow: `node packages/classify/src/cli.ts map-scales <p>`. Run it yourself to read the leftovers: each prints with a reason; a leftover family usually means a missing scale word (back to §4.3) or a type the role does not accept.
5. Read the agents' gap reports (the workflow returns them). Same gap from both agents, or the agents split on a whole family -> G5 (ontology change), then re-map that family in a new run (lessons L1).

Manual equivalents:
```
node packages/mapper/src/cli.ts prepare color-v1 <run>
node packages/mapper/src/cli.ts check color-v1 <run> <p> a   # and b
node packages/mapper/src/cli.ts merge color-v1 <run>
node packages/mapper/src/cli.ts rank-emphasis color-v1 <run> <p>
node packages/classify/src/cli.ts map-scales <p>
node packages/mapper/src/cli.ts queue color-v1
```

Exit: merge, rank and map-scales counts recorded; gaps answered or recorded as queued.

## §6 Tiebreak (two of three)

Freedom: Low. Workflow `tiebreak.js` with `{kind: "map", product, version, run: "color-v1-<p>1c", firstRun: "color-v1-<p>1", docs}`. It:
1. runs `prepare color-v1 <run>` (packets of the still-unapproved tokens for every scoped product),
2. copies `<p>.a.packet.json` to `<p>.c.packet.json` with `role: "c"` and the output path renamed,
3. runs a fable agent blind with web research (`prompts/map-third.md`), `check color-v1 <run> <p> c` with one re-prompt,
4. runs `tiebreak color-v1 <run> <p> <firstRun>`: an answer equal to one of the first two (each >= 0.7) is approved `two-of-three`; the others rejected with a note.

Manual copy step:
```
python3 -c "import json;R='.cache/mapper/<run>/';d=json.load(open(R+'<p>.a.packet.json'));d['role']='c';d['output']=d['output'].replace('.a.proposals','.c.proposals');json.dump(d,open(R+'<p>.c.packet.json','w'),indent=1)"
```

Exit: tiebreak counts recorded (`contested`, `approved`, `unmapped`, `queued`); `node packages/mapper/src/cli.ts queue color-v1` size known.

## §7 Audit

Freedom: Low for commands, High for the auditor.

1. Workflow `audit.js` with `{product, version, run: "audit-<p>1", docs}`: `audit-prepare color-v1 <run>` (deterministic checks + packets), a fable auditor (`prompts/audit.md`; a model that mapped none), `audit-check color-v1 <run> <p>` with one re-prompt, `audit-merge color-v1 <run>` (skips products without verdicts). Returns supported / contradicted / insufficient and the dispute lines.
2. Group contradictions by pattern. A pattern is a rule or prompt defect, not 20 individual fixes: fix the rule (classifier, merge, prompt, ADR via G6), re-derive (`map-scales`, re-merge), re-audit. Found before: scale roles carrying color emphasis/intent (lessons L4).
3. Remaining contradictions are disputes; they reopen on the review page.

Exit: `mappings/<p>/<v>.audit.json` written; every contradiction pattern either fixed at the root or listed as a dispute.

## §8 Review

Freedom: Low.

1. Render: `node packages/mapper/src/cli.ts review color-v1 <latest map run> <scratchpad>/review/mapping-review.html <color vocab run>,<scale vocab run> [--words-only]`. Vocab runs are comma-separated; `--words-only` when only words and disputes are queued.
2. Publish to the existing review artifact (keeps its `db` and `user` capabilities and its stored decisions): Artifact `{action: "publish", file_path: <the html>, url: "https://claude.ai/artifact/YXqvMeQkVNW2BGrP3H8YrK", label: "<product> round N"}`. Note the publish time.
3. Ask the owner to review (G7) and wait for "done".
4. Export with ArtifactData `{action: "list", url, collection, query: {limit: 500}, out_dir: <scratchpad>/review-<p>N}` for each of `decisions`, `term-decisions`, `dispute-decisions`. Keep only documents whose `at` is after the publish time (older decisions were applied in earlier rounds); write them as one JSON array.
5. `node packages/mapper/src/cli.ts apply-review color-v1 <decisions.json> kimgranlund` (the reviewer id used in every earlier round).
6. Re-merge the map run (`merge color-v1 <run>`, which re-applies the rule to queued tokens), `node packages/classify/src/cli.ts map-scales <p>`, rebuild (§10), validate.

Exit: applied counts printed; queue empty or the owner deferred the rest; validator clean.

## §9 Ship

Freedom: Low.

1. Rebuild (§10) and run the full check via gate_lock. Fix failures at the root (two strikes rule).
2. Site: `python3 $G run --name site-build -- sh -c 'cd site && corepack pnpm run data && corepack pnpm run build'`.
3. Probe the homepage specimens: `(cd site && npx vite preview --port 4173 --strictPort >/dev/null 2>&1 &)`, wait until `curl -s localhost:4173` answers, then `python3 $G run --name probe -- env PW=/Users/kimba/.npm/_npx/e41f203b7505f1fb/node_modules/playwright D=<scratchpad>/pw node .claude/skills/add-design-system/scripts/probe-specimens.cjs`. It prints every system and mode with a label/fill pair under 3:1 or a missing part, and writes `probe.json` + `home.png`. A low pair is traced to its token chain (`probe.json` `src`) and fixed at the root (data, resolver policy via G6, or site), never by restyling. Stop the preview server afterwards.
4. Commit locally (one-line message, attribution line). Preview deploy: `cd site && npx wrangler deploy -c wrangler.preview.jsonc`; report the URL.
5. G8: ask the owner before `git push` and before `cd site && npx wrangler deploy -c wrangler.jsonc`. Each needs its own fresh yes.

Exit: preview URL reported; push and production done only on approval.

## §10 Rebuild sequence

```
node packages/classify/src/cli.ts run <p>
node packages/classify/src/cli.ts structure <p>
node packages/ingest/src/apply-cli.ts <p>        # only when sources/<p>/applications.json exists
node packages/resolve/src/skos-cli.ts <p>
node packages/canon/src/cli.ts
node packages/schema/src/cli.ts .
```
The site data (`node packages/db/src/cli.ts build` then `export`, or `cd site && corepack pnpm run data`) is rebuilt in §9.

## §11 Re-ingest a new upstream version

1. Research only what changed: new version (at least two weeks old), license unchanged (re-check; ADR 0016 requires it for Atlassian), changelog for renamed or removed tokens and new themes. G1/G2 only if something changed.
2. Bump `package.version` (and dependencies) in `sources/<p>/source.json`; re-ingest. The old `data/native/<p>/<old>/` folder stays.
3. Verify ingest (§3).
4. Bump the version in `packages/mapper/scopes/color-v1.json`; create the new empty `<new>.mappings.json`. No command carries approved mappings to a new version today: run the pipeline from §4 (approved terms in `terms.json` are per product, so they apply again and the classifier vote can settle tokens) and say so in the report.
5. Audit and review the new version as for a new system.
