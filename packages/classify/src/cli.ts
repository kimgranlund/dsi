#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadOntology } from '@dsi/schema';
import { loadNative } from '@dsi/resolve';
import { classify, type TermsFile } from './classify.ts';
import { deriveTerms, mergeTerms, type ApprovedMapping } from './derive.ts';

const USAGE = `usage (from the repo root):
  dsi-classify derive <product>   learn candidate terms from approved mappings into mappings/<product>/terms.json
  dsi-classify eval <product>     leave-one-out accuracy of the classifier on approved color mappings
  dsi-classify run <product>      classify every native token -> data/classified/<product>/<version>.json`;
const [cmd, product] = process.argv.slice(2);
if (!cmd || !product) { console.error(USAGE); process.exit(2); }
const root = process.cwd();
const version = JSON.parse(fs.readFileSync(path.join(root, 'sources', product, 'source.json'), 'utf8')).package.version as string;
const termsPath = path.join(root, 'mappings', product, 'terms.json');
const terms: TermsFile = JSON.parse(fs.readFileSync(termsPath, 'utf8'));
const o = await loadOntology(path.join(root, 'ontology'));
const mapFile = path.join(root, 'mappings', product, `${version}.mappings.json`);
const approved: ApprovedMapping[] = fs.existsSync(mapFile) ? JSON.parse(fs.readFileSync(mapFile, 'utf8')).mappings.filter((m: any) => m.status === 'approved') : [];
const exactish = approved.filter((m) => m.match === 'exact' || m.match === 'close');
const set = loadNative(root, product, version);
const fileOf = (p: string) => String(set.tokens.get(p)?.prov.file ?? '');
const domainOf = (p: string) => (set.tokens.get(p)?.type === 'color' || /color/.test(fileOf(p)) ? 'color' : undefined);
const hints = new Set(['approved', 'proposed']);

if (cmd === 'derive') {
  const derived = deriveTerms(o, product, approved, terms.noise ?? []);
  const merged = mergeTerms(terms, derived);
  fs.writeFileSync(termsPath, JSON.stringify(merged, null, 2) + '\n');
  console.log(`${product}: ${derived.length} candidate terms from ${exactish.length} approved exact/close mappings -> ${path.relative(root, termsPath)}`);
} else if (cmd === 'eval') {
  let produced = 0, correct = 0, partial = 0;
  const misses: string[] = [];
  for (const m of exactish) {
    // Leave this token out, learn terms from the rest, then classify it.
    const learned = deriveTerms(o, product, approved.filter((x) => x.token !== m.token), terms.noise ?? []);
    const c = classify({ ...terms, terms: learned }, m.token, fileOf(m.token), 'color', hints);
    if (!c.concept) continue;
    produced++;
    if (c.concept === m.concept) correct++;
    else { const want = m.concept.split('/').slice(3), got = c.concept.split('/').slice(3); if (got.every((g) => want.includes(g))) partial++; misses.push(`${m.token}: classifier ${c.concept.replace('dsi:concept/color/', '')} vs approved ${m.concept.replace('dsi:concept/color/', '')}`); }
  }
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : 'n/a');
  console.log(`${product}: ${exactish.length} approved exact/close mappings; classifier proposed a concept for ${produced} (${pct(produced, exactish.length)})`);
  console.log(`  exact concept: ${correct} (${pct(correct, produced)} of proposed); right facets but incomplete: ${partial}; wrong: ${produced - correct - partial}`);
  for (const x of misses.slice(0, 8)) console.log('  ' + x);
} else if (cmd === 'run') {
  const out = [...set.tokens.keys()].sort().map((p) => {
    const d = domainOf(p);
    const c = classify(terms, p, fileOf(p), d ?? 'color', hints);
    return { ...c, domain: d, ...(d ? {} : { concept: undefined }) };
  });
  const dir = path.join(root, 'data/classified', product);
  fs.mkdirSync(dir, { recursive: true });
  const summary: Record<string, number> = {};
  for (const c of out) summary[c.scope] = (summary[c.scope] ?? 0) + 1;
  const full = out.filter((c) => c.domain === 'color' && c.concept && c.explained === 1).length;
  fs.writeFileSync(path.join(dir, `${version}.json`), JSON.stringify({ product, version, terms: 'mappings/' + product + '/terms.json', summary: { scopes: summary, colorTokensFullyExplained: full }, tokens: out }, null, 1) + '\n');
  console.log(`${product}: scopes ${JSON.stringify(summary)}; ${full} color tokens fully explained by terms -> data/classified/${product}/${version}.json`);
} else { console.error(USAGE); process.exit(2); }
