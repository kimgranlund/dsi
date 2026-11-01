import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ece, isCorrect, summarize, type Scored } from '../src/metrics.ts';

const s = (item: string, facet: string, gold: string, pred: string, confidence: number): Scored => ({ item, product: 'p', tier: 'owner', facet, gold, pred, confidence, correct: isCorrect(gold, pred) });

test('none is correct only for an unbound facet; multi-valued usage accepts any member', () => {
  assert.equal(isCorrect('', 'none'), true);
  assert.equal(isCorrect('danger', 'none'), false);
  assert.equal(isCorrect('categorical+on-fill', 'on-fill'), true);
  assert.equal(isCorrect('categorical', 'on-fill'), false);
});

test('a perfectly calibrated set has zero ECE; an overconfident one does not', () => {
  const ok = [s('a', 'f', 'x', 'x', 0.95), s('b', 'f', 'x', 'x', 0.95)];
  assert.ok(ece(ok) < 0.06);
  const bad = [s('a', 'f', 'x', 'y', 0.95), s('b', 'f', 'x', 'y', 0.95)];
  assert.ok(ece(bad) > 0.9);
});

test('joint accuracy needs every facet of an item right', () => {
  const r = summarize([s('a', 'intent', 'danger', 'danger', 0.9), s('a', 'property', 'text', 'icon', 0.9), s('b', 'intent', '', 'none', 0.9), s('b', 'property', 'text', 'text', 0.9)]);
  assert.equal(r.joint, 50);
  assert.equal(r.perFacet.intent.accuracy, 100);
});
