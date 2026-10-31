import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRepo } from '../src/index.ts';

const ONTOLOGY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../ontology');
const prov = (theme?: string) => ({ 'io.nonoun.dsi': { product: 'p', package: 'p', version: '1.0.0', file: 'f.scss', nativeName: 'n', rawValue: 'r', ...(theme ? { theme } : {}) } });
const color = { colorSpace: 'srgb', components: [1, 0, 0], hex: '#ff0000' };

const valid = () => ({
  'base.tokens.json': { a: { ref: { $type: 'color', $value: color, $extensions: prov() }, comp: { $value: '{a.sys}', $extensions: prov() } } },
  'light.tokens.json': { a: { sys: { $value: '{a.ref}', $extensions: prov('light') } } },
  'dark.tokens.json': { a: { sys: { $value: '{a.ref}', $extensions: prov('dark') } } },
});
const manifest = (files: Record<string, any>) => ({
  product: 'p', package: { version: '1.0.0' },
  files: Object.keys(files).map((f) => ({ file: f, ...(f === 'base.tokens.json' ? {} : { theme: f.split('.')[0] }), tokens: JSON.stringify(files[f]).split('"$value"').length - 1 })),
});

async function run(files: Record<string, any>, man = manifest(files)) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsi-native-'));
  const dir = path.join(root, 'data/native/p/1.0.0');
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), JSON.stringify(v));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man));
  try { return (await validateRepo({ root, ontologyDir: ONTOLOGY })).map((i) => i.message); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('valid native set: base aliases resolve through each theme', async () => {
  assert.deepEqual(await run(valid()), []);
});

const cases: [string, (f: Record<string, any>) => void, RegExp][] = [
  ['alias to missing token', (f) => (f['base.tokens.json'].a.comp.$value = '{a.nope}'), /alias \{a\.nope\} does not resolve/],
  ['alias missing in one theme', (f) => delete f['dark.tokens.json'].a.sys, /alias \{a\.sys\} does not resolve in theme dark/],
  ['alias cycle', (f) => (f['base.tokens.json'].a.ref = { $value: '{a.comp}', $extensions: prov() }), /alias cycle/],
  ['missing provenance', (f) => delete f['base.tokens.json'].a.ref.$extensions, /\$extensions\["io\.nonoun\.dsi"\]/],
  ['provenance from another product', (f) => (f['base.tokens.json'].a.ref.$extensions['io.nonoun.dsi'].product = 'q'), /provenance says q@1\.0\.0/],
  ['theme mismatch', (f) => (f['light.tokens.json'].a.sys.$extensions['io.nonoun.dsi'].theme = 'dark'), /provenance theme dark differs/],
  ['bad color shape', (f) => (f['base.tokens.json'].a.ref.$value = '#ff0000'), /color must be/],
  ['dimension in em', (f) => (f['base.tokens.json'].a.ref = { $type: 'dimension', $value: { value: 1, unit: 'em' }, $extensions: prov() }), /dimension must be/],
  ['untyped literal not flagged', (f) => (f['base.tokens.json'].a.ref = { $value: '100%', $extensions: prov() }), /must be marked untyped/],
  ['unchecked type', (f) => (f['base.tokens.json'].a.ref = { $type: 'shadow', $value: {}, $extensions: prov() }), /type shadow is not checked yet/],
];
for (const [name, change, expected] of cases) {
  test(`rejects native: ${name}`, async () => {
    const f = structuredClone(valid()) as Record<string, any>;
    change(f);
    const issues = await run(f);
    assert.ok(issues.some((m) => expected.test(m)), `expected ${expected} in:\n${issues.join('\n') || '(none)'}`);
  });
}

test('rejects native: manifest count and unlisted file', async () => {
  const f = valid();
  const m = manifest(f);
  m.files[0].tokens = 99;
  m.files = m.files.filter((x) => x.file !== 'dark.tokens.json');
  const issues = await run(f, m);
  assert.ok(issues.some((i) => /manifest says 99 tokens/.test(i)), issues.join('\n'));
  assert.ok(issues.some((i) => /not listed in manifest/.test(i)), issues.join('\n'));
});
