#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadOntology } from '@dsi/schema';
import { facetLabels, loadNative, readMappingSet } from '@dsi/resolve';
import { buildCanon } from './canon.ts';

// Usage (from the repo root): dsi-canon -> data/canonical/
const root = process.cwd();
const o = await loadOntology(path.join(root, 'ontology'));
const stable = (v: unknown): unknown => (Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter((k) => (v as any)[k] !== undefined).map((k) => [k, stable((v as any)[k])])) : v);
const products = fs.readdirSync(path.join(root, 'sources')).filter((p) => fs.existsSync(path.join(root, 'sources', p, 'source.json'))).sort().map((p) => {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'sources', p, 'source.json'), 'utf8')).package.version;
  const cat = fs.readdirSync(path.join(root, 'catalog'), { recursive: true, encoding: 'utf8' }).find((f) => f.endsWith(`/${p}.json`));
  const name = cat ? JSON.parse(fs.readFileSync(path.join(root, 'catalog', cat), 'utf8')).name : p;
  return { set: loadNative(root, p, version), maps: readMappingSet(root, p, version), name };
});
const r = buildCanon(o, facetLabels(root), products);
const out = path.join(root, 'data/canonical');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const files = [];
for (const [key, f] of [...r.files].sort(([a], [b]) => a.localeCompare(b))) {
  fs.writeFileSync(path.join(out, `${key}.tokens.json`), JSON.stringify(stable(f.tree), null, 2) + '\n');
  fs.writeFileSync(path.join(out, `${key}.css`), f.css);
  const n = Object.values(f.tree).reduce((a, g) => a + Object.keys(g).length, 0);
  files.push({ file: `${key}.tokens.json`, css: `${key}.css`, product: f.product, mode: f.mode, theme: f.theme || undefined, tokens: n });
}
const status: Record<string, number> = {};
for (const byP of Object.values(r.coverage)) for (const byM of Object.values(byP)) for (const c of Object.values(byM)) status[c.status] = (status[c.status] ?? 0) + 1;
const manifest = { sources: products.map((p) => ({ product: p.set.product, version: p.set.version })), concepts: r.concepts, files, coverage: r.coverage, summary: { concepts: r.concepts.length, cells: status } };
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(stable(manifest), null, 1) + '\n');
console.log(`${r.concepts.length} canonical concepts, ${files.length} product/mode files -> data/canonical/; cells ${JSON.stringify(status)}`);
for (const f of files) console.log(`  ${f.file}: ${f.tokens} tokens`);
