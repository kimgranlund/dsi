#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadOntology } from '@dsi/schema';
import { merge, readProposals, APPROVE_AT } from './merge.ts';
import { preparePacket, readMappings, type Scope } from './packet.ts';

const USAGE = `usage:
  dsi-map prepare <scope> <run>   write <product>.{a,b}.packet.json for every product in the scope
  dsi-map merge <scope> <run>     merge <product>.{a,b}.proposals.json into mappings/ by two-agent agreement
  dsi-map check <scope> <run> <product> <role>   validate one proposals file against its packet
  dsi-map queue <scope>           list tokens whose mappings still need a human decision`;

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
    const r = merge(root, product, version, impl, a, b, scope.id);
    console.log(`${product}: ${r.approved} approved, ${r.approvedUnmapped} agreed unmapped, ${r.queued} queued for review -> ${r.file}`);
  }
  console.log(`approval rule: same concept and match from two models, both confidence >= ${APPROVE_AT}`);
} else if (cmd === 'check') {
  const [product, role] = process.argv.slice(5);
  if (!run || !product || !role) { console.error(USAGE); process.exit(2); }
  const packet = JSON.parse(fs.readFileSync(path.join(runDir, `${product}.${role}.packet.json`), 'utf8'));
  try {
    const pf = readProposals(path.join(runDir, `${product}.${role}.proposals.json`), ontology, new Set(packet.tokens.map((t: { token: string }) => t.token)));
    console.log(`OK: ${pf.proposals.length} proposals, all packet tokens answered, all concepts valid`);
  } catch (e) { console.error(`FAIL: ${(e as Error).message}`); process.exit(1); }
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
