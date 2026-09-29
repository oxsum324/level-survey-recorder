import test from 'node:test';
import assert from 'node:assert/strict';
import { actionEntry, resolveObservedEdit } from './audit.js';

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
