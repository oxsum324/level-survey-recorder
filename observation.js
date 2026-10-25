export function setFirstObservedAt(item, key, from, to, at) {
  const stampKey = key === 'value' ? 'at' : `${key}At`;
  if (String(from ?? '') !== '' || String(to ?? '') === '' || item[stampKey]) return false;
  item[stampKey] = at;
  return true;
}

function observationIdKey(field) {
  return field.startsWith('bs') ? 'bsObservationId' : field.startsWith('fs') ? 'fsObservationId' : field === 'distance' ? 'distanceObservationId' : 'observationId';
}

export function ensureObservationId(item, field, createId) {
  const key = observationIdKey(field);
  if (!item[key]) item[key] = createId();
  return item[key];
}

function fieldFamily(field) {
  if (['bs', 'fs', 'value'].includes(field)) return 'reading';
  if (['bsUpper', 'fsUpper', 'upper'].includes(field)) return 'upper';
  if (['bsLower', 'fsLower', 'lower'].includes(field)) return 'lower';
  if (['bsInverted', 'fsInverted', 'inverted'].includes(field)) return 'inverted';
  if (['bsPointId', 'fsPointId', 'pointId'].includes(field)) return 'point';
  return field;
}

export function correctionEntries(project, station, pointCode, field, item) {
  const observationId = item?.[observationIdKey(field)];
  const setup = project.setups[station - 1];
  const candidates = !setup ? [] : field.startsWith('bs') ? [{ item: setup, pointId: setup.bsPointId }]
    : field.startsWith('fs') || field === 'distance' ? [{ item: setup, pointId: setup.fsPointId }]
      : (setup.intermediate || []).map(sight => ({ item: sight, pointId: sight.pointId }));
  const matchesPoint = (entry, pointId) => {
    if (entry.pointId) return entry.pointId === pointId;
    const current = project.points.find(point => point.id === pointId);
    const names = new Set([current?.code]);
    for (const rename of project.auditLog || []) if (rename.type === 'rename-point' && rename.pointId === pointId) {
      names.add(rename.from); names.add(rename.to);
    }
    return names.has(entry.pointCode) || fieldFamily(field) === 'point' && names.has(entry.to);
  };
  return (project.auditLog || []).filter(entry => {
    if (entry.type !== 'edit') return false;
    if (entry.observationId) return !!observationId && entry.observationId === observationId && fieldFamily(entry.field) === fieldFamily(field);
    if (entry.station !== station || entry.field !== field) return false;
    const possible = candidates.filter(candidate => matchesPoint(entry, candidate.pointId));
    return possible.length === 1 && possible[0].item === item;
  });
}

export function legacyCorrectionNotice(project) {
  return (project.auditLog || []).some(entry => entry.type === 'edit' && !entry.observationId)
    ? '歷史更正依舊站號與點號核對；無法唯一對應者僅列操作紀錄，不套用到個別讀數。' : '';
}
