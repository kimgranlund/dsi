import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferLiteral, isAlias } from '../src/dtcg.ts';

test('infers DTCG types from Sass literals', () => {
  assert.deepEqual(inferLiteral('#fff', 'x'), { $type: 'color', $value: { colorSpace: 'srgb', components: [1, 1, 1], hex: '#ffffff' } });
  assert.deepEqual(inferLiteral('rgba(0, 0, 0, 0.5)', 'x').$value, { colorSpace: 'srgb', components: [0, 0, 0], hex: '#000000', alpha: 0.5 });
  assert.deepEqual(inferLiteral('0.875rem', 'size'), { $type: 'dimension', $value: { value: 0.875, unit: 'rem' } });
  assert.deepEqual(inferLiteral('200ms', 'duration'), { $type: 'duration', $value: { value: 200, unit: 'ms' } });
  assert.deepEqual(inferLiteral('cubic-bezier(0.2, 0, 0, 1)', 'easing'), { $type: 'cubicBezier', $value: [0.2, 0, 0, 1] });
  assert.deepEqual(inferLiteral('500', 'label-text-weight'), { $type: 'fontWeight', $value: 500 });
  assert.deepEqual(inferLiteral('0.38', 'disabled-opacity'), { $type: 'number', $value: 0.38 });
  assert.deepEqual(inferLiteral('"Google Sans", Roboto', 'brand'), { $type: 'fontFamily', $value: ['Google Sans', 'Roboto'] });
});

test('leaves what DTCG cannot type as an untyped string', () => {
  assert.deepEqual(inferLiteral('100%', 'container-height'), { $value: '100%' });
  assert.deepEqual(inferLiteral('2em', 'size'), { $value: '2em' });
  assert.deepEqual(inferLiteral('500 0.875rem / 1.25rem Roboto', 'headline-type'), { $value: '500 0.875rem / 1.25rem Roboto' });
  assert.deepEqual(inferLiteral('Roboto', 'label-text-color'), { $value: 'Roboto' });
});

test('alias syntax', () => {
  assert.ok(isAlias('{md.sys.color.on-primary}'));
  assert.ok(!isAlias('{md.sys.color.primary} 50%'));
  assert.ok(!isAlias('var(--x, {a})'));
});
