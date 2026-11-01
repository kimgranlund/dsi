import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStructure, pairingPrefixes, type TermsFile } from '../src/index.ts';

const prov = { agent: 't', at: 'x' };
const term = (t: string, concept: string) => ({ term: t, concept, match: 'exact', status: 'approved', provenance: prov });
const terms: TermsFile = { product: 'p', noise: ['color'], terms: [term('hover', 'dsi:state/hover'), term('active', 'dsi:state/active'), term('variant', 'dsi:emphasis/subtle'), term('bg', 'dsi:property/background'), term('primary', 'dsi:intent/accent')] };
const none = () => ({});
const flat = (g: { tokens: string[]; subgroups: { tokens: string[] }[] }) => [...g.tokens, ...g.subgroups.flatMap((s) => s.tokens)];

test('pairing prefixes are found from the data and ranked by frequency', () => {
  const p = pairingPrefixes(['a', 'b', 'c', 'on-a', 'on-b', 'on-c', 'inverse-a', 'inverse-b', 'inverse-c', 'on-d'], new Set());
  assert.deepEqual([...p], [['on', 1], ['inverse', 2]]);
});

test('name families: base, its on- pair, then variants, then states, in order', () => {
  const toks = ['surface-variant', 'on-surface', 'inverse-surface', 'surface', 'on-surface-variant', 'primary', 'on-primary', 'on-error', 'error', 'on-x', 'x'];
  const s = buildStructure(toks, terms, none);
  const surface = s.groups.find((g) => g.native === 'surface')!;
  assert.deepEqual(flat(surface), ['surface', 'on-surface', 'surface-variant', 'on-surface-variant']);
  assert.ok(s.groups.some((g) => g.native === 'inverse'), 'inverse prefixes one name here, below the pairing threshold of three');
  const primary = s.groups.find((g) => g.native === 'primary')!;
  assert.deepEqual([primary.label, primary.meaning], ['Primary', 'Accent']);
});

test('shipped order wins inside families; shipped groups keep designer order and absorb their family', () => {
  const toks = ['color-bg-surface', 'color-bg-surface-hover', 'color-bg-surface-active', 'color-bg', 'syntax-a', 'syntax-b', 'syntax-c', 'layer-01', 'layer-02'];
  const order = buildStructure(toks.slice(0, 4), terms, none, { kind: 'shipped-order', file: 'f', groups: [{ label: 'color', tokens: ['color-bg', 'color-bg-surface', 'color-bg-surface-active', 'color-bg-surface-hover'], groups: [] }] });
  assert.deepEqual(flat(order.groups[0]), ['color-bg', 'color-bg-surface', 'color-bg-surface-active', 'color-bg-surface-hover']);
  const grouped = buildStructure(toks.slice(4), terms, none, { kind: 'shipped-groups', file: 'f', groups: [{ label: 'Layer', tokens: ['layer-02', 'layer-01'], groups: [] }, { label: 'Syntax', tokens: ['syntax-b'], groups: [] }] });
  assert.deepEqual(grouped.groups.map((g) => [g.label, flat(g)]), [['Layer', ['layer-02', 'layer-01']], ['Syntax', ['syntax-b', 'syntax-a', 'syntax-c']]]);
});

test('every token is placed exactly once', () => {
  const toks = ['a-1', 'a-2', 'b', 'on-b', 'c-hover', 'c'];
  const s = buildStructure(toks, terms, none);
  const placed = s.groups.flatMap(flat);
  assert.deepEqual([...placed].sort(), [...toks].sort());
});

test('a family running both ways from its base reads as a ramp', () => {
  const f: Record<string, string> = { 'c-lowest': 'subtlest', 'c-low': 'subtle', 'c-high': 'strong', 'c-highest': 'strongest' };
  const rampTerms: TermsFile = { ...terms, terms: [...terms.terms, ...['lowest', 'low', 'high', 'highest'].map((w) => term(w, 'dsi:emphasis/subtle'))] };
  const s = buildStructure(['c-high', 'c', 'c-lowest', 'c-highest', 'c-low'], rampTerms, (t) => (f[t] ? { emphasis: f[t] } : {}));
  assert.deepEqual(flat(s.groups[0]), ['c-lowest', 'c-low', 'c', 'c-high', 'c-highest']);
});
