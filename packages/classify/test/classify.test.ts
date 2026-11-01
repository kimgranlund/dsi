import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOntology } from '@dsi/schema';
import { classify, deriveTerms, mergeTerms, words, type TermsFile, type Term } from '../src/index.ts';

const o = await loadOntology(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../ontology'));
const prov = { agent: 't', at: '2026-11-01T00:00:00Z' };
const term = (t: string, facet: any, value: string, status = 'approved'): Term => ({ term: t, facet, value, match: 'exact', status, provenance: prov } as Term);
const file = (terms: Term[]): TermsFile => ({ product: 'p', noise: ['color'], scopes: [{ pathPrefix: 'colors.', scope: 'palette' }, { pathPrefix: 'color-', scope: 'semantic' }], terms });

test('words split on separators and camelCase', () => {
  assert.deepEqual(words('md.sys.color.on-error-container'), ['md', 'sys', 'color', 'on', 'error', 'container']);
  assert.deepEqual(words('blackHover'), ['black', 'hover']);
});

test('every term contributes; a longer term overrides a shorter one on the same facet', () => {
  const t = file([term('bg', 'property', 'background'), term('on-bg-fill', 'property', 'foreground'), term('on-bg-fill', 'usage', 'on-fill'), term('critical', 'intent', 'danger'), term('fill-critical', 'property', 'background'), term('hover', 'state', 'hover')]);
  const a = classify(t, 'color-bg-fill-critical-hover', '', 'color');
  assert.equal(a.concept, 'dsi:concept/color/intent-danger/property-background/state-hover');
  assert.equal(a.scope, 'semantic');
  const b = classify(t, 'color-text-critical-on-bg-fill', '', 'color');
  assert.equal(b.facets.property, 'foreground');
  assert.equal(b.facets.usage, 'on-fill');
  assert.deepEqual(b.unknown, ['text']);
  assert.ok(b.explained < 1);
});

test('equal-length disagreement is a conflict on single-valued facets and combines on state', () => {
  const t = file([term('alert', 'intent', 'danger'), term('notice', 'intent', 'warning'), term('hover', 'state', 'hover'), term('selected', 'state', 'selected')]);
  const a = classify(t, 'color-alert-notice', '', 'color');
  assert.equal(a.concept, undefined);
  assert.equal(a.conflicts.length, 1);
  assert.equal(classify(t, 'color-selected-hover', '', 'color').facets.state, 'hover+selected');
});

test('only the requested statuses count; proposed terms are hints, not votes', () => {
  const t = file([term('critical', 'intent', 'danger', 'proposed')]);
  assert.equal(classify(t, 'color-critical', '', 'color').concept, undefined);
  assert.equal(classify(t, 'color-critical', '', 'color', new Set(['approved', 'proposed'])).concept, 'dsi:concept/color/intent-danger');
});

test('derivation keeps clean words with evidence and never overrides settled terms', () => {
  const maps = [
    { token: 'color-text-critical', concept: 'dsi:concept/color/intent-danger/property-text', match: 'exact' },
    { token: 'color-icon-critical', concept: 'dsi:concept/color/intent-danger/property-icon', match: 'exact' },
    { token: 'color-text-success', concept: 'dsi:concept/color/intent-success/property-text', match: 'exact' },
    { token: 'color-text-odd', concept: 'dsi:concept/color/intent-info/property-text', match: 'related' },
  ];
  const d = deriveTerms(o, 'p', maps, ['color']);
  const crit = d.find((x) => x.term === 'critical' && x.facet === 'intent');
  assert.deepEqual([crit?.value, crit?.evidence], ['danger', { support: 2, agree: 2, precision: 1 }]);
  assert.ok(d.some((x) => x.term === 'text' && x.value === 'text'));
  assert.ok(!d.some((x) => x.term === 'success'), 'support 1 is below the bar');
  assert.ok(!d.some((x) => x.term.includes('odd')), 'related mappings teach nothing');
  const merged = mergeTerms(file([term('critical', 'intent', 'warning', 'rejected'), term('text', 'property', 'foreground')]), d);
  assert.ok(merged.terms.some((x) => x.term === 'critical' && x.value === 'danger' && x.status === 'proposed'));
  assert.ok(!merged.terms.some((x) => x.term === 'text' && x.status === 'proposed'), 'an approved term blocks a proposed one on the same facet');
});
