#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadOntology } from '@dsi/schema';
import { merge, readProposals, APPROVE_AT, APPROVE_WITH_CLASSIFIER_AT, type ClassifierVotes } from './merge.ts';
import { classify, type TermsFile } from '@dsi/classify';
import { loadNative } from '@dsi/resolve';
import { preparePacket, readMappings, type Scope } from './packet.ts';
import { prepareAudit, readVerdicts } from './audit.ts';
import { applyDecisions, applyTermDecisions, collectQueue, collectTermQueue, renderPage, type Decision, type TermDecision } from './review.ts';

const USAGE = `usage:
  dsi-map prepare <scope> <run>   write <product>.{a,b}.packet.json for every product in the scope
  dsi-map merge <scope> <run>     merge <product>.{a,b}.proposals.json into mappings/ by two-agent agreement
  dsi-map check <scope> <run> <product> <role>   validate one proposals file against its packet
  dsi-map queue <scope>           list tokens whose mappings still need a human decision
  dsi-map audit-prepare <scope> <run>            deterministic checks + auditor packets for every approved mapping
  dsi-map audit-check <scope> <run> <product>    validate an auditor's verdicts
  dsi-map audit-merge <scope> <run>              write mappings/<product>/<version>.audit.json and list disputes
  dsi-map review <scope> <run> <out.html> [vocab run]  render the review page for the token queue (details from <run>) and term queue (from .cache/classify/<vocab run>)
  dsi-map apply-review <scope> <decisions.json> <reviewer>  apply decisions exported from the review page`;

const [cmd, scopeId, run] = process.argv.slice(2);
const root = process.cwd();
if (!cmd || !scopeId) { console.error(USAGE); process.exit(2); }
const scope = JSON.parse(fs.readFileSync(path.join(root, 'packages/mapper/scopes', `${scopeId}.json`), 'utf8')) as Scope;
const runDir = run ? path.join(root, '.cache/mapper', run) : '';
const ontology = await loadOntology(path.join(root, 'ontology'));
if (ontology.issues.length) { console.error('ontology has issues; run corepack pnpm check'); process.exit(1); }

if (cmd === 'prepare') {
  if (!run) { console.error(USAGE); process.exit(2); }
  for (const product of Object.keys(scope.products))
    for (const role of ['a', 'b'] as const) {
      const r = preparePacket(root, ontology, scope, product, role, runDir);
      if (role === 'a') console.log(`${product}: ${r.count} tokens to map (${r.skipped} already approved) -> ${path.relative(root, r.file).replace('.a.', '.{a,b}.')}`);
    }
} else if (cmd === 'merge') {
  if (!run) { console.error(USAGE); process.exit(2); }
  for (const [product, { version }] of Object.entries(scope.products)) {
    const packet = JSON.parse(fs.readFileSync(path.join(runDir, `${product}.a.packet.json`), 'utf8'));
    const tokens = new Set<string>(packet.tokens.map((t: { token: string }) => t.token));
    const a = readProposals(path.join(runDir, `${product}.a.proposals.json`), ontology, tokens);
    const b = readProposals(path.join(runDir, `${product}.b.proposals.json`), ontology, tokens);
    const impl = JSON.parse(fs.readFileSync(path.join(root, 'data/native', product, version, 'manifest.json'), 'utf8')).implementation;
    // Third vote: the classifier with approved terms only, counted only when it explains the whole name.
    const votes: ClassifierVotes = new Map();
    const termsPath = path.join(root, 'mappings', product, 'terms.json');
    if (fs.existsSync(termsPath)) {
      const terms = JSON.parse(fs.readFileSync(termsPath, 'utf8')) as TermsFile;
      const set = loadNative(root, product, version);
      for (const t of tokens) { const c = classify(terms, t, String(set.tokens.get(t)?.prov.file ?? ''), scope.domain); if (c.concept && c.explained === 1 && !c.conflicts.length) votes.set(t, c.concept); }
    }
    const r = merge(root, product, version, impl, a, b, scope.id, undefined, votes);
    console.log(`${product}: ${r.approved} approved, ${r.approvedWithClassifier} approved with the classifier's vote, ${r.approvedUnmapped} agreed unmapped, ${r.queued} queued for review -> ${r.file}`);
  }
  console.log(`approval rule: same concept and match from two models, both confidence >= ${APPROVE_AT}; or >= ${APPROVE_WITH_CLASSIFIER_AT} when the classifier (approved terms, whole name explained) gives the same concept and the match is exact or close`);
} else if (cmd === 'check') {
  const [product, role] = process.argv.slice(5);
  if (!run || !product || !role) { console.error(USAGE); process.exit(2); }
  const packet = JSON.parse(fs.readFileSync(path.join(runDir, `${product}.${role}.packet.json`), 'utf8'));
  try {
    const pf = readProposals(path.join(runDir, `${product}.${role}.proposals.json`), ontology, new Set(packet.tokens.map((t: { token: string }) => t.token)));
    console.log(`OK: ${pf.proposals.length} proposals, all packet tokens answered, all concepts valid`);
  } catch (e) { console.error(`FAIL: ${(e as Error).message}`); process.exit(1); }
} else if (cmd === 'review') {
  const [out, vocabRun] = [process.argv[5], process.argv[6]];
  if (!run || !out) { console.error(USAGE); process.exit(2); }
  const items = collectQueue(root, scope, runDir);
  const termItems = vocabRun ? collectTermQueue(root, Object.keys(scope.products), path.join(root, '.cache/classify', vocabRun)) : [];
  const packet = JSON.parse(fs.readFileSync(path.join(runDir, `${Object.keys(scope.products)[0]}.a.packet.json`), 'utf8'));
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, renderPage(root, items, packet.ontology, new Date().toISOString(), termItems));
  console.log(`${items.length} queued tokens, ${termItems.length} queued words -> ${out}`);
} else if (cmd === 'apply-review') {
  const [file, reviewer] = [process.argv[4], process.argv[5]];
  if (!file || !reviewer) { console.error(USAGE); process.exit(2); }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const all = (Array.isArray(raw) ? raw : raw.documents ?? raw.docs ?? []).map((d: any) => d.data ?? d);
  // Token decisions and term decisions may come in one export; term decisions carry a `term` field.
  console.log('tokens', JSON.stringify(applyDecisions(root, scope, all.filter((d: any) => !('term' in d)) as Decision[], reviewer)));
  console.log('terms ', JSON.stringify(applyTermDecisions(root, all.filter((d: any) => 'term' in d) as TermDecision[], reviewer)));
} else if (cmd === 'audit-prepare') {
  if (!run) { console.error(USAGE); process.exit(2); }
  const dir = path.join(root, '.cache/audit', run);
  for (const product of Object.keys(scope.products)) {
    const r = prepareAudit(root, ontology, scope, product, dir);
    const by: Record<string, number> = {};
    for (const f of r.findings) by[f.check] = (by[f.check] ?? 0) + 1;
    console.log(`${product}: ${r.count} approved mappings to audit; check findings ${JSON.stringify(by)}`);
    for (const f of r.findings.slice(0, 50)) console.log(`  ${f.check}  ${f.token}: ${f.detail}`);
  }
} else if (cmd === 'audit-check' || cmd === 'audit-merge') {
  if (!run) { console.error(USAGE); process.exit(2); }
  const dir = path.join(root, '.cache/audit', run);
  const products = cmd === 'audit-check' ? [process.argv[5]] : Object.keys(scope.products);
  for (const product of products) {
    const packet = JSON.parse(fs.readFileSync(path.join(dir, `${product}.audit-packet.json`), 'utf8'));
    const expected = new Map<string, string>(packet.items.map((i: any) => [i.token, i.mappingId]));
    try {
      const v = readVerdicts(path.join(dir, `${product}.verdicts.json`), ontology, expected);
      const c: Record<string, number> = {};
      for (const x of v.verdicts) c[x.verdict] = (c[x.verdict] ?? 0) + 1;
      if (cmd === 'audit-check') { console.log(`OK: ${v.verdicts.length} verdicts ${JSON.stringify(c)}`); continue; }
      const checks = packet.items.flatMap((i: any) => i.checks.map((d: string) => ({ token: i.token, finding: d })));
      const out = path.join(root, 'mappings', product, `${scope.products[product].version}.audit.json`);
      fs.writeFileSync(out, JSON.stringify({ packet: v.packet, model: v.model, at: v.at, checks, verdicts: v.verdicts.sort((a: any, b: any) => a.token.localeCompare(b.token)) }, null, 2) + '\n');
      console.log(`${product}: ${JSON.stringify(c)} -> ${path.relative(root, out)}`);
      for (const x of v.verdicts.filter((x: any) => x.verdict === 'contradicted')) console.log(`  disputed ${x.token}: ${packet.items.find((i: any) => i.token === x.token).mapping.concept.replace('dsi:concept/color/', '')} -> ${x.suggested.concept.replace('dsi:concept/color/', '')} ${x.suggested.match}`);
    } catch (e) { console.error(`FAIL: ${(e as Error).message}`); process.exit(1); }
  }
} else if (cmd === 'queue') {
  for (const [product, { version }] of Object.entries(scope.products)) {
    const m = readMappings(root, product, version) as any;
    if (!m) continue;
    const open = new Map<string, any[]>();
    for (const x of m.mappings ?? []) if (x.status === 'proposed') (open.get(x.token) ?? open.set(x.token, []).get(x.token)!).push(x);
    for (const x of m.unmapped ?? []) if (x.status === 'proposed') (open.get(x.token) ?? open.set(x.token, []).get(x.token)!).push({ ...x, concept: '(unmapped)', match: '' });
    if (!open.size) continue;
    console.log(`\n${product}@${version}: ${open.size} token(s) need a decision`);
    for (const [token, xs] of [...open].sort()) console.log(`  ${token}\n${xs.map((x) => `    ${x.provenance.model}: ${x.concept} ${x.match}${x.confidence !== undefined ? ` (${x.confidence})` : ''}`).join('\n')}`);
  }
} else { console.error(USAGE); process.exit(2); }
