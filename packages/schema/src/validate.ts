import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { Ajv2020 } from 'ajv/dist/2020.js';
import type { FormatsPlugin } from 'ajv-formats';
import { DSI, expand, inScheme, loadOntology, toQuads, type Issue, type Ontology } from './ontology.ts';
import { validateNative, valueIssue } from './native.ts';
import { canonicalNameOf, parseConcept } from './concepts.ts';

// ajv and ajv-formats are CommonJS with a `default` export; load them through require for correct interop.
const require = createRequire(import.meta.url);
const Ajv: typeof Ajv2020 = require('ajv/dist/2020.js').default;
const addFormats: FormatsPlugin = require('ajv-formats').default;

export const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemas');
const BASE = 'https://dsi.nonoun.io/schema/';

export function createAjv() {
  // strictRequired is off because if/then branches require properties defined in the parent schema.
  const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
  addFormats(ajv);
  for (const f of fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.schema.json'))) ajv.addSchema(JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, f), 'utf8')));
  return ajv;
}

export interface ValidateOptions { root: string; ontologyDir?: string }

/** Validate repo data: JSON Schema shape first, then references against the ontology and catalog. */
export async function validateRepo({ root, ontologyDir = path.join(root, 'ontology') }: ValidateOptions): Promise<Issue[]> {
  const ontology = await loadOntology(ontologyDir);
  const issues: Issue[] = [...ontology.issues];
  const ajv = createAjv();
  const rel = (f: string) => path.relative(root, f);
  const read = (f: string): unknown => {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { issues.push({ file: rel(f), message: `invalid JSON: ${(e as Error).message}` }); return undefined; }
  };
  const shape = (schema: string, f: string, data: unknown): boolean => {
    const v = ajv.getSchema(BASE + schema)!;
    if (v(data)) return true;
    for (const e of v.errors ?? []) issues.push({ file: rel(f), message: `${e.instancePath || '/'} ${e.message}${e.params && 'allowedValues' in e.params ? ` ${JSON.stringify(e.params.allowedValues)}` : ''}` });
    return false;
  };

  // Catalog
  type Entry = { id: string; category: string; targets?: string[]; relations?: Record<string, string[]>; implementations?: { id: string; targets?: string[] }[] };
  const catalog = new Map<string, { entry: Entry; file: string }>();
  const implOf = new Map<string, string>();
  for (const f of walk(path.join(root, 'catalog'), '.json')) {
    const data = read(f);
    if (data === undefined || !shape('catalog-entry.schema.json', f, data)) continue;
    const e = data as Entry;
    if (path.basename(f, '.json') !== e.id) issues.push({ file: rel(f), message: `file name must equal id "${e.id}"` });
    if (catalog.has(e.id) || implOf.has(e.id)) issues.push({ file: rel(f), message: `duplicate catalog id "${e.id}"` });
    catalog.set(e.id, { entry: e, file: f });
    for (const i of e.implementations ?? []) {
      if (catalog.has(i.id) || implOf.has(i.id)) issues.push({ file: rel(f), message: `duplicate catalog id "${i.id}"` });
      implOf.set(i.id, e.id);
    }
  }
  const cat = (id: string) => catalog.get(id)?.entry.category;
  for (const { entry: e, file: f } of catalog.values()) {
    const at = rel(f);
    if (!inScheme(ontology, e.category, 'dsi:scheme/categories')) issues.push({ file: at, message: `category ${e.category} is not in dsi:scheme/categories` });
    const targets = [...(e.targets ?? []), ...(e.implementations ?? []).flatMap((i) => i.targets ?? [])];
    for (const t of targets) if (!inScheme(ontology, t, 'dsi:scheme/targets')) issues.push({ file: at, message: `target ${t} is not in dsi:scheme/targets` });
    if (e.implementations?.length && e.category !== 'dsi:category/design-system') issues.push({ file: at, message: 'only Design Systems have implementations; link other products with relations.implements' });
    for (const [rel_, ids] of Object.entries(e.relations ?? {}))
      for (const id of ids) if (!catalog.has(id) && !implOf.has(id)) issues.push({ file: at, message: `relations.${rel_} references unknown catalog id "${id}"` });
    for (const id of e.relations?.implements ?? []) if (catalog.has(id) && cat(id) !== 'dsi:category/design-system') issues.push({ file: at, message: `implements "${id}", which is not a Design System` });
    for (const id of e.relations?.usesFormat ?? []) if (catalog.has(id) && cat(id) !== 'dsi:category/token-format') issues.push({ file: at, message: `usesFormat "${id}", which is not a Token Format` });
    if (e.relations?.providesTokenSet?.length && e.category !== 'dsi:category/styling-engine') issues.push({ file: at, message: 'providesTokenSet is only for Styling Engines' });
    for (const id of e.relations?.providesTokenSet ?? []) if (catalog.has(id) && cat(id) !== 'dsi:category/token-set') issues.push({ file: at, message: `providesTokenSet "${id}", which is not a Token Set` });
  }

  // Sources
  for (const f of walk(path.join(root, 'sources'), 'source.json')) {
    const data = read(f);
    if (data === undefined || !shape('source.schema.json', f, data)) continue;
    const s = data as { product: string; implementation?: string; themes?: string[]; modes?: Record<string, string>; entries: { theme?: string }[] };
    const at = rel(f);
    if (path.basename(path.dirname(f)) !== s.product) issues.push({ file: at, message: `folder must equal product "${s.product}"` });
    const p = catalog.get(s.product);
    if (!p) { issues.push({ file: at, message: `unknown product "${s.product}"` }); continue; }
    if (ontology.ingested.get(expand(p.entry.category)) !== true) issues.push({ file: at, message: `${p.entry.category} is not an ingested category` });
    if (p.entry.category === 'dsi:category/design-system' && !s.implementation) issues.push({ file: at, message: 'Design Systems are ingested through an implementation (shipped code is the source of truth)' });
    if (s.implementation && implOf.get(s.implementation) !== s.product) issues.push({ file: at, message: `implementation "${s.implementation}" is not an implementation of "${s.product}"` });
    for (const en of s.entries) if (en.theme && !(s.themes ?? []).includes(en.theme)) issues.push({ file: at, message: `entry theme "${en.theme}" is not listed in themes` });
    for (const [mode, theme] of Object.entries(s.modes ?? {})) {
      if (!inScheme(ontology, `dsi:mode/${mode}`, 'dsi:scheme/mode')) issues.push({ file: at, message: `modes: "${mode}" is not in dsi:scheme/mode` });
      if (!(s.themes ?? []).includes(theme)) issues.push({ file: at, message: `modes.${mode}: theme "${theme}" is not listed in themes` });
    }
  }

  // Mappings
  for (const f of walk(path.join(root, 'mappings'), '.mappings.json')) {
    const data = read(f);
    if (data === undefined || !shape('mapping-file.schema.json', f, data)) continue;
    issues.push(...checkMappingSemantics(ontology, data as MappingFile, rel(f), catalog.has.bind(catalog)));
  }

  // Audit files: auditor verdicts on approved mappings (agent-authored, kept beside the mappings they judge).
  for (const f of walk(path.join(root, 'mappings'), '.audit.json')) {
    const data = read(f);
    if (data === undefined || !shape('audit.schema.json', f, data)) continue;
    for (const [i, x] of ((data as { verdicts: { suggested?: { concept: string } }[] }).verdicts).entries())
      if (x.suggested) { const ci = conceptIssue(ontology, x.suggested.concept); if (ci) issues.push({ file: rel(f), message: `verdicts[${i}]: suggested ${x.suggested.concept} ${ci}` }); }
  }

  // Term mappings
  for (const f of walk(path.join(root, 'mappings'), 'terms.json')) {
    const data = read(f);
    if (data === undefined || !shape('terms-file.schema.json', f, data)) continue;
    const t = data as { product: string; terms: { term: string; concept: string; status: string }[] };
    const at = rel(f);
    if (path.basename(path.dirname(f)) !== t.product) issues.push({ file: at, message: `folder must equal product "${t.product}"` });
    if (!catalog.has(t.product)) issues.push({ file: at, message: `unknown product "${t.product}"` });
    const live = new Map<string, string>();
    t.terms.forEach((x, i) => {
      const facet = facetOfConcept(ontology, x.concept);
      if (!facet) issues.push({ file: at, message: `terms[${i}] ${x.term}: ${x.concept} is not a value of a facet scheme (${TERM_FACETS.join(', ')})` });
      else if (ontology.deprecated.has(expand(x.concept))) issues.push({ file: at, message: `terms[${i}] ${x.term}: ${x.concept} is deprecated` });
      if (!inScheme(ontology, `dsi:review/${x.status}`, 'dsi:scheme/review-status')) issues.push({ file: at, message: `terms[${i}] ${x.term}: status "${x.status}" is not in dsi:scheme/review-status` });
      if (x.status === 'approved') {
        const k = `${x.term}|${facetOfConcept(ontology, x.concept)}`;
        if (live.has(k)) issues.push({ file: at, message: `terms[${i}] ${x.term}: two approved values on one facet (${live.get(k)}, ${x.concept})` });
        live.set(k, x.concept);
      }
    });
  }

  // Native tokens
  validateNative(root, ajv, issues);

  // Canonical set: each token's value is a valid DTCG value, its concept a valid concept whose facet values form the
  // token's name, its status match or nearest (never invented), and the manifest lists every file with its count.
  const canonDir = path.join(root, 'data/canonical');
  if (fs.existsSync(path.join(canonDir, 'manifest.json'))) {
    const man = JSON.parse(fs.readFileSync(path.join(canonDir, 'manifest.json'), 'utf8')) as { files: { file: string; tokens: number }[] };
    const listed = new Set(man.files.map((f) => f.file));
    for (const f of fs.readdirSync(canonDir).filter((f) => f.endsWith('.tokens.json'))) if (!listed.has(f)) issues.push({ file: rel(path.join(canonDir, f)), message: 'not listed in manifest.json' });
    for (const entry of man.files) {
      const fp = path.join(canonDir, entry.file);
      if (!fs.existsSync(fp)) { issues.push({ file: rel(fp), message: 'listed in manifest.json but missing' }); continue; }
      const tree = JSON.parse(fs.readFileSync(fp, 'utf8')) as Record<string, Record<string, { $type?: string; $value: unknown; $extensions?: Record<string, any> }>>;
      let n = 0;
      for (const [group, tokens] of Object.entries(tree)) for (const [name, t] of Object.entries(tokens)) {
        n++;
        const at = `${group}.${name}`, x = t.$extensions?.['io.nonoun.dsi'];
        const vi = valueIssue(t);
        if (vi) issues.push({ file: rel(fp), message: `${at}: ${vi}` });
        if (!x || (x.status !== 'match' && x.status !== 'nearest')) { issues.push({ file: rel(fp), message: `${at}: status must be match or nearest` }); continue; }
        const ci = conceptIssue(ontology, x.concept);
        if (ci) { issues.push({ file: rel(fp), message: `${at}: concept ${x.concept} ${ci}` }); continue; }
        const pc = parseConcept(ontology, x.concept);
        if (typeof pc !== 'string' && (pc.domain !== group || canonicalNameOf(pc) !== name)) issues.push({ file: rel(fp), message: `${at}: name does not match concept ${x.concept}` });
      }
      if (n !== entry.tokens) issues.push({ file: rel(fp), message: `manifest says ${entry.tokens} tokens, file has ${n}` });
    }
  }

  // SKOS exports: valid JSON-LD; every dsi: IRI they reference is defined by the ontology or by the file itself,
  // and every mapping object is a valid concept.
  for (const f of walk(path.join(root, 'data/skos'), '.jsonld')) {
    let quads;
    try { quads = await toQuads(f, root); } catch (e) { issues.push({ file: rel(f), message: `invalid JSON-LD: ${(e as Error).message}` }); continue; }
    const local = new Set(quads.map((q) => q.subject.value));
    const SKOS_MATCH = /#(exact|close|broad|narrow|related)Match$/;
    for (const q of quads) {
      if (q.object.termType !== 'NamedNode' || !q.object.value.startsWith(DSI)) continue;
      const v = q.object.value;
      if (!local.has(v) && !ontology.defined.has(v)) issues.push({ file: rel(f), message: `${q.subject.value.replace(DSI, 'dsi:')} references undefined ${v.replace(DSI, 'dsi:')}` });
      if (SKOS_MATCH.test(q.predicate.value)) { const ci = conceptIssue(ontology, v.replace(DSI, 'dsi:')); if (ci) issues.push({ file: rel(f), message: `${q.subject.value.replace(DSI, 'dsi:')}: mapping target ${v.replace(DSI, 'dsi:')} ${ci}` }); }
    }
  }
  return issues;
}

type Judgment = { status: string; supersededBy?: string };
type MappingFile = {
  product: string;
  bindings?: (Judgment & { token: string; facets: Record<string, string | number> })[];
  mappings?: (Judgment & { id: string; token: string; concept: string; match: string })[];
  noEquivalent?: (Judgment & { concept: string })[];
  unmapped?: (Judgment & { token: string })[];
};

export const TERM_FACETS = ['intent', 'usage', 'syntax', 'property', 'emphasis', 'brightness', 'state'] as const;
/** The facet whose value scheme holds this concept (dsi:intent/danger -> intent), if any. */
export function facetOfConcept(o: Ontology, concept: string): (typeof TERM_FACETS)[number] | undefined {
  return TERM_FACETS.find((f) => concept.startsWith(`dsi:${f}/`) && inScheme(o, concept, `dsi:scheme/${f}`));
}

/** A concept reference is valid if the ontology defines it or it is a well-formed compositional concept. */
function conceptIssue(o: Ontology, ref: string): string | undefined {
  if (o.defined.has(expand(ref))) return undefined;
  if (!ref.startsWith('dsi:concept/')) return 'is not defined in the ontology';
  const p = parseConcept(o, ref);
  return typeof p === 'string' ? p : undefined;
}

const FACET_SCHEMES: Record<string, string> = { domain: 'domain', emphasis: 'emphasis', intent: 'intent', property: 'property', state: 'state', usage: 'usage', syntax: 'syntax', brightness: 'brightness' };

function checkMappingSemantics(o: Ontology, m: MappingFile, at: string, productExists: (id: string) => boolean): Issue[] {
  const out: Issue[] = [];
  const err = (message: string) => out.push({ file: at, message });
  if (!productExists(m.product)) err(`unknown product "${m.product}"`);
  const status = (j: Judgment, where: string) => { if (!inScheme(o, `dsi:review/${j.status}`, 'dsi:scheme/review-status')) err(`${where}: status "${j.status}" is not in dsi:scheme/review-status`); };
  (m.bindings ?? []).forEach((b, i) => {
    status(b, `bindings[${i}]`);
    for (const [facet, scheme] of Object.entries(FACET_SCHEMES)) {
      const v = b.facets[facet];
      if (typeof v === 'string' && v.startsWith('dsi:') && !inScheme(o, v, `dsi:scheme/${scheme}`)) err(`bindings[${i}] ${b.token}: ${facet} ${v} is not in dsi:scheme/${scheme}`);
    }
  });
  const ids = new Set<string>();
  (m.mappings ?? []).forEach((x, i) => {
    status(x, `mappings[${i}]`);
    if (ids.has(x.id)) err(`mappings[${i}]: duplicate id "${x.id}"`);
    ids.add(x.id);
    if (!inScheme(o, `dsi:match/${x.match}`, 'dsi:scheme/match-types')) err(`mappings[${i}] ${x.token}: match "${x.match}" is not in dsi:scheme/match-types`);
    const ci = conceptIssue(o, x.concept);
    if (ci) err(`mappings[${i}] ${x.token}: concept ${x.concept} ${ci}`);
  });
  (m.mappings ?? []).forEach((x, i) => { if (x.supersededBy && !ids.has(x.supersededBy)) err(`mappings[${i}]: supersededBy "${x.supersededBy}" is not a mapping id in this file`); });
  (m.noEquivalent ?? []).forEach((x, i) => {
    status(x, `noEquivalent[${i}]`);
    const ci = conceptIssue(o, x.concept);
    if (ci) err(`noEquivalent[${i}]: concept ${x.concept} ${ci}`);
  });
  const mapped = new Set((m.mappings ?? []).filter((x) => x.status !== 'rejected' && x.status !== 'superseded').map((x) => x.token));
  const approvedMapping = new Set((m.mappings ?? []).filter((x) => x.status === 'approved').map((x) => x.token));
  const approvedUnmapped = new Set((m.unmapped ?? []).filter((x) => x.status === 'approved').map((x) => x.token));
  (m.unmapped ?? []).forEach((x, i) => {
    status(x, `unmapped[${i}]`);
    if (x.status === 'approved' && mapped.has(x.token)) err(`unmapped[${i}] ${x.token}: approved as unmapped but also has a live mapping`);
    if (x.status === 'proposed' && approvedMapping.has(x.token)) err(`unmapped[${i}] ${x.token}: stale proposal; the token already has an approved mapping`);
  });
  (m.mappings ?? []).forEach((x, i) => {
    if (x.status === 'proposed' && (approvedMapping.has(x.token) || approvedUnmapped.has(x.token))) err(`mappings[${i}] ${x.token}: stale proposal; the token is already settled`);
  });
  return out;
}

function walk(dir: string, suffix: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith(suffix)).sort().map((f) => path.join(dir, f));
}
