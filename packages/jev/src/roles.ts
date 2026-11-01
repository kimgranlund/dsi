import path from 'node:path';
import { type Ontology } from '@dsi/schema';
import fs from 'node:fs';
import { Jev, type Request } from './client.ts';
import { Context, loadGold, type GoldItem } from './tasks.ts';

/**
 * The two roles the owner gave Jev (G9, 2026-11-01), configured by the pilot (LESSONS.md):
 * - prescreen: Noul for the approved concept vs its 3 nearest registered rivals; flag when a rival wins by 0.2 or more.
 * - suggest:   two-stage reuse-first (facet Choices -> top 20 registered concepts -> one Choice), state with siblings.
 * Neither approves anything. Every answer carries the model version Jev reports.
 */
export const FACETS = ['intent', 'usage', 'hue', 'property', 'emphasis', 'state'];
export const SUGGEST_AT = 0.85;
export const FLAG_MARGIN = 0.2;

function registry(root: string): string[] {
  return (JSON.parse(fs.readFileSync(path.join(root, 'ontology/schemes/concepts.jsonld'), 'utf8'))['@graph'] as { id: string }[]).map((c) => c.id);
}

export interface Flag { product: string; token: string; approved: string; rival: string; margin: number; approvedScore: number; rivalScore: number; model: string }

export async function prescreen(root: string, o: Ontology, opts: { margin?: number; offline?: boolean } = {}): Promise<{ flags: Flag[]; checked: number; model?: string }> {
  const gold = loadGold(root, o);
  const ctx = new Context(root, o, gold);
  const reg = registry(root);
  const jev = new Jev(root, { offline: opts.offline });
  await jev.version();
  const ask = (c: string) => ({ type: 'noul' as const, instructions: `This token means "${ctx.name(c)}": ${ctx.definition(c)}` });
  let model: string | undefined;
  const flags: Flag[] = [];
  await Promise.all(gold.map(async (g) => {
    const rivals = ctx.candidates(g, 4, reg).filter((c) => c !== g.concept).slice(0, 3);
    // Same request shape as experiment e23, so its cached answers are reused.
    const req: Request = { model: 'jev-latest', state: ctx.state(g, 'full', 'text'), questions: { gold: ask(g.concept), ...Object.fromEntries(rivals.map((c, i) => [i === 0 ? 'distractor' : `r${i + 1}`, ask(c)])) } };
    const r = await jev.ask(req);
    model ??= r.model;
    const keys = ['distractor', 'r2', 'r3'];
    const best = keys.map((k, i) => ({ c: rivals[i], p: r.answers[k]?.noul ?? 0 })).filter((x) => x.c).sort((a, b) => b.p - a.p)[0];
    const yes = r.answers.gold?.noul ?? 0;
    if (best && best.p - yes >= (opts.margin ?? FLAG_MARGIN)) flags.push({ product: g.product, token: g.token, approved: g.concept, rival: best.c, margin: Math.round((best.p - yes) * 100) / 100, approvedScore: yes, rivalScore: best.p, model: r.model });
  }));
  return { flags: flags.sort((a, b) => b.margin - a.margin), checked: gold.length, model };
}

export interface Suggestion { concept: string; confidence: number; model: string }

/** Option descriptions that won round 5 (usage 47 -> 61%): lexicon definitions plus contrastive usage and "none" texts. */
export const CRITERIA_FILES = ['packages/jev/experiments/criteria-contrastive.json']; // definitions now live in the lexicon

export async function suggest(root: string, o: Ontology, items: { product: string; version: string; token: string }[], opts: { offline?: boolean } = {}): Promise<Map<string, Suggestion>> {
  const gold = loadGold(root, o);
  const ctx = new Context(root, o, gold);
  ctx.override = Object.assign({}, ...CRITERIA_FILES.filter((f) => fs.existsSync(path.join(root, f))).map((f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'))));
  const reg = registry(root);
  const jev = new Jev(root, { offline: opts.offline });
  await jev.version();
  const out = new Map<string, Suggestion>();
  await Promise.all(items.map(async (it) => {
    const g: GoldItem = { ...it, concept: '', facets: {}, tier: 'rule', method: '' };
    const state = ctx.state(g, 'full+siblings', 'text');
    try {
      const r1 = await jev.ask({ model: 'jev-latest', state, questions: ctx.facetQuestions(FACETS) });
      const probs = Object.fromEntries(FACETS.map((f) => [f, r1.answers[f]?.probabilities ?? {}]));
      const top = ctx.rankByFacets(probs, reg).slice(0, 20);
      const key = Object.fromEntries(top.map((c, i) => [`c${i + 1}`, c]));
      const r2 = await jev.ask({ model: 'jev-latest', state, questions: { concept: { type: 'choice', instructions: 'Which shared concept this design token means', criteria: Object.fromEntries(Object.entries(key).map(([k, c]) => [k, `${ctx.name(c)}: ${ctx.definition(c)}`])) } } });
      const a = r2.answers.concept;
      if (a?.choice && key[a.choice]) out.set(`${it.product}__${it.token}`, { concept: key[a.choice], confidence: a.confidence ?? 0, model: r2.model });
    } catch { /* no suggestion for this token */ }
  }));
  return out;
}
