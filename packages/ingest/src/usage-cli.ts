#!/usr/bin/env node
// Build data/usage/<product>/<version>.json from the component CSS packages in sources/<product>/usage.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchNpm } from './fetch.ts';
import { readUses } from './usage.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const product = process.argv[2];
if (!product) { console.error('usage: usage-cli.ts <product>'); process.exit(2); }
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'sources', product, 'usage.json'), 'utf8')) as { packages: { name: string; version: string }[]; files: string[]; selectorComponent?: string };
const source = JSON.parse(fs.readFileSync(path.join(root, 'sources', product, 'source.json'), 'utf8'));
const version = source.package.version as string;
// CSS variable name -> token path, from the ingested DTCG files' provenance (nativeName).
const byVar = new Map<string, string>();
const nativeDir = path.join(root, 'data', 'native', product, version);
const walk = (o: any, pre: string[]) => { for (const [k, v] of Object.entries<any>(o)) { if (k.startsWith('$')) continue; if (v && typeof v === 'object' && '$value' in v) { const n = v.$extensions?.['io.nonoun.dsi']?.nativeName; if (typeof n === 'string' && n.startsWith('--')) byVar.set(n, [...pre, k].join('.')); } else if (v && typeof v === 'object') walk(v, [...pre, k]); } };
for (const f of fs.readdirSync(nativeDir).filter((f) => f.endsWith('.tokens.json'))) walk(JSON.parse(fs.readFileSync(path.join(nativeDir, f), 'utf8')), []);
// Glob over path segments: '*' within a segment, '**' for any depth.
const match = (dir: string, pattern: string): string[] => {
  const segs = pattern.split('/');
  const re = (g: string) => new RegExp('^' + g.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
  const walk = (d: string, i: number): string[] => {
    if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) return [];
    if (i === segs.length - 1) return fs.readdirSync(d).filter((f) => re(segs[i]).test(f)).map((f) => path.join(d, f)).filter((f) => fs.statSync(f).isFile());
    const subs = fs.readdirSync(d).filter((f) => fs.statSync(path.join(d, f)).isDirectory());
    if (segs[i] === '**') return [...walk(d, i + 1), ...subs.flatMap((f) => walk(path.join(d, f), i))];
    return subs.filter((f) => re(segs[i]).test(f)).flatMap((f) => walk(path.join(d, f), i + 1));
  };
  return walk(dir, 0);
};
// Component name from a file: its base name without '.css', '.out' or a content hash ('SideNav-baa2364d.css' -> SideNav).
const componentOfFile = (pkg: string, f: string) => { const b = path.basename(f).replace(/\.css$/, '').replace(/\.out$/, '').replace(/-[0-9a-f]{8}$/, ''); return /^(styles|index|index-vars)$/.test(b) ? pkg.split('/').pop()! : b; };
const files: { file: string; component: string }[] = [];
const versions: Record<string, string> = {};
for (const p of cfg.packages) {
  let dir: string;
  try { dir = fetchNpm(path.join(root, '.cache'), p.name, p.version).dir; } catch (e) { console.error(`skip ${p.name}@${p.version}: ${(e as Error).message.slice(0, 120)}`); continue; }
  versions[p.name] = p.version;
  const found = cfg.files.flatMap((f) => match(dir, f));
  const uniq = [...new Set(found)].filter((f) => !/-vars\.css$/.test(f) || found.length === 1);
  for (const f of uniq) files.push({ file: f, component: componentOfFile(p.name, f) });
}
// selectorComponent: a regex whose first group names the component in a selector, for one-file bundles (Carbon '.cds--button').
const selRe = cfg.selectorComponent ? new RegExp(cfg.selectorComponent) : undefined;
const uses = readUses(files, (v) => byVar.get(v), selRe ? (sel) => selRe.exec(sel)?.[1] : undefined);
const out = path.join(root, 'data', 'usage', product, `${version}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ product, tokensVersion: version, packages: versions, files: files.length, uses }, null, 1));
console.log(`${product}: ${uses.length} uses of ${new Set(uses.map((u) => u.token)).size} tokens in ${files.length} files -> ${path.relative(root, out)}`);
