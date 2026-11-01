import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOntology } from '@dsi/schema';
import { classify, deriveTerms, mergeTerms, words, type TermsFile, type Term } from '../src/index.ts';

const o = await loadOntology(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../ontology'));
const prov = { agent: 't', at: '2026-11-01T00:00:00Z' };
const term = (t: string, facet: string, value: string, status = 'approved'): Term => ({ term: t, concept: `dsi:${facet}/${value}`, match: 'exact', status, provenance: prov });
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
  const crit = d.find((x) => x.term === 'critical' && x.concept.startsWith('dsi:intent/'));
  assert.deepEqual([crit?.concept, crit?.evidence], ['dsi:intent/danger', { support: 2, agree: 2, precision: 1 }]);
  assert.ok(d.some((x) => x.term === 'text' && x.concept === 'dsi:property/text'));
  assert.ok(!d.some((x) => x.term === 'success'), 'support 1 is below the bar');
  assert.ok(!d.some((x) => x.term.includes('odd')), 'related mappings teach nothing');
  const merged = mergeTerms(file([term('critical', 'intent', 'warning', 'rejected'), term('text', 'property', 'foreground')]), d);
  assert.ok(merged.terms.some((x) => x.term === 'critical' && x.concept === 'dsi:intent/danger' && x.status === 'proposed'));
  assert.ok(!merged.terms.some((x) => x.term === 'text' && x.status === 'proposed'), 'an approved term blocks a proposed one on the same facet');
});

import { mergeTermProposals, vocabulary, type TermProposalFile } from '../src/index.ts';

test('vocabulary lists every word and only recurring sequences', () => {
  const v = vocabulary(['color-bg-fill-critical', 'color-bg-fill-success', 'color-text-critical'], ['color']);
  const terms = v.map((x) => x.term);
  for (const w of ['bg', 'fill', 'critical', 'success', 'text', 'bg-fill']) assert.ok(terms.includes(w), w);
  assert.ok(!terms.includes('fill-success'), 'a sequence seen once is just one token name');
});

test('term agreement approves, disagreement queues, approved terms are never changed', () => {
  const pf = (role: 'a' | 'b', model: string, terms: any[]): TermProposalFile => ({ packet: 'p', role, model, at: '2026-11-01T00:00:00Z', terms });
  const a = pf('a', 'opus', [
    { term: 'critical', concept: 'dsi:intent/danger', match: 'exact', confidence: 0.95, rationale: 'r' },
    { term: 'bg', concept: 'dsi:property/background', match: 'exact', confidence: 0.9, rationale: 'r' },
    { term: 'subdued', concept: 'dsi:emphasis/subtle', match: 'exact', confidence: 0.7, rationale: 'r' },
    { term: 'sys', ignore: 'noise', rationale: 'r' },
    { term: 'text', concept: 'dsi:property/foreground', match: 'exact', confidence: 0.9, rationale: 'r' },
  ]);
  const b = pf('b', 'sonnet', [
    { term: 'critical', concept: 'dsi:intent/danger', match: 'exact', confidence: 0.9, rationale: 'r' },
    { term: 'bg', concept: 'dsi:usage/surface', match: 'exact', confidence: 0.9, rationale: 'r' },
    { term: 'subdued', concept: 'dsi:emphasis/subtle', match: 'exact', confidence: 0.95, rationale: 'r' },
    { term: 'sys', ignore: 'noise', rationale: 'r' },
    { term: 'text', concept: 'dsi:property/foreground', match: 'exact', confidence: 0.9, rationale: 'r' },
  ]);
  const existing = file([term('text', 'property', 'text')]);
  const { file: out, counts } = mergeTermProposals(existing, a, b);
  assert.deepEqual(counts, { approved: 1, noise: 1, steps: 0, proposed: 2 });
  const st = (t: string) => out.terms.filter((x) => x.term === t).map((x) => `${x.concept}:${x.status}`).sort();
  assert.deepEqual(st('critical'), ['dsi:intent/danger:approved']);
  assert.deepEqual(st('bg'), ['dsi:property/background:proposed', 'dsi:usage/surface:proposed']);
  assert.deepEqual(st('subdued'), ['dsi:emphasis/subtle:proposed'], 'agreement below 0.85 is queued');
  assert.deepEqual(st('text'), ['dsi:property/text:approved'], 'an approved term blocks proposals on its facet');
  assert.ok(out.noise!.includes('sys'));
  assert.throws(() => mergeTermProposals(existing, a, { ...b, model: 'opus' }), /two different models/);
});

test('a multi-word term matches even when one of its words is a noise word; approved words never become noise', () => {
  const t = file([term('border', 'property', 'border'), term('border-radius', 'property', 'corner-radius')]);
  t.noise = ['color', 'border'];
  const r = classify(t, 'border-radius-200', '', 'color');
  assert.deepEqual([r.facets.property, r.unknown, r.explained], ['corner-radius', [], 1]);
  const pf = (role: 'a' | 'b', model: string): TermProposalFile => ({ packet: 'p', role, model, at: 'x', terms: [{ term: 'border', ignore: 'noise', rationale: 'r' }, { term: 'sys', ignore: 'step', rationale: 'r' }] });
  const { file: out } = mergeTermProposals(file([term('border', 'property', 'border')]), pf('a', 'opus'), pf('b', 'sonnet'));
  assert.ok(!out.noise!.includes('border'), 'border has an approved term');
  assert.deepEqual(out.steps, ['sys']);
});
