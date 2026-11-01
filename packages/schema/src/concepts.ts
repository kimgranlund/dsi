import fs from 'node:fs';
import path from 'node:path';
import { expand, inScheme, type Ontology } from './ontology.ts';

/** Fixed facet order of compositional concept IRIs. */
export const CONCEPT_FACETS = ['intent', 'usage', 'hue', 'syntax', 'component', 'part', 'property', 'style', 'emphasis', 'brightness', 'state'] as const;
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
  // ADR 0019: the bare concept is the default step, so emphasis-default is never bound; opacity has its own domain.
  if (facets.emphasis === 'default') return 'emphasis default is the bare concept: leave emphasis unbound';
  if (facets.property === 'opacity' && domain !== 'opacity') return 'property opacity belongs to the opacity domain';
  // A part belongs to a component, or to a code surface (gutter, line number, line; ADR 0018).
  if (facets.part && !facets.component && !String(facets.usage ?? '').split('+').includes('code-surface')) return 'part needs a component or usage code-surface';
  if (facets.hue && !String(facets.usage ?? '').split('+').includes('categorical')) return 'hue needs usage categorical';
  return { domain, facets };
}

/**
 * Canonical token name of a parsed concept: facet values in facet order joined by '-'. Syntax values are prefixed
 * "code-" because Lezer tag names (link, strong, emphasis) would otherwise collide with other facets' values.
 */
export function canonicalNameOf(p: ParsedConcept): string {
  return Object.entries(p.facets).map(([f, v]) => (f === 'syntax' ? `code-${v}` : String(v))).join('-');
}

/** Lexicon entry: a facet value's label and, when it differs inside names, its name form (docs/controlled-language.md). */
export interface Word { label: string; nameForm?: string; definition?: string }

/** Read the lexicon (every prefLabel in ontology/schemes) without the full RDF load. */
export function readLexicon(root: string): Map<string, Word> {
  const dir = path.join(root, 'ontology/schemes');
  const out = new Map<string, Word>();
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonld') && f !== 'concepts.jsonld'))
    for (const c of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))['@graph'] as any[])
      if (c.prefLabel) out.set(c.id, { label: c.prefLabel, ...(c.nameForm ? { nameForm: c.nameForm } : {}), ...(c.definition ? { definition: c.definition } : {}) });
  return out;
}

const NAME_ORDER = ['state', 'emphasis', 'brightness', 'style', 'intent', 'hue', 'usage', 'component', 'part', 'syntax'] as const;
const form = (lex: Map<string, Word>, facet: string, v: string) => { const w = lex.get(`dsi:${facet}/${v}`); return w?.nameForm ?? (w?.label ?? v.replace(/-/g, ' ')).toLowerCase(); };
// In the color domain a property that is not itself colored paint (shadow) takes "color": "Overlay shadow color".
const COLOR_SUFFIX = new Set(['shadow']);
const headOf = (lex: Map<string, Word>, p: ParsedConcept) => (p.facets.property ? form(lex, 'property', p.facets.property) + (p.domain === 'color' && COLOR_SUFFIX.has(p.facets.property) ? ' color' : '') : form(lex, 'domain', p.domain));

/**
 * L3 concept name: "[state] [emphasis] [brightness] [style] [intent] [hue] [usage] [component] [part] [syntax] head",
 * sentence case. States read as participles (name forms), emphasis default is omitted, syntax reads "code <label>",
 * and the head is the property or, without one, the domain noun.
 */
export function conceptName(lex: Map<string, Word>, p: ParsedConcept): string {
  const words: string[] = [];
  for (const f of NAME_ORDER) {
    const v = p.facets[f];
    if (!v) continue;
    if (f === 'emphasis' && v === 'default') continue;
    for (const x of String(v).split('+')) words.push(f === 'syntax' ? `code ${form(lex, f, x)}` : form(lex, f, x));
  }
  words.push(headOf(lex, p));
  const s = words.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * L4 generated definition: "The <head>[ used for <usage>][ of <component>[ <part>]][ for <syntax> code][, signaling
 * <intent>][, in <hue>][, <style> style][, <brightness>][, at <emphasis> emphasis][, when <state>]."
 */
export function conceptDefinition(lex: Map<string, Word>, p: ParsedConcept): string {
  const f = p.facets, w = (k: string, v?: string) => (v ? String(v).split('+').map((x) => form(lex, k, x)).join(' and ') : '');
  let s = `The ${headOf(lex, p)}`;
  if (f.usage) s += ` for ${w('usage', f.usage)} use`;
  if (f.component) s += ` of the ${w('component', f.component)}${f.part ? ` ${w('part', f.part)}` : ''}`;
  else if (f.part) s += ` of the ${w('part', f.part)}`;
  if (f.syntax) s += ` for ${w('syntax', f.syntax)} code`;
  if (f.intent) s += `, signaling ${w('intent', f.intent)}`;
  if (f.hue) s += `, in ${w('hue', f.hue)}`;
  if (f.style) s += `, ${w('style', f.style)} style`;
  if (f.brightness) s += `, ${w('brightness', f.brightness)}`;
  if (f.emphasis) s += `, at ${w('emphasis', f.emphasis)} emphasis`;
  if (f.state) s += `, when ${w('state', f.state).replace(/ and /g, ' or ')}`;
  return s + '.';
}

/** Is the concept in the registry (ontology/schemes/concepts.jsonld, ADR 0019)? */
export const isRegistered = (o: Ontology, ref: string) => { const m = /^dsi:concept\/([a-z0-9-]+)\//.exec(ref); return !!m && inScheme(o, ref, `dsi:scheme/canonical/${m[1]}`); };

/**
 * Add concepts to the registry (ontology/schemes/concepts.jsonld) with their generated L3 name and L4 definition.
 * Existing entries are kept as written (a hand-written name or definition survives). Returns the IRIs added.
 */
export function registerConcepts(root: string, o: Ontology, iris: string[]): string[] {
  const f = path.join(root, 'ontology/schemes/concepts.jsonld');
  const doc = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { '@context': '../context.jsonld', '@graph': [] };
  const have = new Set((doc['@graph'] as any[]).map((c) => c.id));
  const lex = readLexicon(root);
  const added: string[] = [];
  for (const iri of [...new Set(iris)]) {
    if (have.has(iri)) continue;
    const p = parseConcept(o, iri);
    if (typeof p === 'string') throw new Error(`${iri}: ${p}`);
    doc['@graph'].push({ id: iri, type: 'Concept', inScheme: `dsi:scheme/canonical/${p.domain}`, prefLabel: conceptName(lex, p), definition: conceptDefinition(lex, p) });
    have.add(iri); added.push(iri);
  }
  doc['@graph'].sort((a: any, b: any) => a.id.localeCompare(b.id));
  fs.writeFileSync(f, JSON.stringify(doc, null, 2) + '\n');
  return added;
}

/**
 * Registry gate (ADR 0019): a rule may not approve an unregistered concept. Its approvals of new concepts return to
 * Proposed with a note, so the owner decides on the review page; owner approval registers the concept.
 */
export function gateUnregistered(o: Ontology, file: { mappings: any[] }, at = new Date().toISOString()): string[] {
  const held: string[] = [];
  for (const m of file.mappings)
    if (m.status === 'approved' && m.provenance?.method !== 'human-review' && !isRegistered(o, m.concept)) {
      m.status = 'proposed';
      m.review = { by: 'registry-gate', at, note: `New concept ${m.concept}: not in the concept registry, so it needs owner approval (ADR 0019).` };
      held.push(m.token);
    }
  return held;
}
