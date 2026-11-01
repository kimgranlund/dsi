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

/**
 * Deciding statements for boundaries (ADR 0021): a statement and its negation, scored by Noul in one request and
 * compared, never thresholded alone (raw Noul is poorly calibrated; the pilot's pairwise accuracy is 94 to 96%).
 */
export const STATEMENTS: Record<string, { yes: string; no: string }> = {
  B4: { yes: 'This token colors text or icons placed on a bold, solid colored fill, such as the label of a filled button.', no: 'This token colors text or icons on the page, a card or a subtle tinted background, not on a solid colored fill.' },
  B5: { yes: 'This token paints non-text graphics such as icons, status dots, illustrations, or chart and meter fills.', no: 'This token paints one specific part of an element: its text, background or border.' },
  B7: { yes: 'This token colors code: syntax, code blocks, editors, diffs or line numbers.', no: 'This token colors ordinary interface elements, not code.' },
  B8: { yes: 'This token is the neutral member of a set of status colors, beside danger, success, warning or info versions of the same role.', no: 'This token is a plain gray for structure, with no status meaning.' },
  B1: { yes: 'This token is one step of a strength ladder: its family has weaker and stronger siblings of the same role.', no: 'This token stands alone: it has no weaker or stronger siblings of the same role.' },
  B3: { yes: 'This token colors a container placed on the page, such as a card, panel or layer.', no: 'This token is not specific to containers on the page; it applies anywhere or to the page itself.' },
  B6: { yes: 'This one token colors both text and icons.', no: 'This token colors text only; the system has separate icon colors.' },
};
export const JUDGE_MARGIN = 0.3;

export interface Judgement { yes: number; no: number; margin: number; decided?: boolean; model: string }

export async function judge(jev: Jev, state: unknown, boundary: string, margin = JUDGE_MARGIN): Promise<Judgement> {
  const s = STATEMENTS[boundary];
  const r = await jev.ask({ model: 'jev-latest', state, questions: { yes: { type: 'noul', instructions: s.yes }, no: { type: 'noul', instructions: s.no } } });
  const yes = r.answers.yes?.noul ?? 0, no = r.answers.no?.noul ?? 0;
  return { yes, no, margin: yes - no, decided: Math.abs(yes - no) >= margin ? yes > no : undefined, model: r.model };
}

/**
 * A boundary judge bound to one repo state: judge(product, version, token, boundary). Used by boundary-rules for
 * tokens a code test cannot decide (B4) and to triage approved conflicts (B4, B6). Benchmarks (round 6): B7 99%,
 * B4 98% at margin 0.3 (72% decided), B6 100% at margin (48% decided); B1 76% and B3 89% one-sided: not used; B8 50%.
 */
export const RELIABLE = new Set(['B4', 'B6', 'B7']);
export async function boundaryJudge(root: string, o: Ontology, opts: { offline?: boolean } = {}) {
  const gold = loadGold(root, o);
  const ctx = new Context(root, o, gold);
  const jev = new Jev(root, { offline: opts.offline });
  await jev.version();
  return (product: string, version: string, token: string, boundary: string) => judge(jev, ctx.state({ product, version, token, concept: '', facets: {}, tier: 'agent', method: '' }, 'full+siblings', 'text'), boundary);
}
