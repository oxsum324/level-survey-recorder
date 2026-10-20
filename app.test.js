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

test('L2 an immediate undo restores the removed IS and retains its audit trail', () => {
  const h = caseWithReading();
  h.click({ removeIs: '0:0' });
  h.run('undoLast()');
  assert.equal(h.run('project.setups[0].intermediate[0].value'), '0.500');
  assert.equal(h.run("project.auditLog.map(item => item.type).join(',')"), 'delete,undo');
  assert.equal(h.node('#undoLast').disabled, true);
});

test('L2 recording a new reading invalidates undo without losing the new observation', () => {
  const h = caseWithReading();
  h.click({ removeIs: '0:0' });
  h.node('#nextPoint').value = 's1';
  h.node('#nextRole').value = 'IS';
  h.node('#nextReading').value = '0.600';
  h.run('updateReadingWarning = () => null');
  h.click({ addNext: '0' });
  assert.equal(h.node('#undoLast').disabled, true);
  h.run('undoLast()');
  assert.equal(h.run('project.setups[0].intermediate[0].value'), '0.600');
  assert.equal(h.run("project.auditLog.some(item => item.type === 'undo')"), false);
});

test('L2 a missing snapshot point rejects restoration and identifies the deleted point', () => {
  const h = caseWithReading();
  h.click({ removeIs: '0:0' });
  h.run("project.points = project.points.filter(item => item.id !== 's1')");
  h.run('undoLast()');
  assert.equal(h.run('project.setups[0].intermediate.length'), 0);
  assert.equal(h.node('#undoLast').disabled, true);
  assert.equal(h.messages.at(-1), '快照中的點位 S1 已刪除，無法復原');
});

test('L2 adding or deleting points and saving reading changes invalidate snapshots', () => {
  for (const mutation of ["addPoint('TP')", "deletePoint('s1')", "project.setups[0].bs = '1.100'; queueSave(true)"]) {
    const h = caseWithReading();
    h.click({ removeIs: '0:0' });
    h.run(mutation);
    assert.equal(h.node('#undoLast').disabled, true, mutation);
    assert.equal(h.run('undoStack.length'), 0, mutation);
  }
});

test('L3 deleting a previously observed point preserves its identity in the case audit log', () => {
  const h = caseWithReading();
  h.click({ removeIs: '0:0' });
  h.run("deletePoint('s1')");
  assert.equal(h.run('project.auditLog.at(-1).type'), 'delete-point');
  assert.equal(h.run('project.auditLog.at(-1).pointCode'), 'S1');
  assert.equal(h.run('project.auditLog.at(-1).wasObserved'), true);
});
