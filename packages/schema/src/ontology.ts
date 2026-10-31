import fs from 'node:fs';
import path from 'node:path';
import jsonld from 'jsonld';

export const DSI = 'https://dsi.nonoun.io/ontology/';
const SKOS = 'http://www.w3.org/2004/02/skos/core#';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

export interface Issue { file: string; message: string }

export interface Ontology {
  /** Every subject IRI defined in the ontology. */
  defined: Set<string>;
  /** Concept IRI -> scheme IRIs it is inScheme. */
  schemes: Map<string, Set<string>>;
  /** Concept IRI -> literal values of dsi:ingested, for categories. */
  ingested: Map<string, boolean>;
  issues: Issue[];
}

/** Expand a compact dsi: reference to a full IRI. */
export const expand = (ref: string): string => (ref.startsWith('dsi:') ? DSI + ref.slice(4) : ref);

export const inScheme = (o: Ontology, ref: string, scheme: string): boolean =>
  o.schemes.get(expand(ref))?.has(expand(scheme)) ?? false;

export async function loadOntology(dir: string): Promise<Ontology> {
  const files = [path.join(dir, 'vocab.jsonld'), ...fs.readdirSync(path.join(dir, 'schemes')).filter((f) => f.endsWith('.jsonld')).map((f) => path.join(dir, 'schemes', f)), ...listConceptFiles(dir)];
  const documentLoader = async (url: string) => {
    const p = url.startsWith('file://') ? url.slice(7) : url;
    if (!p.startsWith(dir)) throw new Error(`refusing to load remote or out-of-tree context ${url}`);
    return { contextUrl: undefined, documentUrl: url, document: JSON.parse(fs.readFileSync(p, 'utf8')) };
  };
  const quads: { s: string; p: string; o: string; oType: string }[] = [];
  const issues: Issue[] = [];
  for (const f of files) {
    try {
      const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
      // jsonld's types lag the runtime options; documentLoader and safe are supported.
      const nq = (await jsonld.toRDF(doc, { base: 'file://' + f, documentLoader, safe: true } as never)) as unknown as { subject: { value: string }; predicate: { value: string }; object: { value: string; termType: string } }[];
      for (const q of nq) quads.push({ s: q.subject.value, p: q.predicate.value, o: q.object.value, oType: q.object.termType });
    } catch (e) {
      issues.push({ file: f, message: `invalid JSON-LD: ${(e as Error).message}` });
    }
  }
  const defined = new Set(quads.map((q) => q.s));
  const schemes = new Map<string, Set<string>>();
  const ingested = new Map<string, boolean>();
  for (const q of quads) {
    if (q.p === SKOS + 'inScheme') (schemes.get(q.s) ?? schemes.set(q.s, new Set()).get(q.s)!).add(q.o);
    if (q.p === DSI + 'ingested') ingested.set(q.s, q.o === 'true');
  }
  const concepts = quads.filter((q) => q.p === RDF_TYPE && q.o === SKOS + 'Concept').map((q) => q.s);
  const has = (s: string, p: string) => quads.some((q) => q.s === s && q.p === p);
  const where = (iri: string) => iri.replace(DSI, 'dsi:');
  for (const c of concepts) {
    if (!has(c, SKOS + 'inScheme')) issues.push({ file: 'ontology', message: `${where(c)} has no skos:inScheme` });
    if (!has(c, SKOS + 'prefLabel')) issues.push({ file: 'ontology', message: `${where(c)} has no skos:prefLabel` });
  }
  for (const q of quads) {
    for (const [v, isIri] of [[q.p, true], [q.o, q.oType === 'NamedNode']] as const)
      if (isIri && v.startsWith(DSI) && !defined.has(v)) issues.push({ file: 'ontology', message: `${where(q.s)} references undefined ${where(v)}` });
  }
  const labels = new Map<string, string>();
  for (const c of concepts) {
    const label = quads.find((q) => q.s === c && q.p === SKOS + 'prefLabel')?.o;
    for (const sc of schemes.get(c) ?? []) {
      const k = `${sc}|${label}`;
      if (labels.has(k)) issues.push({ file: 'ontology', message: `duplicate prefLabel "${label}" in ${where(sc)}: ${where(labels.get(k)!)} and ${where(c)}` });
      labels.set(k, c);
    }
  }
  for (const q of quads.filter((q) => q.p === SKOS + 'related'))
    if (!quads.some((r) => r.p === SKOS + 'related' && r.s === q.o && r.o === q.s)) issues.push({ file: 'ontology', message: `skos:related ${where(q.s)} -> ${where(q.o)} is not symmetric` });
  return { defined, schemes, ingested, issues };
}

function listConceptFiles(dir: string): string[] {
  const c = path.join(dir, 'concepts');
  if (!fs.existsSync(c)) return [];
  return fs.readdirSync(c, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.jsonld')).map((f) => path.join(c, f));
}
