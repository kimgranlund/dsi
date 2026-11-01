#!/usr/bin/env node
// Jev lab: run mapping experiments against approved mappings, score them, compare them. See README.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOntology } from '@dsi/schema';
import { Jev, type Request, type Response } from './client.ts';
import { Context, loadGold, loadOwnerChoices, loadWords, sample, type Experiment, type GoldItem } from './tasks.ts';
import { confusions, isCorrect, summarize, type Scored } from './metrics.ts';
import { prescreen, STATEMENTS } from './roles.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const resultsDir = path.join(root, '.cache/jev/results');
const [cmd, ...args] = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const USAGE = `usage:
  dsi-jev gold                                  gold set size by product and tier
  dsi-jev run <experiment.json> [--dry] [--offline] [--refresh] [--concurrency N]
  dsi-jev compare <name>...                     key metrics side by side
  dsi-jev errors <name> [facet]                 most common confusions
  dsi-jev show <name> <token>                   one item: state, gold, answers
  dsi-jev gaps [--products fluent,spectrum]      Jev's pick for sample-card parts a system has no approved token for
  dsi-jev contrast                              generate contrastive option descriptions from .cache/boundaries.json
  dsi-jev prescreen [--margin 0.2] [--offline]  audit pre-screen: write .cache/jev/prescreen.json for audit-prepare --only`;

const o = await loadOntology(path.join(root, 'ontology'));
const gold = loadGold(root, o);

/** Ground truth of a boundary statement for an approved mapping. */
function predicateTruth(b: string, g: GoldItem): boolean {
  const f = g.facets;
  if (b === 'B4') return (f.usage ?? '').split('+').includes('on-fill');
  if (b === 'B7') return (f.usage ?? '').split('+').includes('code-surface') || !!f.syntax;
  if (b === 'B8') return f.intent === 'neutral';
  if (b === 'B6') return f.property === 'foreground';
  if (b === 'B3') return (f.usage ?? '').split('+').includes('surface');
  return !!f.emphasis; // B1
}
function predicatePool(b: string, gold: GoldItem[]): GoldItem[] {
  const content = (g: GoldItem) => ['text', 'icon', 'foreground'].includes(g.facets.property ?? '');
  if (b === 'B4' || b === 'B6') return gold.filter(content);
  if (b === 'B8') return gold.filter((g) => !g.facets.hue && (g.facets.intent === 'neutral' || !g.facets.intent));
  if (b === 'B3') return gold.filter((g) => ['background', 'fill'].includes(g.facets.property ?? '') && !(g.facets.usage ?? '').split('+').some((u) => ['page', 'overlay', 'scrim', 'inverse', 'categorical', 'data-viz', 'code-surface'].includes(u)));
  return gold;
}

/** Concepts the mapping agents proposed for a token (any status), excluding owner-authored records. */
function loadAgentAnswers(g: GoldItem): string[] {
  const f = path.join(root, 'mappings', g.product, `${g.version}.mappings.json`);
  return [...new Set((JSON.parse(fs.readFileSync(f, 'utf8')).mappings as any[]).filter((m) => m.token === g.token && m.provenance?.model && m.concept.startsWith('dsi:concept/color/')).map((m) => m.concept as string))];
}

function registry(): string[] {
  return (JSON.parse(fs.readFileSync(path.join(root, 'ontology/schemes/concepts.jsonld'), 'utf8'))['@graph'] as { id: string }[]).map((c) => c.id);
}

function build(ctx: Context, e: Experiment, g: GoldItem): { req: Request; key?: Record<string, string>; pair?: [string, string] } {
  const state = e.questions.kind === 'words' ? '' : ctx.state(g, e.state.kind, e.state.format, { evidence: e.state.evidence, conventions: e.state.conventions });
  const model = e.model ?? 'jev-latest';
  const q = e.questions;
  if (q.kind === 'facets' || q.kind === 'two-stage') return { req: { model, state, questions: ctx.facetQuestions(q.facets, q.criteria, q.kind === 'facets' ? q.instructions : 'plain', q.noneKey) } };
  if (q.kind === 'predicate') { const st = STATEMENTS[q.boundary]; return { req: { model, state, questions: { yes: { type: 'noul', instructions: st.yes }, no: { type: 'noul', instructions: st.no } } } }; }
  if (q.kind === 'staged') return { req: { model, state, questions: ctx.facetQuestions(q.first, q.criteria) } };
  if (q.kind === 'words') {
    const w = (g as any).word;
    const facets = ['intent', 'usage', 'hue', 'property', 'emphasis', 'state'];
    return { req: { model, state: `system: ${g.product}\nword in token names: ${w}\nexamples: ${ctx.examplesOf(g.product, g.version, w).join(', ')}`, questions: {
      facet: { type: 'choice', instructions: 'Which dimension of meaning this naming word expresses in the token names', criteria: { intent: 'What the color signals (danger, success, brand)', usage: 'Where it is used (page, surface, overlay, link)', hue: 'A named hue of a categorical color set', property: 'Which part it colors (background, text, border, icon)', emphasis: 'How strong it is (subtle, strong)', state: 'An interaction state (hover, pressed, disabled)', none: 'No meaning: a noise word, a number or part of a product name' } },
      ...Object.fromEntries(facets.map((f) => [f, { type: 'choice' as const, instructions: `If this word expresses ${f}, which value`, criteria: ctx.criteria(f) }])) } } };
  }
  if (q.kind === 'merged') return { req: { model, state, questions: ctx.facetQuestions(['intent', 'usage', 'hue', 'property', 'emphasis', 'state']) } };
  if (q.kind === 'owner-choice') {
    // The owner's concept, the rejected alternatives, and optionally the nearest registered concepts as extra distractors.
    const extra = q.extra ? ctx.candidates(g, q.extra + 1, registry()).filter((c) => c !== g.concept && !g.alts!.includes(c)).slice(0, q.extra) : [];
    const cands = [g.concept, ...g.alts!, ...extra].sort((a, b) => (a + g.token).localeCompare(b + g.token));
    const key = Object.fromEntries(cands.map((c, i) => [`c${i + 1}`, c]));
    return { key, req: { model, state, questions: { concept: { type: 'choice', instructions: 'Which shared concept this design token means', criteria: Object.fromEntries(Object.entries(key).map(([k, c]) => [k, `${ctx.name(c)}: ${ctx.definition(c)}`])) } } } };
  }
  if (q.kind === 'registry') {
    const cands = ctx.candidates(g, q.k, registry());
    const key = Object.fromEntries(cands.map((c, i) => [`c${i + 1}`, c]));
    return { key, req: { model, state, questions: { concept: { type: 'choice', instructions: 'Which shared concept this design token means', criteria: Object.fromEntries(Object.entries(key).map(([k, c]) => [k, `${ctx.name(c)}: ${ctx.definition(c)}`])) } } } };
  }
  if (q.kind === 'usage-noul') {
    const vals = Object.keys(ctx.criteria('usage')).filter((v) => v !== 'none');
    const lex = ctx.lex;
    return { req: { model, state, questions: Object.fromEntries(vals.map((v) => [v, { type: 'noul' as const, instructions: `This token is used for ${lex.get('dsi:usage/' + v)?.label ?? v}: ${lex.get('dsi:usage/' + v)?.definition ?? ''}` }])) } };
  }
  const n = q.kind === 'noul' ? (q.neighbors ?? 1) : 1;
  const rivals = ctx.candidates(g, n + 1, registry()).filter((c) => c !== g.concept).slice(0, n);
  const ask = (c: string) => ({ type: 'noul' as const, instructions: `This token means "${ctx.name(c)}": ${ctx.definition(c)}` });
  return { pair: [g.concept, rivals[0]], key: Object.fromEntries(rivals.map((c, i) => [`r${i + 1}`, c])), req: { model, state, questions: { gold: ask(g.concept), ...Object.fromEntries(rivals.map((c, i) => [i === 0 ? 'distractor' : `r${i + 1}`, ask(c)])) } } };
}

/** Apply post-processing: boost the none option per facet, then the grammar (no hue without categorical usage). */
function postFacets(e: Experiment, answers: Response['answers'], facets: string[], noneKey: string): Record<string, { pred: string; confidence: number }> {
  const out: Record<string, { pred: string; confidence: number }> = {};
  for (const f of facets) {
    const p = { ...(answers[f]?.probabilities ?? {}) };
    const boost = e.post?.noneBoost?.[f] ?? 0;
    if (boost) p[noneKey] = (p[noneKey] ?? 0) + boost;
    const [pred, conf] = Object.entries(p).sort((a, b) => b[1] - a[1])[0] ?? [answers[f]?.choice ?? noneKey, answers[f]?.confidence ?? 0];
    out[f] = { pred: pred === noneKey ? 'none' : pred, confidence: boost ? conf / (1 + boost) : (answers[f]?.confidence ?? conf) };
  }
  if (e.post?.grammar && out.hue && out.usage && out.usage.pred !== 'categorical') out.hue = { pred: 'none', confidence: out.usage.confidence };
  return out;
}

function score(e: Experiment, g: GoldItem, b: ReturnType<typeof build>, r: Response, extra?: Response): Scored[] {
  const base = { item: `${g.product} ${g.token}`, product: g.product, tier: g.tier };
  const q = e.questions;
  if (q.kind === 'facets') { const pf = postFacets(e, r.answers, q.facets, q.noneKey ?? 'none'); return q.facets.map((f) => ({ ...base, facet: f, gold: g.facets[f] ?? '', pred: pf[f].pred, confidence: pf[f].confidence, correct: isCorrect(g.facets[f], pf[f].pred) })); }
  if (q.kind === 'two-stage') {
    const a = extra?.answers.concept; const pred = b.key?.[a?.choice ?? ''] ?? '(none)';
    return [{ ...base, facet: 'recall@k', gold: g.concept, pred: b.key && Object.values(b.key).includes(g.concept) ? g.concept : '(missed)', confidence: 1, correct: !!b.key && Object.values(b.key).includes(g.concept) }, { ...base, facet: 'concept', gold: g.concept, pred, confidence: a?.confidence ?? 0, correct: pred === g.concept }];
  }
  if (q.kind === 'predicate') {
    const truth = predicateTruth(q.boundary, g);
    const m = (r.answers.yes?.noul ?? 0) - (r.answers.no?.noul ?? 0);
    const decided = Math.abs(m) >= (q.margin ?? 0.3);
    return [{ ...base, facet: 'pairwise', gold: String(truth), pred: String(m > 0), confidence: Math.min(1, Math.abs(m)), correct: (m > 0) === truth }, ...(decided ? [{ ...base, facet: 'decided@margin', gold: String(truth), pred: String(m > 0), confidence: Math.min(1, Math.abs(m)), correct: (m > 0) === truth }] : [])];
  }
  if (q.kind === 'staged') { const pf = postFacets({ ...e, post: { grammar: true, ...(e.post ?? {}) } }, { ...r.answers, ...(extra?.answers ?? {}) }, [...q.first, ...q.then], 'none'); return [...q.first, ...q.then].map((f) => ({ ...base, facet: f, gold: g.facets[f] ?? '', pred: pf[f].pred, confidence: pf[f].confidence, correct: isCorrect(g.facets[f], pf[f].pred) })); }
  if (q.kind === 'words') {
    const w = g as any; const fa = r.answers.facet; const fp = fa?.choice ?? 'none';
    const vp = fp === 'none' ? 'none' : (r.answers[fp]?.choice ?? 'none');
    return [{ ...base, item: `${g.product} ${w.word}`, facet: 'word-facet', gold: w.wordFacet, pred: fp, confidence: fa?.confidence ?? 0, correct: fp === w.wordFacet }, { ...base, item: `${g.product} ${w.word}`, facet: 'word-value', gold: `${w.wordFacet}/${w.wordValue}`, pred: `${fp}/${vp}`, confidence: Math.min(fa?.confidence ?? 0, r.answers[fp]?.confidence ?? 0), correct: fp === w.wordFacet && vp === w.wordValue }];
  }
  if (q.kind === 'merged') {
    const a = extra?.answers.concept; const pred = b.key?.[a?.choice ?? ''] ?? '(none)'; const inList = !!b.key && Object.values(b.key).includes(g.concept);
    return [{ ...base, facet: 'recall', gold: g.concept, pred: inList ? g.concept : '(missed)', confidence: 1, correct: inList }, { ...base, facet: 'concept', gold: g.concept, pred, confidence: a?.confidence ?? 0, correct: pred === g.concept }, { ...base, facet: 'agent-baseline', gold: g.concept, pred: g.baseline ?? '(none)', confidence: 1, correct: g.baseline === g.concept }];
  }
  if (q.kind === 'owner-choice') { const a = r.answers.concept; const pred = b.key![a?.choice ?? ''] ?? '(none)'; return [{ ...base, facet: 'concept', gold: g.concept, pred, confidence: a?.confidence ?? 0, correct: pred === g.concept }, { ...base, facet: 'agent-baseline', gold: g.concept, pred: g.baseline ?? '(none)', confidence: 1, correct: g.baseline === g.concept }]; }
  if (q.kind === 'registry') { const a = r.answers.concept; const pred = b.key![a?.choice ?? ''] ?? '(none)'; return [{ ...base, facet: 'concept', gold: g.concept, pred, confidence: a?.confidence ?? 0, correct: pred === g.concept }]; }
  if (q.kind === 'usage-noul') {
    const t = q.threshold ?? 0.5;
    const ps = Object.entries(r.answers).map(([v, a]) => [v, a.noul ?? 0] as const).sort((a, b) => b[1] - a[1]);
    const chosen = ps.filter(([, p]) => p >= t).map(([v]) => v).sort();
    const goldSet = (g.facets.usage ?? '').split('+').filter(Boolean).sort();
    const top = ps[0];
    const single = top && top[1] >= t ? top[0] : 'none';
    return [{ ...base, facet: 'usage-set', gold: goldSet.join('+'), pred: chosen.join('+') || 'none', confidence: top?.[1] ?? 0, correct: chosen.join('+') === goldSet.join('+') }, { ...base, facet: 'usage-top', gold: g.facets.usage ?? '', pred: single, confidence: top?.[1] ?? 0, correct: isCorrect(g.facets.usage, single) }];
  }
  const rivals = Object.entries(r.answers).filter(([k]) => k !== 'gold').map(([, a]) => a.noul ?? 0);
  const yes = r.answers.gold?.noul ?? 0, no = r.answers.distractor?.noul ?? 0;
  if ((q.kind === 'noul') && (q.neighbors ?? 1) > 1) return [{ ...base, facet: 'gold-beats-all', gold: 'true', pred: String(yes > Math.max(...rivals)), confidence: yes - Math.max(...rivals), correct: yes > Math.max(...rivals) }];
  return [{ ...base, facet: 'noul-pair', gold: b.pair![0], pred: yes > no ? b.pair![0] : b.pair![1], confidence: Math.abs(yes - no), correct: yes > no }, { ...base, facet: 'noul-gold>0.5', gold: 'true', pred: yes > 0.5 ? 'true' : 'false', confidence: yes, correct: yes > 0.5 }];
}

if (cmd === 'gold') {
  const c: Record<string, Record<string, number>> = {};
  for (const g of gold) { c[g.product] ??= { judgment: 0, convention: 0, agent: 0 }; c[g.product][g.tier]++; }
  console.log(`${gold.length} approved exact/close color mappings`); console.table(c);
} else if (cmd === 'run') {
  const file = args.find((a) => a.endsWith('.json'));
  if (!file) { console.error(USAGE); process.exit(2); }
  const e = JSON.parse(fs.readFileSync(file, 'utf8')) as Experiment;
  const wordsAsGold = () => loadWords(root).map((w) => ({ product: w.product, version: w.version, token: `${w.term}`, concept: '', facets: {}, tier: w.tier as GoldItem['tier'], method: '', word: w.term, wordFacet: w.facet, wordValue: w.value } as GoldItem));
  // Predicate runs balance true and false cases so pairwise accuracy is not a base-rate artifact.
  const balanced = (b: string) => { const pool = predicatePool(b, gold); const t = sample(pool.filter((g) => predicateTruth(b, g)), { ...e.sample, n: Math.floor(e.sample.n / 2) }); const f = sample(pool.filter((g) => !predicateTruth(b, g)), { ...e.sample, n: Math.ceil(e.sample.n / 2) }); return [...t, ...f]; };
  const items = e.questions.kind === 'predicate' ? balanced(e.questions.boundary) : sample(e.questions.kind === 'owner-choice' || e.questions.kind === 'merged' ? loadOwnerChoices(root, o) : e.questions.kind === 'words' ? wordsAsGold() : gold, e.sample);
  const ctx = new Context(root, o, gold);
  if (e.criteriaFile) ctx.override = Object.assign({}, ...e.criteriaFile.split(',').map((f) => JSON.parse(fs.readFileSync(path.resolve(root, f), 'utf8'))));
  const built = items.map((g) => ({ g, b: build(ctx, e, g) }));
  if (flag('--dry')) {
    console.log(`${e.name}: ${built.length} requests. First request:\n${JSON.stringify(built[0].b.req, null, 2)}`);
    const chars = built.reduce((n, x) => n + JSON.stringify(x.b.req).length, 0);
    console.log(`about ${Math.round(chars / 4)} input tokens in total (4 characters per token)`);
    process.exit(0);
  }
  const jev = new Jev(root, { concurrency: Number(opt('--concurrency') ?? 8), offline: flag('--offline'), refresh: flag('--refresh') });
  await jev.version(); // cached answers from another Jev release are re-asked
  const t0 = Date.now();
  const failures: string[] = [];
  const answers = await Promise.all(built.map(async ({ g, b }) => { try { return { g, b, r: await jev.ask(b.req) }; } catch (err) { failures.push(`${g.token}: ${(err as Error).message}`); return undefined; } }));
  const done = answers.filter((x): x is NonNullable<typeof x> => !!x);
  // Two-stage: rank registered concepts by the facet probabilities, then ask Jev to choose among the top k.
  const second = new Map<string, Response>();
  if (e.questions.kind === 'two-stage') {
    const q = e.questions; const reg = registry();
    await Promise.all(done.map(async (x) => {
      const probs = Object.fromEntries(q.facets.map((f) => { const p = { ...(x.r.answers[f]?.probabilities ?? {}) }; const bst = e.post?.noneBoost?.[f]; if (bst) p[q.noneKey ?? 'none'] = (p[q.noneKey ?? 'none'] ?? 0) + bst; return [f, p]; }));
      if (e.post?.grammar && probs.hue) { const pc = probs.usage?.categorical ?? 0; for (const k of Object.keys(probs.hue)) if (k !== (q.noneKey ?? 'none')) probs.hue[k] *= pc; probs.hue[q.noneKey ?? 'none'] = (probs.hue[q.noneKey ?? 'none'] ?? 0) + (1 - pc); }
      const ranked = ctx.rankByFacets(probs, reg, q.noneKey ?? 'none');
      const fam = q.siblings ? ctx.familyConcepts(x.g).filter((c) => reg.includes(c)) : [];
      const top = [...new Set([...fam.slice(0, Math.floor(q.k / 2)), ...ranked])].slice(0, q.k);
      x.b.key = Object.fromEntries(top.map((c, i) => [`c${i + 1}`, c]));
      const req: Request = { model: e.model ?? 'jev-latest', state: x.b.req.state, questions: { concept: { type: 'choice', instructions: 'Which shared concept this design token means', criteria: Object.fromEntries(Object.entries(x.b.key).map(([k, c]) => [k, `${ctx.name(c)}: ${ctx.definition(c)}`])) } } };
      try { second.set(x.g.token + x.g.product, await jev.ask(req)); } catch (err) { failures.push(`${x.g.token} (stage 2): ${(err as Error).message}`); }
    }));
  }
  if (e.questions.kind === 'staged') {
    const q = e.questions;
    await Promise.all(done.map(async (x) => {
      const firsts = q.first.map((f) => `${f}: ${x.r.answers[f]?.choice ?? 'none'}`).join('; ');
      const req: Request = { model: e.model ?? 'jev-latest', state: `${x.b.req.state}\nalready decided: ${firsts}`, questions: ctx.facetQuestions(q.then, q.criteria) };
      try { second.set(x.g.token + x.g.product, await jev.ask(req)); } catch (err) { failures.push(`${x.g.token} (stage 2): ${(err as Error).message}`); }
    }));
  }
  if (e.questions.kind === 'merged') {
    const q = e.questions; const reg = registry(); const F = ['intent', 'usage', 'hue', 'property', 'emphasis', 'state'];
    await Promise.all(done.map(async (x) => {
      // Candidates: every agent answer on record (approved or rejected) plus Jev's top facet-ranked registered concepts. No owner leak.
      const agents = loadAgentAnswers(x.g);
      const probs = Object.fromEntries(F.map((f) => [f, x.r.answers[f]?.probabilities ?? {}]));
      const cands = [...new Set([...agents, ...ctx.rankByFacets(probs, reg).slice(0, q.jevTop)])];
      x.b.key = Object.fromEntries(cands.map((c, i) => [`c${i + 1}`, c]));
      const req: Request = { model: e.model ?? 'jev-latest', state: x.b.req.state, questions: { concept: { type: 'choice', instructions: 'Which shared concept this design token means', criteria: Object.fromEntries(Object.entries(x.b.key).map(([k, c]) => [k, `${ctx.name(c)}: ${ctx.definition(c)}`])) } } };
      try { second.set(x.g.token + x.g.product, await jev.ask(req)); } catch (err) { failures.push(`${x.g.token} (stage 2): ${(err as Error).message}`); }
    }));
  }
  const scored = done.flatMap(({ g, b, r }) => score(e, g, b, r, second.get(g.token + g.product)));
  const summary = summarize(scored);
  const model = done.find((x) => x.r.model)?.r.model;
  const out = { experiment: e, model, at: new Date().toISOString(), seconds: (Date.now() - t0) / 1000, calls: jev.calls, cached: jev.hits, usage: { input: jev.inputTokens, output: jev.outputTokens }, failures, summary, scored, raw: done.map(({ g, b, r }) => ({ token: g.token, product: g.product, concept: g.concept, key: b.key, answers: r.answers })) };
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(resultsDir, `${e.name}.json`), JSON.stringify(out, null, 1));
  const log = path.join(root, 'packages/jev/experiments/RESULTS.md');
  if (!fs.existsSync(log)) fs.writeFileSync(log, '# Jev experiment results\n\nAppended by `dsi-jev run`. Full results: `.cache/jev/results/<name>.json`.\n\n| Experiment | Model | Items | Joint % | Facet accuracy % | ECE % | Acc@0.8 (coverage) | Calls (cached) | Tokens in/out |\n|---|---|---|---|---|---|---|---|---|\n');
  const s8 = summary.selective.find((x) => x.threshold === 0.8)!;
  fs.appendFileSync(log, `| ${e.name} | ${model ?? '?'} | ${summary.items} | ${summary.joint} | ${Object.entries(summary.perFacet).map(([f, v]) => `${f} ${v.accuracy}`).join(', ')} | ${summary.ece} | ${s8.accuracy} (${s8.coverage}) | ${jev.calls} (${jev.hits}) | ${jev.inputTokens}/${jev.outputTokens} |\n`);
  console.log(JSON.stringify({ name: e.name, model, failures: failures.length, ...summary, byProduct: undefined }, null, 1));
  if (failures.length) console.log('failures:', failures.slice(0, 5));
} else if (cmd === 'compare') {
  const rows = args.map((n) => { const r = JSON.parse(fs.readFileSync(path.join(resultsDir, `${n}.json`), 'utf8')); const s = r.summary; return { name: n, items: s.items, joint: s.joint, ece: s.ece, ...Object.fromEntries(Object.entries(s.perFacet).map(([f, v]: any) => [f, v.accuracy])), 'acc@0.8': s.selective.find((x: any) => x.threshold === 0.8).accuracy, 'cov@0.8': s.selective.find((x: any) => x.threshold === 0.8).coverage }; });
  console.table(rows);
} else if (cmd === 'errors') {
  const r = JSON.parse(fs.readFileSync(path.join(resultsDir, `${args[0]}.json`), 'utf8'));
  for (const [k, n] of confusions(r.scored, args[1], 25)) console.log(String(n).padStart(4), k);
} else if (cmd === 'show') {
  const r = JSON.parse(fs.readFileSync(path.join(resultsDir, `${args[0]}.json`), 'utf8'));
  const g = gold.find((x) => x.token === args[1]);
  const ctx = new Context(root, o, gold);
  if (g) console.log(ctx.state(g, r.experiment.state.kind, r.experiment.state.format), '\ngold:', g.concept);
  console.log(JSON.stringify(r.raw.find((x: any) => x.token === args[1])?.answers, null, 1));
} else if (cmd === 'contrast') {
  // Generate contrastive option descriptions from the mined boundaries (.cache/boundaries.json): each value's
  // definition plus "not <neighbor>" for its two most-confused neighbors; "none" names what it is confused with.
  const pairs = JSON.parse(fs.readFileSync(path.join(root, '.cache/boundaries.json'), 'utf8')) as { facet: string; a: { value: string }; b: { value: string }; score: number }[];
  const ctx = new Context(root, o, gold);
  const out: Record<string, string> = {};
  const short = (f: string, v: string) => { const w = ctx.lex.get(`dsi:${f}/${v}`); return w ? `${w.label.toLowerCase()} (${(w.definition ?? '').replace(/\.$/, '').split(/[,;:]/)[0].toLowerCase()})` : v; };
  for (const f of ['intent', 'usage', 'hue', 'property', 'emphasis', 'state']) {
    for (const v of [...ctx.usedValues(f), 'none']) {
      const nb = pairs.filter((p) => p.facet === f && (p.a.value === v || p.b.value === v)).sort((x, y) => y.score - x.score).map((p) => (p.a.value === v ? p.b.value : p.a.value)).filter((x) => x !== v && !x.includes('+')).slice(0, 2);
      if (!nb.length) continue;
      const nots = nb.map((x) => (x === 'none' ? 'not general-purpose' : `not ${short(f, x)}`)).join('; ');
      if (v === 'none') out[`none:${f}`] = `Not specific to this dimension; ${nb.map((x) => `not ${short(f, x)}`).join('; ')}.`;
      else { const w = ctx.lex.get(`dsi:${f}/${v}`); if (w) out[`dsi:${f}/${v}`] = `${(w.definition ?? w.label).replace(/\.$/, '')}; ${nots}.`; }
    }
  }
  const file = path.join(root, 'packages/jev/experiments/criteria-generated.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log(`${Object.keys(out).length} contrastive descriptions -> ${path.relative(root, file)}`);
} else if (cmd === 'prescreen') {
  const r = await prescreen(root, o, { margin: opt('--margin') ? Number(opt('--margin')) : undefined, offline: flag('--offline') });
  const out = path.join(root, '.cache/jev/prescreen.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), ...r }, null, 1));
  console.log(`${r.flags.length} of ${r.checked} approved mappings flagged (${r.model}) -> ${path.relative(root, out)}`);
  const ctx = new Context(root, o, gold);
  for (const f of r.flags.slice(0, 20)) console.log(`  ${f.margin.toFixed(2)} ${f.product} ${f.token}: ${ctx.name(f.approved)} -> ${ctx.name(f.rival)}`);
} else if (cmd === 'gaps') {
  // Sample-card gaps: for a system with no approved token at a specimen concept, let Jev pick from that system's own
  // color tokens (name-filtered shortlist). A report for review, never a mapping.
  const SPEC: { part: string; concept: string; hint: RegExp }[] = [
    { part: 'Page', concept: 'dsi:concept/color/usage-page/property-background', hint: /(page|canvas|app|body|base|background1$|default)/i },
    { part: 'Link', concept: 'dsi:concept/color/usage-link/property-text', hint: /(link|href|hyperlink|anchor)/i },
    { part: 'Delete button label', concept: 'dsi:concept/color/intent-danger/usage-on-fill/property-foreground', hint: /(danger|error|negative|critical|red).*(on|inverse|fill|static|white|foreground)|on.*(danger|error|negative|critical)/i },
  ];
  const products = (opt('--products') ?? 'fluent,spectrum').split(',');
  const scope = JSON.parse(fs.readFileSync(path.join(root, 'packages/mapper/scopes/color-v1.json'), 'utf8')).products as Record<string, { version: string }>;
  const ctx = new Context(root, o, gold);
  const jev = new Jev(root, { offline: flag('--offline') });
  await jev.version();
  const report: any[] = [];
  for (const product of products) {
    const version = scope[product].version;
    const approved = new Set((JSON.parse(fs.readFileSync(path.join(root, 'mappings', product, `${version}.mappings.json`), 'utf8')).mappings as any[]).filter((m) => m.status === 'approved').map((m) => m.concept));
    const set = ctx.set({ product, version } as GoldItem);
    for (const sp of SPEC) {
      if (approved.has(sp.concept)) continue;
      const pool = [...set.tokens.values()].filter((t) => (t.type === 'color' || !t.type) && sp.hint.test(t.path) && !t.deprecated).map((t) => t.path).slice(0, 25);
      if (!pool.length) { report.push({ product, part: sp.part, note: 'no candidate names' }); continue; }
      const key = Object.fromEntries(pool.map((t, i) => [`t${i + 1}`, t]));
      const desc = (t: string) => { const tk = set.tokens.get(t)!; const v = ctx.state({ product, version, token: t } as GoldItem, 'full', 'json') as any; return `${t}${tk.description ? ': ' + tk.description : ''} (${JSON.stringify(v.valuesByMode ?? {})})`; };
      const r = await jev.ask({ model: 'jev-latest', state: `system: ${product}\nlooking for: ${ctx.name(sp.concept)} (${ctx.definition(sp.concept)})`, questions: { token: { type: 'choice', instructions: `Which of this system's tokens is its ${ctx.name(sp.concept).toLowerCase()}`, criteria: Object.fromEntries(Object.entries(key).map(([k, t]) => [k, desc(t)])) } } });
      const a = r.answers.token;
      report.push({ product, part: sp.part, concept: sp.concept, pick: key[a?.choice ?? ''], confidence: a?.confidence, runnerUp: Object.entries(a?.probabilities ?? {}).sort((x, y) => y[1] - x[1]).slice(1, 3).map(([k, p]) => `${key[k]} ${p.toFixed(2)}`), model: r.model });
    }
  }
  fs.mkdirSync(path.join(root, '.cache/jev'), { recursive: true });
  fs.writeFileSync(path.join(root, '.cache/jev/gaps.json'), JSON.stringify(report, null, 1));
  for (const x of report) console.log(`${x.product} ${x.part}: ${x.pick ?? x.note}${x.confidence != null ? ` (${x.confidence.toFixed(2)}; next: ${x.runnerUp.join(', ')})` : ''}`);
} else { console.error(USAGE); process.exit(2); }
