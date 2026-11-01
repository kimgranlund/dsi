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
      if (facet === 'emphasis' && v === 'default') return 'emphasis default is the bare concept: leave emphasis unbound';
      if (o.deprecated.has(expand(`dsi:${facet}/${v}`))) return `${facet} "${v}" is deprecated`;
    }
    facets[facet] = value;
  }
  // ADR 0019: the bare concept is the default step, so emphasis-default is never bound; opacity has its own domain.
  if (facets.emphasis === 'default') return 'emphasis default is the bare concept: leave emphasis unbound';
  if (facets.property === 'opacity' && domain !== 'opacity') return 'property opacity belongs to the opacity domain';
  // A part belongs to a component, or to a code surface (gutter, line number, line; ADR 0018).
  if (facets.part && !facets.component && !String(facets.usage ?? '').split('+').includes('code-surface')) return 'part needs a component or usage code-surface';
  // Terminal (ANSI) slots bind a hue too (ADR 0023).
  if (facets.hue && !String(facets.usage ?? '').split('+').some((u) => u === 'categorical' || u === 'terminal')) return 'hue needs usage categorical or terminal';
  return { domain, facets };
}

/**
 * Rewrites the two forms ADR 0019 retired into their ratified spelling, for answers written before the rule:
 * a bound emphasis-default is dropped (the bare concept is the default) and opacity moves to its own domain.
 */
export function normalizeConcept(ref: string): string {
  let r = ref.replace(/\/emphasis-default(?=\/|$)/, '');
  if (/\/property-opacity(?=\/|$)/.test(r)) r = r.replace(/^dsi:concept\/[a-z0-9-]+\//, 'dsi:concept/opacity/');
  return r;
}

/**
 * Canonical token name of a parsed concept: facet values in facet order joined by '-'. Syntax values are prefixed
 * "code-" because Lezer tag names (link, strong, emphasis) would otherwise collide with other facets' values.
 */
export function canonicalNameOf(p: ParsedConcept): string {
  return Object.entries(p.facets).map(([f, v]) => (f === 'syntax' ? `code-${v}` : String(v))).join('-');
}

/** Lexicon entry: a facet value's label and, when it differs inside names, its name form (docs/controlled-language.md). */
export interface Word { label: string; nameForm?: string; definition?: string; phrase?: string }

/** Read the lexicon (every prefLabel in ontology/schemes) without the full RDF load. */
export function readLexicon(root: string): Map<string, Word> {
  const dir = path.join(root, 'ontology/schemes');
  const out = new Map<string, Word>();
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonld') && f !== 'concepts.jsonld'))
    for (const c of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))['@graph'] as any[])
      if (c.prefLabel) out.set(c.id, { label: c.prefLabel, ...(c.nameForm ? { nameForm: c.nameForm } : {}), ...(c.phrase ? { phrase: c.phrase } : {}), ...(c.definition ? { definition: c.definition } : {}) });
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
 * L4 generated definition (ADR 0019 amendment, 2026-11-01), genus first:
 * - color with a property: "The color of <property phrase>"; color without one: "A color";
 *   other domains: "The <property>" (or "A <domain noun>").
 * - a concept with one facet outside the color domain takes that value's own definition (never circular).
 * - then "[ that communicates <intent>][ <usage phrase>][ of the <component>[ <part>]][ for <syntax definition> in code]
 *   [, in <hue>][, <style> style][, <brightness>][, at <emphasis> emphasis][, when <state>]."
 */
export function conceptDefinition(lex: Map<string, Word>, p: ParsedConcept): string {
  const f = p.facets, keys = Object.keys(f) as (keyof typeof f)[];
  const word = (k: string, v: string) => lex.get(`dsi:${k}/${v}`);
  const w = (k: string, v?: string) => (v ? String(v).split('+').map((x) => form(lex, k, x)).join(' and ') : '');
  const phrase = (k: string, v: string) => String(v).split('+').map((x) => word(k, x)?.phrase ?? `for ${form(lex, k, x)} use`).join(' and ');
  if (p.domain !== 'color' && keys.length === 1) { const d = word(keys[0], String(f[keys[0]]))?.definition; if (d) return d; }
  const prop = f.property ? String(f.property) : undefined;
  let s = p.domain === 'color'
    ? (prop ? `The color of ${word('property', prop)?.phrase ?? form(lex, 'property', prop)}` : 'A color')
    : (prop ? `The ${form(lex, 'property', prop)}` : `A ${form(lex, 'domain', p.domain)}`);
  if (f.part && !f.component) s += ` of the ${w('part', f.part)}`; // code-surface parts: "of the gutter on code surfaces"
  if (f.intent) s += ` that communicates ${w('intent', f.intent)}`;
  if (f.usage) s += ` ${phrase('usage', f.usage)}`;
  if (f.component) s += ` of the ${w('component', f.component)}${f.part ? ` ${w('part', f.part)}` : ''}`;
  if (f.syntax) {
    const d = word('syntax', String(f.syntax))?.definition;
    const np = d ? d.split(/[,.]/)[0].replace(/^(A|An|The) /, (m) => m.toLowerCase()) : `“${w('syntax', f.syntax)}”`;
    s += ` for ${/^(a|an|the) /.test(np) ? np : np.charAt(0).toLowerCase() + np.slice(1)} in code`;
  }
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

/**
 * Apply reviewed L4 definitions to the lexicon files, editing text in place so hand formatting survives. approve and
 * edit set the definition; a replaced definition moves to the scope note. reject leaves the entry as it is.
 */
export function applyDefinitions(root: string, decisions: { iri: string; action: 'approve' | 'edit' | 'reject'; text?: string }[]): Record<string, number> {
  const counts = { applied: 0, kept: 0, missing: 0 };
  const dir = path.join(root, 'ontology/schemes');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonld') && f !== 'concepts.jsonld').map((f) => path.join(dir, f));
  const text = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')]));
  const str = (v: string) => JSON.stringify(v);
  for (const d of decisions) {
    if (d.action === 'reject' || !d.text) { counts.kept++; continue; }
    const def: string = d.text;
    const f = files.find((x) => text.get(x)!.includes(`"id": ${str(d.iri)}`));
    if (!f) { counts.missing++; continue; }
    let s = text.get(f)!;
    const at = s.indexOf(`"id": ${str(d.iri)}`);
    const start = s.lastIndexOf('{', at);
    let depth = 0, end = start, inStr = false;
    for (let i = start; i < s.length; i++) { const ch = s[i]; if (inStr) { if (ch === '\\') i++; else if (ch === '"') inStr = false; } else if (ch === '"') inStr = true; else if (ch === '{') depth++; else if (ch === '}' && --depth === 0) { end = i; break; } }
    let obj = s.slice(start, end + 1);
    const entry = JSON.parse(obj);
    const old: string | undefined = entry.definition;
    const field = (o: string, k: string) => new RegExp(`"${k}":\\s*"(?:[^"\\\\]|\\\\.)*"`);
    if (old !== undefined) obj = obj.replace(field(obj, 'definition'), `"definition": ${str(def)}`);
    else obj = obj.replace(field(obj, 'prefLabel'), (m) => `${m}, "definition": ${str(def)}`);
    if (old && old !== def) {
      const note = entry.scopeNote ? `${entry.scopeNote} Earlier definition: ${old}` : old;
      obj = entry.scopeNote !== undefined ? obj.replace(field(obj, 'scopeNote'), `"scopeNote": ${str(note)}`) : obj.replace(field(obj, 'definition'), (m) => `${m}, "scopeNote": ${str(note)}`);
    }
    JSON.parse(obj); // still valid
    text.set(f, s.slice(0, start) + obj + s.slice(end + 1));
    counts.applied++;
  }
  for (const [f, s] of text) { JSON.parse(s); fs.writeFileSync(f, s); }
  return counts;
}
