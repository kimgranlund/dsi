import { parseConcept, type Ontology } from '@dsi/schema';
import { classify, conceptOf, type Facet, type TermsFile } from './classify.ts';

/** DTCG types each role accepts. A role whose type does not fit is a leftover, never auto-mapped. */
export const ROLE_TYPES: Record<string, string[]> = {
  spacing: ['dimension'], 'corner-radius': ['dimension', ''], 'border-width': ['dimension'], height: ['dimension'], width: ['dimension'], size: ['dimension'], 'icon-size': ['dimension'],
  'container-width': ['dimension'], breakpoint: ['dimension'], 'z-index': ['number', 'keyword'], 'elevation-level': ['number', 'dimension'], opacity: ['number'], shadow: ['shadow', 'keyword', ''],
  'font-family': ['fontFamily'], 'font-weight': ['fontWeight', 'number'], 'font-size': ['dimension'], 'line-height': ['dimension', 'number'], 'letter-spacing': ['dimension'],
  duration: ['duration'], easing: ['cubicBezier'], 'spring-stiffness': ['number'], 'spring-damping': ['number'], 'corner-shape': [''], 'corner-radius-percent': [''], transition: ['transition'], keyframes: [''],
};

export interface ScaleResult { mapped: { token: string; concept: string }[]; leftovers: { token: string; why: string }[] }

/**
 * Map non-color foundation tokens to role concepts deterministically: the approved terms explain the whole name
 * (step words count as explained), they bind a property whose ontology domain gives the concept's domain, and the
 * token's DTCG type fits the role. Everything else is a leftover with the reason.
 */
export function mapScales(o: Ontology, terms: TermsFile, tokens: { path: string; file: string; type?: string; value?: string }[], domainOfProperty: Map<string, string>): ScaleResult {
  const out: ScaleResult = { mapped: [], leftovers: [] };
  for (const t of tokens) {
    const c = classify(terms, t.path, t.file, 'color');
    // A corner token whose value is four radii (untyped: DTCG has no four-corner type) is a Corner shape.
    if (c.facets.property === 'corner-radius' && !t.type && (t.value ?? '').trim().split(/\s+/).length === 4) c.facets.property = 'corner-shape';
    // A bare scale role carries no emphasis or intent (ADR 0013: steps stay native): bold, default and brand in
    // font.weight.bold, border.width.default, font.family.brand pick a step. Emphasis stays meaningful on a type
    // style (label prominent) or a component variant (button primary), and intent only on a component variant.
    if (!c.facets.component) delete c.facets.intent;
    if (!c.facets.component && !c.facets.usage) delete c.facets.emphasis;
    const prop = c.facets.property;
    if (!prop) { out.leftovers.push({ token: t.path, why: c.unknown.length ? `unexplained words: ${c.unknown.join(', ')}` : 'no role term in the name' }); continue; }
    if (c.unknown.length) { out.leftovers.push({ token: t.path, why: `unexplained words: ${c.unknown.join(', ')}` }); continue; }
    if (c.conflicts.length) { out.leftovers.push({ token: t.path, why: `conflicting terms: ${c.conflicts.join('; ')}` }); continue; }
    const domain = domainOfProperty.get(prop);
    if (!domain) { out.leftovers.push({ token: t.path, why: `property ${prop} has no domain` }); continue; }
    if (!(ROLE_TYPES[prop] ?? []).includes(t.type ?? '')) { out.leftovers.push({ token: t.path, why: `type ${t.type ?? 'untyped'} does not fit ${prop}` }); continue; }
    const facets = { ...c.facets } as Partial<Record<Facet, string>>;
    const concept = conceptOf(domain, facets);
    if (!concept || typeof parseConcept(o, concept) === 'string') { out.leftovers.push({ token: t.path, why: `invalid concept ${concept}` }); continue; }
    out.mapped.push({ token: t.path, concept });
  }
  return out;
}
