import { expand, inScheme, type Ontology } from './ontology.ts';

/** Fixed facet order of compositional concept IRIs. */
export const CONCEPT_FACETS = ['intent', 'usage', 'syntax', 'component', 'part', 'property', 'style', 'emphasis', 'brightness', 'state'] as const;
/** Facets that may combine values with '+', sorted alphabetically so one combination has one IRI. */
export const MULTI_VALUED = new Set(['usage', 'state']);

export interface ParsedConcept { domain: string; facets: Partial<Record<(typeof CONCEPT_FACETS)[number], string>> }

/**
 * Parse and check `dsi:concept/<domain>/<facet>-<value>...`. Returns the parse, or the reason it is invalid.
 * Values are checked against dsi:scheme/<facet>; order and uniqueness are enforced so one meaning has one IRI.
 */
export function parseConcept(o: Ontology, ref: string): ParsedConcept | string {
  const m = ref.match(/^dsi:concept\/([a-z0-9-]+)((?:\/[a-z0-9+-]+)*)$/);
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
    const i = CONCEPT_FACETS.indexOf(facet);
    if (i <= last) return `segment "${seg}" is out of order; facet order is ${CONCEPT_FACETS.join(', ')}`;
    last = i;
    const value = seg.slice(facet.length + 1);
    const parts = value.split('+');
    if (parts.length > 1) {
      if (!MULTI_VALUED.has(facet)) return `facet "${facet}" takes one value; only ${[...MULTI_VALUED].join(' and ')} combine with +`;
      if (parts.join('+') !== [...new Set(parts)].sort().join('+')) return `${facet} values "${value}" must be distinct and sorted alphabetically`;
    }
    for (const v of parts) {
      if (!inScheme(o, `dsi:${facet}/${v}`, `dsi:scheme/${facet}`)) return `${facet} "${v}" is not in dsi:scheme/${facet}`;
      if (o.deprecated.has(expand(`dsi:${facet}/${v}`))) return `${facet} "${v}" is deprecated`;
    }
    facets[facet] = value;
  }
  if (facets.part && !facets.component) return 'part needs a component';
  return { domain, facets };
}

/**
 * Canonical token name of a parsed concept: facet values in facet order joined by '-'. Syntax values are prefixed
 * "code-" because Lezer tag names (link, strong, emphasis) would otherwise collide with other facets' values.
 */
export function canonicalNameOf(p: ParsedConcept): string {
  return Object.entries(p.facets).map(([f, v]) => (f === 'syntax' ? `code-${v}` : String(v))).join('-');
}
