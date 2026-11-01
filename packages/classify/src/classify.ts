import { CONCEPT_FACETS } from '@dsi/schema';

export type Facet = 'intent' | 'usage' | 'property' | 'emphasis' | 'state';
export const FACETS: Facet[] = CONCEPT_FACETS.filter((f): f is Facet => f !== 'component' && f !== 'part');
const MULTI = new Set<Facet>(['usage', 'state']);
const MAX_GRAM = 4;

/** A native naming word mapped (SKOS) to a facet-value concept, e.g. { term: "critical", concept: "dsi:intent/danger", match: "exact" }. */
export interface Term { term: string; concept: string; match: string; status: string; evidence?: { support: number; agree: number; precision: number }; provenance: { agent: string; model?: string; at: string; method?: string }; review?: { by: string; at: string; note?: string }; note?: string }

/** Facet and value of a facet-value concept IRI (dsi:intent/danger -> intent, danger). */
export function facetValue(concept: string): { facet: Facet; value: string } | undefined {
  const m = concept.match(/^dsi:([a-z]+)\/([a-z0-9-]+)$/);
  return m && (FACETS as string[]).includes(m[1]) ? { facet: m[1] as Facet, value: m[2] } : undefined;
}
export interface TermsFile { product: string; noise?: string[]; scopes?: { pathPrefix?: string; file?: string; scope: string }[]; terms: Term[] }

/** Split a token path into lowercase words: on '.', '-', '_' and camelCase boundaries. */
export function words(path: string): string[] {
  return path.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().split(/[.\-_]+/).filter(Boolean);
}

export interface Classification {
  token: string;
  scope: string;
  /** Facet values the name implies, with the term that set each. */
  facets: Partial<Record<Facet, string>>;
  matchedTerms: string[];
  /** Words no term or noise entry explains. */
  unknown: string[];
  conflicts: string[];
  /** Candidate compositional concept, when any facet was found. */
  concept?: string;
  /** Share of meaningful words explained by terms: 1 = fully explained. */
  explained: number;
}

export function scopeOf(t: TermsFile, path: string, file: string): string {
  for (const r of t.scopes ?? []) if ((!r.pathPrefix || path.startsWith(r.pathPrefix)) && (!r.file || file.endsWith(r.file))) return r.scope;
  return 'other';
}

/** Build the concept IRI for a set of facet values (fixed order, multi-values sorted). */
export function conceptOf(domain: string, facets: Partial<Record<Facet, string>>): string | undefined {
  const segs = FACETS.filter((f) => facets[f]).map((f) => `${f}-${facets[f]!.split('+').sort().join('+')}`);
  return segs.length ? `dsi:concept/${domain}/${segs.join('/')}` : undefined;
}

/**
 * Decompose a token name with a product's term mappings, longest term first. `statuses` picks which terms count
 * (approved only for votes; approved and proposed for hints).
 */
export function classify(t: TermsFile, token: string, file: string, domain: string, statuses = new Set(['approved'])): Classification {
  const noise = new Set(t.noise ?? []);
  type Bound = { term: string; facet: Facet; value: string };
  const terms = new Map<string, Bound>();
  for (const x of t.terms) {
    const fv = statuses.has(x.status) ? facetValue(x.concept) : undefined;
    if (fv && x.match !== 'related') terms.set(`${x.term}|${fv.facet}`, { term: x.term, ...fv });
  }
  const byTerm = new Map<string, Bound[]>();
  for (const x of terms.values()) (byTerm.get(x.term) ?? byTerm.set(x.term, []).get(x.term)!).push(x);

  // Every term found anywhere in the name contributes, not a greedy segmentation (which lets a two-word term
  // swallow a word that a one-word term explains). Per facet, the longest term wins; equal-length disagreement on
  // a single-valued facet is a conflict, on usage/state the values combine.
  const w = words(token).filter((x) => !noise.has(x));
  const facets: Partial<Record<Facet, string>> = {};
  const len: Partial<Record<Facet, number>> = {};
  const matchedTerms: string[] = [], conflicts: string[] = [];
  const covered = new Array(w.length).fill(false);
  for (let n = Math.min(MAX_GRAM, w.length); n >= 1; n--) {
    for (let i = 0; i + n <= w.length; i++) {
      const ts = byTerm.get(w.slice(i, i + n).join('-'));
      if (!ts) continue;
      matchedTerms.push(ts[0].term);
      for (let k = i; k < i + n; k++) covered[k] = true;
      for (const x of ts) {
        const cur = facets[x.facet];
        if (cur === undefined) { facets[x.facet] = x.value; len[x.facet] = n; }
        else if (cur.split('+').includes(x.value)) continue;
        else if (len[x.facet]! > n) continue;
        else if (MULTI.has(x.facet)) facets[x.facet] = [...new Set([...cur.split('+'), x.value])].sort().join('+');
        else conflicts.push(`${x.facet}: ${cur} vs ${x.value} (${x.term})`);
      }
    }
  }
  const meaningfulIdx = w.map((x, i) => (/^\d+$/.test(x) ? -1 : i)).filter((i) => i >= 0);
  const unknown = meaningfulIdx.filter((i) => !covered[i]).map((i) => w[i]);
  const meaningful = meaningfulIdx.length, explainedWords = meaningfulIdx.filter((i) => covered[i]).length;
  return { token, scope: scopeOf(t, token, file), facets, matchedTerms, unknown, conflicts, concept: conflicts.length ? undefined : conceptOf(domain, facets), explained: meaningful ? explainedWords / meaningful : 1 };
}
