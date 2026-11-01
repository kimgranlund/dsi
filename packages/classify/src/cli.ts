#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadOntology } from '@dsi/schema';
import { loadNative, resolve, themeFor } from '@dsi/resolve';
import { classify, type TermsFile } from './classify.ts';
import { deriveTerms, mergeTerms, type ApprovedMapping } from './derive.ts';
import { mergeTermProposals, packetPath, readTermProposals, vocabulary } from './vocab.ts';
import { buildStructure, type ShippedStructure } from './structure.ts';
import { mapScales } from './scales.ts';
import crypto from 'node:crypto';
import { parseConcept } from '@dsi/schema';

const USAGE = `usage (from the repo root):
  dsi-classify derive <product>   learn candidate terms from approved mappings into mappings/<product>/terms.json
  dsi-classify eval <product>     leave-one-out accuracy of the classifier on approved color mappings
  dsi-classify run <product>      classify every native token -> data/classified/<product>/<version>.json
  dsi-classify structure <product>  group and order tokens -> data/structure/<product>/<version>.json
  dsi-classify vocab-prepare <product> <run>   write term packets .cache/classify/<run>/<product>.{a,b}.packet.json
  dsi-classify vocab-check <product> <run> <role>   validate one agent's term proposals
  dsi-classify vocab-merge <product> <run>     merge both agents' term proposals into mappings/<product>/terms.json`;
const [cmd, product, run, role] = process.argv.slice(2);
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
// Domain from the DTCG type at the end of the alias chain: alias tokens often carry no $type of their own.
const anyTheme = themeFor(set) ?? '';
const typeOf = (p: string) => set.tokens.get(p)?.type ?? resolve(set, anyTheme, p).type;
const domainOf = (p: string) => (typeOf(p) === 'color' ? 'color' : typeOf(p) ? 'other' : undefined);
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
    const c = classify(terms, p, fileOf(p), d === "color" ? "color" : "color", hints);
    return { ...c, domain: d, ...(d ? {} : { concept: undefined }) };
  });
  const dir = path.join(root, 'data/classified', product);
  fs.mkdirSync(dir, { recursive: true });
  const summary: Record<string, number> = {};
  for (const c of out) summary[c.scope] = (summary[c.scope] ?? 0) + 1;
  const full = out.filter((c) => c.domain === 'color' && c.concept && c.explained === 1).length;
  fs.writeFileSync(path.join(dir, `${version}.json`), JSON.stringify({ product, version, terms: 'mappings/' + product + '/terms.json', summary: { scopes: summary, colorTokensFullyExplained: full }, tokens: out }, null, 1) + '\n');
  console.log(`${product}: scopes ${JSON.stringify(summary)}; ${full} color tokens fully explained by terms -> data/classified/${product}/${version}.json`);
} else if (cmd === 'structure') {
  const shippedPath = path.join(root, 'data/native', product, version, 'structure.json');
  const shipped = fs.existsSync(shippedPath) ? (JSON.parse(fs.readFileSync(shippedPath, 'utf8')) as ShippedStructure) : undefined;
  const mappedConcept = new Map(approved.map((m) => [m.token, m.concept]));
  const scoped = [...set.tokens.keys()].filter((p) => mappedConcept.has(p) || (classify(terms, p, fileOf(p), 'color').scope === 'semantic' && domainOf(p) === 'color')).sort();
  const facetsOf = (t: string) => {
    const c = mappedConcept.get(t);
    const p = c ? parseConcept(o, c) : undefined;
    if (p && typeof p !== 'string') return p.facets as Record<string, string>;
    return classify(terms, t, fileOf(t), 'color').facets;
  };
  const st = buildStructure(scoped, terms, facetsOf, shipped);
  const dir = path.join(root, 'data/structure', product);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${version}.json`), JSON.stringify({ product, version, ...st }, null, 1) + '\n');
  const n = st.groups.reduce((a, g) => a + g.tokens.length + g.subgroups.reduce((b, s) => b + s.tokens.length, 0), 0);
  if (n !== scoped.length) { console.error(`structure placed ${n} of ${scoped.length} tokens`); process.exit(1); }
  console.log(`${product}: ${st.kind}; ${st.groups.length} groups for ${scoped.length} tokens -> data/structure/${product}/${version}.json`);
  for (const g of st.groups) console.log(`  ${g.label}${g.meaning ? ` = ${g.meaning}` : ''}${g.native && g.native !== g.label.toLowerCase() ? ` (${g.native})` : ''} [${g.source}, ${g.order}] ${g.tokens.length}${g.subgroups.length ? ' + ' + g.subgroups.map((s) => `${s.label}:${s.tokens.length}`).join(', ') : ''}`);
} else if (cmd === 'map-scales') {
  // Role concepts for non-color foundation tokens, from approved terms; approved mappings are never changed.
  const schemeDir = path.join(root, 'ontology/schemes');
  const graph = fs.readdirSync(schemeDir).filter((f) => f.endsWith('.jsonld')).flatMap((f) => JSON.parse(fs.readFileSync(path.join(schemeDir, f), 'utf8'))['@graph'] as any[]);
  const domainOfProperty = new Map<string, string>(graph.filter((c) => c['dsi:inDomain']).map((c) => [String(c.id).split('/').pop()!, String(c['dsi:inDomain'].id).split('/').pop()!]));
  const scoped = [...set.tokens.keys()].filter((p) => classify(terms, p, fileOf(p), 'color').scope === 'foundation' && domainOf(p) !== 'color').sort();
  const r = mapScales(o, terms, scoped.map((p) => ({ path: p, file: fileOf(p), type: typeOf(p) })), domainOfProperty);
  const file = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  const settled = new Set([...file.mappings.filter((m: any) => m.status === 'approved').map((m: any) => m.token), ...(file.unmapped ?? []).filter((u: any) => u.status === 'approved').map((u: any) => u.token)]);
  const at = new Date().toISOString();
  let added = 0;
  for (const m of r.mapped) {
    if (settled.has(m.token)) continue;
    const id = 'm-' + crypto.createHash('sha1').update([m.token, m.concept, 'exact'].join('|')).digest('hex').slice(0, 12);
    file.mappings = file.mappings.filter((x: any) => x.id !== id);
    file.mappings.push({ id, token: m.token, concept: m.concept, match: 'exact', confidence: 1, status: 'approved', rationale: 'Role and type roles from approved naming terms explain the whole name; the DTCG type fits the role (ADR 0013).', provenance: { agent: 'dsi-classify', at, method: 'map-scales-v1' }, review: { by: 'terms+classifier', at, note: 'Deterministic: every word is an approved term or a step word.' } });
    added++;
  }
  file.mappings.sort((a: any, b: any) => a.token.localeCompare(b.token) || a.id.localeCompare(b.id));
  fs.writeFileSync(mapFile, JSON.stringify(file, null, 2) + '\n');
  const why: Record<string, number> = {};
  for (const l of r.leftovers) { const k = l.why.split(':')[0]; why[k] = (why[k] ?? 0) + 1; }
  console.log(`${product}: ${scoped.length} foundation tokens; ${added} mapped (${r.mapped.length - added} already settled); ${r.leftovers.length} leftovers ${JSON.stringify(why)}`);
  for (const l of r.leftovers) console.log(`  ${l.token}: ${l.why}`);
} else if (cmd === 'vocab-prepare' || cmd === 'vocab-check' || cmd === 'vocab-merge') {
  if (!run) { console.error(USAGE); process.exit(2); }
  const runDir = path.join(root, '.cache/classify', run);
  // Vocabulary of the semantic color tokens (terms-v1), or of the non-color foundation tokens (terms-scale-v1).
  const scaleRun = run.includes('scale');
  const paths = [...set.tokens.keys()].filter((p) => scaleRun ? classify(terms, p, fileOf(p), 'color').scope === 'foundation' && domainOf(p) !== 'color' : classify(terms, p, fileOf(p), 'color').scope === 'semantic' && domainOf(p) === 'color');
  const vocab = vocabulary(paths, terms.noise ?? []);
  const single = new Set(vocab.filter((v) => !v.term.includes('-')).map((v) => v.term));
  if (cmd === 'vocab-prepare') {
    const facets = JSON.parse(fs.readFileSync(path.join(root, 'ontology/schemes/facets.jsonld'), 'utf8'))['@graph'] as any[];
    const schemeDir = path.join(root, 'ontology/schemes');
    const all = fs.readdirSync(schemeDir).filter((f) => f.endsWith('.jsonld')).flatMap((f) => JSON.parse(fs.readFileSync(path.join(schemeDir, f), 'utf8'))['@graph'] as any[]);
    const facetsFor = scaleRun ? ['usage', 'property', 'emphasis', 'state'] : ['intent', 'usage', 'property', 'emphasis', 'state'];
    const ontology = Object.fromEntries(facetsFor.map((f) => [f, all.filter((c) => c.inScheme === `dsi:scheme/${f}` && !c.deprecated && (!scaleRun || f !== 'property' || c['dsi:inDomain'] || String(c.id).endsWith('/shadow'))).map((c) => ({ concept: c.id, label: c.prefLabel, definition: c.definition, ...(c['dsi:inDomain'] ? { domain: c['dsi:inDomain'].id } : {}) }))]));
    const derived = terms.terms.filter((t) => t.status === 'proposed' && t.evidence).map(({ term, concept, evidence }) => ({ term, concept, evidence }));
    fs.mkdirSync(runDir, { recursive: true });
    for (const r of ['a', 'b']) fs.writeFileSync(packetPath(runDir, product, r), JSON.stringify({ id: `${scaleRun ? 'terms-scale-v1' : 'terms-v1'}/${product}`, role: r, product, instructions: scaleRun ? 'packages/classify/prompts/terms-scale-v1.md' : 'packages/classify/prompts/terms-v1.md', output: path.join(runDir, `${product}.${r}.proposals.json`), ontology, noise: terms.noise ?? [], vocabulary: vocab, derived }, null, 1) + '\n');
    console.log(`${product}: ${single.size} words (${vocab.length} entries with recurring sequences) from ${paths.length} ${scaleRun ? 'foundation' : 'semantic color'} tokens -> ${path.relative(root, packetPath(runDir, product, '{a,b}'))}`);
  } else if (cmd === 'vocab-check') {
    try { const pf = readTermProposals(path.join(runDir, `${product}.${role}.proposals.json`), o, single); console.log(`OK: ${pf.terms.length} entries, all ${single.size} words answered, all concepts valid`); }
    catch (e) { console.error(`FAIL: ${(e as Error).message}`); process.exit(1); }
  } else {
    const a = readTermProposals(path.join(runDir, `${product}.a.proposals.json`), o, single);
    const b = readTermProposals(path.join(runDir, `${product}.b.proposals.json`), o, single);
    const { file, counts } = mergeTermProposals(terms, a, b);
    fs.writeFileSync(termsPath, JSON.stringify(file, null, 2) + '\n');
    console.log(`${product}: ${counts.approved} terms approved by agreement, ${counts.noise} noise words agreed, ${counts.steps} step words agreed, ${counts.proposed} words queued for review -> ${path.relative(root, termsPath)}`);
  }
} else { console.error(USAGE); process.exit(2); }
