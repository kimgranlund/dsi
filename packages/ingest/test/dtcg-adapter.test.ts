import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dtcg } from '../src/adapters/dtcg.ts';
import { EXT } from '../src/dtcg.ts';

const F = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/dtcg');
const pkgs = { main: { dir: path.join(F, 'main'), version: '1.0.0' }, palette: { dir: path.join(F, 'palette'), version: '2.0.0' } };
const source = {
  product: 'fx', implementation: 'fx-elements', adapter: 'dtcg', themes: ['light', 'dark'],
  package: { registry: 'npm' as const, name: 'main', version: '1.0.0' },
  dependencies: [{ registry: 'npm' as const, name: 'palette', version: '2.0.0' }],
  entries: [{ package: 'palette', path: 'tokens/colors.tokens.json', format: 'dtcg' }, { path: 'tokens/themes.resolver.json', format: 'dtcg-resolver', nativeName: '--fx-{path}' }],
};
const r = await dtcg(pkgs, source);
const set = (f: string) => r.sets.find((s) => s.file === f)!;

test('one base file per dtcg entry and one file per resolver context', () => {
  assert.deepEqual(r.sets.map((s) => [s.file, s.theme]), [['palette.colors.tokens.json', undefined], ['theme.light.tokens.json', 'light'], ['theme.dark.tokens.json', 'dark']]);
});

test('group $type is inherited; descriptions and foreign extensions are kept', () => {
  const red = set('palette.colors.tokens.json').tokens.get('red.60') as any;
  assert.equal(red.$type, 'color');
  assert.equal(red.$description, 'red 60');
  assert.equal(red.$extensions[EXT].package, 'palette');
  assert.equal(red.$extensions[EXT].version, '2.0.0');
  const err = set('theme.light.tokens.json').tokens.get('support-error') as any;
  assert.equal(err.$value, '{red.60}');
  assert.deepEqual(err.$extensions['com.example'], { x: 1 });
  assert.equal(err.$extensions[EXT].nativeName, '--fx-support-error');
  assert.equal(err.$extensions[EXT].theme, 'light');
  assert.equal((set('theme.dark.tokens.json').tokens.get('support-error') as any).$deprecated, 'use support-danger');
});

test('partial $ref values resolve to literals against the palette and are noted', () => {
  const fade = set('theme.light.tokens.json').tokens.get('error-fade') as any;
  assert.deepEqual(fade.$value, { colorSpace: 'srgb', components: [0.855, 0.118, 0.157], alpha: 0.5 });
  assert.match(fade.$extensions[EXT].rawValue, /"\$ref":"#\/red\/60\/\$value\/colorSpace"/);
  assert.equal(r.report.counts.derived, 1);
});
