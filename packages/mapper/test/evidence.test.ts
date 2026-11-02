import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOntology, stampVersions, writeMappingFile } from '@dsi/schema';
import { buildEvidence } from '../src/evidence.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const o = await loadOntology(path.join(root, 'ontology'));
const scope = JSON.parse(fs.readFileSync(path.join(root, 'packages/mapper/scopes/color-v1.json'), 'utf8'));
const version = scope.products.atlassian.version;
const terms = JSON.parse(fs.readFileSync(path.join(root, 'mappings/atlassian/terms.json'), 'utf8'));
const m = (token: string, concept: string) => ({ id: 'm-test', token, concept, match: 'exact', status: 'approved' });

test('evidence: a right mapping agrees on every record', () => {
  const [e] = buildEvidence(root, o, 'atlassian', version, [m('color.text.danger', 'dsi:concept/color/intent-danger/property-text')], terms);
  assert.ok(e.records.length >= 2);
  assert.ok(e.records.every((r) => r.agrees), JSON.stringify(e.records));
  assert.ok(e.records.some((r) => r.test === 'terms' && r.field === 'intent'));
});

test('evidence: a wrong mapping of the same token disagrees (negative control)', () => {
  const [e] = buildEvidence(root, o, 'atlassian', version, [m('color.text.danger', 'dsi:concept/color/intent-success/property-background')], terms);
  const bad = e.records.filter((r) => !r.agrees).map((r) => `${r.test}:${r.field}`);
  assert.ok(bad.includes('terms:intent'), bad.join());
  assert.ok(bad.includes('terms:property'), bad.join());
  assert.ok(bad.includes('hue:intent'), bad.join());
});

test('evidence: multi-valued facets compare as sets, broader terms values agree', () => {
  const [e] = buildEvidence(root, o, 'atlassian', version, [m('color.text.inverse', 'dsi:concept/color/usage-on-fill/property-text')], terms);
  assert.ok(e.records.find((r) => r.test === 'terms' && r.field === 'usage')?.agrees);
});

test('stamps: only records a write adds or changes get the registry and resolver versions', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsi-stamp-'));
  fs.mkdirSync(path.join(tmp, 'ontology/schemes'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'packages/resolve/src'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'ontology/schemes/facets.jsonld'), '{}');
  fs.writeFileSync(path.join(tmp, 'packages/resolve/src/index.ts'), '');
  const f = path.join(tmp, 'mappings/x/1.mappings.json');
  const old = { id: 'm-a', token: 'a', concept: 'c', match: 'exact', status: 'approved', provenance: { agent: 'x', at: '2026-01-01T00:00:00Z' } };
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ mappings: [old] }));
  const added = { id: 'm-b', token: 'b', concept: 'c', match: 'exact', status: 'proposed', provenance: { agent: 'x', at: '2026-01-01T00:00:00Z' } };
  const n = writeMappingFile(tmp, f, { mappings: [structuredClone(old), added] });
  const out = JSON.parse(fs.readFileSync(f, 'utf8')).mappings;
  const v = stampVersions(tmp);
  assert.equal(n, 1);
  assert.equal(out[0].provenance.registry, undefined, 'unchanged history stays unstamped');
  assert.equal(out[1].provenance.registry, v.registry);
  assert.match(out[1].provenance.resolver, /^resolve@[0-9a-f]{12}$/);
  // A status change is a new judgment: it gets stamped.
  const again = JSON.parse(fs.readFileSync(f, 'utf8'));
  again.mappings[0].status = 'rejected';
  assert.equal(writeMappingFile(tmp, f, again), 1);
  // The registry changes: an untouched stamped record keeps its old stamp.
  fs.writeFileSync(path.join(tmp, 'ontology/schemes/facets.jsonld'), '{"changed":true}');
  const third = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(writeMappingFile(tmp, f, third), 0);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).mappings[1].provenance.registry, v.registry);
  fs.rmSync(tmp, { recursive: true });
});
