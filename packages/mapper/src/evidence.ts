import { DSI, parseConcept, type Ontology } from '@dsi/schema';
import { resolve } from '@dsi/resolve';
import { classify, type TermsFile } from '@dsi/classify';
import { BoundaryTests, facetsOf } from './boundary-rules.ts';
import { agrees, evidenceOf, loadUsage } from './usage-evidence.ts';
import { INTENT_HUES, hsl, inRanges, rgbOf } from './audit.ts';

/**
 * Structured mapping evidence (docs/planning/spec-alignment.md, L3): for each approved mapping, what the shipped
 * facts say about each facet it binds, as {test, field, observed, expected, agrees, weight}. Every record comes from
 * a deterministic test over shipped data: the usage graph, contrast ladders (B1), the boundary tests B3, B4 and B6,
 * hue against intent, and the approved naming terms. A test that cannot decide writes no record; missing evidence
 * is not disagreement. Output is generated (data/evidence/), stamped with the registry and resolver versions.
 */
export interface Record_ { test: string; field: string; observed: string; expected: string; agrees: boolean; weight?: number }
export interface MappingEvidence { mapping: string; token: string; concept: string; match: string; records: Record_[] }

/** Facet values broader than `value` (transitively), as plain slugs. */
function ancestors(o: Ontology, facet: string, value: string): Set<string> {
  const base = `${DSI}${facet}/`;
  const out = new Set<string>();
  const walk = (iri: string) => { for (const b of o.broader.get(iri) ?? []) if (b.startsWith(base) && !out.has(b.slice(base.length))) { out.add(b.slice(base.length)); walk(b); } };
  walk(base + value);
  return out;
}

export function buildEvidence(root: string, o: Ontology, product: string, version: string, mappings: any[], terms?: TermsFile): MappingEvidence[] {
  const approved = mappings.filter((m) => m.status === 'approved' && m.concept.startsWith('dsi:concept/color/'));
  const pageTok = approved.find((m) => m.concept === 'dsi:concept/color/usage-page/property-background')?.token;
  const t = new BoundaryTests(root, product, version, pageTok);
  const usage = loadUsage(root, product, version);
  const out: MappingEvidence[] = [];
  for (const m of approved) {
    const f = facetsOf(m.concept);
    const has = (k: string, v: string) => (f.get(k) ?? []).includes(v);
    const recs: Record_[] = [];
    const prop = f.get('property')?.[0];
    // Usage graph: the system's own component CSS (decisive only at a 70% majority; agrees() returns undefined otherwise).
    const uses = usage?.get(m.token);
    if (uses?.length) {
      const e = evidenceOf(uses);
      const a = agrees(e, m.concept);
      if (a.property !== undefined) recs.push({ test: 'usage', field: 'property', observed: `${e.property} (${Math.round(e.propertyShare * 100)}% of ${e.uses} uses)`, expected: prop ?? '(unbound)', agrees: a.property, weight: Math.round(e.propertyShare * 100) / 100 });
      if (a.state !== undefined) recs.push({ test: 'usage', field: 'state', observed: `${e.state ?? 'resting'} (${Math.round(e.stateShare * 100)}% of ${e.uses} uses)`, expected: (f.get('state') ?? ['resting']).join('+'), agrees: a.state, weight: Math.round(e.stateShare * 100) / 100 });
      if (a.container !== undefined) recs.push({ test: 'usage', field: 'usage', observed: `paints ${e.container} containers`, expected: (f.get('usage') ?? ['(unbound)']).join('+'), agrees: a.container });
    }
    // B1: emphasis binds only in a contrast-ordered ladder. A numbered ladder without emphasis is native (ADR 0025),
    // so only a bound emphasis is tested.
    if (f.has('emphasis') && !has('usage', 'categorical')) {
      const l = t.ladder(m.token);
      recs.push({ test: 'B1', field: 'emphasis', observed: l.bound ? `contrast-ordered ladder of ${l.members.length} in every mode` : 'no contrast-ordered ladder', expected: f.get('emphasis')!.join('+'), agrees: l.bound });
    }
    // B3: surface needs a page sibling it differs from in some mode (the test only refutes).
    if (has('usage', 'surface') && ['background', 'fill'].includes(prop ?? '')) {
      const s = t.surface(m.token, !!pageTok);
      if (s === false) recs.push({ test: 'B3', field: 'usage', observed: pageTok ? 'same value as the page in every mode' : 'the system has no page token', expected: 'surface', agrees: false });
      else if (s === true) recs.push({ test: 'B3', field: 'usage', observed: 'differs from the page in some mode', expected: 'surface', agrees: true });
    }
    // B4: on-fill needs a bold sibling fill the token reaches 4.5:1 on.
    if (has('usage', 'on-fill') && ['text', 'icon', 'foreground'].includes(prop ?? '')) {
      const of = t.onFill(m.token);
      if (of !== undefined) recs.push({ test: 'B4', field: 'usage', observed: of ? '4.5:1 or more on a bold sibling fill' : 'below 4.5:1 on every bold sibling fill', expected: 'on-fill', agrees: of });
    }
    // B6: text when the system ships a separate icon family, foreground when one token colors both.
    const textByNature = f.has('syntax') || (f.get('usage') ?? []).some((u) => u === 'code-surface' || u === 'link');
    if ((prop === 'text' || prop === 'foreground') && !textByNature) {
      const txt = t.textNotForeground(m.token);
      if (txt !== undefined) recs.push({ test: 'B6', field: 'property', observed: txt ? 'the system ships a separate icon family' : 'one token colors text and icons', expected: prop, agrees: txt === (prop === 'text') });
    }
    // Hue against intent, in the first mode (saturated, mid-lightness, mostly opaque colors only).
    const intent = f.get('intent')?.[0];
    const ranges = intent ? INTENT_HUES[intent] : undefined;
    // The first mode the token resolves in (some tokens ship in one theme only, e.g. Atlassian brand-refresh).
    const th = ranges ? [...t.modes, ...t.set.themes].find((x) => rgbOf(resolve(t.set, x, m.token).value)) : undefined;
    const rgb = th !== undefined ? rgbOf(resolve(t.set, th, m.token).value) : undefined;
    if (ranges && rgb && rgb[3] > 0.2) {
      const c = hsl(rgb);
      if (c.s > 0.3 && c.l > 0.08 && c.l < 0.92) recs.push({ test: 'hue', field: 'intent', observed: `hue ${Math.round(c.h)}° (${th || 'default'})`, expected: `${intent} (${ranges.map(([a, b]) => `${a}–${b}°`).join(', ')})`, agrees: inRanges(c.h, ranges) });
    }
    // Naming terms: each facet the approved terms bind, against the mapping (a less specific terms answer is not tested).
    if (terms && (m.match === 'exact' || m.match === 'close')) {
      const c = classify(terms, m.token, String(t.set.tokens.get(m.token)?.prov.file ?? ''), 'color');
      const p = parseConcept(o, m.concept);
      if (!c.conflicts.length && typeof p !== 'string') for (const [k, v] of Object.entries(c.facets)) {
        const mine = (p.facets as Record<string, unknown>)[k];
        // Multi-valued facets compare as sets: every terms value is one of the mapping's values or broader than one.
        const have = mine === undefined ? [] : String(mine).split('+');
        const ok = String(v).split('+').every((x) => have.some((h) => h === x || ancestors(o, k, h).has(x)));
        recs.push({ test: 'terms', field: k, observed: `${v} (terms: ${c.matchedTerms.join(', ')})`, expected: mine === undefined ? '(unbound)' : String(mine), agrees: ok });
      }
    }
    out.push({ mapping: m.id, token: m.token, concept: m.concept, match: m.match, records: recs });
  }
  return out;
}
