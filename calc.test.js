import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from './calc.js';

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
