import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRepo } from '@dsi/schema';
import { merge, type ProposalFile } from '../src/merge.ts';
import { applyDecisions } from '../src/review.ts';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const D = 'dsi:concept/color/intent-danger';
const BG = 'dsi:concept/color/intent-danger/property-background';
const pf = (role: 'a' | 'b', model: string, proposals: any[]): ProposalFile => ({ packet: 'p', role, model, at: '2026-10-31T12:00:00Z', proposals });
const scope = { id: 'color-v1', domain: 'color', prompt: '', products: { material: { version: '2.5.0' } } };

test('decisions become approved and rejected records that pass the repo validator', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsi-review-'));
  fs.cpSync(path.join(REPO, 'catalog'), path.join(root, 'catalog'), { recursive: true });
  const toks = ['md.sys.color.a', 'md.sys.color.b', 'md.sys.color.c', 'md.sys.color.d'];
  const a = pf('a', 'opus', toks.map((token) => ({ token, concept: D, match: 'close', confidence: 0.7, rationale: 'r' })));
  const b = pf('b', 'sonnet', toks.map((token) => (token.endsWith('d') ? { token, unmapped: true, rationale: 'r' } : { token, concept: BG, match: 'exact', confidence: 0.9, rationale: 'r' })));
  merge(root, 'material', '2.5.0', 'material-web', a, b, 'color-v1');
  const file = path.join(root, 'mappings/material/2.5.0.mappings.json');
  const before = JSON.parse(fs.readFileSync(file, 'utf8'));
  const chosen = before.mappings.find((m: any) => m.token === 'md.sys.color.a' && m.concept === BG).id;
  const at = '2026-11-01T10:00:00Z';
  const counts = applyDecisions(root, scope, [
    { key: 'k', product: 'material', token: 'md.sys.color.a', action: 'accept', candidateId: chosen, at },
    { key: 'k', product: 'material', token: 'md.sys.color.b', action: 'custom', concept: 'dsi:concept/color/intent-danger/property-text', match: 'close', note: 'text only', at },
    { key: 'k', product: 'material', token: 'md.sys.color.c', action: 'reject', at },
    { key: 'k', product: 'material', token: 'md.sys.color.d', action: 'unmapped', at },
  ], 'kimgranlund');
  assert.deepEqual(counts, { accept: 1, custom: 1, unmapped: 1, reject: 1, skipped: 0 });
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  const st = (t: string) => after.mappings.filter((m: any) => m.token === t).map((m: any) => m.status).sort();
  assert.deepEqual(st('md.sys.color.a'), ['approved', 'rejected']);
  assert.deepEqual(st('md.sys.color.b'), ['approved', 'rejected', 'rejected']);
  assert.deepEqual(st('md.sys.color.c'), ['rejected', 'rejected']);
  assert.deepEqual(st('md.sys.color.d'), ['rejected']);
  assert.deepEqual(after.unmapped.map((u: any) => [u.token, u.status]), [['md.sys.color.d', 'approved']]);
  assert.equal(applyDecisions(root, scope, [{ key: 'k', product: 'material', token: 'md.sys.color.a', action: 'reject', at }], 'kimgranlund').skipped, 1);
  const issues = await validateRepo({ root, ontologyDir: path.join(REPO, 'ontology') });
  assert.deepEqual(issues.filter((i) => i.file.startsWith('mappings')), []);
});

import { applyTermDecisions, collectTermQueue } from '../src/review.ts';

test('term decisions approve, reject and add noise, and the result validates', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsi-terms-'));
  fs.cpSync(path.join(REPO, 'catalog'), path.join(root, 'catalog'), { recursive: true });
  fs.mkdirSync(path.join(root, 'mappings/polaris'), { recursive: true });
  const prov = (model: string) => ({ agent: 'dsi-classify', model, at: '2026-11-01T00:00:00Z', method: 'terms-v1' });
  fs.writeFileSync(path.join(root, 'mappings/polaris/terms.json'), JSON.stringify({ product: 'polaris', noise: ['color'], terms: [
    { term: 'bg', concept: 'dsi:property/background', match: 'exact', status: 'proposed', provenance: prov('opus') },
    { term: 'bg', concept: 'dsi:usage/surface', match: 'exact', status: 'proposed', provenance: prov('sonnet') },
    { term: 'tertiary', concept: 'dsi:emphasis/subtlest', match: 'close', status: 'proposed', provenance: prov('opus') },
    { term: 'video', concept: 'dsi:usage/surface', match: 'related', status: 'proposed', provenance: prov('opus') },
  ] }));
  const q = collectTermQueue(root, ['polaris'], path.join(root, 'none'));
  assert.deepEqual(q.map((x) => [x.term, x.candidates.length]), [['bg', 2], ['tertiary', 1], ['video', 1]]);
  const bgId = q[0].candidates.find((c) => c.concept === 'dsi:property/background')!.id;
  const at = '2026-11-01T10:00:00Z';
  const counts = applyTermDecisions(root, [
    { key: 'k', product: 'polaris', term: 'bg', action: 'accept', candidateId: bgId, at },
    { key: 'k', product: 'polaris', term: 'tertiary', action: 'custom', concept: 'dsi:emphasis/subtle', match: 'broad', at },
    { key: 'k', product: 'polaris', term: 'video', action: 'ignore', ignore: 'noise', at },
  ], 'kimgranlund');
  assert.deepEqual(counts, { accept: 1, custom: 1, ignore: 1, reject: 0, skipped: 0 });
  const f = JSON.parse(fs.readFileSync(path.join(root, 'mappings/polaris/terms.json'), 'utf8'));
  const st = (t: string) => f.terms.filter((x: any) => x.term === t).map((x: any) => `${x.concept}:${x.status}`).sort();
  assert.deepEqual(st('bg'), ['dsi:property/background:approved', 'dsi:usage/surface:rejected']);
  assert.deepEqual(st('tertiary'), ['dsi:emphasis/subtle:approved', 'dsi:emphasis/subtlest:rejected']);
  assert.ok(f.noise.includes('video'));
  const issues = await validateRepo({ root, ontologyDir: path.join(REPO, 'ontology') });
  assert.deepEqual(issues.filter((i) => i.file.includes('terms')), []);
});
