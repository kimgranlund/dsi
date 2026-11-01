import fs from 'node:fs';
import path from 'node:path';
import { CONCEPT_FACETS, DSI, type Ontology } from '@dsi/schema';
import { loadNative, resolve, showValue, type NativeSet } from '@dsi/resolve';

export interface Scope {
  id: string;
  domain: string;
  prompt: string;
  products: Record<string, { version: string; pathPrefix?: string[]; provenanceFile?: string[]; exclude?: string[] }>;
}

export interface MappingFileShape {
  product: string;
  implementation?: string;
  sourceVersion: string;
  mappings?: { id: string; token: string; concept: string; match: string; status: string }[];
  unmapped?: { token: string; status: string }[];
  [k: string]: unknown;
}

export const mappingPath = (root: string, product: string, version: string) => path.join(root, 'mappings', product, `${version}.mappings.json`);
export const readMappings = (root: string, product: string, version: string): MappingFileShape | undefined => {
  const p = mappingPath(root, product, version);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : undefined;
};

export function inScope(scope: Scope, product: string, set: NativeSet): string[] {
  const s = scope.products[product];
  return [...set.tokens.values()]
    .filter((t) => (!s.pathPrefix || s.pathPrefix.some((p) => t.path.startsWith(p))) && (!s.provenanceFile || s.provenanceFile.some((f) => String(t.prov.file).endsWith(f))) && !(s.exclude ?? []).some((x) => (x.endsWith('.') ? t.path.startsWith(x) : t.path === x)))
    .map((t) => t.path)
    .sort();
}

/** Facet values with labels and definitions, read from the ontology quads already loaded by @dsi/schema. */
function ontologySummary(root: string, o: Ontology) {
  const schemeDir = path.join(root, 'ontology/schemes');
  const facets = fs.readdirSync(schemeDir).filter((f) => f.endsWith('.jsonld')).flatMap((f) => JSON.parse(fs.readFileSync(path.join(schemeDir, f), 'utf8'))['@graph'] as Record<string, unknown>[]);
  const values = (scheme: string) => facets.filter((c) => c.inScheme === `dsi:scheme/${scheme}`).map((c) => ({ value: String(c.id).split('/').pop(), label: c.prefLabel, definition: c.definition, example: c.example })).filter((v) => o.defined.has(DSI + `${scheme}/${v.value}`) && !o.deprecated.has(DSI + `${scheme}/${v.value}`));
  const facetOrder = [...CONCEPT_FACETS];
  return {
    grammar: 'dsi:concept/<domain>/<facet>-<value>/... with facets in this order: ' + facetOrder.join(', '),
    facets: Object.fromEntries(facetOrder.map((f) => [f, values(f)])),
    matchTypes: { exact: 'same meaning for every use', close: 'same meaning for comparison, known nuance', broad: 'the concept is broader than the token', narrow: 'the concept is narrower than the token (token covers more)', related: 'associated, never interchangeable' },
  };
}

/** Build one packet per product for a role. Approved tokens are skipped; rejected answers are listed. */
export function preparePacket(root: string, o: Ontology, scope: Scope, product: string, role: 'a' | 'b', runDir: string, only?: Set<string>) {
  const { version } = scope.products[product];
  const set = loadNative(root, product, version);
  const existing = readMappings(root, product, version);
  const settled = new Set([...(existing?.mappings ?? []).filter((m) => m.status === 'approved').map((m) => m.token), ...(existing?.unmapped ?? []).filter((u) => u.status === 'approved').map((u) => u.token)]);
  const rejected = (existing?.mappings ?? []).filter((m) => m.status === 'rejected').map(({ token, concept, match }) => ({ token, concept, match }));
  // `only`: map just these tokens (a re-opened set, `prepare --only`), leaving the open review queue alone.
  const paths = inScope(scope, product, set).filter((p) => !settled.has(p) && (!only || only.has(p)));
  const themes = set.themes.length ? set.themes : [''];
  const tokens = paths.map((p) => {
    const t = set.tokens.get(p)!;
    return {
      token: p,
      nativeName: t.prov.nativeName,
      ...(t.description ? { description: t.description } : {}),
      ...(t.deprecated ? { deprecated: t.deprecated } : {}),
      themes: Object.fromEntries(themes.map((th) => {
        const r = resolve(set, th, p);
        return [th || 'all', { aliases: r.chain, value: showValue(r.type, r.value) }];
      })),
    };
  });
  const id = `${scope.id}/${product}@${version}`;
  const packet = { id, role, product, version, scope: scope.id, instructions: scope.prompt, output: path.join(runDir, `${product}.${role}.proposals.json`), ontology: ontologySummary(root, o), rejected, tokens };
  const file = path.join(runDir, `${product}.${role}.packet.json`);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(packet, null, 2) + '\n');
  return { file, count: tokens.length, skipped: settled.size };
}
