import test from 'node:test';
import assert from 'node:assert/strict';
import { pageCanvasPlan, reportBreakPoints, CANVAS_LIMITS } from './pdf-pages.js';

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

test('R1 DOM collection protects existing print-avoid panels, maps, tables and footer in nested offset coordinates', () => {
  const container = {};
  const section = { offsetTop: 100, offsetParent: container };
  const frame = { tagName: 'SECTION', className: 'analysis-panel', textContent: '算術複核', offsetTop: 850, offsetHeight: 140, offsetParent: section, matches: () => false };
  container.querySelectorAll = selector => {
    if (selector === 'SECTION') return [frame];
    for (const required of ['.print-map', '.point-print-table', '.analysis-panel', 'footer']) assert.ok(selector.includes(required));
    return [frame];
  };
  const blocks = reportBreakPoints(container);
  assert.equal(blocks[0].start, 950);
  assert.equal(blocks[0].end, 1090);
  assert.deepEqual(pageCanvasPlan(681, 1500, 1000, 2, blocks).slices.map(slice => slice.end), [950, 1500]);
});

test('D4 heading follows the first sibling at least 60px high, with immediate-sibling fallback', () => {
  const container = {};
  const photo = { offsetTop: 1040, offsetHeight: 400, offsetParent: container, nextElementSibling: null };
  const note = { offsetTop: 970, offsetHeight: 22, offsetParent: container, nextElementSibling: photo };
  const heading = { tagName: 'H2', className: '', textContent: '儀器照片', offsetTop: 940, offsetHeight: 25, offsetParent: container, matches: () => true, nextElementSibling: note };
  container.querySelectorAll = selector => selector === 'H2' ? [heading] : [heading];
  let blocks = reportBreakPoints(container);
  assert.equal(blocks[1].end, 1440);
  assert.equal(pageCanvasPlan(681, 1500, 1000, 2, blocks).slices[0].end, 940);
  note.nextElementSibling = null;
  blocks = reportBreakPoints(container);
  assert.equal(blocks[1].end, 992);
});

test('D4 a tiny final page remains separate when merging would exceed the unchanged page height', () => {
  const plan = pageCanvasPlan(681, 2050, 1000, 2, [{ start: 1980, end: 2050, label: 'footer' }]);
  assert.deepEqual(plan.slices.map(slice => [slice.start, slice.end]), [[0, 1000], [1000, 1980], [1980, 2050]]);
  assert.equal(plan.shortLastPage.height, 70);
  assert.equal(plan.shortLastPage.merged, false);
  assert.equal(plan.shortLastPage.reason, '合併後超過頁高');
  assert.ok(plan.slices.every(slice => slice.end - slice.start <= 1000 && slice.hardCuts.length === 0));
});

test('D5 positioned containers use the offset chain without a fallback warning', t => {
  const warnings = []; t.mock.method(console, 'warn', message => warnings.push(message));
  const container = {};
  const block = { tagName: 'TR', className: '', textContent: 'S1', offsetTop: 150, offsetHeight: 100, offsetParent: container, matches: () => false };
  container.querySelectorAll = () => [block];
  const result = reportBreakPoints(container);
  assert.equal(result[0].start, 150); assert.equal(result[0].end, 250);
  assert.equal(warnings.length, 0);
});

test('D5 missing positioned container warns and measures equivalent relative DOMRects under CSS zoom', t => {
  const warnings = []; t.mock.method(console, 'warn', message => warnings.push(message));
  const parent = { parentElement: null, ownZoom: '2' };
  const container = { parentElement: parent, ownZoom: '0.25', getBoundingClientRect: () => ({ top: 40 }), ownerDocument: { defaultView: { getComputedStyle: node => ({ zoom: node.ownZoom }) } } };
  const block = { tagName: 'TR', className: '', textContent: 'S1', offsetParent: null, getBoundingClientRect: () => ({ top: 115, height: 50 }), matches: () => false };
  container.querySelectorAll = () => [block];
  const result = reportBreakPoints(container);
  assert.equal(result[0].start, 150); assert.equal(result[0].end, 250);
  assert.equal(warnings.length, 1); assert.match(warnings[0], /offsetParent/);
});

test('E1 short-tail reasons describe the retained page boundary rather than the document end', () => {
  // Deliberately extend the synthetic block past the document to distinguish
  // the old end-of-document test from the actual retained boundary at zero.
  const fitting = pageCanvasPlan(681, 1000, 1000, 2, [{ start: 980, end: 1020, label: 'synthetic boundary probe' }]);
  assert.deepEqual(fitting.shortLastPage, { height: 20, merged: true, reason: '可容納於前頁' });
  assert.deepEqual(fitting.slices.map(({ start, end }) => [start, end]), [[0, 1000]]);
  assert.deepEqual(fitting.slices[0].hardCuts, []);
  const tooTall = pageCanvasPlan(681, 2050, 1000, 2, [{ start: 1980, end: 2050, label: 'footer' }]);
  assert.equal(tooTall.shortLastPage.reason, '合併後超過頁高');
  assert.equal(tooTall.shortLastPage.merged, false);
});
