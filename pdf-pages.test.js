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

test('R1 a heading and its first block move together to the next page', () => {
  const plan = pageCanvasPlan(681, 2100, 1000, 2, [{ start: 970, end: 1060, label: 'h2 四、儀器檢校與設備照片' }]);
  assert.deepEqual(plan.slices.map(({ start, end }) => [start, end]), [[0, 970], [970, 1970], [1970, 2100]]);
  assert.equal(plan.slices[0].next[0], 'h2 四、儀器檢校與設備照片');
  assert.equal(plan.slices.flatMap(slice => slice.hardCuts).length, 0);
});

test('R1 table rows and photos are not cut, including overlapping heading groups', () => {
  const blocks = [{ start: 950, end: 1050, label: 'tr' }, { start: 900, end: 980, label: 'h3' }, { start: 1800, end: 2500, label: 'photo' }];
  const plan = pageCanvasPlan(681, 2600, 1000, 2, blocks);
  assert.deepEqual(plan.slices.map(slice => slice.end), [900, 1800, 2600]);
  assert.ok(plan.slices.every(slice => slice.hardCuts.length === 0));
});

test('R1 a block taller than a page retains hard cuts and is reported', () => {
  const block = { start: 100, end: 2600, label: 'oversized photo' };
  const plan = pageCanvasPlan(681, 2700, 1000, 2, [block]);
  assert.deepEqual(plan.slices.map(slice => slice.end), [1000, 2000, 2700]);
  assert.deepEqual(plan.oversized, [block]);
  assert.deepEqual(plan.slices.map(slice => slice.hardCuts.length), [1, 1, 0]);
});

test('R1 exact boundaries and fractional layout pixels do not lose content or stall', () => {
  const plan = pageCanvasPlan(681, 2000, 1000, 2, [{ start: 1000, end: 1100, label: 'exact' }, { start: 1890.4, end: 1999.7, label: 'fraction' }]);
  assert.deepEqual(plan.slices.map(slice => slice.end), [1000, 2000]);
  assert.equal(plan.slices.at(-1).end, 2000);
  assert.ok(plan.slices.every(slice => slice.end > slice.start && slice.end - slice.start <= 1000));
});
