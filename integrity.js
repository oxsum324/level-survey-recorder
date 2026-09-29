function ordered(value) {
  if (Array.isArray(value)) return value.map(item => item === undefined ? null : ordered(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, ordered(value[key])]));
  }
  return value;
}

export const canonicalize = value => JSON.stringify(ordered(value));

const FINGERPRINT_FIELDS = [
  'schema', 'id', 'name', 'number', 'date', 'observer', 'rodHolder', 'photographer',
  'instrument', 'datum', 'approxLocation', 'mapMediaId', 'mapSource', 'points',
  'route', 'setups', 'auditLog', 'instrumentCheck', 'environment', 'checklist',
  'photos', 'equipmentPhotos', 'routeHistory',
];

export function fingerprintPayload(project, mediaHashes = []) {
  const evidence = Object.fromEntries(FINGERPRINT_FIELDS.filter(key => project[key] !== undefined).map(key => [key, project[key]]));
  evidence.mediaHashes = mediaHashes.map(item => ({ id: item.id, sha256: item.sha256 })).sort((a, b) => a.id.localeCompare(b.id));
  return evidence;
}

const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');

export async function sha256Blob(blob) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())));
}

export async function fingerprint(project, mediaHashes = []) {
  const encoded = new TextEncoder().encode(canonicalize(fingerprintPayload(project, mediaHashes)));
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoded)));
}
