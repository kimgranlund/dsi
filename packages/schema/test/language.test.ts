import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { conceptDefinition, conceptName, gateUnregistered, isRegistered, loadOntology, parseConcept, readLexicon } from '../src/index.ts';

// docs/controlled-language.md, ADR 0019.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const o = await loadOntology(path.join(ROOT, 'ontology'));
const lex = readLexicon(ROOT);
const name = (c: string) => { const p = parseConcept(o, c); assert.equal(typeof p, 'object', String(p)); return conceptName(lex, p as any); };

test('L3 names follow the template: participle states, modifiers before the head, sentence case', () => {
  assert.equal(name('dsi:concept/color/intent-danger/property-background/emphasis-subtle/state-hover'), 'Hovered subtle danger background');
  assert.equal(name('dsi:concept/color/intent-accent/property-background/state-active'), 'Pressed accent background');
  assert.equal(name('dsi:concept/color/usage-categorical+on-fill/hue-gray/property-icon'), 'Gray categorical on-fill icon');
  assert.equal(name('dsi:concept/color/usage-page/property-background'), 'Page background');
});

test('L3 head is the domain noun without a property, and shadow color is named apart from the shadow', () => {
  assert.equal(name('dsi:concept/color/intent-accent'), 'Accent color');
  assert.equal(name('dsi:concept/color/usage-overlay/property-shadow'), 'Overlay shadow color');
  assert.equal(name('dsi:concept/elevation/usage-overlay/property-shadow'), 'Overlay shadow');
});

test('L4 generated definitions use the frame', () => {
  const p = parseConcept(o, 'dsi:concept/color/intent-danger/usage-page/property-background/state-hover') as any;
  assert.equal(conceptDefinition(lex, p), 'The color of backgrounds that communicates danger on the page, when hovered.');
});

test('emphasis default is never bound and opacity lives in its own domain', () => {
  assert.match(String(parseConcept(o, 'dsi:concept/color/intent-accent/property-background/emphasis-default')), /bare concept/);
  assert.match(String(parseConcept(o, 'dsi:concept/color/property-opacity/state-disabled')), /opacity domain/);
  assert.equal(typeof parseConcept(o, 'dsi:concept/opacity/property-opacity/state-disabled'), 'object');
});

test('the registry gate holds a rule approval of an unregistered concept and leaves owner approvals alone', () => {
  assert.ok(isRegistered(o, 'dsi:concept/color/usage-page/property-background'));
  const fresh = 'dsi:concept/color/intent-ai/usage-navigation/property-border/state-dragged';
  assert.ok(!isRegistered(o, fresh));
  const file = { mappings: [
    { token: 'a', concept: fresh, status: 'approved', provenance: { method: 'two-of-three-v1' } },
    { token: 'b', concept: fresh, status: 'approved', provenance: { method: 'human-review' } },
    { token: 'c', concept: 'dsi:concept/color/usage-page/property-background', status: 'approved', provenance: { method: 'agreement' } },
  ] };
  assert.deepEqual(gateUnregistered(o, file), ['a']);
  assert.deepEqual(file.mappings.map((m) => m.status), ['proposed', 'approved', 'approved']);
});

test('registered names are unique within each canonical scheme', () => {
  assert.deepEqual(o.issues.filter((i) => /duplicate prefLabel/.test(i.message)), []);
});
