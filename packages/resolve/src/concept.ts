import fs from 'node:fs';
import path from 'node:path';
import { parseConcept, type Ontology } from '@dsi/schema';
import { resolve, showValue, themeFor, type NativeSet } from './native.ts';

export type MatchType = 'exact' | 'close' | 'broad' | 'narrow' | 'related';

export interface Mapping { id: string; token: string; concept: string; match: MatchType; confidence: number; status: string }
export interface MappingSet { mappings: Mapping[]; noEquivalent: { concept: string; status: string }[] }

export const readMappingSet = (root: string, product: string, version: string): MappingSet => {
  const p = path.join(root, 'mappings', product, `${version}.mappings.json`);
  const m = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  return { mappings: m.mappings ?? [], noEquivalent: m.noEquivalent ?? [] };
};

/**
 * How a product answers a concept:
 *   match    an approved exact or close mapping to this concept
 *   nearest  only broad or narrow mappings to this concept, or exact/close mappings to a strictly more specific
 *            concept (same facets plus more); always flagged, never presented as equal
 *   absent   an approved noEquivalent record says the product has no such token
 *   unknown  nothing approved either way
 * Related mappings never answer. Only Approved records count. No value is ever invented.
 */
export type Status = 'match' | 'nearest' | 'absent' | 'unknown';

export interface Candidate {
  token: string;
  match: MatchType;
  /** 'direct' maps to the asked concept; 'more-specific' maps to a concept that adds facets to it. */
  via: 'direct' | 'less-specific' | 'more-specific';
  concept: string;
  confidence: number;
  theme: string;
  chain: string[];
  type?: string;
  value?: unknown;
  display: string;
  /** For more-specific answers: how many facet values the answering concept adds, and whether one is a state. */
  extra?: number;
  addsState?: boolean;
}

export interface ConceptAnswer { product: string; version: string; concept: string; mode?: string; theme?: string; status: Status; answer?: Candidate; candidates: Candidate[]; note?: string }

const RANK: Record<MatchType, number> = { exact: 0, close: 1, broad: 2, narrow: 2, related: 9 };

/** Facet set of a compositional concept, as "facet-value" strings (multi-values split). */
function facetSet(o: Ontology, concept: string): Set<string> | undefined {
  const p = parseConcept(o, concept);
  if (typeof p === 'string') return undefined;
  return new Set(Object.entries(p.facets).flatMap(([f, v]) => String(v).split('+').map((x) => `${p.domain}:${f}-${x}`)).concat(`${p.domain}:domain`));
}

export function resolveConcept(o: Ontology, set: NativeSet, maps: MappingSet, concept: string, mode?: string): ConceptAnswer {
  const base = { product: set.product, version: set.version, concept, mode };
  const theme = themeFor(set, mode);
  if (theme === undefined) return { ...base, status: 'unknown', candidates: [], note: `no theme is declared for mode "${mode}"` };
  const want = facetSet(o, concept);
  const approved = maps.mappings.filter((m) => m.status === 'approved' && m.match !== 'related');
  const cands: Candidate[] = [];
  for (const m of approved) {
    let via: Candidate['via'] | undefined;
    let extra: number | undefined, addsState: boolean | undefined;
    if (m.concept === concept) via = 'direct';
    else if (want) {
      const have = facetSet(o, m.concept);
      if (have && (m.match === 'exact' || m.match === 'close') && have.size > want.size && [...want].every((f) => have.has(f))) {
        const added = [...have].filter((f) => !want.has(f));
        // A state variant (hover, selected, visited) never answers a stateless concept: a hovered surface is not a surface.
        if (added.some((f) => /:state-/.test(f))) continue;
        via = 'more-specific';
        extra = added.length;
        addsState = false;
      } else if (have && (m.match === 'exact' || m.match === 'close' || m.match === 'narrow') && have.size < want.size && [...have].every((f) => want.has(f)) && [...have].some((f) => !f.endsWith(':domain')) && [...want].filter((f) => !have.has(f)).every((f) => /:property-/.test(f))) {
        // A broader concept answers when only the property is unbound (Material primary = Accent answers Accent
        // background): the token is that meaning's color for any property. Never across usage, emphasis or state.
        via = 'less-specific';
        extra = want.size - have.size;
      }
    }
    if (!via) continue;
    const r = resolve(set, theme, m.token);
    if (r.value === undefined) continue; // no value in this theme: not an answer
    cands.push({ token: m.token, match: m.match, via, concept: m.concept, confidence: m.confidence, theme, chain: r.chain, type: r.type, value: r.value, display: showValue(r.type, r.value), extra, addsState });
  }
  // Direct answers first, then a broader concept the token covers (fewest missing facets), then a narrower one
  // (fewest added facets, never an added state). Never an alphabetical accident.
  const VIA = { direct: 0, 'less-specific': 1, 'more-specific': 2 } as const;
  cands.sort((a, b) => VIA[a.via] - VIA[b.via] || Number(a.addsState ?? false) - Number(b.addsState ?? false) || (a.extra ?? 0) - (b.extra ?? 0) || RANK[a.match] - RANK[b.match] || b.confidence - a.confidence || a.token.localeCompare(b.token));
  const top = cands[0];
  const t = theme || undefined;
  if (top && top.via === 'direct' && RANK[top.match] <= 1) return { ...base, theme: t, status: 'match', answer: top, candidates: cands };
  if (top) return { ...base, theme: t, status: 'nearest', answer: top, candidates: cands, note: top.via === 'more-specific' ? `no direct mapping; ${top.token} maps to the more specific ${top.concept}` : top.via === 'less-specific' ? `no direct mapping; ${top.token} maps to the broader ${top.concept}` : `only a ${top.match} match` };
  if (maps.noEquivalent.some((n) => n.status === 'approved' && n.concept === concept)) return { ...base, theme: t, status: 'absent', candidates: [] };
  return { ...base, theme: t, status: 'unknown', candidates: [] };
}
