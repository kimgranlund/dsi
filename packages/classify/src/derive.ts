import { parseConcept, type Ontology } from '@dsi/schema';
import { words, facetValue, FACETS, type Facet, type Term, type TermsFile } from './classify.ts';

export interface ApprovedMapping { token: string; concept: string; match: string }

/** Facet values of a concept as `facet:value` strings (multi-values split). */
export function conceptFacets(o: Ontology, concept: string): Set<string> {
  const p = parseConcept(o, concept);
  if (typeof p === 'string') return new Set();
  return new Set(Object.entries(p.facets).filter(([f]) => (FACETS as string[]).includes(f)).flatMap(([f, v]) => String(v).split('+').map((x) => `${f}:${x}`)));
}

/**
 * Learn candidate terms from approved exact/close token mappings. For every 1..3-word n-gram in token names,
 * count how many approved tokens contain it (support) and how many of those bind each facet value (agree).
 * Keep the best value per (n-gram, facet) with support >= minSupport and precision >= minPrecision, and drop an
 * n-gram that adds nothing over a shorter n-gram inside it. Results are Proposed, with their evidence.
 */
export function deriveTerms(o: Ontology, product: string, mappings: ApprovedMapping[], noise: string[], opts = { minSupport: 2, minPrecision: 0.9 }, at = new Date().toISOString()): Term[] {
  const noiseSet = new Set(noise);
  const support = new Map<string, number>();
  const agree = new Map<string, number>();
  for (const m of mappings) {
    if (m.match !== 'exact' && m.match !== 'close') continue;
    const fs = conceptFacets(o, m.concept);
    const w = words(m.token).filter((x) => !noiseSet.has(x) && !/^\d+$/.test(x));
    const grams = new Set<string>();
    for (let i = 0; i < w.length; i++) for (let n = 1; n <= 3 && i + n <= w.length; n++) grams.add(w.slice(i, i + n).join('-'));
    for (const g of grams) {
      support.set(g, (support.get(g) ?? 0) + 1);
      for (const f of fs) agree.set(`${g}|${f}`, (agree.get(`${g}|${f}`) ?? 0) + 1);
    }
  }
  const best = new Map<string, { facet: Facet; value: string; agree: number; support: number }>();
  for (const [k, a] of agree) {
    const [g, fv] = k.split('|');
    const [facet, value] = fv.split(':') as [Facet, string];
    const s = support.get(g)!;
    if (s < opts.minSupport || a / s < opts.minPrecision) continue;
    const key = `${g}|${facet}`;
    const cur = best.get(key);
    if (!cur || a > cur.agree) best.set(key, { facet, value, agree: a, support: s });
  }
  // An n-gram earns its place only if it binds something none of its shorter parts already bind.
  const out: Term[] = [];
  for (const [key, b] of [...best].sort(([x], [y]) => x.localeCompare(y))) {
    const g = key.split('|')[0];
    const parts = g.split('-');
    if (parts.length > 1) {
      const sub = new Set<string>();
      for (let i = 0; i < parts.length; i++) for (let n = 1; n < parts.length && i + n <= parts.length; n++) sub.add(parts.slice(i, i + n).join('-'));
      if ([...sub].some((s) => best.get(`${s}|${b.facet}`)?.value === b.value)) continue;
    }
    out.push({ term: g, concept: `dsi:${b.facet}/${b.value}`, match: 'exact', status: 'proposed', evidence: { support: b.support, agree: b.agree, precision: Math.round((b.agree / b.support) * 1000) / 1000 }, provenance: { agent: 'dsi-classify', at, method: 'derive-from-approved-mappings' } } as Term);
  }
  return out;
}

/** Merge newly derived terms into a terms file: never touch approved or rejected terms; refresh proposed ones. */
export function mergeTerms(file: TermsFile, derived: Term[]): TermsFile {
  const fk = (t: Term) => `${t.term}|${facetValue(t.concept)?.facet}`;
  const keep = file.terms.filter((t) => t.status !== 'proposed' || t.provenance.method !== 'derive-from-approved-mappings');
  const settled = new Set(keep.filter((t) => t.status !== 'proposed').map((t) => `${t.term}|${t.concept}`));
  const settledKey = new Set(keep.filter((t) => t.status === 'approved').map(fk));
  const fresh = derived.filter((t) => !settled.has(`${t.term}|${t.concept}`) && !settledKey.has(fk(t)));
  return { ...file, terms: [...keep, ...fresh].sort((a, b) => a.term.localeCompare(b.term) || a.concept.localeCompare(b.concept)) };
}
