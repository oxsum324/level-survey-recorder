import test from 'node:test';
import assert from 'node:assert/strict';
import { setFirstObservedAt } from './observation.js';

test('first BS and IS readings keep their initial observation time through edits', () => {
  const setup = { bs: '' }, sight = { value: '' };
  assert.equal(setFirstObservedAt(setup, 'bs', '', '0.595', '2026-09-29T08:00:00Z'), true);
  assert.equal(setFirstObservedAt(sight, 'value', '', '0.848', '2026-09-29T08:01:00Z'), true);
  assert.equal(setFirstObservedAt(setup, 'bs', '0.595', '0.596', '2026-09-29T08:05:00Z'), false);
  assert.equal(setup.bsAt, '2026-09-29T08:00:00Z');
  assert.equal(sight.at, '2026-09-29T08:01:00Z');
});

test('old readings never receive invented observation times', () => {
  const old = { bs: '0.595' };
  assert.equal(setFirstObservedAt(old, 'bs', '0.595', '0.596', '2026-09-29T08:05:00Z'), false);
  assert.equal(old.bsAt, undefined);
});
