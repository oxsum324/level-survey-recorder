export function setFirstObservedAt(item, key, from, to, at) {
  const stampKey = key === 'value' ? 'at' : `${key}At`;
  if (String(from ?? '') !== '' || String(to ?? '') === '' || item[stampKey]) return false;
  item[stampKey] = at;
  return true;
}
