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

test('L4 exported snapshots contain the successful export time and reopen as exported', async () => {
  const h = caseWithReading();
  h.run(`makeBackup = async snapshot => new Blob([JSON.stringify({ format: 'level-survey-case.v1', project: snapshot, media: [] })]);
    deliverFile = async (name, blob) => { globalThis.deliveredBackup = await blob.text(); return true; };`);
  assert.equal(await h.run('exportBackup()'), true);
  const exportedAt = h.run('project.lastExportedAt');
  assert.equal(JSON.parse(h.context.deliveredBackup).project.lastExportedAt, exportedAt);
  h.context.importFile = { text: async () => h.context.deliveredBackup };
  await h.run('importBackup(importFile)');
  h.run('updateExportState()');
  assert.match(h.node('#exportState').textContent, /^已匯出 \d{2}:\d{2}$/);
});

test('L4 failed or cancelled delivery restores the previous export marker', async () => {
  for (const delivery of ['return false', "throw new Error('下載失敗')"]) {
    const h = caseWithReading();
    h.run(`project.lastExportedAt = '2026-01-01T00:00:00.000Z';
      makeBackup = async snapshot => new Blob([JSON.stringify({ project: snapshot })]);
      deliverFile = async () => { ${delivery}; };`);
    assert.equal(await h.run('exportBackup(true)'), false);
    assert.equal(h.run('project.lastExportedAt'), '2026-01-01T00:00:00.000Z');
  }
});

test('L5 an unsupported import leaves the active case and its undo snapshot intact', async () => {
  let replacements = 0;
  const h = caseWithReading();
  h.context.replaceProject = async () => { replacements++; };
  h.click({ removeIs: '0:0' });
  const before = h.run('JSON.stringify(project)');
  const incoming = JSON.parse(before); incoming.schema = 2;
  h.context.importFile = { text: async () => JSON.stringify({ format: 'level-survey-case.v1', project: incoming, media: [] }) };
  await h.run('importBackup(importFile)');
  assert.equal(replacements, 0);
  assert.equal(h.run('JSON.stringify(project)'), before);
  assert.equal(h.node('#undoLast').disabled, false);
  assert.match(h.messages.at(-1), /schema 2/);
});

test('L6 blocked localStorage keeps case startup, preferences and observation available', async () => {
  let registered = false;
  const h = appHarness({
    loadProject: async () => null,
    localStorage: { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } },
    navigator: { serviceWorker: { register: async () => { registered = true; } } },
  });
  h.run('updateStorageStatus = () => {}');
  await h.run('main()');
  assert.equal(h.node('#saveState').textContent, '已載入本機案件');
  assert.equal(h.node('#wakeLockToggle').checked, true);
  assert.equal(h.run("readPreference('unknown', 'default')"), 'default');
  assert.equal(registered, true);
  assert.doesNotThrow(() => h.node('#sunlightToggle').onclick());
  assert.doesNotThrow(() => h.node('#wakeLockToggle').onchange());
  h.node('#addStation').onclick();
  assert.equal(h.run('project.setups.length'), 1);
});

test('L8 the size notice is informational and successful delivery still completes', async () => {
  const h = caseWithReading();
  h.run(`makeBackup = async (snapshot, options) => { options.onEstimate(150 * 1024 * 1024); return new Blob(['case']); };
    deliverFile = async () => true;`);
  assert.equal(await h.run('exportBackup()'), true);
  assert.match(h.node('#backupSizeNotice').textContent, /約 150.0 MB/);
  assert.equal(h.node('#backupSizeNotice').hidden, false);
  h.run('showBackupEstimate(1000)');
  assert.equal(h.node('#backupSizeNotice').hidden, true);
});


function formatCase() {
  const h = appHarness();
  h.run(`project = blankProject(); project.points.push({ id: 's1', code: 'S1', type: 'S' });
    project.setups = [{ bsPointId: project.route.startId, bs: '1.500', bsUpper: '1.600', bsLower: '1.400', fsPointId: 's1', fs: '0.500', intermediate: [{ pointId: 's1', value: '0.600', upper: '0.700', lower: '0.500' }] }]; bindInputs();`);
  return h;
}
function readingTarget(dataset, value) {
  const warning = { hidden: true, textContent: '' };
  const container = { querySelector: selector => selector === '.reading-warning' ? warning : null };
  return { id: '', dataset, value, classList: { toggle() {} }, setAttribute() {}, warning,
    closest: selector => selector === '.reading-value' ? container : { dataset: { station: '0' } } };
}

test('M1 malformed input and blur preserve every saved reading and audit trail', async () => {
  for (const dataset of [{ reading: '', field: 'bs', station: '0' }, { reading: '', field: 'fs', station: '0' }, { reading: '', isValue: '0:0' }, { wireField: 'bsUpper', station: '0' }, { wireField: 'bsLower', station: '0' }, { isWire: '0:0:upper' }, { isWire: '0:0:lower' }]) {
    const h = formatCase();
    const target = readingTarget(dataset, '1.5001.500');
    const before = h.run('JSON.stringify(project)');
    await h.dispatch('input', target);
    await h.dispatch('change', target);
    assert.equal(h.run('JSON.stringify(project)'), before);
    assert.equal(target.value, '1.5001.500');
    assert.equal(target.warning.hidden, false);
    assert.match(target.warning.textContent, /讀數格式不正確/);
    assert.equal(h.node('#editReasonContext').textContent, '');
  }
});

test('M1 invalid first entry stays unsaved until corrected and clearing removes its warning', async () => {
  const h = formatCase(); h.run("project.setups[0].bs = ''");
  const target = readingTarget({ reading: '', field: 'bs', station: '0' }, 'abc');
  await h.dispatch('focusin', target); await h.dispatch('input', target); await h.dispatch('change', target);
  assert.equal(h.run('project.setups[0].bs'), '');
  target.value = '1,417'; await h.dispatch('input', target);
  assert.equal(h.run('project.setups[0].bs'), '1,417');
  assert.equal(target.warning.hidden, true);
  target.value = '1.'; await h.dispatch('input', target);
  assert.equal(h.run('project.setups[0].bs'), '1,417');
  target.value = ''; await h.dispatch('input', target);
  assert.equal(h.run('project.setups[0].bs'), '');
  assert.equal(target.warning.hidden, true);
  assert.equal(h.run('project.auditLog.length'), 0);
});


test('M2 correction preview identifies station, point, role, units and inverted staff', async () => {
  const h = formatCase();
  const target = readingTarget({ reading: '', field: 'bs', station: '0' }, '1.417');
  h.run(`editReason = async text => { document.querySelector('#editReasonContext').textContent = text; return null; };`);
  await h.dispatch('change', target);
  assert.equal(h.node('#editReasonContext').textContent, '第 1 站 BM1 點 ‧ 後視：1.500 m → 1.417 m');
  assert.equal(target.value, '1.500', 'cancel restores original text');
  h.run('project.setups[0].bsInverted = true');
  target.value = '1.417'; await h.dispatch('change', target);
  assert.equal(h.node('#editReasonContext').textContent, '第 1 站 BM1 點 ‧ 後視（倒尺）：1.500 m → 1.417 m');
  h.node('#editReasonContext').textContent = '';
  target.value = '1.500'; await h.dispatch('change', target);
  assert.equal(h.node('#editReasonContext').textContent, '', 'identical text does not open a dialog');
});

test('M2 opening the correction dialog places focus on its reason selector', () => {
  const h = appHarness(); let focused = false;
  h.node('#editReasonChoice').focus = () => { focused = true; };
  h.run("editReason('第 1 站 BM1 點 ‧ 後視：1.500 m → 1.417 m')");
  assert.equal(focused, true);
  assert.equal(h.node('#editReasonContext').textContent, '第 1 站 BM1 點 ‧ 後視：1.500 m → 1.417 m');
});


test('M1 malformed next-reading input still invalidates the previous destructive undo', async () => {
  const h = formatCase();
  h.run("pushUndo('移除讀數', 1, 'S1', 'value', '0.500', '')");
  const target = readingTarget({ reading: '' }, '1.5001.500'); target.id = 'nextReading';
  const before = h.run('JSON.stringify(project)');
  await h.dispatch('input', target);
  assert.equal(h.node('#undoLast').disabled, true);
  assert.equal(h.run('JSON.stringify(project)'), before);
  assert.equal(target.warning.hidden, false);
});
