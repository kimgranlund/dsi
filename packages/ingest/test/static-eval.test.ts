import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ref, StaticModules } from '../src/static-eval.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/static');
const m = () => new StaticModules(root, (rel) => rel === 'lib/colors.js');

test('themes built with spreads, reduce, template keys and patches evaluate statically', () => {
  const t = m().load('lib/theme.js').light as Record<string, unknown>;
  assert.deepEqual(Object.keys(t).sort(), ['bg', 'fg', 'label', 'patched', 'sizeA', 'sizeB']);
  assert.equal(t.sizeA, '8px');
  assert.equal(t.label, 'web-x');
});

test('values read from a palette module carry their palette path; others do not', () => {
  const t = m().load('lib/theme.js').light as Record<string, unknown>;
  assert.ok(t.fg instanceof Ref && t.fg.ref === 'grey.14' && t.fg.value === '#242424');
  assert.ok(t.bg instanceof Ref && t.bg.ref === 'white');
  assert.ok(t.patched instanceof Ref && t.patched.ref === 'grey.26');
  assert.ok(!(t.sizeA instanceof Ref));
});

test('negative control: anything outside the data subset throws instead of running', () => {
  assert.throws(() => m().load('lib/evil.js'), /unknown identifier globalThis/);
});
