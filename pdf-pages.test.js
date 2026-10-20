import test from 'node:test';
import assert from 'node:assert/strict';
import { pageCanvasPlan, CANVAS_LIMITS } from './pdf-pages.js';

test('L9 long reports keep the scale and bound each page canvas independently of total height', () => {
  const plan = pageCanvasPlan(681, 33157, 1009, 2);
  assert.equal(plan.pages, 33);
  assert.equal(plan.canvasWidth, 1362);
  assert.equal(plan.canvasHeight, 2018);
  assert.ok(plan.area <= CANVAS_LIMITS.area);
  assert.equal(pageCanvasPlan(680.3125, 1009, 1009, 2).canvasWidth, 1362);
});

test('L9 invalid or individually oversized pages stop before rasterization', () => {
  assert.throws(() => pageCanvasPlan(10000, 30000, 1009, 2), /系統列印/);
  assert.throws(() => pageCanvasPlan(5000, 5000, 5000, 2), /系統列印/);
  assert.throws(() => pageCanvasPlan(0, 1, 1), /尺寸無效/);
});
