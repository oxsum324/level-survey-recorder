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

export async function makeBackup(project) {
  const ids = new Set([project.mapMediaId, ...(project.photos || []).map(photo => photo.mediaId)].filter(Boolean));
  const media = [];
  for (const id of ids) {
    const blob = await loadMedia(id);
    if (!blob) throw new Error(`媒體 ${id} 不在此裝置，無法建立完整案件檔。`);
    media.push({ id, dataUrl: await blobAsDataUrl(blob) });
  }
  return { format: 'level-survey-case.v1', exportedAt: new Date().toISOString(), project, media };
}

export function parseBackup(contents) {
  const backup = JSON.parse(contents);
  if (backup?.format !== 'level-survey-case.v1' || !backup.project || !Array.isArray(backup.media)) {
    throw new Error('不是此版水準測量案件檔。');
  }
  const project = backup.project;
  if (!Array.isArray(project.points) || !Array.isArray(project.setups) || !Array.isArray(project.photos) || !project.route) {
    throw new Error('案件資料結構不完整。');
  }
  const ids = new Set();
  const media = backup.media.map(item => {
    if (!item || typeof item.id !== 'string' || ids.has(item.id) || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(item.dataUrl)) {
      throw new Error('案件圖像資料無效。');
    }
    ids.add(item.id);
    const [prefix, base64] = item.dataUrl.split(',');
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    if (bytes.byteLength > 60 * 1024 * 1024) throw new Error('單張圖像超過 60 MB。');
    return { id: item.id, blob: new Blob([bytes], { type: prefix.slice(5, -7) }) };
  });
  for (const id of [project.mapMediaId, ...project.photos.map(photo => photo.mediaId)].filter(Boolean)) {
    if (!ids.has(id)) throw new Error('案件缺少圖面或照片原檔。');
  }
  return { project, media };
}
