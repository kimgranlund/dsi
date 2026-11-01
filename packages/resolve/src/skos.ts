import fs from 'node:fs';
import path from 'node:path';
import { parseConcept, type Ontology } from '@dsi/schema';
import type { NativeSet } from './native.ts';

const MATCH_PROP: Record<string, string> = { exact: 'skos:exactMatch', close: 'skos:closeMatch', broad: 'skos:broadMatch', narrow: 'skos:narrowMatch', related: 'skos:relatedMatch' };
const seg = (s: string) => s.replace(/[^A-Za-z0-9._~+-]/g, (c) => encodeURIComponent(c));

export const nativeIri = (product: string, version: string, token: string) => `dsi:native/${product}/${version}/${seg(token)}`;
export const termIri = (product: string, term: string) => `dsi:vocab/${product}/${seg(term)}`;

/** prefLabels of facet values, read from the ontology source (for readable compositional concept labels). */
export function facetLabels(root: string): Map<string, string> {
  const g = JSON.parse(fs.readFileSync(path.join(root, 'ontology/schemes/facets.jsonld'), 'utf8'))['@graph'] as { id: string; prefLabel?: string }[];
  return new Map(g.filter((c) => c.prefLabel).map((c) => [c.id, c.prefLabel!]));
}

interface Inputs {
  set: NativeSet;
  mappings: { token: string; concept: string; match: string; status: string }[];
  noEquivalent: { concept: string; status: string }[];
  terms: { term: string; concept: string; match: string; status: string }[];
  productName: string;
}

/**
 * The SKOS view of one product version, as JSON-LD over ontology/context.jsonld:
 *   - dsi:scheme/native/<product>/<version>: every native token as a skos:Concept (prefLabel = DTCG path, notation = native name)
 *   - dsi:scheme/vocab/<product>: every approved naming term as a skos:Concept
 *   - compositional canonical concepts used by approved mappings, in dsi:scheme/canonical, with their facet bindings
 *   - approved token and term mappings as SKOS mapping properties (subject native, object canonical)
 * Only Approved records are exported. Generated, never edited: rebuild with `dsi-skos`.
 */
export function skosGraph(o: Ontology, labels: Map<string, string>, x: Inputs): Record<string, unknown> {
  const { set } = x;
  const nativeScheme = `dsi:scheme/native/${set.product}/${set.version}`;
  const vocabScheme = `dsi:scheme/vocab/${set.product}`;
  const graph: Record<string, unknown>[] = [
    { id: nativeScheme, type: 'ConceptScheme', prefLabel: `${x.productName} ${set.version} tokens`, definition: `Design tokens as shipped by ${x.productName} ${set.version}, under their native names.` },
    { id: vocabScheme, type: 'ConceptScheme', prefLabel: `${x.productName} naming vocabulary`, definition: `Words ${x.productName} builds its token names from, mapped to DesignSystemsIndex facet values.` },
  ];
  const approved = x.mappings.filter((m) => m.status === 'approved');
  const byToken = new Map<string, typeof approved>();
  for (const m of approved) (byToken.get(m.token) ?? byToken.set(m.token, []).get(m.token)!).push(m);
  for (const [p, t] of [...set.tokens].sort(([a], [b]) => a.localeCompare(b))) {
    const node: Record<string, unknown> = { id: nativeIri(set.product, set.version, p), type: 'Concept', inScheme: nativeScheme, prefLabel: p, notation: String(t.prov.nativeName) };
    if (t.description) node.definition = t.description;
    for (const m of byToken.get(p) ?? []) (node[MATCH_PROP[m.match]] ??= [] as unknown[]) && (node[MATCH_PROP[m.match]] as unknown[]).push({ id: m.concept });
    graph.push(node);
  }
  for (const t of x.terms.filter((t) => t.status === 'approved')) {
    const id = termIri(set.product, t.term);
    let node = graph.find((n) => n.id === id);
    if (!node) { node = { id, type: 'Concept', inScheme: vocabScheme, prefLabel: t.term }; graph.push(node); }
    ((node[MATCH_PROP[t.match]] ??= []) as unknown[]).push({ id: t.concept });
  }
  const compositional = new Set(approved.map((m) => m.concept).filter((c) => c.startsWith('dsi:concept/')));
  for (const c of [...compositional].sort()) {
    const p = parseConcept(o, c);
    if (typeof p === 'string') continue;
    const node: Record<string, unknown> = { id: c, type: 'Concept', inScheme: `dsi:scheme/canonical/${p.domain}` };
    const parts: string[] = [];
    for (const [f, v] of Object.entries(p.facets)) {
      const vals = String(v).split('+');
      parts.push(vals.map((val) => labels.get(`dsi:${f}/${val}`) ?? val).join(' + '));
      const prop = `dsi:has${f[0].toUpperCase()}${f.slice(1)}`;
      node[prop] = vals.map((val) => ({ id: `dsi:${f}/${val}` }));
    }
    node.prefLabel = `${labels.get(`dsi:domain/${p.domain}`) ?? p.domain}: ${parts.join(' · ')}`;
    graph.push(node);
  }
  for (const n of x.noEquivalent.filter((n) => n.status === 'approved')) graph.push({ id: nativeScheme, 'dsi:noEquivalent': { id: n.concept } });
  return { '@context': '../../../ontology/context.jsonld', '@graph': graph };
}
