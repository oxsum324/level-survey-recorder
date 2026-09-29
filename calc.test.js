import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeThreeWire, buildSummaryCsv, calculate, formulaToleranceMm, twoPegCheck } from './calc.js';

function example(finalFs = '0.883', toleranceMm = '5', adjustMethod = 'stations') {
  const codes = ['BM1', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'TP'];
  return {
    points: codes.map(code => ({ id: code, code, type: code.startsWith('BM') ? 'BM' : code === 'TP' ? 'TP' : 'S' })),
    route: { startId: 'BM1', endId: 'BM1', startHeight: '86.653', toleranceMm, adjustMethod },
    setups: [
      { bsPointId: 'BM1', bs: '0.595', intermediate: [
        { pointId: 'S1', value: '0.848' }, { pointId: 'S2', value: '1.187' }, { pointId: 'S3', value: '1.258' },
      ], fsPointId: 'S4', fs: '1.417', distance: '20' },
      { bsPointId: 'S4', bs: '0.640', intermediate: [
        { pointId: 'S5', value: '0.810' }, { pointId: 'S6', value: '1.088' }, { pointId: 'S7', value: '1.244' },
      ], fsPointId: 'TP', fs: '0.525', distance: '30' },
      { bsPointId: 'TP', bs: '1.590', intermediate: [], fsPointId: 'BM1', fs: finalFs, distance: '50' },
    ],
  };
}

test('provided BM1 loop reproduces every listed elevation and zero closure', () => {
  const result = calculate(example());
  assert.equal(result.complete, true);
  assert.equal(result.adjusted, true);
  assert.ok(Math.abs(result.closureMm) < 1e-7);
  assert.equal(result.sumBS.toFixed(3), '2.825');
  assert.equal(result.sumFS.toFixed(3), '2.825');
  assert.deepEqual(result.stations[0].intermediate.map(sight => sight.rawHeight.toFixed(3)), ['86.400', '86.061', '85.990']);
  assert.equal(result.stations[0].rawEndHeight.toFixed(3), '85.831');
  assert.deepEqual(result.stations[1].intermediate.map(sight => sight.rawHeight.toFixed(3)), ['85.661', '85.383', '85.227']);
  assert.equal(result.stations[1].rawEndHeight.toFixed(3), '85.946');
  assert.equal(result.rawEndHeight.toFixed(3), '86.653');
});

test('nonzero closure is distributed by station and by length', () => {
  const equal = calculate(example('0.880'));
  assert.equal(equal.closureMm.toFixed(2), '3.00');
  assert.equal(equal.stations[0].correction.toFixed(3), '-0.001');
  assert.equal(equal.stations[1].adjustedIntermediate[0].adjustedHeight.toFixed(3), '85.660');
  assert.equal(equal.stations[2].adjustedEndHeight.toFixed(3), '86.653');
  const distance = calculate(example('0.880', '5', 'distance'));
  assert.equal(distance.stations[0].correction.toFixed(4), '-0.0006');
  assert.equal(distance.stations[1].correction.toFixed(4), '-0.0009');
  assert.equal(distance.stations[2].correction.toFixed(4), '-0.0015');
  assert.equal(distance.stations[2].adjustedEndHeight.toFixed(3), '86.653');
});

test('over tolerance and absent tolerance retain raw heights without adjustment', () => {
  const over = calculate(example('0.880', '2'));
  assert.equal(over.withinTolerance, false);
  assert.equal(over.adjusted, false);
  const absent = calculate(example('0.880', ''));
  assert.equal(absent.withinTolerance, null);
  assert.equal(absent.adjusted, false);
});

test('partial current setup shows intermediate elevation but never reports closure', () => {
  const project = example();
  project.setups = [project.setups[0]];
  project.setups[0].fs = '';
  const result = calculate(project);
  assert.equal(result.complete, false);
  assert.equal(result.closureMm, null);
  assert.equal(result.stations[0].intermediate[0].rawHeight.toFixed(3), '86.400');
  assert.equal(result.stations[0].rawEndHeight, null);
});

test('different known BM checks measured end against its own height', () => {
  const project = example('0.880');
  project.points.push({ id: 'BM2', code: 'BM2', type: 'BM' });
  project.route.endId = 'BM2';
  project.route.endHeight = '86.650';
  project.setups[2].fsPointId = 'BM2';
  const result = calculate(project);
  assert.equal(result.complete, true);
  assert.equal(result.closureMm.toFixed(2), '6.00');
  assert.equal(result.withinTolerance, false);
});

test('assumed start elevation cannot certify closure to another known BM', () => {
  const project = example('0.883');
  project.points.push({ id: 'BM2', code: 'BM2', type: 'BM' });
  project.route.endId = 'BM2';
  project.route.endHeight = '86.653';
  project.route.startHeightKind = 'assumed';
  project.setups[2].fsPointId = 'BM2';
  const result = calculate(project);
  assert.equal(result.complete, true);
  assert.equal(result.closureMm.toFixed(2), '0.00');
  assert.equal(result.withinTolerance, null);
  assert.equal(result.adjusted, false);
  assert.match(result.issues.join(' '), /高程基準/);
});

test('decimal comma from a mobile keyboard is accepted', () => {
  const project = example();
  project.setups[0].bs = '0,595';
  assert.equal(calculate(project).rawEndHeight.toFixed(3), '86.653');
});

test('each S point may carry the previous foresight and next backsight', () => {
  const project = {
    points: ['BM1', 'S1', 'S2'].map(code => ({ id: code, code, type: code === 'BM1' ? 'BM' : 'S' })),
    route: { startId: 'BM1', endId: 'BM1', startHeight: '100.000', toleranceMm: '5', adjustMethod: 'stations' },
    setups: [
      { bsPointId: 'BM1', bs: '1.000', intermediate: [], fsPointId: 'S1', fs: '1.500' },
      { bsPointId: 'S1', bs: '0.600', intermediate: [], fsPointId: 'S2', fs: '0.900' },
      { bsPointId: 'S2', bs: '1.400', intermediate: [], fsPointId: 'BM1', fs: '0.600' },
    ],
  };
  const result = calculate(project);
  assert.equal(result.complete, true);
  assert.equal(result.rawEndHeight.toFixed(3), '100.000');
  assert.equal(result.stations[0].rawEndHeight.toFixed(3), '99.500');
  assert.equal(result.stations[1].rawEndHeight.toFixed(3), '99.200');
  assert.equal(result.stations[1].bsPointId, result.stations[0].fsPointId);
  assert.equal(result.stations[2].bsPointId, result.stations[1].fsPointId);
});

test('readings longer than the staff stop closure and use the case staff length', () => {
  const mistaken = example();
  mistaken.setups[0].bs = '1417';
  const rejected = calculate(mistaken);
  assert.equal(rejected.complete, false);
  assert.equal(rejected.closureMm, null);
  assert.match(rejected.issues.join(' '), /第 1 站 後視 BM1 點讀數 1417 m 超過尺長 5 m/);
  mistaken.setups[0].bs = '-1417';
  assert.match(calculate(mistaken).issues.join(' '), /讀數 -1417 m 超過尺長 5 m/);

  mistaken.setups[0].bs = '4.999';
  assert.equal(calculate(mistaken).complete, true);
  mistaken.route.staffLengthM = '3';
  mistaken.setups[0].bs = '3.2';
  assert.match(calculate(mistaken).issues.join(' '), /超過尺長 3 m/);
  mistaken.setups[0].bs = '1';
  mistaken.setups[0].intermediate[0].value = '3.2';
  assert.match(calculate(mistaken).issues.join(' '), /中間視 S1/);
  mistaken.setups[0].intermediate[0].value = '1';
  mistaken.setups[0].fs = '3.2';
  assert.match(calculate(mistaken).issues.join(' '), /前視 S4/);
});

test('inverted foresight adds its magnitude to the instrument height', () => {
  // BM1 10.000 + BS 1.000 = HI 11.000; inverted FS 0.500 means 11.000 - (-0.500) = 11.500.
  const project = {
    points: [{ id: 'BM1', code: 'BM1' }, { id: 'BM2', code: 'BM2' }],
    route: { startId: 'BM1', endId: 'BM2', startHeight: '10.000', endHeight: '11.500', startHeightKind: 'known', toleranceMm: '5' },
    setups: [{ bsPointId: 'BM1', bs: '1.000', intermediate: [], fsPointId: 'BM2', fs: '0.500', fsInverted: true }],
  };
  const result = calculate(project);
  assert.equal(result.stations[0].fs, -0.5);
  assert.equal(result.rawEndHeight, 11.5);
  assert.equal(result.closureMm, 0);
  project.setups[0].intermediate.push({ pointId: 'BM2', value: '0.300', inverted: true });
  assert.equal(calculate(project).stations[0].intermediate[0].rawHeight, 11.3);
});

test('inverted backsight and unmarked negative readings are distinguished', () => {
  const project = example();
  project.setups[0].bs = '-0.595';
  let result = calculate(project);
  assert.equal(result.closureMm, null);
  assert.match(result.issues.join(' '), /讀數為負值，如為倒尺請勾選「倒尺」/);
  project.setups[0].bs = '0.595';
  project.setups[0].bsInverted = true;
  result = calculate(project);
  assert.equal(result.stations[0].bs, -0.595);
  assert.equal(result.stations[0].instrumentHeight.toFixed(3), '86.058');
});

test('three-wire readings provide sight distances and optional midpoint warnings', () => {
  const project = example();
  project.route.stadiaConstantK = '100';
  project.route.threeWireToleranceMm = '2';
  project.setups[0].bsUpper = '0.645';
  project.setups[0].bsLower = '0.545';
  project.setups[0].fsUpper = '1.467';
  project.setups[0].fsLower = '1.367';
  project.setups[0].intermediate[0].upper = '0.904';
  project.setups[0].intermediate[0].lower = '0.800';
  const result = calculate(project);
  assert.equal(result.complete, true);
  assert.equal(result.stations[0].bsDistanceM.toFixed(3), '10.000');
  assert.equal(result.stations[0].fsDistanceM.toFixed(3), '10.000');
  assert.equal(result.stations[0].distanceDifferenceM.toFixed(3), '0.000');
  assert.equal(result.threeWireAlerts.length, 1);
  assert.match(result.threeWireAlerts[0], /中間視 S1/);
  assert.equal(result.stations[0].intermediate[0].wire.exceedsTolerance, true);
  assert.equal(analyzeThreeWire(1.5, '', '', 5, 100, null), null);
  assert.equal(analyzeThreeWire(1.5, '1.6', '', 5, 100, null).issue.includes('同時'), true);
  assert.equal(analyzeThreeWire(1.5, '1.4', '1.6', 5, 100, null).distanceM, undefined);
});

test('rise and fall independently reproduces the provided BM1 loop and inverted sight', () => {
  const loop = calculate(example());
  assert.equal(loop.riseFallCheck.ok, true);
  assert.ok(Math.abs(loop.riseFallCheck.sumRise - loop.riseFallCheck.sumFall) < 1e-9);
  assert.ok(loop.riseFallCheck.maxDiffMm < 1e-7);
  const project = example();
  project.setups[0].intermediate[0].inverted = true;
  const inverted = calculate(project);
  assert.equal(inverted.riseFallCheck.ok, true);
  assert.ok(inverted.riseFallCheck.maxDiffMm < 1e-7);
  project.setups[0].fs = '';
  assert.equal(calculate(project).riseFallCheck.ok, null);
});

test('C square-root length uses every manually entered station distance', () => {
  const setups = example().setups;
  assert.deepEqual(formulaToleranceMm('5', setups), { lengthKm: 0.1, valueMm: 1.58 });
  setups[1].distance = '';
  assert.match(formulaToleranceMm('5', setups).issue, /每站/);
  assert.match(formulaToleranceMm('', example().setups).issue, /C 值/);
});

test('CSV preserves reading order, correction blanks, BOM, and spreadsheet-safe text', () => {
  const project = example('0.880', '');
  project.name = '=SUM(1,1)';
  project.number = 'A,1';
  project.setups[0].intermediate[0].inverted = true;
  const csv = buildSummaryCsv(project);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /案件名稱,"'=SUM\(1,1\)"/);
  assert.match(csv, /案件編號,"A,1"/);
  assert.match(csv, /測站,點號,點位類別,後視,中間視,前視,倒尺註記,視準軸高,原始高程,改正數,改正後高程,測線長度,備註/);
  assert.match(csv, /1,S1,S,,0\.848,,IS 倒尺,87\.248,88\.096,,,,中間視/);
  assert.match(csv, /是否已改正,否/);
});

test('two-peg check reports signed error without a pass or fail judgment', () => {
  const result = twoPegCheck({ a1: '1.000', b1: '1.200', a2: '1.100', b2: '1.310', distanceM: '50' });
  assert.equal(result.errorMm.toFixed(2), '-10.00');
  assert.equal(result.per100mMm.toFixed(2), '-20.00');
  assert.equal(twoPegCheck({ a1: '1.000' }), null);
  assert.match(twoPegCheck({ a1: '1', b1: '2', a2: '3', b2: '4', distanceM: '0' }).issue, /大於零/);
});
