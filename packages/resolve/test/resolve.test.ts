import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOntology } from '@dsi/schema';
import { loadNative, resolve, resolveConcept, themeFor, type MappingSet } from '../src/index.ts';

const ONTOLOGY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../ontology');
const o = await loadOntology(ONTOLOGY);
const ext = (theme?: string) => ({ 'io.nonoun.dsi': { product: 'p', package: 'p', version: '1.0.0', file: 'f', nativeName: 'n', rawValue: 'r', ...(theme ? { theme } : {}) } });
const col = (hex: string) => ({ colorSpace: 'srgb', components: [0, 0, 0], hex });

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsi-resolve-'));
const dir = path.join(root, 'data/native/p/1.0.0');
fs.mkdirSync(dir, { recursive: true });
const files: Record<string, unknown> = {
  'base.tokens.json': {
    red: { 50: { $type: 'color', $value: col('#ff5555'), $extensions: ext() }, 60: { $type: 'color', $value: col('#dd0000'), $extensions: ext() } },
    dur: { $type: 'duration', $value: { value: 70, unit: 'ms' }, $extensions: ext() },
    fade: { $type: 'transition', $value: { duration: '{dur}', delay: { value: 0, unit: 'ms' }, timingFunction: [0, 0, 1, 1] }, $extensions: ext() },
    loop: { $value: '{loop2}', $extensions: ext() }, loop2: { $value: '{loop}', $extensions: ext() },
  },
  'theme.light.tokens.json': { danger: { $value: '{red.60}', $extensions: ext('light') }, 'danger-text': { $value: '{red.60}', $extensions: ext('light') } },
  'theme.dark.tokens.json': { danger: { $value: '{red.50}', $extensions: ext('dark') }, 'danger-text': { $value: '{red.50}', $extensions: ext('dark') } },
};
for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), JSON.stringify(v));
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ product: 'p', package: { name: 'p', version: '1.0.0' }, themes: ['light', 'dark'], modes: { light: 'light', dark: 'dark' }, files: [{ file: 'base.tokens.json', tokens: 6 }, { file: 'theme.light.tokens.json', theme: 'light', tokens: 2 }, { file: 'theme.dark.tokens.json', theme: 'dark', tokens: 2 }] }));
const set = loadNative(root, 'p', '1.0.0');

test('aliases resolve per theme and modes pick the declared theme', () => {
  assert.equal(themeFor(set, 'dark'), 'dark');
  assert.equal(themeFor(set, 'increased-contrast'), undefined);
  const r = resolve(set, 'dark', 'danger');
  assert.deepEqual([r.chain, r.type, (r.value as any).hex], [['red.50'], 'color', '#ff5555']);
  assert.equal((resolve(set, 'light', 'danger').value as any).hex, '#dd0000');
});

test('aliases nested in composite values resolve; cycles and missing tokens are reported', () => {
  assert.deepEqual((resolve(set, 'light', 'fade').value as any).duration, { value: 70, unit: 'ms' });
  assert.equal(resolve(set, 'light', 'loop').problem, 'cycle');
  assert.equal(resolve(set, 'light', 'nope').problem, 'unresolved');
});

const DANGER = 'dsi:concept/color/intent-danger';
const DANGER_BG = 'dsi:concept/color/intent-danger/property-background';
const DANGER_TEXT = 'dsi:concept/color/intent-danger/property-text';
const m = (token: string, concept: string, match: any, status = 'approved', confidence = 0.9) => ({ id: token + concept + match, token, concept, match, confidence, status });

test('approved exact/close answers; broad/narrow only as nearest; related and proposed never', () => {
  const maps: MappingSet = { mappings: [m('danger', DANGER_BG, 'exact'), m('danger-text', DANGER_BG, 'related'), m('red.60', DANGER_BG, 'exact', 'proposed')], noEquivalent: [] };
  const a = resolveConcept(o, set, maps, DANGER_BG, 'dark');
  assert.deepEqual([a.status, a.answer?.token, a.candidates.length, (a.answer?.value as any).hex], ['match', 'danger', 1, '#ff5555']);
  const b = resolveConcept(o, set, { mappings: [m('danger', DANGER_BG, 'broad')], noEquivalent: [] }, DANGER_BG, 'light');
  assert.deepEqual([b.status, b.answer?.match], ['nearest', 'broad']);
  const r = resolveConcept(o, set, { mappings: [m('danger', DANGER_BG, 'related')], noEquivalent: [] }, DANGER_BG, 'light');
  assert.equal(r.status, 'unknown');
});

test('a more specific exact mapping answers a broader concept only as nearest; a sibling never answers', () => {
  const maps: MappingSet = { mappings: [m('danger', DANGER_BG, 'exact')], noEquivalent: [] };
  const a = resolveConcept(o, set, maps, DANGER, 'light');
  assert.deepEqual([a.status, a.answer?.via], ['nearest', 'more-specific']);
  assert.equal(resolveConcept(o, set, maps, DANGER_TEXT, 'light').status, 'unknown');
});

test('a broader mapping answers a narrower concept as nearest only when just the property is unbound (ADR 0006 amended)', () => {
  const up: MappingSet = { mappings: [m('danger', DANGER, 'exact')], noEquivalent: [] };
  const a = resolveConcept(o, set, up, DANGER_BG, 'light');
  assert.deepEqual([a.status, a.answer?.via], ['nearest', 'less-specific']);
  // Negative control: Danger never answers Danger on-fill text (a usage is missing, not just the property).
  assert.equal(resolveConcept(o, set, up, 'dsi:concept/color/intent-danger/usage-on-fill/property-text', 'light').status, 'unknown');
});

test('a state variant never answers a stateless concept', () => {
  const hov: MappingSet = { mappings: [m('danger', `${DANGER_BG}/state-hover`, 'exact')], noEquivalent: [] };
  assert.equal(resolveConcept(o, set, hov, DANGER_BG, 'light').status, 'unknown');
});

test('absent needs an approved noEquivalent; an unmapped mode is unknown with a note', () => {
  const none: MappingSet = { mappings: [], noEquivalent: [{ concept: DANGER_TEXT, status: 'approved' }] };
  assert.equal(resolveConcept(o, set, none, DANGER_TEXT, 'light').status, 'absent');
  assert.equal(resolveConcept(o, set, { mappings: [], noEquivalent: [{ concept: DANGER_TEXT, status: 'proposed' }] }, DANGER_TEXT, 'light').status, 'unknown');
  const x = resolveConcept(o, set, { mappings: [m('danger', DANGER_BG, 'exact')], noEquivalent: [] }, DANGER_BG, 'increased-contrast');
  assert.deepEqual([x.status, x.note], ['unknown', 'no theme is declared for mode "increased-contrast"']);
});

test('a more-specific answer is the closest superset, never a state variant chosen by name order', () => {
  const SURF = 'dsi:concept/color/usage-surface/property-background';
  const maps: MappingSet = { mappings: [
    m('danger', `${SURF}/state-disabled+selected`, 'exact'),
    m('red.60', `${SURF}/emphasis-subtle/state-hover`, 'exact'),
    m('danger-text', `${SURF}/emphasis-subtle`, 'exact'),
  ], noEquivalent: [] };
  const a = resolveConcept(o, set, maps, SURF, 'light');
  assert.deepEqual([a.status, a.answer?.token, a.answer?.extra, a.answer?.addsState], ['nearest', 'danger-text', 1, false]);
});
