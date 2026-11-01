#!/usr/bin/env node
// Jev lab: run mapping experiments against approved mappings, score them, compare them. See README.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOntology } from '@dsi/schema';
import { Jev, type Request, type Response } from './client.ts';
import { Context, loadGold, loadOwnerChoices, sample, type Experiment, type GoldItem } from './tasks.ts';
import { confusions, isCorrect, summarize, type Scored } from './metrics.ts';
import { prescreen } from './roles.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const resultsDir = path.join(root, '.cache/jev/results');
const [cmd, ...args] = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const USAGE = `usage:
  dsi-jev gold                                  gold set size by product and tier
  dsi-jev run <experiment.json> [--dry] [--offline] [--concurrency N]
  dsi-jev compare <name>...                     key metrics side by side
  dsi-jev errors <name> [facet]                 most common confusions
  dsi-jev show <name> <token>                   one item: state, gold, answers
  dsi-jev prescreen [--margin 0.2] [--offline]  audit pre-screen: write .cache/jev/prescreen.json for audit-prepare --only`;

const o = await loadOntology(path.join(root, 'ontology'));
const gold = loadGold(root, o);

function registry(): string[] {
  return (JSON.parse(fs.readFileSync(path.join(root, 'ontology/schemes/concepts.jsonld'), 'utf8'))['@graph'] as { id: string }[]).map((c) => c.id);
}

function build(ctx: Context, e: Experiment, g: GoldItem): { req: Request; key?: Record<string, string>; pair?: [string, string] } {
  const state = ctx.state(g, e.state.kind, e.state.format);
  const model = e.model ?? 'jev-latest';
  const q = e.questions;
  if (q.kind === 'facets' || q.kind === 'two-stage') return { req: { model, state, questions: ctx.facetQuestions(q.facets, q.criteria, q.kind === 'facets' ? q.instructions : 'plain', q.noneKey) } };
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
  for (const g of gold) { c[g.product] ??= { owner: 0, rule: 0 }; c[g.product][g.tier]++; }
  console.log(`${gold.length} approved exact/close color mappings`); console.table(c);
} else if (cmd === 'run') {
  const file = args.find((a) => a.endsWith('.json'));
  if (!file) { console.error(USAGE); process.exit(2); }
  const e = JSON.parse(fs.readFileSync(file, 'utf8')) as Experiment;
  const items = sample(e.questions.kind === 'owner-choice' ? loadOwnerChoices(root, o) : gold, e.sample);
  const ctx = new Context(root, o, gold);
  const built = items.map((g) => ({ g, b: build(ctx, e, g) }));
  if (flag('--dry')) {
    console.log(`${e.name}: ${built.length} requests. First request:\n${JSON.stringify(built[0].b.req, null, 2)}`);
    const chars = built.reduce((n, x) => n + JSON.stringify(x.b.req).length, 0);
    console.log(`about ${Math.round(chars / 4)} input tokens in total (4 characters per token)`);
    process.exit(0);
  }
  const jev = new Jev(root, { concurrency: Number(opt('--concurrency') ?? 8), offline: flag('--offline') });
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
} else if (cmd === 'prescreen') {
  const r = await prescreen(root, o, { margin: opt('--margin') ? Number(opt('--margin')) : undefined, offline: flag('--offline') });
  const out = path.join(root, '.cache/jev/prescreen.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), ...r }, null, 1));
  console.log(`${r.flags.length} of ${r.checked} approved mappings flagged (${r.model}) -> ${path.relative(root, out)}`);
  const ctx = new Context(root, o, gold);
  for (const f of r.flags.slice(0, 20)) console.log(`  ${f.margin.toFixed(2)} ${f.product} ${f.token}: ${ctx.name(f.approved)} -> ${ctx.name(f.rival)}`);
} else { console.error(USAGE); process.exit(2); }
