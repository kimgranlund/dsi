import fs from 'node:fs';
import path from 'node:path';
import type { Scope } from './packet.ts';

/**
 * Boundary mining: where answers for the same token differ, the facet values they differ on form a boundary pair
 * (property text | foreground, usage on-fill | none). Pairs are counted from four sources and ranked by how many
 * tokens one owner decision on that pair could settle.
 *  - open:    queued tokens whose proposals differ on the pair (settled by a decision now)
 *  - history: decided tokens where an agent answer differed from the approved one (the decision's precedent)
 *  - audit:   approved vs auditor-suggested concept (contradicted verdicts)
 *  - jev:     Jev facet confusions in the best lab run (gold vs predicted)
 */
export interface Side { value: string; won: number; examples: string[] }
export interface Boundary { key: string; facet: string; a: Side; b: Side; open: number; history: number; audit: number; jev: number; systems: string[]; openTokens: string[]; deciders: Record<string, number>; score: number }

const atoms = (c: string) => {
  const out = new Map<string, Set<string>>();
  for (const seg of c.split('/').slice(2)) { const i = seg.indexOf('-'); out.set(seg.slice(0, i), new Set(seg.slice(i + 1).split('+'))); }
  return out;
};
const FACETS = ['intent', 'usage', 'hue', 'syntax', 'component', 'part', 'property', 'style', 'emphasis', 'brightness', 'state'];

/** The facet-level differences between two concepts: one [facet, x, y] per differing facet ('none' when unbound). */
export function diffConcepts(x: string, y: string): [string, string, string][] {
  const [ax, ay] = [atoms(x), atoms(y)];
  const out: [string, string, string][] = [];
  if (x.split('/')[1] !== y.split('/')[1]) out.push(['domain', x.split('/')[1], y.split('/')[1]]);
  for (const f of FACETS) {
    const vx = ax.get(f) ?? new Set(), vy = ay.get(f) ?? new Set();
    const onlyX = [...vx].filter((v) => !vy.has(v)).sort(), onlyY = [...vy].filter((v) => !vx.has(v)).sort();
    if (onlyX.length || onlyY.length) out.push([f, onlyX.join('+') || 'none', onlyY.join('+') || 'none']);
  }
  return out;
}

export function mineBoundaries(root: string, scope: Scope, jevRun?: string): Boundary[] {
  const pairs = new Map<string, Boundary>();
  const get = (facet: string, x: string, y: string) => {
    const [a, b] = [x, y].sort();
    const key = `${facet}: ${a} | ${b}`;
    return { key, flip: a !== x, rec: pairs.get(key) ?? pairs.set(key, { key, facet, a: { value: a, won: 0, examples: [] }, b: { value: b, won: 0, examples: [] }, open: 0, history: 0, audit: 0, jev: 0, systems: [], openTokens: [], deciders: {}, score: 0 }).get(key)! };
  };
  const seen = new Set<string>();
  const touch = (rec: Boundary, product: string, kind: 'open' | 'history' | 'audit' | 'jev', token: string) => {
    const k = `${rec.key}|${kind}|${product}|${token}`;
    if (seen.has(k)) return false;
    seen.add(k); rec[kind]++;
    if (!rec.systems.includes(product)) rec.systems.push(product);
    return true;
  };
  for (const [product, { version }] of Object.entries(scope.products)) {
    const f = path.join(root, 'mappings', product, `${version}.mappings.json`);
    if (!fs.existsSync(f)) continue;
    const by = new Map<string, any[]>();
    for (const m of JSON.parse(fs.readFileSync(f, 'utf8')).mappings) if (m.concept.startsWith('dsi:concept/')) (by.get(m.token) ?? by.set(m.token, []).get(m.token)!).push(m);
    for (const [token, ms] of by) {
      const approved = ms.find((m) => m.status === 'approved');
      const agent = [...new Set(ms.filter((m) => m.provenance?.model).map((m) => m.concept as string))];
      if (approved) {
        const decider = approved.review?.by === 'kimgranlund' || approved.provenance?.method === 'human-review' ? 'owner' : String(approved.provenance?.method ?? 'rule').replace(/-v\d+$/, '');
        for (const other of agent.filter((c) => c !== approved.concept)) for (const [facet, x, y] of diffConcepts(approved.concept, other)) {
          const { flip, rec } = get(facet, x, y);
          if (!touch(rec, product, 'history', token)) continue;
          const side = flip ? rec.b : rec.a; // the side the approved concept is on
          side.won++;
          if (side.examples.length < 4) side.examples.push(`${product} ${token}`);
          rec.deciders[decider] = (rec.deciders[decider] ?? 0) + 1;
        }
      } else {
        const proposed = [...new Set(ms.filter((m) => m.status === 'proposed').map((m) => m.concept as string))];
        for (let i = 0; i < proposed.length; i++) for (let j = i + 1; j < proposed.length; j++) for (const [facet, x, y] of diffConcepts(proposed[i], proposed[j])) {
          const { rec } = get(facet, x, y);
          if (touch(rec, product, 'open', token) && rec.openTokens.length < 6) rec.openTokens.push(`${product} ${token}`);
        }
      }
    }
    const af = path.join(root, 'mappings', product, `${version}.audit.json`);
    if (fs.existsSync(af)) {
      const maps = new Map((JSON.parse(fs.readFileSync(f, 'utf8')).mappings as any[]).map((m) => [m.id, m]));
      for (const v of JSON.parse(fs.readFileSync(af, 'utf8')).verdicts) {
        if (v.verdict !== 'contradicted' || !v.suggested) continue;
        const m = maps.get(v.mappingId);
        const cur = m?.concept;
        if (!cur) continue;
        for (const [facet, x, y] of diffConcepts(cur, v.suggested.concept)) touch(get(facet, x, y).rec, product, 'audit', v.token);
      }
    }
  }
  if (jevRun) {
    const jf = path.join(root, '.cache/jev/results', `${jevRun}.json`);
    if (fs.existsSync(jf)) for (const x of JSON.parse(fs.readFileSync(jf, 'utf8')).scored) {
      if (x.correct || !['intent', 'usage', 'hue', 'property', 'emphasis', 'state'].includes(x.facet)) continue;
      const gold = (x.gold || 'none').split('+'), pred = x.pred || 'none';
      touch(get(x.facet, gold[0], pred).rec, x.product, 'jev', x.item);
    }
  }
  for (const b of pairs.values()) b.score = b.open * 3 + b.audit * 2 + b.history + b.jev * 0.5 + b.systems.length;
  return [...pairs.values()].sort((x, y) => y.score - x.score);
}
