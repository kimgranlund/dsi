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
