import test from 'node:test';
import assert from 'node:assert/strict';
import { actionEntry, resolveObservedEdit, pointDeletionEntry, auditReportEntry } from './audit.js';

const base = { station: 2, pointCode: 'S4', field: 'fs', at: '2026-09-29T10:00:00.000Z', id: 'entry-1' };

test('first reading has no correction entry; a later change requires a reason', () => {
  assert.deepEqual(resolveObservedEdit({ ...base, from: '', to: '1.417', reason: '' }),
    { accepted: true, value: '1.417', entry: null });
  const edit = resolveObservedEdit({ ...base, from: '1.417', to: '1.418', reason: '讀錯重讀' });
  assert.equal(edit.accepted, true);
  assert.equal(edit.entry.type, 'edit');
  assert.equal(edit.entry.reason, '讀錯重讀');
  assert.equal(edit.entry.from, '1.417');
  assert.deepEqual(resolveObservedEdit({ ...base, from: '1.417', to: '1.418', reason: '' }),
    { accepted: false, value: '1.417', entry: null });
});

test('delete and undo events retain the affected station and source value', () => {
  const deleted = actionEntry({ ...base, type: 'delete', from: 'S4 1.417', to: '', reason: '移除中間視' });
  const restored = actionEntry({ ...base, type: 'undo', from: '', to: 'S4 1.417', reason: '復原移除中間視' });
  assert.equal(deleted.station, 2);
  assert.equal(deleted.from, restored.to);
  assert.equal(restored.type, 'undo');
});

test('L3 point deletion records its type and previous reading use for report display', () => {
  const point = { id: 's1', code: 'S1', type: 'S' };
  const project = { setups: [], auditLog: [] };
  const unused = pointDeletionEntry({ ...base, point, project });
  assert.equal(unused.type, 'delete-point');
  assert.equal(unused.pointType, 'S');
  assert.equal(unused.wasObserved, false);
  project.auditLog.push({ type: 'delete', pointId: 's1', pointCode: 'OLD-S1', field: 'is', from: '0.500' });
  const used = pointDeletionEntry({ ...base, point, project });
  assert.equal(used.wasObserved, true);
  assert.equal(auditReportEntry(used).field, '刪除點位');
  assert.equal(auditReportEntry(used).reason, '既有軌跡記有此點讀數');
});

test('L3 deleted station snapshots retain evidence of the contained point readings', () => {
  const entry = pointDeletionEntry({ ...base, point: { id: 's1', code: 'S1', type: 'S' },
    project: { setups: [], auditLog: [{ type: 'delete', field: 'station', pointCode: 'BM1', from: JSON.stringify([{ intermediate: [{ pointId: 's1', value: '1.2' }] }]) }] } });
  assert.equal(entry.wasObserved, true);
});

test('L3 an empty placeholder does not assert a historical reading', () => {
  const entry = pointDeletionEntry({ ...base, point: { id: 's1', code: 'S1', type: 'S' },
    project: { setups: [], auditLog: [{ type: 'delete', field: 'is', pointCode: 'S1', pointId: 's1', from: '', to: '' }] } });
  assert.equal(entry.wasObserved, false);
});
