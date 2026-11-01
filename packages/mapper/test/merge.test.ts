import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOntology } from '@dsi/schema';
import { merge, readProposals, type ProposalFile } from '../src/merge.ts';

const ONTOLOGY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../ontology');
const o = await loadOntology(ONTOLOGY);
const D = 'dsi:concept/color/intent-danger';
const BG = 'dsi:concept/color/intent-danger/property-background';
const pf = (role: 'a' | 'b', model: string, proposals: any[]): ProposalFile => ({ packet: 'p', role, model, at: '2026-10-31T12:00:00Z', proposals });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dsi-map-'));
const read = (root: string) => JSON.parse(fs.readFileSync(path.join(root, 'mappings/x/1.0.0.mappings.json'), 'utf8'));

test('agreement approves; disagreement, low confidence and match mismatch are queued', () => {
  const root = tmp();
  const a = pf('a', 'opus', [
    { token: 'agree', concept: D, match: 'close', confidence: 0.9, rationale: 'r' },
    { token: 'differ', concept: D, match: 'close', confidence: 0.9, rationale: 'r' },
    { token: 'low', concept: D, match: 'close', confidence: 0.65, rationale: 'r' }, // under the 0.7 bar (ADR 0005 amended)
    { token: 'match', concept: D, match: 'close', confidence: 0.9, rationale: 'r' },
    { token: 'none', unmapped: true, rationale: 'syntax' },
  ]);
  const b = pf('b', 'sonnet', [
    { token: 'agree', concept: D, match: 'close', confidence: 0.95, rationale: 'r' },
    { token: 'differ', concept: BG, match: 'exact', confidence: 0.9, rationale: 'r' },
    { token: 'low', concept: D, match: 'close', confidence: 0.99, rationale: 'r' },
    { token: 'match', concept: D, match: 'narrow', confidence: 0.9, rationale: 'r' },
    { token: 'none', unmapped: true, rationale: 'no syntax concept' },
  ]);
  const r = merge(root, 'x', '1.0.0', undefined, a, b, 'color-v1', '2026-10-31T13:00:00Z');
  assert.deepEqual([r.approved, r.approvedUnmapped, r.queued], [1, 1, 3]);
  const f = read(root);
  const agree = f.mappings.filter((m: any) => m.token === 'agree');
  assert.deepEqual(agree.map((m: any) => [m.status, m.confidence, m.review.by]), [['approved', 0.9, 'agreement']]);
  assert.equal(f.mappings.filter((m: any) => m.token === 'differ' && m.status === 'proposed').length, 2);
  assert.equal(f.mappings.filter((m: any) => m.token === 'match').length, 2);
  assert.deepEqual(f.unmapped.map((u: any) => [u.token, u.status]), [['none', 'approved']]);
});

test('approved records are never overwritten and rejected answers are never re-approved', () => {
  const root = tmp();
  const a1 = pf('a', 'opus', [{ token: 'kept', concept: D, match: 'close', confidence: 0.9, rationale: 'r' }, { token: 'rej', concept: BG, match: 'exact', confidence: 0.9, rationale: 'r' }]);
  const b1 = pf('b', 'sonnet', [{ token: 'kept', concept: D, match: 'close', confidence: 0.9, rationale: 'r' }, { token: 'rej', concept: D, match: 'exact', confidence: 0.9, rationale: 'r' }]);
  merge(root, 'x', '1.0.0', undefined, a1, b1, 'color-v1');
  const f = read(root);
  // A human rejects one of the proposed answers for "rej".
  for (const m of f.mappings) if (m.token === 'rej' && m.concept === BG) Object.assign(m, { status: 'rejected', review: { by: 'kim', at: '2026-10-31T14:00:00Z' } });
  fs.writeFileSync(path.join(root, 'mappings/x/1.0.0.mappings.json'), JSON.stringify(f));
  const a2 = pf('a', 'opus', [{ token: 'kept', concept: BG, match: 'exact', confidence: 0.99, rationale: 'r' }, { token: 'rej', concept: BG, match: 'exact', confidence: 0.99, rationale: 'r' }]);
  const b2 = pf('b', 'sonnet', [{ token: 'kept', concept: BG, match: 'exact', confidence: 0.99, rationale: 'r' }, { token: 'rej', concept: BG, match: 'exact', confidence: 0.99, rationale: 'r' }]);
  const r = merge(root, 'x', '1.0.0', undefined, a2, b2, 'color-v1');
  assert.equal(r.skippedSettled, 1);
  const g = read(root);
  assert.deepEqual(g.mappings.filter((m: any) => m.token === 'kept').map((m: any) => [m.concept, m.status]), [[D, 'approved']]);
  const rej = g.mappings.filter((m: any) => m.token === 'rej');
  assert.ok(rej.some((m: any) => m.status === 'rejected'));
  assert.ok(rej.some((m: any) => m.status === 'proposed' && /previously rejected/.test(m.rationale)));
  assert.ok(!rej.some((m: any) => m.status === 'approved'));
});

test('two files from the same model are refused', () => {
  assert.throws(() => merge(tmp(), 'x', '1.0.0', undefined, pf('a', 'opus', []), pf('b', 'opus', []), 'color-v1'), /two different models/);
});

test('proposal files are checked against the packet and the concept grammar', () => {
  const dir = tmp();
  const write = (p: any) => { const f = path.join(dir, 'p.json'); fs.writeFileSync(f, JSON.stringify(p)); return f; };
  const tokens = new Set(['t1', 't2']);
  const ok = pf('a', 'opus', [{ token: 't1', concept: D, match: 'close', confidence: 0.9, rationale: 'r' }, { token: 't2', unmapped: true, rationale: 'r' }]);
  assert.equal(readProposals(write(ok), o, tokens).proposals.length, 2);
  assert.throws(() => readProposals(write({ ...ok, proposals: ok.proposals.slice(0, 1) }), o, tokens), /unanswered/);
  assert.throws(() => readProposals(write({ ...ok, proposals: [...ok.proposals, { token: 'zz', unmapped: true, rationale: 'r' }] }), o, tokens), /not in the packet/);
  assert.throws(() => readProposals(write({ ...ok, proposals: [{ ...ok.proposals[0], concept: 'dsi:concept/color/intent-critical' }, ok.proposals[1]] }), o, tokens), /not in dsi:scheme\/intent/);
  assert.throws(() => readProposals(write({ ...ok, proposals: [{ ...ok.proposals[0], match: 'equivalent' }, ok.proposals[1]] }), o, tokens), /must be equal to one of the allowed values|must match/);
});

test('the classifier as third vote lowers the bar for exact/close agreement only', () => {
  const root = tmp();
  const a = pf('a', 'opus', [
    { token: 't1', concept: D, match: 'close', confidence: 0.65, rationale: 'r' },
    { token: 't2', concept: D, match: 'broad', confidence: 0.65, rationale: 'r' },
    { token: 't3', concept: D, match: 'close', confidence: 0.5, rationale: 'r' },
    { token: 't4', concept: D, match: 'close', confidence: 0.65, rationale: 'r' },
  ]);
  const b = pf('b', 'sonnet', a.proposals.map((p: any) => ({ ...p })));
  const votes = new Map([['t1', D], ['t2', D], ['t3', D], ['t4', BG]]);
  const r = merge(root, 'x', '1.0.0', undefined, a, b, 'color-v1', '2026-11-01T00:00:00Z', votes);
  assert.deepEqual([r.approved, r.approvedWithClassifier, r.queued], [0, 1, 3]);
  const f = read(root);
  const t1 = f.mappings.find((m: any) => m.token === 't1');
  assert.deepEqual([t1.status, t1.review.by], ['approved', 'agreement+classifier']);
  for (const t of ['t2', 't3', 't4']) assert.ok(f.mappings.filter((m: any) => m.token === t).every((m: any) => m.status === 'proposed'), t);
});
