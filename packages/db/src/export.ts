import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type Row = Record<string, any>;

/**
 * Export the site's static data from the database (so the site and the future API read the same rows):
 * meta.json, concepts.json, tokens.<product>.json, search.json, and the canonical CSS bridges.
 */
export function exportSite(root: string, dbFile: string, outDir: string): Record<string, number> {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  const all = (sql: string, ...args: any[]) => db.prepare(sql).all(...args) as Row[];
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'canonical'), { recursive: true });
  const write = (name: string, data: unknown) => { const s = JSON.stringify(data); fs.writeFileSync(path.join(outDir, name), s); return s.length; };
  const sizes: Record<string, number> = {};

  const schemeDir = path.join(root, 'ontology/schemes');
  const facets = fs.readdirSync(schemeDir).filter((f) => f.endsWith('.jsonld')).flatMap((f) => JSON.parse(fs.readFileSync(path.join(schemeDir, f), 'utf8'))['@graph'] as Row[]);
  const facetValues = Object.fromEntries(['intent', 'usage', 'syntax', 'component', 'part', 'property', 'style', 'emphasis', 'brightness', 'state'].map((f) => [f, facets.filter((c) => c.inScheme === `dsi:scheme/${f}` && !c.deprecated).map((c) => ({ value: String(c.id).split('/').pop(), label: c.prefLabel, definition: c.definition ?? null, ...(c.broader ? { broader: String(c.broader).split('/').pop() } : {}) }))]));
  const modes = all('SELECT product, mode, theme FROM modes ORDER BY product, mode');
  const products = all("SELECT * FROM products WHERE version IS NOT NULL ORDER BY name").map((p): Row => ({
    ...p,
    modes: Object.fromEntries(modes.filter((m) => m.product === p.id).map((m) => [m.mode, m.theme])),
    counts: {
      tokens: (all('SELECT count(*) n FROM tokens WHERE product = ?', p.id)[0].n),
      mapped: (all('SELECT count(DISTINCT token) n FROM mappings WHERE product = ?', p.id)[0].n),
      unmapped: (all('SELECT count(*) n FROM unmapped WHERE product = ?', p.id)[0].n),
      answered: (all("SELECT count(DISTINCT concept) n FROM coverage WHERE product = ? AND status IN ('match','nearest')", p.id)[0].n),
    },
  }));
  const catalog = all('SELECT id, name, category, organization, homepage, description FROM products ORDER BY name');
  sizes['meta.json'] = write('meta.json', { products, catalog, facets: facetValues, concepts: all('SELECT count(*) n FROM concepts')[0].n });

  const cov = all('SELECT * FROM coverage');
  const byConcept = new Map<string, Row[]>();
  for (const c of cov) (byConcept.get(c.concept) ?? byConcept.set(c.concept, []).get(c.concept)!).push(c);
  // Scale concepts list every approved member per system, with its value in the system's default theme.
  const defTheme = new Map(all('SELECT product, theme FROM modes WHERE mode = ?', 'light').map((r) => [r.product, r.theme]));
  const memberRows = all("SELECT m.product, m.token, m.concept, m.match, v.display FROM mappings m LEFT JOIN token_values v ON v.product = m.product AND v.path = m.token AND (v.theme = '' OR v.theme = (SELECT theme FROM modes WHERE product = m.product AND mode = 'light')) WHERE m.concept NOT LIKE 'dsi:concept/color/%'");
  const members = new Map<string, Record<string, [string, string, string][]>>();
  for (const r of memberRows) { const byP = members.get(r.concept) ?? members.set(r.concept, {}).get(r.concept)!; (byP[r.product] ??= []).push([r.token, r.display ?? '', r.match]); }
  void defTheme;
  const concepts = all('SELECT * FROM concepts ORDER BY name').map((c) => {
    const cells: Record<string, Record<string, Row>> = {};
    for (const x of byConcept.get(c.iri) ?? []) if (x.status === 'match' || x.status === 'nearest') (cells[x.product] ??= {})[x.mode] = { s: x.status, t: x.token, m: x.match, via: x.via, d: x.display };
    return { iri: c.iri, group: c.grp, name: c.name, label: c.label, facets: JSON.parse(c.facets), cells, ...(members.has(c.iri) ? { members: members.get(c.iri) } : {}) };
  });
  sizes['concepts.json'] = write('concepts.json', concepts);

  for (const p of products) {
    const maps = all('SELECT token, concept, match, review_by FROM mappings WHERE product = ?', p.id);
    const mapped = new Map<string, Row[]>();
    for (const m of maps) (mapped.get(m.token) ?? mapped.set(m.token, []).get(m.token)!).push(m);
    const unm = new Map(all('SELECT token, rationale FROM unmapped WHERE product = ?', p.id).map((u) => [u.token, u.rationale]));
    const values = all('SELECT path, theme, display, alias_chain FROM token_values WHERE product = ?', p.id);
    const vals = new Map<string, Row>();
    for (const v of values) ((vals.get(v.path) ?? vals.set(v.path, {}).get(v.path)!) as Row)[v.theme || 'all'] = [v.display, JSON.parse(v.alias_chain)];
    const tokens = all("SELECT path, native_name, type, description, scope, visibility, deprecated FROM tokens WHERE product = ? AND (scope = 'semantic' OR path IN (SELECT token FROM mappings WHERE product = ?)) ORDER BY path", p.id, p.id).map((t) => ({
      p: t.path, n: t.native_name, t: t.type, d: t.description ?? undefined, s: t.scope, vis: t.visibility ?? undefined, dep: t.deprecated ?? undefined, v: vals.get(t.path),
      m: mapped.get(t.path)?.map((m) => [m.concept, m.match, m.review_by]) ?? [],
      u: unm.get(t.path) ?? undefined,
    }));
    sizes[`tokens.${p.id}.json`] = write(`tokens.${p.id}.json`, tokens);
    // Groups and order from the structure stage (shipped groups, shipped order, or name families), limited to exported tokens.
    const sp = path.join(root, 'data/structure', p.id, `${p.version}.json`);
    if (fs.existsSync(sp)) {
      const st = JSON.parse(fs.readFileSync(sp, 'utf8'));
      const have = new Set(tokens.map((t) => t.p));
      const keep = (ts: string[]) => ts.filter((t) => have.has(t));
      const groups = st.groups.map((g: Row) => ({ ...g, tokens: keep(g.tokens), subgroups: g.subgroups.map((x: Row) => ({ ...x, tokens: keep(x.tokens) })).filter((x: Row) => x.tokens.length) })).filter((g: Row) => g.tokens.length || g.subgroups.length);
      sizes[`groups.${p.id}.json`] = write(`groups.${p.id}.json`, { kind: st.kind, groups });
    }
  }

  sizes['search.json'] = write('search.json', all('SELECT kind, key, title, body FROM search').map((r) => [r.kind, r.key, r.title, r.body]));
  for (const f of fs.readdirSync(path.join(root, 'data/canonical')).filter((f) => f.endsWith('.css'))) fs.copyFileSync(path.join(root, 'data/canonical', f), path.join(outDir, 'canonical', f));
  db.close();
  return sizes;
}
