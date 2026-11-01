import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { facetLabels, loadNative, resolve, showValue } from '@dsi/resolve';
import { canonicalNameOf, loadOntology, parseConcept } from '@dsi/schema';

export const SCHEMA = `
CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, organization TEXT, homepage TEXT, license TEXT, description TEXT, version TEXT, implementation TEXT, redistribution TEXT);
CREATE TABLE tokens (product TEXT NOT NULL, path TEXT NOT NULL, native_name TEXT, type TEXT, description TEXT, scope TEXT, visibility TEXT, file TEXT, deprecated TEXT, PRIMARY KEY (product, path));
CREATE TABLE token_values (product TEXT NOT NULL, path TEXT NOT NULL, theme TEXT NOT NULL, value_json TEXT, display TEXT, alias_chain TEXT NOT NULL, PRIMARY KEY (product, path, theme));
CREATE TABLE modes (product TEXT NOT NULL, mode TEXT NOT NULL, theme TEXT NOT NULL, PRIMARY KEY (product, mode));
CREATE TABLE concepts (iri TEXT PRIMARY KEY, grp TEXT NOT NULL, name TEXT NOT NULL, label TEXT NOT NULL, facets TEXT NOT NULL);
CREATE TABLE mappings (id TEXT NOT NULL, product TEXT NOT NULL, token TEXT NOT NULL, concept TEXT NOT NULL, match TEXT NOT NULL, confidence REAL, status TEXT NOT NULL, review_by TEXT, rationale TEXT, PRIMARY KEY (product, id));
CREATE TABLE unmapped (product TEXT NOT NULL, token TEXT NOT NULL, rationale TEXT, PRIMARY KEY (product, token));
CREATE TABLE terms (product TEXT NOT NULL, term TEXT NOT NULL, concept TEXT NOT NULL, match TEXT NOT NULL, PRIMARY KEY (product, term, concept));
CREATE TABLE coverage (concept TEXT NOT NULL, product TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL, token TEXT, match TEXT, via TEXT, display TEXT, PRIMARY KEY (concept, product, mode));
CREATE VIRTUAL TABLE search USING fts5(kind UNINDEXED, key UNINDEXED, title, body, tokenize = 'unicode61 tokenchars ''-.''');
CREATE INDEX mappings_concept ON mappings (concept);
`;

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));

/**
 * Build the query database from the repo's authored and generated files. Only Approved mappings, unmapped records
 * and terms are loaded: the database is what the public site and API may show. Deterministic: same inputs, same rows.
 */
export async function buildDatabase(root: string, out: string): Promise<Record<string, number>> {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.rmSync(out, { force: true });
  const db = new DatabaseSync(out);
  db.exec(SCHEMA);
  const ins = (table: string, cols: string[]) => db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
  const counts: Record<string, number> = {};
  const add = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  db.exec('BEGIN');

  const catalogFiles = fs.readdirSync(path.join(root, 'catalog'), { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.json')).sort();
  const sources = new Map<string, any>(fs.readdirSync(path.join(root, 'sources')).filter((p) => fs.existsSync(path.join(root, 'sources', p, 'source.json'))).map((p) => [p, readJson(path.join(root, 'sources', p, 'source.json'))]));
  const iProduct = ins('products', ['id', 'name', 'category', 'organization', 'homepage', 'license', 'description', 'version', 'implementation', 'redistribution']);
  const iSearch = ins('search', ['kind', 'key', 'title', 'body']);
  for (const f of catalogFiles) {
    const e = readJson(path.join(root, 'catalog', f));
    const s = sources.get(e.id);
    iProduct.run(e.id, e.name, e.category, e.organization ?? null, e.homepage ?? null, e.license ?? null, e.description, s?.package.version ?? null, s?.implementation ?? null, s?.license.redistribution ?? null);
    iSearch.run('product', e.id, e.name, `${e.organization ?? ''} ${e.description}`);
    add('products');
  }

  const canon = readJson(path.join(root, 'data/canonical/manifest.json'));
  const iConcept = ins('concepts', ['iri', 'grp', 'name', 'label', 'facets']);
  // Scale concepts (geometry, typography, motion) come from approved mappings: they have members, not canonical tokens.
  const o = await loadOntology(path.join(root, 'ontology'));
  const labels = facetLabels(root);
  const known = new Set(canon.concepts.map((c: any) => c.concept));
  const extra: any[] = [];
  for (const [product, s] of sources) {
    const mf = path.join(root, 'mappings', product, `${s.package.version}.mappings.json`);
    for (const m of readJson(mf).mappings) {
      if (m.status !== 'approved' || known.has(m.concept) || m.concept.startsWith('dsi:concept/color/')) continue;
      const pc = parseConcept(o, m.concept);
      if (typeof pc === 'string') continue;
      known.add(m.concept);
      extra.push({ concept: m.concept, group: pc.domain, name: canonicalNameOf(pc), label: Object.entries(pc.facets).map(([f, v]) => String(v).split('+').map((x) => labels.get(`dsi:${f}/${x}`) ?? x).join(' + ')).join(' · ') });
    }
  }
  for (const c of [...canon.concepts, ...extra]) {
    const facets = Object.fromEntries(c.concept.replace(/^dsi:concept\/[a-z]+\//, '').split('/').map((s: string) => { const i = s.indexOf('-'); return [s.slice(0, i), s.slice(i + 1)]; }));
    iConcept.run(c.concept, c.group, c.name, c.label, JSON.stringify(facets));
    iSearch.run('concept', c.concept, c.label, `${c.group}.${c.name} ${Object.values(facets).join(' ')}`);
    add('concepts');
  }
  const iCov = ins('coverage', ['concept', 'product', 'mode', 'status', 'token', 'match', 'via', 'display']);
  for (const [concept, byProduct] of Object.entries(canon.coverage as Record<string, Record<string, Record<string, any>>>))
    for (const [product, byMode] of Object.entries(byProduct)) for (const [mode, cell] of Object.entries(byMode)) { iCov.run(concept, product, mode, cell.status, cell.token ?? null, cell.match ?? null, cell.via ?? null, cell.value ?? null); add('coverage'); }

  const iToken = ins('tokens', ['product', 'path', 'native_name', 'type', 'description', 'scope', 'visibility', 'file', 'deprecated']);
  const iValue = ins('token_values', ['product', 'path', 'theme', 'value_json', 'display', 'alias_chain']);
  const iMode = ins('modes', ['product', 'mode', 'theme']);
  const iMap = ins('mappings', ['id', 'product', 'token', 'concept', 'match', 'confidence', 'status', 'review_by', 'rationale']);
  const iUnm = ins('unmapped', ['product', 'token', 'rationale']);
  const iTerm = ins('terms', ['product', 'term', 'concept', 'match']);
  for (const [product, s] of [...sources].sort(([a], [b]) => a.localeCompare(b))) {
    const version = s.package.version;
    const set = loadNative(root, product, version);
    const classified = fs.existsSync(path.join(root, 'data/classified', product, `${version}.json`)) ? new Map<string, any>(readJson(path.join(root, 'data/classified', product, `${version}.json`)).tokens.map((t: any) => [t.token, t])) : new Map();
    for (const [mode, theme] of Object.entries(set.modes)) iMode.run(product, mode, theme);
    const themes = set.themes.length ? set.themes : [''];
    for (const [p, t] of [...set.tokens].sort(([a], [b]) => a.localeCompare(b))) {
      iToken.run(product, p, String(t.prov.nativeName ?? ''), t.type ?? resolve(set, themes[0], p).type ?? null, t.description ?? null, classified.get(p)?.scope ?? null, (t.prov.visibility as string) ?? null, String(t.prov.file ?? ''), t.deprecated === undefined || t.deprecated === false ? null : typeof t.deprecated === 'string' ? t.deprecated : 'deprecated');
      for (const th of themes) { const r = resolve(set, th, p); iValue.run(product, p, th, r.value === undefined ? null : JSON.stringify(r.value), showValue(r.type, r.value), JSON.stringify(r.chain)); }
      add('tokens');
    }
    const m = readJson(path.join(root, 'mappings', product, `${version}.mappings.json`));
    for (const x of m.mappings.filter((x: any) => x.status === 'approved')) {
      iMap.run(x.id, product, x.token, x.concept, x.match, x.confidence ?? null, x.status, x.review?.by ?? null, x.rationale ?? null);
      add('mappings');
    }
    for (const x of (m.unmapped ?? []).filter((x: any) => x.status === 'approved')) { iUnm.run(product, x.token, x.rationale ?? null); add('unmapped'); }
    // Search covers tokens people look for: semantic and mapped ones (palettes and component tokens are reachable from them).
    const mapped = new Set(m.mappings.filter((x: any) => x.status === 'approved').map((x: any) => x.token));
    for (const [p, t] of set.tokens) if (mapped.has(p) || classified.get(p)?.scope === 'semantic') iSearch.run('token', `${product}/${p}`, p, `${t.prov.nativeName ?? ''} ${t.description ?? ''} ${product}`);
    const tp = path.join(root, 'mappings', product, 'terms.json');
    if (fs.existsSync(tp)) for (const x of readJson(tp).terms.filter((x: any) => x.status === 'approved')) { iTerm.run(product, x.term, x.concept, x.match); add('terms'); }
  }
  db.exec('COMMIT');
  db.exec("INSERT INTO search(search) VALUES ('optimize')");
  db.close();
  return counts;
}
