import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { material } from '../src/adapters/material.ts';
import { EXT, type Token } from '../src/dtcg.ts';

const PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/material');
const source = { product: 'material', implementation: 'material-web', package: { registry: 'npm' as const, name: '@material/web', version: '2.5.0' }, entries: [], adapter: 'material' };

const result = await material(PKG, source);
const set = (file: string) => result.sets.find((s) => s.file === file)!;
const tok = (file: string, p: string): Token | undefined => set(file)?.tokens.get(p);

test('writes mode-independent and per-mode files', () => {
  assert.deepEqual(result.sets.map((s) => [s.file, s.theme]).sort(), [
    ['md.comp.tokens.json', undefined], ['md.ref.tokens.json', undefined], ['md.sys.color.dark.tokens.json', 'dark'], ['md.sys.color.light.tokens.json', 'light'], ['md.sys.tokens.json', undefined],
  ]);
});

test('system color aliases differ per mode and keep the resolved raw value', () => {
  assert.equal(tok('md.sys.color.light.tokens.json', 'md.sys.color.error')!.$value, '{md.ref.palette.error40}');
  assert.equal(tok('md.sys.color.dark.tokens.json', 'md.sys.color.error')!.$value, '{md.ref.palette.error80}');
  assert.equal(tok('md.sys.color.dark.tokens.json', 'md.sys.color.error')!.$extensions[EXT].rawValue, '#f2b8b5');
  assert.equal(tok('md.sys.color.dark.tokens.json', 'md.sys.color.error')!.$extensions[EXT].theme, 'dark');
});

test('component tokens alias system tokens, not the CSS var() fallback', () => {
  const t = tok('md.comp.tokens.json', 'md.comp.thing.container-color')!;
  assert.equal(t.$value, '{md.sys.color.primary}');
  assert.equal(t.$extensions[EXT].nativeName, '--md-thing-container-color');
  assert.equal(tok('md.comp.tokens.json', 'md.comp.thing.container-shape')!.$value, '{md.sys.shape.corner-small}');
});

test('a value derived from a dependency is a literal, not an alias', () => {
  const t = tok('md.comp.tokens.json', 'md.comp.thing.container-shape-start')!;
  assert.deepEqual([t.$type, t.$value], ['dimension', { value: 8, unit: 'px' }]);
  assert.ok(result.report.notes.some((n) => n.startsWith('md.comp.thing.container-shape-start')));
});

test('literals are typed; multi-value shapes are untyped; nulls and test tables are skipped', () => {
  assert.deepEqual(tok('md.ref.tokens.json', 'md.ref.palette.error40')!.$value, { colorSpace: 'srgb', components: [0.702, 0.149, 0.1176], hex: '#b3261e' });
  assert.deepEqual(tok('md.comp.tokens.json', 'md.comp.thing.label-text-font')!.$value, 'Roboto');
  const top = tok('md.sys.tokens.json', 'md.sys.shape.corner-small-top')!;
  assert.equal(top.$type, undefined);
  assert.equal(top.$extensions[EXT].untyped, true);
  assert.equal(tok('md.comp.tokens.json', 'md.comp.thing.unset-color'), undefined);
  assert.equal(result.report.counts.nullSkipped, 1);
  assert.ok(![...set('md.comp.tokens.json').tokens.keys()].some((k) => k.includes('test-table')));
});

test('native names follow the shipped API', () => {
  assert.equal(tok('md.sys.color.light.tokens.json', 'md.sys.color.error')!.$extensions[EXT].nativeName, '--md-sys-color-error');
  assert.equal(tok('md.ref.tokens.json', 'md.ref.palette.error40')!.$extensions[EXT].nativeName, 'md-ref-palette.error40');
});
