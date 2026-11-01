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
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'sources', product, 'usage.json'), 'utf8')) as { packages: { name: string; version: string }[]; files: string[] };
const source = JSON.parse(fs.readFileSync(path.join(root, 'sources', product, 'source.json'), 'utf8'));
const version = source.package.version as string;
// CSS variable name -> token path, from the ingested DTCG files' provenance (nativeName).
const byVar = new Map<string, string>();
const nativeDir = path.join(root, 'data', 'native', product, version);
const walk = (o: any, pre: string[]) => { for (const [k, v] of Object.entries<any>(o)) { if (k.startsWith('$')) continue; if (v && typeof v === 'object' && '$value' in v) { const n = v.$extensions?.['io.nonoun.dsi']?.nativeName; if (typeof n === 'string' && n.startsWith('--')) byVar.set(n, [...pre, k].join('.')); } else if (v && typeof v === 'object') walk(v, [...pre, k]); } };
for (const f of fs.readdirSync(nativeDir).filter((f) => f.endsWith('.tokens.json'))) walk(JSON.parse(fs.readFileSync(path.join(nativeDir, f), 'utf8')), []);
const match = (dir: string, pattern: string) => {
  const [d, glob] = pattern.includes('*') ? [path.dirname(pattern), path.basename(pattern)] : [path.dirname(pattern), path.basename(pattern)];
  const full = path.join(dir, d);
  if (!fs.existsSync(full)) return [];
  const re = new RegExp('^' + glob.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
  return fs.readdirSync(full).filter((f) => re.test(f)).map((f) => path.join(full, f));
};
const files: { file: string; component: string }[] = [];
const versions: Record<string, string> = {};
for (const p of cfg.packages) {
  let dir: string;
  try { dir = fetchNpm(path.join(root, '.cache'), p.name, p.version).dir; } catch (e) { console.error(`skip ${p.name}@${p.version}: ${(e as Error).message.slice(0, 120)}`); continue; }
  versions[p.name] = p.version;
  const found = cfg.files.flatMap((f) => match(dir, f));
  const uniq = [...new Set(found)].filter((f) => !/-vars\.css$/.test(f) || found.length === 1);
  for (const f of uniq) files.push({ file: f, component: p.name.split('/').pop()!.replace(/^css$/, path.basename(f, '.css')) });
}
const uses = readUses(files, (v) => byVar.get(v));
const out = path.join(root, 'data', 'usage', product, `${version}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ product, tokensVersion: version, packages: versions, files: files.length, uses }, null, 1));
console.log(`${product}: ${uses.length} uses of ${new Set(uses.map((u) => u.token)).size} tokens in ${files.length} files -> ${path.relative(root, out)}`);
