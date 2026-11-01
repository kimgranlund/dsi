#!/usr/bin/env node
// Jev lab: run mapping experiments against approved mappings, score them, compare them. See README.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOntology } from '@dsi/schema';
import { Jev, type Request, type Response } from './client.ts';
import { Context, loadGold, sample, type Experiment, type GoldItem } from './tasks.ts';
import { confusions, isCorrect, summarize, type Scored } from './metrics.ts';

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
  dsi-jev show <name> <token>                   one item: state, gold, answers`;

const o = await loadOntology(path.join(root, 'ontology'));
const gold = loadGold(root, o);

function registry(): string[] {
  return (JSON.parse(fs.readFileSync(path.join(root, 'ontology/schemes/concepts.jsonld'), 'utf8'))['@graph'] as { id: string }[]).map((c) => c.id);
}

function build(ctx: Context, e: Experiment, g: GoldItem): { req: Request; key?: Record<string, string>; pair?: [string, string] } {
  const state = ctx.state(g, e.state.kind, e.state.format);
  const model = e.model ?? 'jev-latest';
  const q = e.questions;
  if (q.kind === 'facets') return { req: { model, state, questions: ctx.facetQuestions(q.facets, q.criteria, q.instructions) } };
  if (q.kind === 'registry') {
    const cands = ctx.candidates(g, q.k, registry());
    const key = Object.fromEntries(cands.map((c, i) => [`c${i + 1}`, c]));
    return { key, req: { model, state, questions: { concept: { type: 'choice', instructions: 'Which shared concept this design token means', criteria: Object.fromEntries(Object.entries(key).map(([k, c]) => [k, `${ctx.name(c)}: ${ctx.definition(c)}`])) } } } };
  }
  const distractor = ctx.candidates(g, 2, registry()).find((c) => c !== g.concept)!;
  return { pair: [g.concept, distractor], req: { model, state, questions: { gold: { type: 'noul', instructions: `This token means "${ctx.name(g.concept)}": ${ctx.definition(g.concept)}` }, distractor: { type: 'noul', instructions: `This token means "${ctx.name(distractor)}": ${ctx.definition(distractor)}` } } } };
}

function score(e: Experiment, g: GoldItem, b: ReturnType<typeof build>, r: Response): Scored[] {
  const base = { item: `${g.product} ${g.token}`, product: g.product, tier: g.tier };
  const q = e.questions;
  if (q.kind === 'facets') return q.facets.map((f) => { const a = r.answers[f]; const pred = a?.choice ?? 'none'; return { ...base, facet: f, gold: g.facets[f] ?? '', pred, confidence: a?.confidence ?? a?.probabilities?.[pred] ?? 0, correct: isCorrect(g.facets[f], pred) }; });
  if (q.kind === 'registry') { const a = r.answers.concept; const pred = b.key![a?.choice ?? ''] ?? '(none)'; return [{ ...base, facet: 'concept', gold: g.concept, pred, confidence: a?.confidence ?? 0, correct: pred === g.concept }]; }
  const yes = r.answers.gold?.noul ?? 0, no = r.answers.distractor?.noul ?? 0;
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
  const items = sample(gold, e.sample);
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
  const scored = done.flatMap(({ g, b, r }) => score(e, g, b, r));
  const summary = summarize(scored);
  const model = done.find((x) => x.r.model)?.r.model;
  const out = { experiment: e, model, at: new Date().toISOString(), seconds: (Date.now() - t0) / 1000, calls: jev.calls, cached: jev.hits, usage: { input: jev.inputTokens, output: jev.outputTokens }, failures, summary, scored, raw: done.map(({ g, r }) => ({ token: g.token, product: g.product, answers: r.answers })) };
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
} else { console.error(USAGE); process.exit(2); }
