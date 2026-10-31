import { inScheme, type Ontology } from './ontology.ts';

/** Fixed facet order of compositional concept IRIs. component and part are reserved until their vocabularies exist. */
export const CONCEPT_FACETS = ['intent', 'usage', 'component', 'part', 'property', 'emphasis', 'state'] as const;
const RESERVED = new Set(['component', 'part']);

export interface ParsedConcept { domain: string; facets: Partial<Record<(typeof CONCEPT_FACETS)[number], string>> }

/**
 * Parse and check `dsi:concept/<domain>/<facet>-<value>...`. Returns the parse, or the reason it is invalid.
 * Values are checked against dsi:scheme/<facet>; order and uniqueness are enforced so one meaning has one IRI.
 */
export function parseConcept(o: Ontology, ref: string): ParsedConcept | string {
  const m = ref.match(/^dsi:concept\/([a-z0-9-]+)((?:\/[a-z0-9-]+)*)$/);
  if (!m) return 'not a dsi:concept/<domain>/<facet>-<value> IRI';
  const domain = m[1];
  if (!inScheme(o, `dsi:domain/${domain}`, 'dsi:scheme/domain')) return `domain "${domain}" is not in dsi:scheme/domain`;
  const segs = m[2].split('/').filter(Boolean);
  if (!segs.length) return 'needs at least one facet segment';
  const facets: ParsedConcept['facets'] = {};
  let last = -1;
  for (const seg of segs) {
    const facet = CONCEPT_FACETS.find((f) => seg.startsWith(f + '-'));
    if (!facet) return `segment "${seg}" does not start with a facet (${CONCEPT_FACETS.join(', ')})`;
    if (RESERVED.has(facet)) return `facet "${facet}" is reserved until its vocabulary exists`;
    const i = CONCEPT_FACETS.indexOf(facet);
    if (i <= last) return `segment "${seg}" is out of order; facet order is ${CONCEPT_FACETS.join(', ')}`;
    last = i;
    const value = seg.slice(facet.length + 1);
    if (!inScheme(o, `dsi:${facet}/${value}`, `dsi:scheme/${facet}`)) return `${facet} "${value}" is not in dsi:scheme/${facet}`;
    facets[facet] = value;
  }
  return { domain, facets };
}
