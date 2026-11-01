#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as sass from 'sass';
import { extractCss, extractProps, readFiles, type ComponentConfig, type Row } from './apply.ts';
import { fetchNpm } from './fetch.ts';
import { stable } from './dtcg.ts';

/** dsi-apply <product>: sources/<product>/applications.json -> data/applications/<product>/<version>.json (ADR 0015). */
interface Config {
  product: string;
  packages: { registry: 'npm'; name: string; version: string }[];
  /** Sass builds whose CSS keeps token names (Carbon): `markers` configure modules so plain Sass variables compile to var(--dsi-<name>). */
  sass?: { id: string; source: string; markers?: { module: string; names: string[] }[] }[];
  /** Extra CSS names for token groups the product publishes as custom properties (Carbon type: --cds-{rest} for type.{rest}). */
  cssNames?: { group: string; pattern: string }[];
  components: (ComponentConfig & { sass?: string })[];
  /** Components the product does not ship, with evidence: shown as absent, not unknown. */
  absent?: { component: string; evidence: string }[];
}
const [product, rootArg] = process.argv.slice(2);
if (!product) { console.error('usage: dsi-apply <product> [repo root]'); process.exit(2); }
const root = path.resolve(rootArg ?? '.');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'sources', product, 'applications.json'), 'utf8')) as Config;
const source = JSON.parse(fs.readFileSync(path.join(root, 'sources', product, 'source.json'), 'utf8'));
const version = source.package.version as string;
const pkgs = Object.fromEntries(cfg.packages.map((p) => [p.name, { ...fetchNpm(path.join(root, '.cache'), p.name, p.version), version: p.version }]));

// Every ingested token, by the names it can appear under in CSS: its shipped native name and --<path with dashes>.
const byName = new Map<string, string>();
const walk = (o: Record<string, any>, p: string[] = []) => { for (const [k, v] of Object.entries(o)) { if (k.startsWith('$') || !v || typeof v !== 'object') continue; if ('$value' in v) { const tp = [...p, k].join('.'); const n = v.$extensions?.['io.nonoun.dsi']?.nativeName; if (n) byName.set(n, tp); byName.set('--' + tp.replaceAll('.', '-'), tp); } else walk(v, [...p, k]); } };
const nativeDir = path.join(root, 'data/native', product, version);
for (const f of fs.readdirSync(nativeDir)) if (f.endsWith('.tokens.json')) walk(JSON.parse(fs.readFileSync(path.join(nativeDir, f), 'utf8')));
for (const c of cfg.cssNames ?? []) for (const tp of [...new Set(byName.values())]) if (tp.startsWith(c.group + '.')) byName.set(c.pattern.replace('{rest}', tp.slice(c.group.length + 1).replaceAll('.', '-')), tp);
const isToken = (n: string) => byName.has(n) || /^--dsi-/.test(n);

// Sass builds: compile with the pinned packages linked into a temporary node_modules.
const built = new Map<string, string>();
if (cfg.sass?.length) {
  const nm = fs.mkdtempSync(path.join(os.tmpdir(), 'dsi-apply-'));
  try {
    for (const [name, { dir }] of Object.entries(pkgs)) { fs.mkdirSync(path.join(nm, path.dirname(name)), { recursive: true }); fs.symlinkSync(path.resolve(dir), path.join(nm, name), 'dir'); }
    for (const b of cfg.sass) {
      const withs = (b.markers ?? []).map((m) => `@use '${m.module}' with (${m.names.map((n) => `$${n}: var(--dsi-m-${n})`).join(', ')});`);
      try { built.set(b.id, sass.compileString([...withs, b.source].join('\n'), { loadPaths: [nm], logger: sass.Logger.silent, style: 'expanded' }).css); } catch (e) { throw new Error(`sass build ${b.id}: ${(e as Error).message.split('\n').slice(0, 6).join(' ')}`); }
      if (process.env.DSI_APPLY_DUMP) fs.writeFileSync(path.join(process.env.DSI_APPLY_DUMP, `${b.id}.css`), built.get(b.id)!);
    }
  } finally { fs.rmSync(nm, { recursive: true, force: true }); }
}

const rows: Row[] = [];
const notes: string[] = [];
for (const c of cfg.components) {
  const dir = pkgs[c.package ?? cfg.packages[0].name].dir;
  const files = [...readFiles(dir, c.css ?? []), ...(c.sass ? [{ rel: `sass:${c.sass}`, css: built.get(c.sass)! }] : [])];
  const r = extractCss(c, files, isToken);
  const props = extractProps(c, (rel) => fs.readFileSync(path.join(dir, rel), 'utf8'));
  rows.push(...r.rows, ...props);
  notes.push(`${c.component} (${c.native}): ${r.rows.length} css rows, ${props.length} prop defaults, ${r.skipped} declarations outside the part map`);
}
// Token names to ingested paths; Sass markers (--dsi-spacing-05) to the Sass variable's token by its native name ($spacing-05).
const sassName = new Map<string, string>();
for (const [n, p] of byName) if (n.startsWith('$')) sassName.set(n, p);
for (const r of rows) {
  const t = r.token;
  if (!t) continue;
  const m = t.match(/^--dsi-m-(.+)$/);
  const p = m ? (sassName.get(`$${m[1]}`) ?? [...byName.values()].find((tp) => tp.endsWith(`.${m[1]}`))) : byName.get(t);
  if (p) r.token = p; else { notes.push(`${r.component}: ${t} is not an ingested token`); delete r.token; }
}
const out = path.join(root, 'data/applications', product);
fs.mkdirSync(out, { recursive: true });
const doc = { product, version, packages: cfg.packages.map((p) => ({ ...p, integrity: pkgs[p.name].integrity })), components: cfg.components.map(({ component, native, match, variant, evidence }) => ({ component, native, match, ...(variant ? { variant } : {}), ...(evidence ? { evidence } : {}) })), ...(cfg.absent?.length ? { absent: cfg.absent } : {}), rows: rows.sort((a, b) => a.component.localeCompare(b.component) || a.native.localeCompare(b.native) || a.part.localeCompare(b.part) || a.cssProperty.localeCompare(b.cssProperty) || (a.state ?? '').localeCompare(b.state ?? '') || a.selector.localeCompare(b.selector)), notes };
fs.writeFileSync(path.join(out, `${version}.json`), JSON.stringify(stable(doc), null, 1) + '\n');
console.log(`${product}: ${rows.length} applications (${rows.filter((r) => r.token).length} on ingested tokens) -> data/applications/${product}/${version}.json`);
for (const n of notes) console.log('  ' + n);
