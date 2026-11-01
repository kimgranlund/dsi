import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOntology, validateRepo } from '@dsi/schema';
import { facetLabels, skosGraph, type NativeSet } from '../src/index.ts';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const o = await loadOntology(path.join(REPO, 'ontology'));
const tok = (p: string, nativeName: string, description?: string) => [p, { path: p, description, prov: { nativeName }, byTheme: new Map() }] as const;
const set = { product: 'carbon', version: '11.84.0', themes: [], modes: {}, tokens: new Map([tok('support-error', '--cds-support-error', 'Error color.'), tok('text-error', '--cds-text-error')]), lookup: () => undefined } as unknown as NativeSet;
const DANGER_TEXT = 'dsi:concept/color/intent-danger/property-text';

const g = skosGraph(o, facetLabels(REPO), {
  set, productName: 'Carbon',
  mappings: [
    { token: 'text-error', concept: DANGER_TEXT, match: 'exact', status: 'approved' },
    { token: 'support-error', concept: 'dsi:concept/color/intent-danger', match: 'close', status: 'approved' },
    { token: 'support-error', concept: 'dsi:concept/color/intent-warning', match: 'exact', status: 'proposed' },
  ],
  noEquivalent: [],
  terms: [{ term: 'error', concept: 'dsi:intent/danger', match: 'exact', status: 'approved' }, { term: 'support', concept: 'dsi:usage/page', match: 'exact', status: 'rejected' }],
});
const nodes = g['@graph'] as Record<string, any>[];
const node = (id: string) => nodes.find((n) => n.id === id);

test('native tokens, terms and used canonical concepts become skos:Concepts with approved mappings only', () => {
  const se = node('dsi:native/carbon/11.84.0/support-error')!;
  assert.deepEqual([se.inScheme, se.notation, se.definition], ['dsi:scheme/native/carbon/11.84.0', '--cds-support-error', 'Error color.']);
  assert.deepEqual(se['skos:closeMatch'], [{ id: 'dsi:concept/color/intent-danger' }]);
  assert.equal(se['skos:exactMatch'], undefined, 'proposed mappings are not exported');
  assert.deepEqual(node('dsi:native/carbon/11.84.0/text-error')!['skos:exactMatch'], [{ id: DANGER_TEXT }]);
  assert.deepEqual(node('dsi:vocab/carbon/error')!['skos:exactMatch'], [{ id: 'dsi:intent/danger' }]);
  assert.equal(node('dsi:vocab/carbon/support'), undefined, 'rejected terms are not exported');
  const c = node(DANGER_TEXT)!;
  assert.deepEqual([c.prefLabel, c.inScheme, c['dsi:hasIntent']], ['Color: Danger · Text', 'dsi:scheme/canonical/color', [{ id: 'dsi:intent/danger' }]]);
});

test('the repo validator accepts the export and rejects a dangling reference', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsi-skos-'));
  fs.cpSync(path.join(REPO, 'ontology'), path.join(root, 'ontology'), { recursive: true });
  const out = path.join(root, 'data/skos/carbon/11.84.0.jsonld');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(g));
  const ok = await validateRepo({ root });
  assert.deepEqual(ok.filter((i) => i.file.startsWith('data/skos')), []);
  nodes.push({ id: 'dsi:native/carbon/11.84.0/x', 'skos:exactMatch': [{ id: 'dsi:concept/color/intent-critical' }] });
  fs.writeFileSync(out, JSON.stringify(g));
  const bad = (await validateRepo({ root })).map((i) => i.message);
  assert.ok(bad.some((m) => /references undefined dsi:concept\/color\/intent-critical/.test(m)), bad.join('\n'));
  assert.ok(bad.some((m) => /intent "critical" is not in dsi:scheme\/intent/.test(m)), bad.join('\n'));
});
