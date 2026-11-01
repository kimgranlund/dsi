import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOntology } from '@dsi/schema';
import type { NativeSet, MappingSet } from '@dsi/resolve';
import { buildCanon, canonicalName } from '../src/index.ts';

const o = await loadOntology(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../ontology'));
const col = (hex: string) => ({ colorSpace: 'srgb', components: [0, 0, 0], hex });
function set(product: string, tokens: Record<string, Record<string, unknown>>, modes: Record<string, string>): NativeSet {
  const m = new Map(Object.entries(tokens));
  return { product, version: '1', themes: Object.values(modes), modes, tokens: new Map([...new Set([...m.keys()].map((k) => k.replace(/^[a-z]+:/, '')))].map((p) => [p, { path: p, prov: { nativeName: `--${product}-${p}` }, byTheme: new Map() }])), lookup: (theme: string, p: string) => (m.get(`${theme}:${p}`) ?? m.get(p)) as any } as unknown as NativeSet;
}
const ap = (token: string, concept: string, match: string): MappingSet['mappings'][number] => ({ id: token, token, concept, match: match as any, confidence: 0.9, status: 'approved' });
const DT = 'dsi:concept/color/intent-danger/property-text';
const DBG = 'dsi:concept/color/intent-danger/property-background';

test('canonical names come from facet values in order', () => {
  assert.deepEqual(canonicalName(o, 'dsi:concept/color/intent-danger/usage-on-fill/property-foreground'), { group: 'color', name: 'danger-on-fill-foreground' });
  assert.deepEqual(canonicalName(o, 'dsi:concept/color/usage-inverse+link/property-text/state-hover'), { group: 'color', name: 'inverse+link-text-hover' });
  // Syntax values are prefixed so Lezer's link/strong/emphasis cannot collide with usage-link or emphasis-strong.
  assert.deepEqual(canonicalName(o, 'dsi:concept/color/syntax-link/property-text'), { group: 'color', name: 'code-link-text' });
  assert.notDeepEqual(canonicalName(o, 'dsi:concept/color/syntax-link/property-text'), canonicalName(o, 'dsi:concept/color/usage-link/property-text'));
  assert.deepEqual(canonicalName(o, 'dsi:concept/color/usage-surface/property-background/brightness-dim'), { group: 'color', name: 'surface-background-dim' });
});

test('each product answers per mode; nearest is flagged; unknown is omitted, never invented', () => {
  const a = set('a', { 'light:err': { $type: 'color', $value: col('#da1e28') }, 'dark:err': { $type: 'color', $value: col('#ff8389') }, bg: { $type: 'color', $value: col('#fff1f1') } }, { light: 'light', dark: 'dark' });
  const b = set('b', { crit: { $type: 'color', $value: col('#8e0b21') } }, { light: 'light' });
  const r = buildCanon(o, new Map([['dsi:intent/danger', 'Danger'], ['dsi:property/text', 'Text'], ['dsi:property/background', 'Background']]), [
    { set: a, name: 'A', maps: { mappings: [ap('err', DT, 'exact'), ap('bg', DBG, 'broad')], noEquivalent: [] } },
    { set: b, name: 'B', maps: { mappings: [ap('crit', DT, 'close')], noEquivalent: [] } },
  ]);
  assert.deepEqual(r.concepts.map((c) => [c.name, c.label]), [['danger-background', 'Danger · Background'], ['danger-text', 'Danger · Text']]);
  const ad = r.files.get('a.dark')!.tree.color as any;
  assert.equal(ad['danger-text'].$value.hex, '#ff8389');
  assert.equal(ad['danger-text'].$extensions['io.nonoun.dsi'].nativeName, '--a-err');
  assert.equal(ad['danger-background'].$extensions['io.nonoun.dsi'].status, 'nearest');
  assert.match(r.files.get('a.dark')!.css, /--dsi-color-danger-background: var\(--a-bg, #fff1f1\); \/\* nearest: broad \*\//);
  const bl = r.files.get('b.light')!.tree.color as any;
  assert.equal(bl['danger-background'], undefined, 'B has no answer for danger background, so nothing is emitted');
  assert.equal(r.coverage[DBG].b.light.status, 'unknown');
  assert.equal(r.coverage[DT].b.light.status, 'match');
});
