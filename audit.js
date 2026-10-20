const hasValue = value => value !== null && value !== undefined && String(value).trim() !== '';

export function resolveObservedEdit({ from, to, reason, station, pointCode, field, at, id }) {
  if (String(from ?? '') === String(to ?? '')) return { accepted: true, value: from, entry: null };
  if (!hasValue(from)) return { accepted: true, value: to, entry: null };
  if (!String(reason ?? '').trim()) return { accepted: false, value: from, entry: null };
  return {
    accepted: true, value: to,
    entry: { id, at, type: 'edit', station, pointCode, field, from, to, reason: reason.trim() },
  };
}

export function actionEntry({ id, at, type, station, pointCode, field, from, to, reason }) {
  if (!['edit', 'delete', 'undo', 'convert'].includes(type)) throw new Error('更正事件種類無效。');
  return { id, at, type, station, pointCode, field, from, to, reason };
}

export function pointDeletionEntry({ id, at, point, project }) {
  const referenced = setups => setups.some(setup => setup.bsPointId === point.id || setup.fsPointId === point.id ||
    (setup.intermediate || []).some(sight => sight.pointId === point.id));
  const wasObserved = referenced(project.setups) || (project.auditLog || []).some(entry => {
    if (!['edit', 'delete', 'undo', 'convert'].includes(entry.type)) return false;
    if (entry.pointId ? entry.pointId === point.id : entry.pointCode === point.code) return true;
    if (entry.field === 'station') {
      try { return referenced(JSON.parse(entry.from || '[]')); } catch (_) { return false; }
    }
    return false;
  });
  return { id, at, type: 'delete-point', pointId: point.id, pointCode: point.code, pointType: point.type, wasObserved };
}

export function auditReportEntry(entry) {
  if (entry.type !== 'delete-point') return entry;
  return { ...entry, station: '—', field: '刪除點位', from: entry.pointType, to: '已刪除',
    reason: entry.wasObserved ? '既有軌跡記有此點讀數' : '既有軌跡未見此點讀數' };
}
