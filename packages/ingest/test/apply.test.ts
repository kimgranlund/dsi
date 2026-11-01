import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainOf, extractCss, extractProps, stateOf, vars } from '../src/apply.ts';

const tokens = new Set(['--md-filled-button-leading-space', '--p-space-300', '--p-space-150', '--p-color-bg-fill', '--p-color-bg-fill-brand']);
const isToken = (n: string) => tokens.has(n);

test('vars splits top-level var() calls with fallbacks', () => {
  assert.deepEqual(vars('var(--a, var(--b, 1px)) var(--c)'), [{ name: '--a', fallback: 'var(--b, 1px)' }, { name: '--c' }]);
});

test('a component-local property is followed to the token it wraps, with the literal fallback', () => {
  const defs = new Map([['--_leading-space', 'var(--md-filled-button-leading-space, 24px)']]);
  assert.deepEqual(chainOf('--_leading-space', undefined, defs, isToken), { chain: ['--_leading-space', '--md-filled-button-leading-space'], literal: '24px' });
});

test('disabled wins over hover in a combined selector', () => {
  assert.equal(stateOf('.btn:disabled, .btn:hover:disabled'), 'disabled');
  assert.equal(stateOf('.btn:hover'), 'hover');
  assert.equal(stateOf('.btn'), undefined);
});

const css = `.Polaris-Button{ --pc-button-bg: var(--p-color-bg-fill); padding: var(--pc-button-padding-block) var(--pc-button-padding-inline); background: var(--pc-button-bg); }
.Polaris-Button--variantPrimary{ --pc-button-bg: var(--p-color-bg-fill-brand); }
.Polaris-Button--sizeMedium{ --pc-button-padding-block: var(--p-space-150); --pc-button-padding-inline: var(--p-space-300); }
.Polaris-Checkbox{ padding: var(--p-space-300); }`;
const cfg = { component: 'button', native: 'Button', match: 'exact', within: '^\\.Polaris-Button', defScope: '^\\.Polaris-Button$|--sizeMedium$', parts: [{ selector: '.', part: 'container' }] };

test('only the default variant defines component-local values; other components stay out', () => {
  const { rows } = extractCss(cfg, [{ rel: 'styles.css', css }], isToken);
  const bg = rows.find((r) => r.cssProperty === 'background')!;
  assert.equal(bg.token, '--p-color-bg-fill', 'variantPrimary must not leak into the default variant');
  assert.deepEqual(rows.filter((r) => r.cssProperty === 'padding').map((r) => [r.token, r.position]), [['--p-space-150', [1, 2]], ['--p-space-300', [2, 2]]]);
  assert.ok(!rows.some((r) => r.selector.includes('Checkbox')));
});

test('negative control: without defScope the primary variant leaks into the default', () => {
  const { rows } = extractCss({ ...cfg, defScope: undefined }, [{ rel: 'styles.css', css }], isToken);
  assert.equal(rows.find((r) => r.cssProperty === 'background')!.token, '--p-color-bg-fill-brand');
});

test('prop defaults are read by pattern from source text, never run', () => {
  const rows = extractProps({ component: 'card', native: 'Card', match: 'exact', parts: [], props: [{ file: 'Card.js', pattern: "padding = \\{\\s*xs: '([0-9]+)'", token: '--p-space-{v}', part: 'container', property: 'padding' }] }, () => "const Card = ({\n  padding = {\n    xs: '400'\n  } }) => null;");
  assert.equal(rows[0].token, '--p-space-400');
  assert.equal(rows[0].how, 'prop-default');
  assert.equal(rows[0].line, 2);
  assert.throws(() => extractProps({ component: 'card', native: 'Card', match: 'exact', parts: [], props: [{ file: 'x', pattern: 'nope ([0-9]+)', token: '{v}', part: 'container', property: 'padding' }] }, () => ''), /not found/);
});
