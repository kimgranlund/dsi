import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dtcg } from '../src/adapters/dtcg.ts';
import { EXT } from '../src/dtcg.ts';

const F = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/dtcg');
const pkgs = { main: { dir: path.join(F, 'main'), version: '1.0.0' }, '@fx/type': { dir: path.join(F, 'type'), version: '3.0.0' } };
const source = {
  product: 'fx', adapter: 'dtcg', package: { registry: 'npm' as const, name: 'main', version: '1.0.0' },
  entries: [
    { package: '@fx/type', path: 'scss/_styles.scss', format: 'sass-module', group: 'type', skipKeys: ['breakpoints'] },
    { package: '@fx/type', path: 'scss/_scale.scss', format: 'sass-module', group: 'type', variables: ['type-scale'] },
  ],
};
const r = await dtcg(pkgs, source);
const set = r.sets.find((s) => s.file === 'type.tokens.json')!;

test('sass-module: map keys and list items become typed tokens under the group', () => {
  assert.deepEqual([...set.tokens.keys()].sort(), ['type.caption-01.font-size', 'type.caption-01.line-height', 'type.label-01.font-size', 'type.label-01.font-weight', 'type.label-01.letter-spacing', 'type.type-scale.1', 'type.type-scale.2']);
  const size = set.tokens.get('type.label-01.font-size')!;
  assert.deepEqual([size.$type, size.$value], ['dimension', { value: 0.75, unit: 'rem' }]);
  assert.equal(set.tokens.get('type.label-01.font-weight')!.$type, 'fontWeight');
  assert.equal(set.tokens.get('type.caption-01.line-height')!.$type, 'number');
  assert.equal(size.$extensions[EXT].nativeName, '$label-01.font-size');
});

test('sass-module: doc comments give descriptions and deprecation; skipped keys are noted', () => {
  const t = (p: string) => set.tokens.get(p) as unknown as Record<string, unknown>;
  assert.equal(t('type.label-01.font-size').$description, 'Small label text.');
  assert.equal(t('type.caption-01.font-size').$deprecated, true);
  assert.equal(t('type.label-01.font-size').$deprecated, undefined);
  assert.ok(r.report.notes.some((n) => n.includes('1 breakpoints entries skipped')));
});
