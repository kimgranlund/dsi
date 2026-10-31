#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import type { Adapter, SourceConfig } from './adapter.ts';
import { material } from './adapters/material.ts';
import { setPath, stable } from './dtcg.ts';
import { fetchNpm } from './fetch.ts';

const ADAPTERS: Record<string, Adapter> = { material };

const [product, rootArg] = process.argv.slice(2);
if (!product) { console.error('usage: dsi-ingest <product> [repo root]'); process.exit(2); }
const root = path.resolve(rootArg ?? '.');
const source = JSON.parse(fs.readFileSync(path.join(root, 'sources', product, 'source.json'), 'utf8')) as SourceConfig;
const adapter = ADAPTERS[source.adapter];
if (!adapter) { console.error(`no adapter "${source.adapter}"`); process.exit(2); }

const pkg = fetchNpm(path.join(root, '.cache'), source.package.name, source.package.version);
const { sets, report } = await adapter(pkg.dir, source);

const out = path.join(root, 'data', 'native', source.product, source.package.version);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const s of sets) {
  const tree: Record<string, unknown> = {};
  for (const [p, t] of [...s.tokens].sort(([a], [b]) => a.localeCompare(b))) setPath(tree, p, t);
  fs.writeFileSync(path.join(out, s.file), JSON.stringify(stable(tree), null, 2) + '\n');
}
const manifest = {
  product: source.product,
  implementation: source.implementation,
  package: { ...source.package, integrity: pkg.integrity },
  adapter: source.adapter,
  files: sets.map((s) => ({ file: s.file, ...(s.theme ? { theme: s.theme } : {}), tokens: s.tokens.size })).sort((a, b) => a.file.localeCompare(b.file)),
  counts: report.counts,
  notes: report.notes,
};
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${source.product}@${source.package.version}: ${JSON.stringify(report.counts)}`);
if (report.notes.length) console.log(`${report.notes.length} note(s) in ${path.relative(root, path.join(out, 'manifest.json'))}`);
