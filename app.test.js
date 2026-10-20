import test from 'node:test';
import assert from 'node:assert/strict';
import { appHarness } from './checks/app-harness.js';

function caseWithReading() {
  const h = appHarness();
  h.run(`project = blankProject();
    project.points.push({ id: 's1', code: 'S1', type: 'S' });
    project.setups = [{ bsPointId: project.route.startId, bs: '1.000', fsPointId: '', fs: '', intermediate: [{ pointId: 's1', value: '0.500' }] }];
    bindActions();`);
  return h;
}

test('L1 deleting an IS then creating a case cannot restore readings from the previous case', async () => {
  const h = caseWithReading();
  h.click({ removeIs: '0:0' });
  assert.equal(h.node('#undoLast').disabled, false);
  await h.node('#newCase').onclick();
  assert.equal(h.node('#undoLast').disabled, true);
  assert.equal(h.node('#undoToast').hidden, true);
  const before = h.run('JSON.stringify(project)');
  h.run('undoLast()');
  assert.equal(h.run('JSON.stringify(project)'), before);
});

test('L1 a successfully imported case clears the previous undo snapshot', async () => {
  const h = caseWithReading();
  h.click({ removeIs: '0:0' });
  h.context.importFile = { text: async () => JSON.stringify({ format: 'level-survey-case.v1', project: { schema: 1, points: [], setups: [], photos: [], route: {} }, media: [] }) };
  await h.run('importBackup(importFile)');
  assert.equal(h.run('undoStack.length'), 0);
  assert.equal(h.node('#undoLast').disabled, true);
});

test('L1 a successful photography merge clears the undo snapshot', async () => {
  const h = caseWithReading();
  h.click({ removeIs: '0:0' });
  const incoming = JSON.parse(h.run('JSON.stringify(project)'));
  incoming.points.find(item => item.id === 's1').description = '圍牆角';
  h.context.mergeFile = { text: async () => JSON.stringify({ format: 'level-survey-case.v1', project: incoming, media: [] }) };
  await h.run('mergePhotoBackup(mergeFile)');
  assert.equal(h.run('undoStack.length'), 0);
  assert.equal(h.node('#undoLast').disabled, true);
  assert.equal(h.run("point('s1').description"), '圍牆角');
});
