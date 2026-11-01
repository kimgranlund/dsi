import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOntology } from '@dsi/schema';
import type { NativeSet } from '@dsi/resolve';
import { auditTerms, contrast, hsl, runChecks } from '../src/audit.ts';

const o = await loadOntology(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../ontology'));
const c = (hex: string) => { const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255; return { colorSpace: 'srgb', components: [n(1), n(3), n(5)], hex }; };
const prov = { nativeName: 'n', file: 'f' };

function fixture(tokens: Record<string, Record<string, unknown>>): NativeSet {
  const map = new Map(Object.entries(tokens));
  return {
    product: 'material', version: '1', themes: ['light'], modes: { light: 'light' },
    tokens: new Map([...map.keys()].map((p) => [p, { path: p, prov, byTheme: new Map() }])),
    lookup: (_t: string, p: string) => map.get(p) as any,
  } as unknown as NativeSet;
}

test('color math: hue and WCAG contrast', () => {
  assert.equal(Math.round(hsl([1, 0, 0, 1]).h), 0);
  assert.equal(Math.round(hsl([0, 0.5, 0, 1]).h), 120);
  assert.equal(contrast([0, 0, 0, 1], [1, 1, 1, 1]), 21);
});

test('checks flag hue against intent, property against shipped usage, and low on-fill contrast', () => {
  const set = fixture({
    'md.sys.color.error': { $type: 'color', $value: c('#1b8a3a') },
    'md.sys.color.on-error': { $type: 'color', $value: c('#22993f') },
    'md.sys.color.primary': { $type: 'color', $value: c('#6750a4') },
    'md.comp.a.container-color': { $value: '{md.sys.color.primary}' },
    'md.comp.b.container-color': { $value: '{md.sys.color.primary}' },
    'md.comp.c.container-color': { $value: '{md.sys.color.primary}' },
  });
  const f = runChecks(o, 'material', set, [
    { id: '1', token: 'md.sys.color.error', concept: 'dsi:concept/color/intent-danger', match: 'close' },
    { id: '2', token: 'md.sys.color.on-error', concept: 'dsi:concept/color/intent-danger/usage-on-fill/property-foreground', match: 'exact' },
    { id: '3', token: 'md.sys.color.primary', concept: 'dsi:concept/color/intent-accent/property-text', match: 'exact' },
  ]);
  const kinds = f.map((x) => `${x.check}:${x.token}`);
  assert.ok(kinds.includes('hue-vs-intent:md.sys.color.error'), kinds.join('\n'));
  assert.ok(kinds.includes('property-vs-usage:md.sys.color.primary'), kinds.join('\n'));
  assert.ok(kinds.includes('on-fill-contrast:md.sys.color.on-error'), kinds.join('\n'));
});

test('a correct mapping raises nothing (negative control)', () => {
  const set = fixture({ 'md.sys.color.error': { $type: 'color', $value: c('#b3261e') }, 'md.sys.color.on-error': { $type: 'color', $value: c('#ffffff') } });
  assert.deepEqual(runChecks(o, 'material', set, [
    { id: '1', token: 'md.sys.color.error', concept: 'dsi:concept/color/intent-danger', match: 'narrow' },
    { id: '2', token: 'md.sys.color.on-error', concept: 'dsi:concept/color/intent-danger/usage-on-fill/property-foreground', match: 'exact' },
  ]), []);
});

test('a term most of its own tokens disagree with is flagged', () => {
  const terms = { product: 'p', terms: [{ term: 'brand', concept: 'dsi:usage/on-fill', match: 'exact', status: 'approved', provenance: { agent: 't', at: 'x' } }, { term: 'critical', concept: 'dsi:intent/danger', match: 'exact', status: 'approved', provenance: { agent: 't', at: 'x' } }] };
  const approved = ['color-bg-fill-brand', 'color-text-brand', 'color-border-brand'].map((t) => ({ token: t, concept: 'dsi:concept/color/intent-accent', match: 'exact' }))
    .concat(['color-bg-critical', 'color-text-critical', 'color-icon-critical'].map((t) => ({ token: t, concept: 'dsi:concept/color/intent-danger', match: 'exact' })));
  const f = auditTerms(o, terms as any, approved);
  assert.deepEqual(f.map((x) => x.token), ['term:brand']);
});
