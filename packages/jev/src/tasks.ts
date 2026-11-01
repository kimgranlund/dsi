import fs from 'node:fs';
import path from 'node:path';
import { conceptDefinition, conceptName, parseConcept, readLexicon, type Ontology, type ParsedConcept, type Word } from '@dsi/schema';
import { loadNative, resolve, showValue, type NativeSet } from '@dsi/resolve';
import type { Question } from './client.ts';

/** One token with a known answer: an approved exact/close color mapping. Owner-reviewed ones are the gold tier. */
export interface GoldItem { product: string; version: string; token: string; concept: string; facets: Record<string, string>; tier: 'owner' | 'rule'; method: string; alts?: string[]; baseline?: string }

export interface Experiment {
  name: string;
  hypothesis: string;
  model?: string;
  sample: { n: number; seed?: number; tier?: 'all' | 'owner' | 'rule'; products?: string[] };
  state: { kind: 'name' | 'name+desc' | 'full' | 'full+siblings'; format?: 'text' | 'json' };
  /** Post-processing on the answers, free to vary because responses are cached. */
  post?: { grammar?: boolean; noneBoost?: Record<string, number> };
  questions:
    | { kind: 'facets'; facets: string[]; criteria?: 'definition' | 'label'; instructions?: 'plain' | 'rich'; noneKey?: string }
    | { kind: 'two-stage'; facets: string[]; k: number; criteria?: 'definition' | 'label'; noneKey?: string; siblings?: boolean }
    | { kind: 'registry'; k: number }
    | { kind: 'owner-choice'; extra?: number }
    | { kind: 'noul' };
}

export const FACET_NONE: Record<string, string> = {
  intent: 'The token signals no particular intent (it is neutral or structural).',
  usage: 'The token is not limited to a particular place or context.',
  hue: 'The token is not a member of a categorical color set.',
  property: 'The token does not color one particular property.',
  emphasis: 'The token is not one step of a strength ladder.',
  state: 'The token is for the resting state, not an interaction state.',
};
const FACET_ASK: Record<string, string> = {
  intent: 'What the color signals to the user',
  usage: 'Where or in what context the color is used',
  hue: 'Which named hue the token is, when it belongs to a categorical color set',
  property: 'Which part of an element the token colors',
  emphasis: 'How strong the token is relative to the other members of its family',
  state: 'Which interaction state the token is for',
};

const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

export function loadGold(root: string, o: Ontology, scopeFile = 'packages/mapper/scopes/color-v1.json'): GoldItem[] {
  const scope = JSON.parse(fs.readFileSync(path.join(root, scopeFile), 'utf8')) as { products: Record<string, { version: string }> };
  const out: GoldItem[] = [];
  for (const [product, { version }] of Object.entries(scope.products)) {
    const f = path.join(root, 'mappings', product, `${version}.mappings.json`);
    if (!fs.existsSync(f)) continue;
    for (const m of JSON.parse(fs.readFileSync(f, 'utf8')).mappings) {
      if (m.status !== 'approved' || !['exact', 'close'].includes(m.match) || !m.concept.startsWith('dsi:concept/color/')) continue;
      const p = parseConcept(o, m.concept);
      if (typeof p === 'string') continue;
      const owner = m.provenance?.method === 'human-review' || m.review?.by === 'kimgranlund';
      out.push({ product, version, token: m.token, concept: m.concept, facets: p.facets as Record<string, string>, tier: owner ? 'owner' : 'rule', method: m.provenance?.method ?? '' });
    }
  }
  return out;
}

/**
 * Owner decisions with rejected alternatives on record: the tiebreak benchmark. `alts` are the rejected concepts;
 * `baseline` is what the agents would pick alone (most proposals, then highest confidence).
 */
export function loadOwnerChoices(root: string, o: Ontology, scopeFile = 'packages/mapper/scopes/color-v1.json'): GoldItem[] {
  const scope = JSON.parse(fs.readFileSync(path.join(root, scopeFile), 'utf8')) as { products: Record<string, { version: string }> };
  const out: GoldItem[] = [];
  for (const [product, { version }] of Object.entries(scope.products)) {
    const f = path.join(root, 'mappings', product, `${version}.mappings.json`);
    if (!fs.existsSync(f)) continue;
    const by = new Map<string, any[]>();
    for (const m of JSON.parse(fs.readFileSync(f, 'utf8')).mappings) (by.get(m.token) ?? by.set(m.token, []).get(m.token)!).push(m);
    for (const [token, ms] of by) {
      const ap = ms.find((m) => m.status === 'approved' && (m.review?.by === 'kimgranlund' || m.provenance?.method === 'human-review') && m.concept.startsWith('dsi:concept/color/'));
      if (!ap) continue;
      // Decisions applied by an owner rule (ramp rule, bolder -> stronger, migrations) are conventions, not per-token judgments.
      if (/rule|re-derived|Migrated/i.test(ap.review?.note ?? '')) continue;
      const alts = [...new Set(ms.filter((m) => (m.status === 'rejected' || m.status === 'superseded') && m.concept !== ap.concept && m.concept.startsWith('dsi:concept/color/') && typeof parseConcept(o, m.concept) !== 'string').map((m) => m.concept as string))];
      if (!alts.length) continue;
      const votes = new Map<string, { n: number; c: number }>();
      for (const m of ms.filter((m) => m.provenance?.model && m.concept.startsWith('dsi:concept/color/'))) { const v = votes.get(m.concept) ?? { n: 0, c: 0 }; v.n++; v.c = Math.max(v.c, m.confidence ?? 0); votes.set(m.concept, v); }
      const baseline = [...votes].sort((a, b) => b[1].n - a[1].n || b[1].c - a[1].c)[0]?.[0];
      const p = parseConcept(o, ap.concept);
      if (typeof p === 'string') continue;
      out.push({ product, version, token, concept: ap.concept, facets: p.facets as Record<string, string>, tier: 'owner', method: 'human-review', alts, baseline });
    }
  }
  return out;
}

/** A seeded sample, stratified by product so no one system dominates. */
export function sample(gold: GoldItem[], s: Experiment['sample']): GoldItem[] {
  const pool = gold.filter((g) => (!s.tier || s.tier === 'all' || g.tier === s.tier) && (!s.products || s.products.includes(g.product)));
  const r = rng(s.seed ?? 1);
  const by = new Map<string, GoldItem[]>();
  for (const g of pool) (by.get(g.product) ?? by.set(g.product, []).get(g.product)!).push(g);
  for (const xs of by.values()) for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; }
  const out: GoldItem[] = [];
  const lists = [...by.values()];
  for (let i = 0; out.length < Math.min(s.n, pool.length); i++) for (const xs of lists) if (xs[i] && out.length < s.n) out.push(xs[i]);
  return out;
}

export class Context {
  private sets = new Map<string, NativeSet>();
  lex: Map<string, Word>;
  private root: string; private o: Ontology; private gold: GoldItem[];
  constructor(root: string, o: Ontology, gold: GoldItem[]) { this.root = root; this.o = o; this.gold = gold; this.lex = readLexicon(root); }
  set(g: GoldItem) { return this.sets.get(g.product) ?? this.sets.set(g.product, loadNative(this.root, g.product, g.version)).get(g.product)!; }
  name(concept: string) { const p = parseConcept(this.o, concept); return typeof p === 'string' ? concept : conceptName(this.lex, p); }
  definition(concept: string) { const p = parseConcept(this.o, concept); return typeof p === 'string' ? '' : conceptDefinition(this.lex, p as ParsedConcept); }

  /** The state Jev sees for a token. Siblings carry their approved concept names (precedent), never the token's own. */
  state(g: GoldItem, kind: Experiment['state']['kind'], format: 'text' | 'json' = 'text'): unknown {
    const s = this.set(g);
    const t = s.tokens.get(g.token);
    const modes = s.themes.includes('light') && s.themes.includes('dark') ? ['light', 'dark'] : s.themes.slice(0, 2);
    const values = Object.fromEntries((modes.length ? modes : ['']).map((m) => { const r = resolve(s, m, g.token); return [m || 'all', r.value === undefined ? 'none' : showValue(r.type, r.value)]; }));
    const prefix = g.token.replace(/[.-][^.-]+$/, '');
    const siblings = kind === 'full+siblings' ? this.gold.filter((x) => x.product === g.product && x.token !== g.token && x.token.startsWith(prefix)).slice(0, 6).map((x) => ({ token: x.token, means: this.name(x.concept) })) : undefined;
    const obj: Record<string, unknown> = { system: g.product, token: g.token };
    if (kind !== 'name') { if (t?.description) obj.description = t.description; }
    if (kind === 'full' || kind === 'full+siblings') { const css = t?.prov?.nativeName; if (css && css !== g.token) obj.cssName = css; obj.valuesByMode = values; }
    if (siblings?.length) obj.siblings = siblings;
    if (format === 'json') return obj;
    return Object.entries(obj).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n');
  }

  /** Facet values allowed in color concepts, with the text Jev sees for each. */
  /** Facet values that registered color concepts actually use: the only sensible choices for a color token. */
  private used?: Map<string, Set<string>>;
  usedValues(facet: string): Set<string> {
    if (!this.used) {
      this.used = new Map();
      const reg = JSON.parse(fs.readFileSync(path.join(this.root, 'ontology/schemes/concepts.jsonld'), 'utf8'))['@graph'] as { id: string }[];
      for (const { id } of reg) {
        if (!id.startsWith('dsi:concept/color/')) continue;
        for (const seg of id.split('/').slice(2)) { const i = seg.indexOf('-'); const f = seg.slice(0, i); for (const v of seg.slice(i + 1).split('+')) (this.used.get(f) ?? this.used.set(f, new Set()).get(f)!).add(v); }
      }
    }
    return this.used.get(facet) ?? new Set();
  }

  criteria(facet: string, style: 'definition' | 'label' = 'definition', noneKey = 'none'): Record<string, string> {
    const out: Record<string, string> = {};
    const allowed = this.usedValues(facet);
    for (const [iri, w] of this.lex) {
      if (!iri.startsWith(`dsi:${facet}/`) || iri.includes('/scheme/')) continue;
      if (!allowed.has(iri.split('/').pop()!)) continue;
      if (facet === 'emphasis' && iri.endsWith('/default')) continue; // ADR 0019: never bound
      out[iri.split('/').pop()!] = style === 'label' ? w.label : `${w.label}: ${w.definition ?? w.label}`;
    }
    out[noneKey] = FACET_NONE[facet] ?? 'Not specific to this facet.';
    return out;
  }

  facetQuestions(facets: string[], style: 'definition' | 'label' = 'definition', instructions: 'plain' | 'rich' = 'plain', noneKey = 'none'): Record<string, Question> {
    return Object.fromEntries(facets.map((f) => [f, { type: 'choice' as const, instructions: instructions === 'rich' ? `${FACET_ASK[f]}. This is a design-system color token; answer from its name, description and values. Pick ${noneKey} when the token is not specific to this dimension.` : FACET_ASK[f], criteria: this.criteria(f, style, noneKey) }]));
  }

  /** k registered candidates: the gold concept plus the k-1 registered concepts sharing the most facet values. */
  candidates(g: GoldItem, k: number, registry: string[]): string[] {
    const atoms = (c: string) => new Set(c.split('/').slice(2));
    const mine = atoms(g.concept);
    const near = registry.filter((c) => c !== g.concept && c.startsWith('dsi:concept/color/')).map((c) => ({ c, s: [...atoms(c)].filter((a) => mine.has(a)).length - 0.01 * Math.abs(atoms(c).size - mine.size) })).sort((a, b) => b.s - a.s || a.c.localeCompare(b.c)).slice(0, k - 1).map((x) => x.c);
    const all = [g.concept, ...near];
    const r = rng(g.token.length * 7919 + k);
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
    return all;
  }

  /** Approved concepts of the token's family (same prefix), its own excluded: precedent candidates. */
  familyConcepts(g: GoldItem): string[] {
    const prefix = g.token.replace(/[.-][^.-]+$/, '');
    return [...new Set(this.gold.filter((x) => x.product === g.product && x.token !== g.token && x.token.startsWith(prefix)).map((x) => x.concept))];
  }

  /** Rank registered color concepts by the facet probabilities: product of p(value) for bound facets, p(none) for unbound. */
  rankByFacets(probs: Record<string, Record<string, number>>, registry: string[], noneKey = 'none'): string[] {
    const eps = 1e-3;
    const scored = registry.filter((c) => c.startsWith('dsi:concept/color/')).map((c) => {
      const bound = new Map<string, string[]>();
      for (const seg of c.split('/').slice(2)) { const i = seg.indexOf('-'); bound.set(seg.slice(0, i), seg.slice(i + 1).split('+')); }
      let lp = 0;
      for (const [f, p] of Object.entries(probs)) { const vs = bound.get(f); lp += vs ? Math.max(...vs.map((v) => Math.log((p[v] ?? 0) + eps))) : Math.log((p[noneKey] ?? 0) + eps); }
      return { c, lp };
    });
    return scored.sort((a, b) => b.lp - a.lp).map((x) => x.c);
  }
}

