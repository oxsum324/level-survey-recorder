import { VERSION } from './calc.js';

const DB_NAME = 'level-survey-v1';
const DB_VERSION = 1;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function openDatabase() {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains('project')) database.createObjectStore('project');
    if (!database.objectStoreNames.contains('media')) database.createObjectStore('media');
  };
  return requestResult(request);
}

async function operation(storeName, mode, action) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, mode);
    const result = await requestResult(action(transaction.objectStore(storeName)));
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return result;
  } finally {
    database.close();
  }
}

export const loadProject = () => operation('project', 'readonly', store => store.get('current'));
export const saveProject = project => operation('project', 'readwrite', store => store.put(project, 'current'));
export const saveMedia = (id, file) => operation('media', 'readwrite', store => store.put(file, id));
export const loadMedia = id => operation('media', 'readonly', store => store.get(id));
export const deleteMedia = id => operation('media', 'readwrite', store => store.delete(id));

export async function replaceProject(project, media) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(['project', 'media'], 'readwrite');
    transaction.objectStore('project').put(project, 'current');
    const mediaStore = transaction.objectStore('media');
    mediaStore.clear();
    for (const item of media) mediaStore.put(item.blob, item.id);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function blobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

const mediaIds = project => [...new Set([project.mapMediaId, ...(project.photos || []).map(photo => photo.mediaId), ...(project.equipmentPhotos || []).map(photo => photo.mediaId)].filter(Boolean))];
const backupHeader = (project, exportedAt) => JSON.stringify({ format: 'level-survey-case.v1', exportedAt, project }).slice(0, -1) + ',"media":[';

export async function estimateBackupSize(project, { load = loadMedia, exportedAt = new Date().toISOString() } = {}) {
  const ids = mediaIds(project);
  let bytes = new Blob([backupHeader(project, exportedAt), ']}']).size;
  for (const [index, id] of ids.entries()) {
    const blob = await load(id);
    if (!blob) throw new Error(`媒體 ${id} 不在此裝置，無法建立完整案件檔。`);
    const prefix = `data:${blob.type || 'application/octet-stream'};base64,`;
    bytes += new Blob([index ? ',' : '', JSON.stringify({ id, dataUrl: prefix })]).size + 4 * Math.ceil(blob.size / 3);
  }
  return bytes;
}

export async function makeBackup(project, { load = loadMedia, dataUrl = blobAsDataUrl, exportedAt = new Date().toISOString(), onEstimate = () => {} } = {}) {
  onEstimate(await estimateBackupSize(project, { load, exportedAt }));
  const parts = [new Blob([backupHeader(project, exportedAt)])];
  for (const [index, id] of mediaIds(project).entries()) {
    const blob = await load(id);
    if (!blob) throw new Error(`媒體 ${id} 不在此裝置，無法建立完整案件檔。`);
    // Convert each entry to bytes immediately so parts do not retain all base64 strings.
    parts.push(new Blob([index ? ',' : '', JSON.stringify({ id, dataUrl: await dataUrl(blob) })]));
  }
  parts.push(new Blob([']}']));
  return new Blob(parts, { type: 'application/json' });
}

export function parseBackup(contents) {
  const backup = JSON.parse(contents);
  if (backup?.format !== 'level-survey-case.v1' || !backup.project || !Array.isArray(backup.media)) {
    throw new Error('不是此版水準測量案件檔。');
  }
  const project = backup.project;
  if (project.schema !== 1) throw new Error(`此案件檔格式（schema ${String(project.schema)}）不受 V${VERSION} 支援`);
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const isRecordArray = value => Array.isArray(value) && value.every(isRecord);
  const optionalRecord = value => value === undefined || value === null || isRecord(value);
  const optionalRecordArray = value => value === undefined || isRecordArray(value);
  const optionalString = value => value === undefined || value === null || typeof value === 'string';
  const selectedPointId = value => value === undefined || value === null || value === '' || typeof value === 'string';
  const textFields = ['name', 'number', 'date', 'observer', 'rodHolder', 'photographer', 'instrument', 'datum', 'approxLocation', 'householdNo', 'address', 'orgName', 'mapSource'];
  const pointIds = new Set();
  const validPoints = Array.isArray(project.points) && project.points.every(point => {
    if (!isRecord(point) || typeof point.id !== 'string' || !point.id || typeof point.code !== 'string' || typeof point.type !== 'string' || pointIds.has(point.id)) return false;
    pointIds.add(point.id);
    return true;
  });
  const hasValidShape = validPoints
    && textFields.every(key => optionalString(project[key]))
    && (typeof project.instrument === 'string' || (project.instrument == null && project.instrumentDefaultApplied !== true))
    && isRecordArray(project.setups)
    && project.setups.every(setup => selectedPointId(setup.bsPointId) && selectedPointId(setup.fsPointId)
      && (setup.intermediate === undefined || (isRecordArray(setup.intermediate) && setup.intermediate.every(sight => selectedPointId(sight.pointId)))))
    && isRecordArray(project.photos)
    && (project.equipmentPhotos === undefined || isRecordArray(project.equipmentPhotos))
    && isRecord(project.route)
    && selectedPointId(project.route.startId) && selectedPointId(project.route.endId)
    && selectedPointId(project.mapMediaId)
    && [...project.photos, ...(project.equipmentPhotos || [])].every(photo => typeof photo.mediaId === 'string' && photo.mediaId.length > 0)
    && optionalRecord(project.pointPlan)
    && optionalRecord(project.instrumentCheck)
    && (project.instrumentCheck?.twoPeg === undefined || project.instrumentCheck.twoPeg === null || isRecord(project.instrumentCheck.twoPeg))
    && optionalRecord(project.environment)
    && optionalRecord(project.checklist)
    && (project.checklist?.items === undefined || isRecordArray(project.checklist.items))
    && optionalRecordArray(project.auditLog)
    && optionalRecordArray(project.routeHistory)
    && (project.routeHistory === undefined || project.routeHistory.every(item => typeof item.at === 'string'));
  if (!hasValidShape) throw new Error('案件資料結構不完整。');
  const observationIds = new Set();
  for (const setup of project.setups) {
    const references = [setup.bsPointId, setup.fsPointId, ...(setup.intermediate || []).map(sight => sight.pointId)];
    if (references.some(id => id && !pointIds.has(id))) throw new Error('測站參照不存在的點位。');
    const values = [setup.bsObservationId, setup.fsObservationId, setup.distanceObservationId, ...(setup.intermediate || []).map(sight => sight.observationId)];
    for (const id of values) if (id !== undefined && id !== null) {
      if (typeof id !== 'string' || !id || observationIds.has(id)) throw new Error('觀測識別碼無效或重複。');
      observationIds.add(id);
    }
  }
  if ([project.route.startId, project.route.endId].some(id => id && !pointIds.has(id))) throw new Error('測線參照不存在的點位。');
  const ids = new Set();
  const media = backup.media.map(item => {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.dataUrl !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(item.dataUrl)) {
      throw new Error('案件圖像資料無效。');
    }
    ids.add(item.id);
    const [prefix, base64] = item.dataUrl.split(',');
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    if (bytes.byteLength > 60 * 1024 * 1024) throw new Error('單張圖像超過 60 MB。');
    return { id: item.id, blob: new Blob([bytes], { type: prefix.slice(5, -7) }) };
  });
  for (const id of [project.mapMediaId, ...project.photos.map(photo => photo.mediaId), ...(project.equipmentPhotos || []).map(photo => photo.mediaId)].filter(Boolean)) {
    if (!ids.has(id)) throw new Error('案件缺少圖面或照片原檔。');
  }
  return { project, media };
}
