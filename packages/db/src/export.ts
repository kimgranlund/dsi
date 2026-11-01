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
  const facetValues = Object.fromEntries(['intent', 'usage', 'hue', 'syntax', 'component', 'part', 'property', 'style', 'emphasis', 'brightness', 'state'].map((f) => [f, facets.filter((c) => c.inScheme === `dsi:scheme/${f}` && !c.deprecated).map((c) => ({ value: String(c.id).split('/').pop(), label: c.prefLabel, definition: c.definition ?? null, ...(c.broader ? { broader: String(c.broader).split('/').pop() } : {}) }))]));
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
  // Homepage facts, all derived from the database and repo files: per-system coverage by category and mapping
  // status, token counts per layer (scope), audit totals, and one real alias chain per system.
  const CAT = (concept: string) => { const d = concept.split('/')[1]; return d === 'color' ? 'color' : d === 'typography' ? 'typography' : d === 'motion' ? 'motion' : 'geometry'; };
  for (const p of products) {
    const byCat: Record<string, number> = { color: 0, geometry: 0, typography: 0, motion: 0 };
    for (const r of all('SELECT DISTINCT token, concept FROM mappings WHERE product = ?', p.id)) byCat[CAT(r.concept)]++;
    const tokensByScope = Object.fromEntries(all("SELECT coalesce(scope, 'other') s, count(*) n FROM tokens WHERE product = ? GROUP BY 1", p.id).map((r) => [r.s, r.n]));
    const mf = path.join(root, 'mappings', p.id, `${p.version}.mappings.json`);
    const mfile = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : { mappings: [] };
    const proposed = new Set(mfile.mappings.filter((m: Row) => m.status === 'proposed').map((m: Row) => m.token)).size;
    const af = path.join(root, 'mappings', p.id, `${p.version}.audit.json`);
    const audit = fs.existsSync(af) ? JSON.parse(fs.readFileSync(af, 'utf8')).verdicts.reduce((acc: Row, v: Row) => ((acc[v.verdict] = (acc[v.verdict] ?? 0) + 1), acc), {}) : undefined;
    const components = all('SELECT count(DISTINCT component) n FROM component_sources WHERE product = ? AND absent = 0', p.id)[0].n;
    const sourcePath = path.join(root, 'sources', p.id, 'source.json');
    const lic = fs.existsSync(sourcePath) ? JSON.parse(fs.readFileSync(sourcePath, 'utf8')).license : undefined;
    // The longest alias chain from a component (else semantic) token down to a literal: the layers in one line.
    const chainOf = (scope: string) => all("SELECT t.path, v.alias_chain, v.display FROM tokens t JOIN token_values v USING (product, path) WHERE t.product = ? AND t.scope = ? AND t.type = 'color' AND v.theme IN (?, '') AND json_array_length(v.alias_chain) >= 1 ORDER BY json_array_length(v.alias_chain) DESC, t.path LIMIT 1", p.id, scope, p.modes.light ?? Object.values(p.modes)[0] ?? '')[0];
    const ex = chainOf('component') ?? chainOf('semantic');
    p.home = { byCat, tokensByScope, proposed, audit, components, license: lic?.spdx, status: p.counts.mapped === 0 ? 'not-started' : proposed > 0 ? 'in-progress' : 'mapped', chain: ex ? [ex.path, ...JSON.parse(ex.alias_chain)].slice(0, 6).concat([ex.display]) : undefined };
  }
  // A featured chain for the layers diagram: the first candidate that exists, with its alias chain in light mode.
  const FEATURED = [['material', 'md.comp.filled-button.container-color'], ['primer', 'button.primary.bgColor.rest'], ['spectrum', 'accent-background-color-default']];
  let featured: Row | undefined;
  for (const [pid, tp] of FEATURED) {
    const pr = products.find((x) => x.id === pid);
    const r = pr && all("SELECT v.alias_chain, v.display FROM token_values v WHERE v.product = ? AND v.path = ? AND v.theme IN (?, '') LIMIT 1", pid, tp, pr.modes.light ?? '')[0];
    if (r) { featured = { product: pid, steps: [tp, ...JSON.parse(r.alias_chain)], value: r.display, scopes: [tp, ...JSON.parse(r.alias_chain)].map((x: string) => all('SELECT scope FROM tokens WHERE product = ? AND path = ?', pid, x)[0]?.scope ?? null) }; break; }
  }
  sizes['meta.json'] = write('meta.json', { products, catalog, facets: facetValues, concepts: all('SELECT count(*) n FROM concepts')[0].n, featured });

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

  /**
   * Evaluate a computed CSS length (calc/max/min over var()s) to px, with each custom property's value from the
   * component's own resolved rows. Undefined when any part is not a plain px/rem length (em, %, unknown var).
   */
  /** A value with several top-level lengths (padding-inline: calc(...) calc(...)) evaluates each; equal results collapse. */
  const evalValue = (expr: string, lookup: (name: string) => string | undefined): string | undefined => {
    const parts: string[] = []; let d = 0, cur = '';
    for (const ch of expr.trim()) { if (ch === '(') d++; if (ch === ')') d--; if (/\s/.test(ch) && d === 0) { if (cur) parts.push(cur); cur = ''; continue; } cur += ch; }
    if (cur) parts.push(cur);
    const vs = parts.map((x) => evalLength(x, lookup));
    if (vs.some((v) => v === undefined)) return undefined;
    return [...new Set(vs)].join(' ');
  };
  const evalLength = (expr: string, lookup: (name: string) => string | undefined): string | undefined => {
    const sub = (str: string): string | undefined => {
      let out = '', i = 0;
      while (true) {
        const j = str.indexOf('var(', i);
        if (j < 0) return out + str.slice(i);
        let d = 0, k = j + 4;
        for (; k < str.length; k++) { if (str[k] === '(') d++; else if (str[k] === ')') { if (d === 0) break; d--; } }
        const inner = str.slice(j + 4, k); let c = -1, dd = 0;
        for (let q = 0; q < inner.length; q++) { if (inner[q] === '(') dd++; else if (inner[q] === ')') dd--; else if (inner[q] === ',' && dd === 0) { c = q; break; } }
        const name = (c < 0 ? inner : inner.slice(0, c)).trim();
        const v = lookup(name) ?? (c >= 0 ? sub(inner.slice(c + 1)) : undefined);
        if (v === undefined) return undefined;
        out += str.slice(i, j) + `(${v})`; i = k + 1;
      }
    };
    const s1 = sub(expr);
    if (!s1) return undefined;
    const js = s1.replace(/(-?\d*\.?\d+)(px|rem)?\b/g, (_, n, u) => String(u === 'rem' ? Number(n) * 16 : Number(n))).replace(/\bcalc\(/g, '(').replace(/\b(max|min)\(/g, 'Math.$1(');
    if (!/^[\d\s.+\-*/(),]*$/.test(js.replace(/Math\.(max|min)/g, ''))) return undefined;
    try { const n = Function(`"use strict"; return (${js});`)() as number; return Number.isFinite(n) ? `${Math.round(n * 100) / 100}px` : undefined; } catch { return undefined; }
  };
  /** Which side a padding or margin applies to: inline, block, or (shorthand with one value) both. */
  const axisOf = (role: string, prop: string, position: string | null) => {
    if (role !== 'padding' && role !== 'margin') return undefined;
    if (/-(inline|left|right)(-|$)/.test(prop)) return 'inline';
    if (/-(block|top|bottom)(-|$)/.test(prop)) return 'block';
    if (position) { const [i, n] = position.split('/').map(Number); if (n === 2 || n === 4) return i % 2 ? 'block' : 'inline'; if (n === 3) return i === 2 ? 'inline' : 'block'; }
    return undefined;
  };
  // Component tier (ADR 0015): per component, which token each system applies to each anatomy slot.
  const label = (scheme: string, v: string) => facetValues[scheme]?.find((x: Row) => x.value === v)?.label ?? v;
  const defaultTheme = (product: string) => { const m = modes.filter((x) => x.product === product); return (m.find((x) => x.mode === 'light') ?? m[0])?.theme ?? ''; };
  const apps = all('SELECT a.*, a.value AS selector_value, t.native_name, t.type, t.deprecated FROM applications a LEFT JOIN tokens t ON t.product = a.product AND t.path = a.token WHERE a.concept IS NOT NULL ORDER BY a.component, a.part, a.role, a.state, a.product');
  const value = (product: string, token: string) => { const r = all('SELECT display, alias_chain FROM token_values WHERE product = ? AND path = ? AND theme IN (?, \'\') ORDER BY theme DESC LIMIT 1', product, token, defaultTheme(product))[0]; return r ? { display: r.display, chain: JSON.parse(r.alias_chain) } : undefined; };
  const comps = all('SELECT * FROM component_sources ORDER BY component, product, match');
  const ids = [...new Set(comps.map((c) => c.component))];
  const PART_ORDER = ['container', 'header', 'label', 'body', 'input', 'supporting-text', 'icon', 'indicator', 'row', 'cell', 'footer'];
  const components = ids.map((id) => {
    const slots = new Map<string, Row>();
    for (const a of apps.filter((x) => x.component === id)) {
      const axis = axisOf(a.role, a.css_property, a.position);
      const key = `${a.concept}|${axis ?? ''}`;
      const slot = slots.get(key) ?? slots.set(key, { concept: a.concept, part: a.part, role: a.role, axis, state: a.state ?? undefined, label: `${label('part', a.part)} · ${label('property', a.role)}${axis ? ` ${axis}` : ''}${a.state ? ` · ${label('state', a.state)}` : ''}`, cells: {} as Row }).get(key)!;
      const list: Row[] = (slot.cells[a.product] ??= []);
      // A value computed from several tokens (calc, max) is one cell listing its inputs, not one cell per input.
      const computed = (JSON.parse(a.chain).length && /\b(calc|max|min)\(/.test(a.selector_value ?? '')) || undefined;
      const ck = `${a.native}|${computed ? `computed:${a.selector}:${a.css_property}` : a.token ?? a.literal}|${a.media ?? ''}`;
      let cell = list.find((c) => c.key === ck);
      if (cell && computed) { if (a.token && !cell.inputs.includes(a.token)) cell.inputs.push(a.token); cell.css.push({ selector: a.selector, property: a.css_property, how: a.how, file: a.file, line: a.line ?? undefined, media: a.media ?? undefined, chain: JSON.parse(a.chain), token: a.token ?? undefined, literal: a.literal ?? undefined }); continue; }
      if (!cell) {
        const v = a.token ? value(a.product, a.token) : undefined;
        cell = { key: ck, ...(computed ? { computed: a.selector_value, inputs: a.token ? [a.token] : [] } : {}), media: a.media ?? undefined, native: a.native, token: a.token ?? undefined, name: a.native_name ?? undefined, type: a.type ?? undefined, value: v?.display ?? a.literal ?? undefined, chain: v?.chain ?? [], literal: a.token ? undefined : a.literal ?? undefined, deprecated: a.deprecated ?? undefined, position: a.position ?? undefined, css: [] };
        list.push(cell);
      }
      cell.css.push({ selector: a.selector, property: a.css_property, how: a.how, file: a.file, line: a.line ?? undefined, media: a.media ?? undefined, chain: JSON.parse(a.chain), token: a.token ?? undefined, literal: a.literal ?? undefined });
    }
    // Each custom property name in a component's chains, to the value its token (or literal) resolves to.
    const named = new Map<string, string>();
    for (const sl of slots.values()) for (const [prod, list] of Object.entries(sl.cells) as [string, Row[]][]) for (const c of list) for (const r of c.css) { const v = r.token ? value(prod, r.token)?.display : r.literal; if (v) for (const n of r.chain) named.set(`${prod}|${c.native}|${n}`, v); }
    for (const sl of slots.values()) for (const [prod, list] of Object.entries(sl.cells) as [string, Row[]][]) for (const c of list) {
      delete c.key;
      if (c.computed) { c.value = evalValue(c.computed, (n) => named.get(`${prod}|${c.native}|${n}`)); delete c.token; delete c.chain; }
    }
    const systems: Row = {};
    for (const c of comps.filter((x) => x.component === id)) (systems[c.product] ??= []).push(c.absent ? { absent: true, evidence: c.evidence } : { native: c.native, match: c.match, variant: c.variant ?? undefined, evidence: c.evidence ?? undefined });
    const ordered = [...slots.values()].sort((a, b) => PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(b.part) || String(a.role).localeCompare(String(b.role)) || String(a.axis ?? '').localeCompare(String(b.axis ?? '')) || String(a.state ?? '').localeCompare(String(b.state ?? '')));
    return { id, label: label('component', id), definition: facetValues.component?.find((x: Row) => x.value === id)?.definition ?? null, systems, parts: PART_ORDER.filter((p) => ordered.some((s) => s.part === p)), slots: ordered };
  });
  sizes['components.json'] = write('components.json', components);

  sizes['search.json'] = write('search.json', all('SELECT kind, key, title, body FROM search').map((r) => [r.kind, r.key, r.title, r.body]));
  for (const f of fs.readdirSync(path.join(root, 'data/canonical')).filter((f) => f.endsWith('.css'))) fs.copyFileSync(path.join(root, 'data/canonical', f), path.join(outDir, 'canonical', f));
  db.close();
  return sizes;
}
