import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { polaris } from '../src/adapters/polaris.ts';
import { EXT } from '../src/dtcg.ts';

const PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/polaris');
const source = { product: 'polaris', implementation: 'polaris-tokens', adapter: 'polaris', entries: [], package: { registry: 'npm' as const, name: '@shopify/polaris-tokens', version: '9.4.2' } };
// colors.mjs starts with `throw`: if the adapter executed modules instead of parsing them, this call would fail.
const r = await polaris({ '@shopify/polaris-tokens': { dir: PKG, version: '9.4.2' } }, source);
const set = (f: string) => r.sets.find((s) => s.file === f)!;
const base = (k: string) => set('polaris.tokens.json').tokens.get(k) as any;

test('default theme is the base file, other themes are override files', () => {
  assert.equal(r.defaultTheme, 'light');
  assert.deepEqual(r.sets.map((s) => [s.file, s.theme]), [['scales.tokens.json', undefined], ['polaris.tokens.json', undefined], ['theme.dark-experimental.tokens.json', 'dark-experimental']]);
});

test('palette aliases are verified against the CSS value', () => {
  assert.equal(base('color-bg').$value, '{colors.gray.6}');
  assert.equal(base('color-bg').$description, 'The default background color.');
  assert.equal(base('color-bg-fill-critical').$value, '{colors.red.12}');
  assert.equal(base('color-odd').$type, 'color');
  assert.ok(r.report.notes.some((n) => /^color-odd: module says colors\.red\.13/.test(n)));
});

test('var(--p-x) in CSS is an alias to token x', () => {
  assert.equal(base('color-bg-critical-alias').$value, '{color-bg-fill-critical}');
  assert.equal(base('color-bg-critical-alias').$extensions[EXT].nativeName, '--p-color-bg-critical-alias');
});

test('size scale is stored in rem as the build ships it, so size aliases verify', () => {
  const s = set('scales.tokens.json').tokens.get('size.400') as any;
  assert.deepEqual([s.$value, s.$extensions[EXT].rawValue, s.$extensions[EXT].visibility], [{ value: 1, unit: 'rem' }, '16px', 'internal']);
  assert.equal(base('space-400').$value, '{size.400}');
});

test('theme module without the -experimental suffix supplies the dark aliases', () => {
  const t = set('theme.dark-experimental.tokens.json').tokens.get('color-bg') as any;
  assert.equal(t.$value, '{colors.gray.16}');
  assert.equal(t.$extensions[EXT].theme, 'dark-experimental');
});

test('keyframes and untyped literals', () => {
  assert.equal(base('color-scheme').$extensions[EXT].untyped, true);
  assert.ok(![...set('polaris.tokens.json').tokens.keys()].some((k) => k.includes('opacity')));
});
