#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadOntology } from '@dsi/schema';
import { loadNative, resolve, showValue, themeFor } from './native.ts';
import { readMappingSet, resolveConcept } from './concept.ts';

const USAGE = `usage (from the repo root):
  dsi-resolve token <product> <token path> [mode]   follow a native token's aliases to its value
  dsi-resolve concept <concept IRI> [mode]          how every ingested product answers a canonical concept`;
const [cmd, ...args] = process.argv.slice(2);
const root = process.cwd();
const versionOf = (product: string) => JSON.parse(fs.readFileSync(path.join(root, 'sources', product, 'source.json'), 'utf8')).package.version as string;

if (cmd === 'token' && args.length >= 2) {
  const [product, token, mode] = args;
  const set = loadNative(root, product, versionOf(product));
  const theme = themeFor(set, mode);
  if (theme === undefined) { console.error(`${product} declares no theme for mode "${mode}"`); process.exit(1); }
  const r = resolve(set, theme, token);
  console.log(`${product} ${token}${theme ? ` (${theme})` : ''}: ${[token, ...r.chain].join(' -> ')} = ${r.problem ?? showValue(r.type, r.value)}`);
} else if (cmd === 'concept' && args.length >= 1) {
  const [concept, mode] = args;
  const o = await loadOntology(path.join(root, 'ontology'));
  for (const product of fs.readdirSync(path.join(root, 'data/native')).filter((p) => fs.existsSync(path.join(root, 'sources', p, 'source.json')))) {
    const version = versionOf(product);
    const a = resolveConcept(o, loadNative(root, product, version), readMappingSet(root, product, version), concept, mode);
    const head = `${product.padEnd(8)} ${a.status.padEnd(7)}`;
    if (!a.answer) { console.log(`${head} ${a.note ?? ''}`); continue; }
    console.log(`${head} ${a.answer.token} [${a.answer.match}${a.answer.via === 'more-specific' ? ', more specific' : ''}] ${a.answer.display}${a.theme ? ` (${a.theme})` : ''}${a.candidates.length > 1 ? `  +${a.candidates.length - 1} more` : ''}`);
  }
} else { console.error(USAGE); process.exit(2); }
