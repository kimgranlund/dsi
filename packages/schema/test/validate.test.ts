import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAjv, validateRepo } from '../src/index.ts';

const ONTOLOGY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../ontology');
const prov = { agent: 'dsi-mapper', model: 'claude-opus-5-5', at: '2026-10-31T12:00:00Z' };
const review = { by: 'kimgranlund', at: '2026-10-31T13:00:00Z' };

type Files = Record<string, unknown>;
const base = (): Files => ({
  'catalog/token-format/dtcg.json': { id: 'dtcg', name: 'DTCG', category: 'dsi:category/token-format', description: 'W3C DTCG format.' },
  'catalog/design-system/material.json': {
    id: 'material', name: 'Material Design', category: 'dsi:category/design-system', description: 'Google design system.',
    implementations: [{ id: 'material-web', name: 'Material Web', package: '@material/web', targets: ['dsi:target/web-components'] }],
  },
  'catalog/component-library/mui.json': { id: 'mui', name: 'MUI', category: 'dsi:category/component-library', description: 'React components.', targets: ['dsi:target/react'], relations: { implements: ['material'] } },
  'catalog/styling-engine/tailwind.json': { id: 'tailwind', name: 'Tailwind CSS', category: 'dsi:category/styling-engine', description: 'Utility CSS.', relations: { providesTokenSet: ['tailwind-palette'] } },
  'catalog/token-set/tailwind-palette.json': { id: 'tailwind-palette', name: 'Tailwind default palette', category: 'dsi:category/token-set', description: 'Default theme.', relations: { usesFormat: [] } },
  'sources/material/source.json': {
    product: 'material', implementation: 'material-web', adapter: 'material',
    package: { registry: 'npm', name: '@material/web', version: '2.4.0' },
    entries: [{ path: 'tokens/_md-sys-color.scss', format: 'scss', theme: 'light' }], themes: ['light', 'dark'], modes: { light: 'light', dark: 'dark' },
    license: { spdx: 'Apache-2.0', redistribution: 'permitted' },
  },
  'mappings/material/2.4.0.mappings.json': {
    product: 'material', implementation: 'material-web', sourceVersion: '2.4.0',
    bindings: [{ token: 'md.sys.color.error', facets: { domain: 'dsi:domain/color', intent: 'dsi:intent/danger' }, status: 'proposed', provenance: prov }],
    mappings: [
      { id: 'm1', token: 'md.sys.color.error', concept: 'dsi:intent/danger', match: 'narrow', confidence: 0.8, status: 'approved', review, provenance: prov },
      { id: 'm0', token: 'md.sys.color.error', concept: 'dsi:intent/danger', match: 'exact', confidence: 0.6, status: 'superseded', supersededBy: 'm1', provenance: prov },
      { id: 'm2', token: 'md.sys.color.error-container', concept: 'dsi:concept/color/intent-danger/property-background/emphasis-subtle', match: 'close', confidence: 0.9, status: 'proposed', provenance: prov },
      { id: 'm3', token: 'md.sys.color.inverse-primary', concept: 'dsi:concept/color/usage-inverse+link/property-text/state-hover+selected', match: 'close', confidence: 0.9, status: 'proposed', provenance: prov },
    ],
    noEquivalent: [{ concept: 'dsi:intent/destructive', status: 'proposed', provenance: prov }],
    unmapped: [{ token: 'md.sys.color.surface-tint', status: 'proposed', provenance: prov, rationale: 'no tint concept yet' }],
  },
});

async function run(files: Files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsi-'));
  for (const [f, v] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), typeof v === 'string' ? v : JSON.stringify(v));
  }
  try { return (await validateRepo({ root, ontologyDir: ONTOLOGY })).map((i) => `${i.file}: ${i.message}`); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

/** Apply a change to a deep copy of the valid fixture. */
function variant(change: (f: Record<string, any>) => void): Files {
  const f = structuredClone(base()) as Record<string, any>;
  change(f);
  return f;
}

test('real ontology and valid fixture produce no issues', async () => {
  assert.deepEqual(await run(base()), []);
});

const negatives: [string, (f: Record<string, any>) => void, RegExp][] = [
  ['unknown category', (f) => (f['catalog/token-format/dtcg.json'].category = 'dsi:category/ui-framework'), /not in dsi:scheme\/categories/],
  ['target that is a category', (f) => (f['catalog/component-library/mui.json'].targets = ['dsi:category/design-system']), /not in dsi:scheme\/targets/],
  ['file name differs from id', (f) => (f['catalog/token-format/dtcg.json'].id = 'w3c-dtcg'), /file name must equal id/],
  ['relation to missing product', (f) => (f['catalog/component-library/mui.json'].relations.builtOn = ['radix-primitives']), /unknown catalog id "radix-primitives"/],
  ['implements a non design system', (f) => (f['catalog/component-library/mui.json'].relations.implements = ['tailwind']), /not a Design System/],
  ['implementations on a library', (f) => (f['catalog/component-library/mui.json'].implementations = [{ id: 'mui-core', name: 'core' }]), /only Design Systems have implementations/],
  ['providesTokenSet from a token set', (f) => (f['catalog/token-set/tailwind-palette.json'].relations.providesTokenSet = ['tailwind-palette']), /only for Styling Engines/],
  ['ingesting a styling engine', (f) => (f['sources/tailwind/source.json'] = { ...f['sources/material/source.json'], product: 'tailwind', implementation: undefined }), /not an ingested category/],
  ['design system without implementation', (f) => delete f['sources/material/source.json'].implementation, /through an implementation/],
  ['version range instead of exact', (f) => (f['sources/material/source.json'].package.version = '^2.4.0'), /\/package\/version must match pattern/],
  ['mode that is not canonical', (f) => (f['sources/material/source.json'].modes = { night: 'dark' }), /"night" is not in dsi:scheme\/mode/],
  ['mode pointing at an unknown theme', (f) => (f['sources/material/source.json'].modes = { dark: 'g100' }), /theme "g100" is not listed/],
  ['entry theme not declared', (f) => (f['sources/material/source.json'].entries[0].theme = 'g100'), /entry theme "g100"/],
  ['unknown match type', (f) => (f['mappings/material/2.4.0.mappings.json'].mappings[0].match = 'equivalent'), /match "equivalent" is not in dsi:scheme\/match-types/],
  ['unknown review status', (f) => (f['mappings/material/2.4.0.mappings.json'].mappings[0].status = 'accepted'), /status "accepted"/],
  ['approved without review', (f) => delete f['mappings/material/2.4.0.mappings.json'].mappings[0].review, /must have required property 'review'/],
  ['superseded without replacement', (f) => delete f['mappings/material/2.4.0.mappings.json'].mappings[1].supersededBy, /must have required property 'supersededBy'/],
  ['undefined concept', (f) => (f['mappings/material/2.4.0.mappings.json'].mappings[0].concept = 'dsi:intent/critical'), /concept dsi:intent\/critical is not defined/],
  ['facet value from wrong scheme', (f) => (f['mappings/material/2.4.0.mappings.json'].bindings[0].facets.intent = 'dsi:state/hover'), /intent dsi:state\/hover is not in dsi:scheme\/intent/],
  ['concept with unknown facet value', (f) => (f['mappings/material/2.4.0.mappings.json'].mappings[2].concept = 'dsi:concept/color/intent-critical'), /intent "critical" is not in dsi:scheme\/intent/],
  ['concept facets out of order', (f) => (f['mappings/material/2.4.0.mappings.json'].mappings[2].concept = 'dsi:concept/color/property-background/intent-danger'), /out of order/],
  ['concept with unknown domain', (f) => (f['mappings/material/2.4.0.mappings.json'].mappings[2].concept = 'dsi:concept/colour/intent-danger'), /domain "colour"/],
  ['concept with deprecated facet value', (f) => (f['mappings/material/2.4.0.mappings.json'].mappings[2].concept = 'dsi:concept/color/usage-code'), /usage "code" is deprecated/],
  ['multi-value on a single-valued facet', (f) => (f['mappings/material/2.4.0.mappings.json'].mappings[2].concept = 'dsi:concept/color/intent-danger+warning'), /takes one value/],
  ['multi-value not sorted', (f) => (f['mappings/material/2.4.0.mappings.json'].mappings[2].concept = 'dsi:concept/color/usage-link+inverse'), /sorted alphabetically/],
  ['multi-value with unknown part', (f) => (f['mappings/material/2.4.0.mappings.json'].mappings[2].concept = 'dsi:concept/color/property-text/state-hover+pressed'), /state "pressed"/],
  ['concept with reserved facet', (f) => (f['mappings/material/2.4.0.mappings.json'].mappings[2].concept = 'dsi:concept/color/component-button'), /reserved/],
  ['concept with no facets', (f) => (f['mappings/material/2.4.0.mappings.json'].mappings[2].concept = 'dsi:concept/color'), /at least one facet/],
  ['approved unmapped token that also has a mapping', (f) => { const u = f['mappings/material/2.4.0.mappings.json'].unmapped[0]; Object.assign(u, { token: 'md.sys.color.error', status: 'approved', review }); }, /approved as unmapped but also has a live mapping/],
  ['stale unmapped proposal on an approved token', (f) => f['mappings/material/2.4.0.mappings.json'].unmapped.push({ token: 'md.sys.color.error', status: 'proposed', provenance: prov }), /stale proposal; the token already has an approved mapping/],
  ['stale mapping proposal on an approved token', (f) => f['mappings/material/2.4.0.mappings.json'].mappings.push({ id: 'm9', token: 'md.sys.color.error', concept: 'dsi:intent/danger', match: 'close', confidence: 0.5, status: 'proposed', provenance: prov }), /stale proposal; the token is already settled/],
  ['part without component', (f) => (f['mappings/material/2.4.0.mappings.json'].bindings[0].facets.part = 'container'), /must have property component when property part is present/],
  ['confidence out of range', (f) => (f['mappings/material/2.4.0.mappings.json'].mappings[0].confidence = 1.5), /must be <= 1/],
  ['stored tier field', (f) => (f['mappings/material/2.4.0.mappings.json'].bindings[0].tier = 'dsi:tier/semantic'), /must NOT have unevaluated properties/],
  ['invalid JSON', (f) => (f['catalog/token-format/dtcg.json'] = '{ nope'), /invalid JSON/],
];

for (const [name, change, expected] of negatives) {
  test(`rejects: ${name}`, async () => {
    const issues = await run(variant(change));
    assert.ok(issues.some((i) => expected.test(i)), `expected ${expected} in:\n${issues.join('\n') || '(no issues)'}`);
  });
}

test('dtcg extension schema accepts provenance and rejects a missing native name', () => {
  const v = createAjv().getSchema('https://dsi.nonoun.io/schema/dtcg-extension.schema.json')!;
  const ok = { product: 'material', implementation: 'material-web', package: '@material/web', version: '2.4.0', file: 'tokens/_md-sys-color.scss', nativeName: '--md-sys-color-error', rawValue: '#b3261e' };
  assert.equal(v(ok), true, JSON.stringify(v.errors));
  const { nativeName, ...missing } = ok;
  assert.equal(v(missing), false);
});

test('rejects a broken ontology: dangling reference and asymmetric related', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsi-onto-'));
  fs.cpSync(ONTOLOGY, dir, { recursive: true });
  const f = path.join(dir, 'schemes/facets.jsonld');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"related": ["dsi:intent/danger"]', '"related": ["dsi:intent/dangerr"]'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsi-'));
  try {
    const issues = (await validateRepo({ root, ontologyDir: dir })).map((i) => i.message);
    assert.ok(issues.some((m) => /references undefined dsi:intent\/dangerr/.test(m)), issues.join('\n'));
    assert.ok(issues.some((m) => /not symmetric/.test(m)), issues.join('\n'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
