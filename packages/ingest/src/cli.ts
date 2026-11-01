#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import type { Adapter, SourceConfig } from './adapter.ts';
import { material } from './adapters/material.ts';
import { dtcg } from './adapters/dtcg.ts';
import { polaris } from './adapters/polaris.ts';
import { setPath, stable } from './dtcg.ts';
import { fetchNpm } from './fetch.ts';

const ADAPTERS: Record<string, Adapter> = { material, dtcg, polaris };

const [product, rootArg] = process.argv.slice(2);
if (!product) { console.error('usage: dsi-ingest <product> [repo root]'); process.exit(2); }
const root = path.resolve(rootArg ?? '.');
const source = JSON.parse(fs.readFileSync(path.join(root, 'sources', product, 'source.json'), 'utf8')) as SourceConfig;
const adapter = ADAPTERS[source.adapter];
if (!adapter) { console.error(`no adapter "${source.adapter}"`); process.exit(2); }

const fetched = [source.package, ...(source.dependencies ?? [])].map((p) => ({ ...p, ...fetchNpm(path.join(root, '.cache'), p.name, p.version) }));
const pkgs = Object.fromEntries(fetched.map((p) => [p.name, { dir: p.dir, version: p.version }]));
const { sets, report, defaultTheme, structure } = await adapter(pkgs, source);

const fileThemes = new Set(sets.map((s) => s.theme).filter(Boolean));
for (const t of source.themes ?? []) if (!fileThemes.has(t) && t !== defaultTheme) throw new Error(`theme "${t}" from source.json produced no file and is not the default theme`);
for (const t of fileThemes) if (!(source.themes ?? []).includes(t!)) throw new Error(`adapter emitted theme "${t}" that source.json does not list`);

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
  package: { ...source.package, integrity: fetched[0].integrity },
  ...(source.dependencies?.length ? { dependencies: fetched.slice(1).map(({ name, version, integrity, registry }) => ({ registry, name, version, integrity })) } : {}),
  adapter: source.adapter,
  ...(source.themes?.length ? { themes: source.themes } : {}),
  ...(defaultTheme ? { defaultTheme } : {}),
  ...(source.themeExtends ? { themeExtends: source.themeExtends } : {}),
  ...((source as any).modes ? { modes: (source as any).modes } : {}),
  files: sets.map((s) => ({ file: s.file, ...(s.theme ? { theme: s.theme } : {}), tokens: s.tokens.size })).sort((a, b) => a.file.localeCompare(b.file)),
  counts: report.counts,
  notes: report.notes,
  ...(structure ? { structure: { file: 'structure.json', kind: structure.kind, groups: structure.groups.length } } : {}),
};
if (structure) fs.writeFileSync(path.join(out, 'structure.json'), JSON.stringify(structure, null, 1) + '\n');
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${source.product}@${source.package.version}: ${JSON.stringify(report.counts)}`);
if (report.notes.length) console.log(`${report.notes.length} note(s) in ${path.relative(root, path.join(out, 'manifest.json'))}`);
