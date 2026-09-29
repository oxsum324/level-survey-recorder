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
