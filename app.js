import { buildSummaryCsv, calculate, formatHeight, formatMm, formatObservationTime, formulaToleranceMm, readingIssue, suggestMmCorrection, twoPegCheck, VERSION } from './calc.js';
import { loadProject, saveProject, saveMedia, loadMedia, deleteMedia, replaceProject, makeBackup, parseBackup } from './store.js';
import { resolveObservedEdit, actionEntry } from './audit.js';
import { fingerprint, sha256Blob } from './integrity.js';
import { captureTime } from './exif.js';
import { setFirstObservedAt } from './observation.js';

const $ = selector => document.querySelector(selector);
const uid = () => crypto.randomUUID();
const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const validPosition = value => value && Number.isFinite(value.x) && Number.isFinite(value.y) && value.x >= 0 && value.x <= 100 && value.y >= 0 && value.y <= 100;
const decimals = 'type="text" inputmode="decimal" autocomplete="off"';
const validReading = value => /^\d+(?:[.,]\d{1,5})?$/.test(String(value ?? '').trim());
const DEFAULT_INSTRUMENT = 'PENTAX AP-128';
const photoUrls = new Map();
const equipmentPhotoUrls = new Map();
let mapUrl = null;
let project;
let saveTimer;
let saveQueue = Promise.resolve();
let placingPointId = null;
let draftNextPointId = '';
let draftNextRole = 'IS';
let draftNextValue = '';
let draftNextInverted = false;
let persistRequested = false;
const checklistDefaults = ['圓水準器（氣泡）檢查', '兩樁法檢驗', '水準尺零點、接頭與刻劃檢查', '尺墊準備（轉點使用）', '前後視距大致相等的站位規劃', '避開熱閃爍明顯的時段', '視線不要貼近地面', '扶尺人員前後擺尺，取最小讀數', '使用兩支尺時，測站數取偶數'];
const undoStack = [];
const initialEntries = new WeakMap();
const entryStart = new WeakMap();
let undoTimer;
let wakeSentinel = null;
let editPending = false;
const stamp = () => new Date().toISOString();
const localInputTime = value => { if (!value) return ''; const date = new Date(value); if (Number.isNaN(date.getTime())) return String(value).slice(0, 16); const pad = n => String(n).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; };
const dateTime = value => value ? (String(value).endsWith('Z') ? localInputTime(value) : String(value).slice(0, 16)).replace('T', ' ') : '';
const photoTime = photo => `${dateTime(photo.capturedAt || photo.addedAt)}（來源：${{ exif: 'EXIF', file: '檔案時間', import: '匯入時間' }[photo.capturedAtSource] || '匯入時間'}）`;

function blankProject() {
  const bm = { id: uid(), code: 'BM1', type: 'BM', description: '', position: null };
  return {
    schema: 1, appVersion: VERSION, id: uid(), name: '', number: '', date: new Date().toISOString().slice(0, 10),
    observer: '', rodHolder: '', photographer: '', instrument: DEFAULT_INSTRUMENT, instrumentDefaultApplied: true, datum: '', approxLocation: '', points: [bm], pointPlan: { sCount: '0', tpCount: '0' }, mapMediaId: null, mapSource: '', photos: [], equipmentPhotos: [],
    route: { startId: bm.id, endId: bm.id, startHeight: '10.000', startHeightKind: 'assumed', endHeight: '', toleranceMm: '', toleranceBasis: '', formulaC: '', staffLengthM: '5', stadiaConstantK: '100', threeWireToleranceMm: '', adjustMethod: 'stations' },
    instrumentCheck: { serial: '', calibrationDate: '', calibrationAgency: '', twoPeg: { a1: '', b1: '', a2: '', b2: '', distanceM: '' } },
    setups: [], routeHistory: [], auditLog: [], environment: { weather: '', weatherOther: '', temperature: '', start: '', end: '', notes: '' }, checklist: { items: checklistDefaults.map(label => ({ label, status: '' })), notes: '' }, updatedAt: stamp(), lastModifiedAt: stamp(), lastExportedAt: '',
  };
}

function normalizeProject() {
  let changed = false;
  if (!Array.isArray(project.equipmentPhotos)) { project.equipmentPhotos = []; changed = true; }
  if (!project.instrumentDefaultApplied) {
    if (!project.instrument) project.instrument = DEFAULT_INSTRUMENT;
    project.instrumentDefaultApplied = true;
    changed = true;
  }
  if (!project.route.startHeightKind) { project.route.startHeightKind = 'known'; changed = true; }
  if (project.route.staffLengthM === undefined) { project.route.staffLengthM = '5'; changed = true; }
  if (project.route.stadiaConstantK === undefined) { project.route.stadiaConstantK = '100'; changed = true; }
  if (!project.instrumentCheck) { project.instrumentCheck = { serial: '', calibrationDate: '', calibrationAgency: '', twoPeg: { a1: '', b1: '', a2: '', b2: '', distanceM: '' } }; changed = true; }
  if (!project.instrumentCheck.twoPeg) { project.instrumentCheck.twoPeg = { a1: '', b1: '', a2: '', b2: '', distanceM: '' }; changed = true; }
  if (project.rodHolder === undefined) { project.rodHolder = ''; changed = true; }
  if (project.photographer === undefined) { project.photographer = ''; changed = true; }
  if (!project.pointPlan) { project.pointPlan = { sCount: String(project.points.filter(item => item.type === 'S').length), tpCount: String(project.points.filter(item => item.type === 'TP').length) }; changed = true; }
  if (!Array.isArray(project.auditLog)) { project.auditLog = []; changed = true; }
  if (!project.environment) { project.environment = { weather: '', temperature: '', start: '', end: '', notes: '' }; changed = true; }
  if (!project.checklist) { project.checklist = { items: checklistDefaults.map(label => ({ label, status: '' })), notes: '' }; changed = true; }
  if (!Array.isArray(project.checklist.items)) { project.checklist.items = checklistDefaults.map(label => ({ label, status: '' })); changed = true; }
  if (project.lastModifiedAt === undefined) { project.lastModifiedAt = project.updatedAt || stamp(); changed = true; }
  if (project.lastExportedAt === undefined) { project.lastExportedAt = ''; changed = true; }
  return changed;
}

function point(id) { return project.points.find(item => item.id === id); }
function code(id) { return point(id)?.code || '未指定'; }
function notify(message, danger = false) {
  const box = $('#message');
  box.textContent = message;
  box.className = danger ? 'danger' : '';
  box.hidden = false;
  clearTimeout(box._timer);
  box._timer = setTimeout(() => { box.hidden = true; }, 7000);
}

function updateGoogleMapsLink() {
  const location = (project.approxLocation || '').trim();
  $('#openGoogleMaps').href = location
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`
    : 'https://www.google.com/maps';
  $('#fieldGoogleMaps').href = $('#openGoogleMaps').href;
}

function updateExportState() {
  const dirty = !!project.lastModifiedAt && (!project.lastExportedAt || project.lastModifiedAt > project.lastExportedAt);
  $('#exportState').textContent = dirty ? '有未匯出變更' : '完整案件已匯出';
  $('#exportState').classList.toggle('dirty', dirty);
}

function updateOnlineState() { $('#offlineState').hidden = navigator.onLine; }

async function updateWakeLock() {
  const enabled = $('#wakeLockToggle').checked && !$('#measurePanel').hidden && document.visibilityState === 'visible';
  if (!enabled) {
    if (wakeSentinel) { await wakeSentinel.release().catch(() => {}); wakeSentinel = null; }
    $('#wakeLockState').textContent = $('#wakeLockToggle').checked ? '' : '已關閉';
    return;
  }
  if (!navigator.wakeLock?.request) { $('#wakeLockState').textContent = '此瀏覽器不支援'; return; }
  if (wakeSentinel) { $('#wakeLockState').textContent = '已啟用'; return; }
  try {
    wakeSentinel = await navigator.wakeLock.request('screen');
    $('#wakeLockState').textContent = '已啟用';
    wakeSentinel.addEventListener('release', () => { wakeSentinel = null; $('#wakeLockState').textContent = '已暫停'; });
  } catch (_) { $('#wakeLockState').textContent = '目前無法啟用'; }
}

function queueSave(immediate = false, modified = true) {
  project.updatedAt = stamp();
  if (modified) project.lastModifiedAt = project.updatedAt;
  updateExportState();
  $('#saveState').textContent = '儲存中…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const snapshot = structuredClone(project);
    saveQueue = saveQueue.then(() => saveProject(snapshot)).then(() => {
      $('#saveState').textContent = '已儲存於此裝置';
      if (!persistRequested) requestPersistentStorage();
    }).catch(error => {
      $('#saveState').textContent = '儲存失敗';
      notify(`儲存失敗：${error.message}`, true);
    });
  }, immediate ? 0 : 300);
}

function renderChecklist() {
  $('#checklistItems').innerHTML = project.checklist.items.map((item, index) => `<div class="checklist-row"><strong>${safe(item.label)}${index === 1 && Object.values(project.instrumentCheck?.twoPeg || {}).some(Boolean) ? ' · 已填兩樁法紀錄' : ''}</strong><select data-check-status="${index}"><option value="">未選</option><option value="done" ${item.status === 'done' ? 'selected' : ''}>已執行</option><option value="pending" ${item.status === 'pending' ? 'selected' : ''}>未執行</option><option value="na" ${item.status === 'na' ? 'selected' : ''}>不適用</option></select></div>`).join('');
  $('#checklistNotes').value = project.checklist.notes || '';
}

function renderEnvironment() {
  for (const [id, key] of Object.entries({ envWeather: 'weather', envWeatherOther: 'weatherOther', envTemperature: 'temperature', envStart: 'start', envEnd: 'end', envNotes: 'notes' })) $(`#${id}`).value = project.environment[key] || '';
}

function observedTimestamp(item, key, from, to) {
  const at = stamp();
  if (setFirstObservedAt(item, key, from, to, at)) {
    updateEnvironmentTimes(at);
    const keys = initialEntries.get(item) || new Set(); keys.add(key); initialEntries.set(item, keys);
  }
}

function updateEnvironmentTimes(at) {
  const local = localInputTime(at);
  if (!project.environment.startManual && (!project.environment.start || local < project.environment.start)) project.environment.start = local;
  if (!project.environment.endManual && (!project.environment.end || local > project.environment.end)) project.environment.end = local;
  if ($('#envStart')) renderEnvironment();
}

function pushUndo(label, station, pointCode, field, from, to) {
  undoStack.push({ setups: structuredClone(project.setups), label, station, pointCode, field, from, to });
  if (undoStack.length > 20) undoStack.shift();
  $('#undoLast').disabled = false;
  $('#undoToastText').textContent = label;
  $('#undoToast').hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { $('#undoToast').hidden = true; }, 10000);
}

function logAction(type, station, pointCode, field, from, to, reason) {
  project.auditLog.push(actionEntry({ id: uid(), at: stamp(), type, station, pointCode, field, from, to, reason }));
}

function undoLast() {
  const previous = undoStack.pop();
  if (!previous) return;
  project.setups = previous.setups;
  logAction('undo', previous.station, previous.pointCode, previous.field, previous.to, previous.from, `復原：${previous.label}`);
  $('#undoLast').disabled = !undoStack.length;
  $('#undoToast').hidden = true;
  renderStations(); queueSave(true);
  notify('已復原上一筆讀數操作。');
}

function editReason(context) {
  const dialog = $('#editReasonDialog');
  $('#editReasonContext').textContent = context;
  $('#editReasonChoice').value = '讀錯重讀';
  $('#editReasonOther').value = '';
  dialog.showModal();
  return new Promise(resolve => {
    const done = value => { dialog.close(); $('#saveEditReason').removeEventListener('click', save); $('#cancelEditReason').removeEventListener('click', cancel); dialog.removeEventListener('cancel', onCancel); resolve(value); };
    const save = () => {
      const value = $('#editReasonChoice').value === 'other' ? $('#editReasonOther').value.trim() : $('#editReasonChoice').value;
      if (!value) { notify('請填寫更正原因。', true); return; }
      done(value);
    };
    const cancel = () => done(null);
    const onCancel = event => { event.preventDefault(); cancel(); };
    $('#saveEditReason').addEventListener('click', save);
    $('#cancelEditReason').addEventListener('click', cancel);
    dialog.addEventListener('cancel', onCancel);
  });
}

function readingAddress(target) {
  if (['bs', 'fs', 'distance', 'fsPointId'].includes(target.dataset.field)) {
    const station = Number(target.dataset.station);
    const setup = project.setups[station];
    return { item: setup, key: target.dataset.field, station: station + 1, pointCode: code(setup[target.dataset.field === 'bs' ? 'bsPointId' : 'fsPointId']) };
  }
  if (target.dataset.isValue !== undefined || target.dataset.isPoint !== undefined) {
    const [station, sight] = parsePair(target.dataset.isValue ?? target.dataset.isPoint);
    const item = project.setups[station].intermediate[sight];
    return { item, key: target.dataset.isPoint !== undefined ? 'pointId' : 'value', station: station + 1, pointCode: code(item.pointId) };
  }
  if (target.dataset.wireField) {
    const station = Number(target.dataset.station);
    const setup = project.setups[station];
    return { item: setup, key: target.dataset.wireField, station: station + 1, pointCode: code(setup[target.dataset.wireField.startsWith('bs') ? 'bsPointId' : 'fsPointId']) };
  }
  if (target.dataset.isWire) {
    const [station, sight, key] = target.dataset.isWire.split(':');
    const item = project.setups[Number(station)].intermediate[Number(sight)];
    return { item, key, station: Number(station) + 1, pointCode: code(item.pointId) };
  }
  return null;
}

async function updateStorageStatus() {
  let protectedStorage = false;
  try { protectedStorage = await navigator.storage?.persisted?.() || false; } catch (_) {}
  $('#storageState').textContent = protectedStorage
    ? '本機儲存：已受保護'
    : '本機儲存：可能被瀏覽器清除，請定期匯出案件檔';
  const iosSafari = /iPhone|iPad|iPod/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent);
  $('#iosHomeHint').hidden = !iosSafari || !!navigator.standalone || matchMedia('(display-mode: standalone)').matches;
}

async function requestPersistentStorage() {
  persistRequested = true;
  try { await navigator.storage?.persist?.(); } catch (_) {}
  await updateStorageStatus();
}

function options(items, selected, placeholder = '請選擇點位') {
  return `<option value="">${safe(placeholder)}</option>` + items.map(item =>
    `<option value="${safe(item.id)}" ${item.id === selected ? 'selected' : ''}>${safe(item.code)} · ${safe(item.type)}</option>`).join('');
}

function nextPointOptions(selected) {
  const observed = observedPointIds();
  const option = item => `<option value="${safe(item.id)}" ${item.id === selected ? 'selected' : ''}>${safe(item.code)} · ${safe(item.type)}</option>`;
  const waiting = project.points.filter(item => !observed.has(item.id));
  const used = project.points.filter(item => observed.has(item.id));
  return `<option value="">請選擇點位</option>${waiting.length ? `<optgroup label="尚未觀測">${waiting.map(option).join('')}</optgroup>` : ''}${used.length ? `<optgroup label="已觀測／回測">${used.map(option).join('')}</optgroup>` : ''}`;
}

function updatePointPlanStatus() {
  const sCount = project.points.filter(item => item.type === 'S').length;
  const tpCount = project.points.filter(item => item.type === 'TP').length;
  const waiting = project.points.filter(item => item.type !== 'BM' && !observedPointIds().has(item.id)).length;
  $('#pointPlanStatus').textContent = `已建 S ${sCount} 點、TP ${tpCount} 點；尚未觀測 ${waiting} 點。調小預計數量不會刪除既有點位。`;
}

function renderPointPlan() {
  $('#plannedSCount').value = project.pointPlan.sCount;
  $('#plannedTPCount').value = project.pointPlan.tpCount;
  updatePointPlanStatus();
}

function renderRouteSelections() {
  const bms = project.points.filter(item => item.type === 'BM');
  $('#startId').innerHTML = options(bms, project.route.startId);
  $('#endId').innerHTML = options(bms, project.route.endId);
  $('#endHeightLabel').hidden = project.route.startId === project.route.endId;
  $('#photoPoint').innerHTML = options(project.points, $('#photoPoint').value);
  $('#routeSummary').textContent = `${code(project.route.startId)} → ${code(project.route.endId)}｜${project.setups.length} 站`;
}

function observedPointIds() {
  const ids = new Set();
  for (const setup of project.setups) {
    if (setup.bsPointId && validReading(setup.bs)) ids.add(setup.bsPointId);
    for (const sight of setup.intermediate || []) if (sight.pointId && validReading(sight.value)) ids.add(sight.pointId);
    if (setup.fsPointId && validReading(setup.fs)) ids.add(setup.fsPointId);
  }
  return ids;
}

function renderPhotoQueue() {
  const observed = project.photoTaskMode && Array.isArray(project.photoTargetIds) ? new Set(project.photoTargetIds) : observedPointIds();
  const photographed = new Set(project.photos.map(photo => photo.pointId));
  const targets = project.points.filter(item => observed.has(item.id));
  const pendingPhotos = targets.filter(item => !photographed.has(item.id));
  const pendingPositions = targets.filter(item => !validPosition(item.position));
  $('#photoProgress').textContent = `${project.photoTaskMode ? '攝影工作檔' : '已觀測'} ${observed.size} 點；待攝影 ${pendingPhotos.length} 點；待標圖 ${pendingPositions.length} 點。攝影與標圖可由同一位現場人員完成。`;
  $('#photoQueue').innerHTML = targets.filter(item => !photographed.has(item.id) || !validPosition(item.position)).map(item => `<div class="photo-task"><strong>${safe(item.code)}</strong>${!photographed.has(item.id) ? `<button type="button" data-select-photo-point="${safe(item.id)}">選此點拍照</button>` : ''}${!validPosition(item.position) ? `<button type="button" data-field-map="${safe(item.id)}">在圖上標點</button>` : ''}</div>`).join('');
}

function renderPoints() {
  const observed = observedPointIds();
  const photographed = new Set(project.photos.map(photo => photo.pointId));
  $('#pointList').innerHTML = project.points.map(item => `<div class="point-card" data-point="${safe(item.id)}">
    <div class="point-badge ${safe(item.type.toLowerCase())}">${safe(item.type)}</div>
    <label>點號<input data-point-code="${safe(item.id)}" value="${safe(item.code)}" maxlength="24"></label>
    <label>點位說明<input data-point-description="${safe(item.id)}" value="${safe(item.description)}" maxlength="300" placeholder="固定標誌、構造物位置"></label>
    <div class="point-actions"><button type="button" data-place="${safe(item.id)}">${validPosition(item.position) ? '移動圖上標記' : '放到圖上'}</button><button type="button" data-delete-point="${safe(item.id)}" class="quiet danger-text">刪除</button></div>
    <div class="point-statuses"><span class="${observed.has(item.id) ? 'done' : ''}">${observed.has(item.id) ? '已觀測' : '未觀測'}</span><span class="${validPosition(item.position) ? 'done' : ''}">${validPosition(item.position) ? '已標圖' : '待標圖'}</span><span class="${photographed.has(item.id) ? 'done' : ''}">${photographed.has(item.id) ? '已拍照' : '待拍照'}</span></div>
  </div>`).join('');
  $('#mapMarkers').innerHTML = project.points.filter(item => validPosition(item.position)).map(item =>
    `<span class="map-marker ${safe(item.type.toLowerCase())}" style="left:${item.position.x}%;top:${item.position.y}%" title="${safe(item.code)}"><b>${safe(item.code)}</b></span>`).join('');
  renderRouteSelections();
  renderPhotoQueue();
  updatePointPlanStatus();
}

async function renderMap() {
  if (mapUrl) URL.revokeObjectURL(mapUrl);
  mapUrl = null;
  const image = $('#mapImage');
  if (project.mapMediaId) {
    const media = await loadMedia(project.mapMediaId);
    if (media) {
      mapUrl = URL.createObjectURL(media);
      image.src = mapUrl;
      image.hidden = false;
      $('#mapEmpty').hidden = true;
      return;
    }
  }
  image.hidden = true;
  $('#mapEmpty').hidden = false;
}

function synchronizeSetups() {
  project.setups.forEach((setup, index) => {
    setup.bsPointId = index === 0 ? project.route.startId : project.setups[index - 1].fsPointId;
  });
}

function updateReadingWarning(input) {
  const station = Number(input.closest('[data-station]')?.dataset.station ?? project.setups.length - 1);
  const setup = project.setups[station];
  const sight = input.dataset.isValue !== undefined ? setup?.intermediate[parsePair(input.dataset.isValue)[1]] : null;
  const role = sight ? '中間視' : input.id === 'nextReading' ? ($('#nextRole').value === 'IS' ? '中間視' : '前視') : input.dataset.field === 'bs' ? '後視' : '前視';
  const pointId = sight?.pointId || (input.id === 'nextReading' ? $('#nextPoint').value : input.dataset.field === 'bs' ? setup?.bsPointId : setup?.fsPointId);
  const length = Number(String(project.route.staffLengthM ?? '5').replace(',', '.'));
  const issue = Number.isFinite(length) && length > 0 ? readingIssue(input.value, length, station + 1, role, code(pointId)) : null;
  const warning = input.closest('.reading-value')?.querySelector('.reading-warning');
  input.classList.toggle('reading-invalid', !!issue);
  input.setAttribute('aria-invalid', String(!!issue));
  if (warning) { warning.textContent = issue || ''; warning.hidden = !issue; }
  const correction = suggestMmCorrection(input.value, length);
  let button = input.closest('.reading-value')?.querySelector('.mm-correction');
  if (correction && issue && !button) {
    button = document.createElement('button'); button.type = 'button'; button.className = 'mm-correction';
    input.closest('.reading-value').append(button);
  }
  if (button) { button.textContent = correction && issue ? `改為 ${correction} m` : ''; button.hidden = !(correction && issue); button.onclick = () => applyMmCorrection(input, correction); }
  return issue;
}

function applyMmCorrection(input, correction) {
  if (!correction) return;
  const address = readingAddress(input);
  if (address) {
    const from = String(address.item[address.key] ?? '');
    if (from && !initialEntries.get(address.item)?.has(address.key)) logAction('edit', address.station, address.pointCode, address.key, from, correction, '單位誤植（mm→m）');
    address.item[address.key] = correction;
    initialEntries.get(address.item)?.delete(address.key);
    input.value = correction;
    renderStations(); queueSave(true);
  } else {
    input.value = correction; draftNextValue = correction; updateReadingWarning(input);
  }
}

function updateReadingWarnings() {
  document.querySelectorAll('[data-reading]').forEach(updateReadingWarning);
}

function wireFields(setup, index, role, sightIndex = null) {
  const item = sightIndex === null ? setup : setup.intermediate[sightIndex];
  const upperKey = role === 'bs' ? 'bsUpper' : role === 'fs' ? 'fsUpper' : 'upper';
  const lowerKey = role === 'bs' ? 'bsLower' : role === 'fs' ? 'fsLower' : 'lower';
  const attr = key => sightIndex === null ? `data-wire-field="${key}" data-station="${index}"` : `data-is-wire="${index}:${sightIndex}:${key}"`;
  const check = sightIndex === null ? `${index}:${role}` : `${index}:is:${sightIndex}`;
  const pointCode = code(sightIndex === null ? setup[role === 'bs' ? 'bsPointId' : 'fsPointId'] : item.pointId);
  return `<details class="wire-details"><summary>上絲／下絲（選填）</summary><div class="wire-fields"><div><label>上絲（m）<input ${decimals} ${attr(upperKey)} value="${safe(item[upperKey])}" placeholder="0.000"></label>${correctionNote(index + 1, pointCode, upperKey)}</div><div><label>下絲（m）<input ${decimals} ${attr(lowerKey)} value="${safe(item[lowerKey])}" placeholder="0.000"></label>${correctionNote(index + 1, pointCode, lowerKey)}</div></div><p class="wire-check" data-wire-check="${check}" hidden></p></details>`;
}

function correctionNote(station, pointCode, field) {
  const entries = project.auditLog.filter(item => item.type === 'edit' && item.station === station && (item.pointCode === pointCode || (field === 'pointId' || field === 'fsPointId') && item.to === pointCode) && item.field === field);
  return entries.length ? `<details class="correction-history"><summary>※已更正</summary>${entries.map(item => `<p>${safe(dateTime(item.at))}　<del>${safe(item.from)}</del> → ${safe(item.to)}　${safe(item.reason)}</p>`).join('')}</details>` : '';
}

function updateWireFeedback(result = calculate(project)) {
  const checkFor = key => {
    const [index, role, sightIndex] = key.split(':');
    const station = result.stations[Number(index)];
    return role === 'bs' ? station?.bsWire : role === 'fs' ? station?.fsWire : station?.intermediate[Number(sightIndex)]?.wire;
  };
  document.querySelectorAll('[data-wire-check]').forEach(element => {
    const wire = checkFor(element.dataset.wireCheck);
    element.hidden = !wire;
    element.classList.toggle('wire-alert', !!(wire?.issue || wire?.exceedsTolerance));
    element.textContent = !wire ? '' : wire.issue || `中絲差 ${formatMm(wire.middleDiffMm)} mm；視距 ${formatHeight(wire.distanceM)} m${wire.exceedsTolerance ? '；超出輸入的三絲容許值' : ''}`;
  });
  document.querySelectorAll('[data-wire-station]').forEach(element => {
    const station = result.stations[Number(element.dataset.wireStation)];
    element.hidden = !station || (!station.bsWire && !station.fsWire);
    if (station) element.textContent = `後視距 ${formatHeight(station.bsDistanceM)} m · 前視距 ${formatHeight(station.fsDistanceM)} m · 差 ${formatHeight(station.distanceDifferenceM)} m`;
  });
  document.querySelectorAll('[data-copy-wire-distance]').forEach(button => {
    const station = result.stations[Number(button.dataset.copyWireDistance)];
    button.disabled = station?.bsDistanceM === null || station?.fsDistanceM === null || !station;
  });
}

function renderStations() {
  synchronizeSetups();
  const computed = calculate(project);
  const card = (setup, index) => {
    const active = index === project.setups.length - 1;
    const waitingForNext = active && !setup.fsPointId && setup.fs === '';
    const recorded = (setup.intermediate || []).map((sight, sightIndex) => `<div class="reading-row"><span class="reading-role">中間視 IS</span>
      <div><label>點位<select data-is-point="${index}:${sightIndex}">${options(project.points, sight.pointId)}</select></label>${correctionNote(index + 1, code(sight.pointId), 'pointId')}</div>
      <div class="reading-value"><label>讀數（m）<input ${decimals} data-reading data-is-value="${index}:${sightIndex}" value="${safe(sight.value)}" placeholder="0.000"></label><label class="inverted-toggle"><input type="checkbox" data-is-inverted="${index}:${sightIndex}" ${sight.inverted ? 'checked' : ''}>倒尺</label><small class="reading-warning" hidden></small>${correctionNote(index + 1, code(sight.pointId), 'value')}${correctionNote(index + 1, code(sight.pointId), 'inverted')}</div>
      <small class="raw-height">暫算高程 ${formatHeight(computed.stations[index]?.intermediate[sightIndex]?.rawHeight)} m（未改正）</small><div class="reading-actions"><button type="button" data-field-map="${safe(sight.pointId)}">標圖</button>${active && sightIndex === setup.intermediate.length - 1 && !setup.fsPointId ? `<button type="button" data-convert-is="${index}:${sightIndex}">改為前視</button>` : ''}<button type="button" data-remove-is="${index}:${sightIndex}" class="quiet danger-text">移除</button></div>${wireFields(setup, index, 'is', sightIndex)}</div>`).join('') +
    (setup.fsPointId || setup.fs !== '' ? `<div class="reading-row turn-row"><span class="reading-role">前視 FS</span>
      <div><label>點位<select data-field="fsPointId" data-station="${index}">${options(project.points, setup.fsPointId)}</select></label>${correctionNote(index + 1, code(setup.fsPointId), 'fsPointId')}</div>
      <div class="reading-value"><label>讀數（m）<input ${decimals} data-reading data-field="fs" data-station="${index}" value="${safe(setup.fs)}" placeholder="0.000"></label><label class="inverted-toggle"><input type="checkbox" data-inverted="fsInverted" data-station="${index}" ${setup.fsInverted ? 'checked' : ''}>倒尺</label><small class="reading-warning" hidden></small>${correctionNote(index + 1, code(setup.fsPointId), 'fs')}${correctionNote(index + 1, code(setup.fsPointId), 'fsInverted')}</div>
      <small class="raw-height">暫算高程 ${formatHeight(computed.stations[index]?.rawEndHeight)} m（未改正）</small><div class="reading-actions"><button type="button" data-field-map="${safe(setup.fsPointId)}">標圖</button>${active ? `<button type="button" data-convert-fs="${index}" class="quiet">改為中間視</button>` : ''}</div>${wireFields(setup, index, 'fs')}</div>` : '');
    return `<section class="card station ${active ? 'active-station' : ''}" data-station="${index}">
      <div class="station-head"><h3>測站 ${index + 1} <small>由 ${safe(code(setup.bsPointId))} 後視</small></h3><button type="button" data-remove-station="${index}" class="quiet danger-text" title="刪除此站及後續站">刪除</button></div>
      <div class="bs-entry reading-value"><label>後視 BS · ${safe(code(setup.bsPointId))}<input ${decimals} data-reading data-field="bs" data-station="${index}" value="${safe(setup.bs)}" placeholder="0.000"></label><label class="inverted-toggle"><input type="checkbox" data-inverted="bsInverted" data-station="${index}" ${setup.bsInverted ? 'checked' : ''}>倒尺</label><small class="reading-warning" hidden></small>${correctionNote(index + 1, code(setup.bsPointId), 'bs')}${correctionNote(index + 1, code(setup.bsPointId), 'bsInverted')}</div>
      ${wireFields(setup, index, 'bs')}
      ${waitingForNext ? `<div class="next-reading"><div class="next-point-line"><label>下一點<select id="nextPoint">${nextPointOptions(draftNextPointId)}</select></label></div><div class="next-point-tools"><button type="button" data-next-unobserved="true">選下一未測點</button><button type="button" data-quick-point="S">＋S</button><button type="button" data-quick-point="TP">＋TP</button></div>
        <div class="next-value-line"><label>讀法<select id="nextRole"><option value="IS" ${draftNextRole === 'IS' ? 'selected' : ''}>中間視 · 同站</option><option value="MOVE" ${draftNextRole === 'MOVE' ? 'selected' : ''}>前視 · 換站</option><option value="FINISH" ${draftNextRole === 'FINISH' ? 'selected' : ''}>前視 · 終點</option></select></label><div class="reading-value"><label>讀數（m）<input id="nextReading" data-reading ${decimals} value="${safe(draftNextValue)}" placeholder="0.000"></label><label class="inverted-toggle"><input id="nextInverted" type="checkbox" ${draftNextInverted ? 'checked' : ''}>倒尺</label><small class="reading-warning" hidden></small></div></div>
        <button type="button" data-add-next="${index}" class="primary record-next">記錄此點</button></div>` : ''}
      <details class="station-records"><summary>${setup.fsPointId ? `前視 ${safe(code(setup.fsPointId))} · ${safe(setup.fs)} m` : `本站已記錄 ${(setup.intermediate || []).length} 點`} · 點開核對</summary>
        <div class="reading-actions"><button type="button" data-field-map="${safe(setup.bsPointId)}">標註 ${safe(code(setup.bsPointId))}</button></div>${recorded}
        <div class="station-distance"><label>測線長度（m，按距離分配時填）<input ${decimals} data-field="distance" data-station="${index}" value="${safe(setup.distance)}" placeholder="例如 35.0"></label>${correctionNote(index + 1, code(setup.fsPointId), 'distance')}</div>
        <p class="wire-station-summary" data-wire-station="${index}" hidden></p><button type="button" data-copy-wire-distance="${index}" disabled>由後視距＋前視距帶入本站長度</button>
      </details>
    </section>`;
  };
  const previous = project.setups.slice(0, -1);
  $('#stationList').innerHTML = (project.setups.length ? card(project.setups.at(-1), project.setups.length - 1) : '') + (previous.length ? `<details class="history"><summary>前 ${previous.length} 站 · 核對與更正</summary>${previous.map(card).join('')}</details>` : '');
  const last = project.setups.at(-1);
  $('#addStation').hidden = !!last && (!last.fsPointId || last.fsPointId === project.route.endId);
  $('#addStation').textContent = !last ? `開始第一站：後視 ${code(project.route.startId)}` : `搬站：於 ${code(last.fsPointId)} 讀後視`;
  $('#measureActions').hidden = $('#addStation').hidden;
  renderRouteSelections();
  renderResult();
  renderPhotoQueue();
  updateReadingWarnings();
  updateWireFeedback();
}

function openFieldMap(pointId) {
  if (!point(pointId)) { notify('請先指定要標註的點位。', true); return; }
  placingPointId = pointId;
  $('#fieldMapTitle').textContent = `在圖上標註 ${code(pointId)}`;
  $('#fieldMapMessage').textContent = project.mapMediaId ? '點選底圖上的實際點位，完成後返回原頁。' : '尚未匯入位置圖；可先匯入截圖，或關閉後繼續作業。';
  $('#fieldMapSource').value = project.mapSource || '';
  $('#fieldMapHolder').append($('#mapFrame'));
  $('#mapFrame').classList.add('placing');
  $('#fieldMapDialog').showModal();
}

function closeFieldMap() {
  $('#mapHome').append($('#mapFrame'));
  $('#fieldMapDialog').close();
  $('#mapFrame').classList.remove('placing');
  placingPointId = null;
}

function resultRows(result) {
  const adjusted = result.adjusted;
  const output = [];
  const shown = (value, inverted, station, field, pointCode) => {
    const changes = project.auditLog.filter(item => item.type === 'edit' && item.station === station && item.field === field && item.pointCode === pointCode);
    const last = changes.at(-1);
    return `${last ? `<del title="原讀數">${safe(last.from)}</del> ` : ''}${readingLabel(value, inverted)}${last ? ' ※已更正' : ''}`;
  };
  result.stations.forEach((station, index) => {
    if (index === 0) output.push(`<tr><td>${station.index}</td><td>${safe(code(station.bsPointId))}</td><td>${shown(station.bs, station.bsInverted, station.index, 'bs', code(station.bsPointId))}</td><td></td><td></td><td>${safe(dateTime(project.setups[index]?.bsAt).slice(11, 16))}</td><td>${formatHeight(station.rawStartHeight)}</td><td>${adjusted ? formatHeight(station.adjustedStartHeight) : '—'}</td><td>起點後視</td></tr>`);
    for (const [sightIndex, sight] of station.intermediate.entries()) {
      const adjustedSight = station.adjustedIntermediate?.[sightIndex];
      output.push(`<tr><td>${station.index}</td><td>${safe(code(sight.pointId))}</td><td></td><td></td><td>${shown(sight.value, sight.inverted, station.index, 'value', code(sight.pointId))}</td><td>${safe(dateTime(project.setups[index]?.intermediate[sightIndex]?.at).slice(11, 16))}</td><td>${formatHeight(sight.rawHeight)}</td><td>${adjusted ? formatHeight(adjustedSight?.adjustedHeight) : '—'}</td><td>中間視</td></tr>`);
    }
    if (station.complete) {
      const next = result.stations[index + 1];
      const note = next ? '本點前視、搬站後同點後視' : project.setups[index + 1] ? '本點前視；搬站後同點後視待填' : station.fsPointId === project.route.endId ? '預定終點前視' : '本站前視，待搬站';
      output.push(`<tr><td>${station.index}${next ? `→${next.index}` : ''}</td><td>${safe(code(station.fsPointId))}</td><td>${next ? shown(next.bs, next.bsInverted, next.index, 'bs', code(next.bsPointId)) : ''}</td><td>${shown(station.fs, station.fsInverted, station.index, 'fs', code(station.fsPointId))}</td><td></td><td>${safe([project.setups[index]?.fsAt, project.setups[index + 1]?.bsAt].map(value => dateTime(value).slice(11, 16)).filter(Boolean).join(' / '))}</td><td>${formatHeight(station.rawEndHeight)}</td><td>${adjusted ? formatHeight(station.adjustedEndHeight) : '—'}</td><td>${note}${adjusted ? `；本站改正 ${formatMm(station.correction * 1000)} mm` : ''}</td></tr>`);
    }
  });
  return output.join('');
}

function readingLabel(value, inverted) {
  return `${formatHeight(value === null ? null : Math.abs(value))}${inverted ? '（倒尺）' : ''}`;
}

function resultTable(result) {
  return `<div class="table-wrap"><table><thead><tr><th>站</th><th>點號</th><th>後視 BS<br>m</th><th>前視 FS<br>m</th><th>中間視 IS<br>m</th><th>觀測時間</th><th>暫算高程<br>m</th><th>改正後高程<br>m</th><th>備註</th></tr></thead><tbody>${resultRows(result)}</tbody></table></div>`;
}

function summaryStatus(result) {
  if (!result.complete) return '測線未完成，總表僅供現場核對';
  if (result.withinTolerance === true) return '閉合差符合人工指定容許值';
  if (result.withinTolerance === false) return '閉合差超出人工指定容許值，未執行改正';
  return '已完成測線；容許值或高程基準尚未確認，未判定閉合檢核';
}

function summaryMeta(result) {
  return `<span>案件：<strong>${safe(project.name || '未填')}</strong></span><span>案號：<strong>${safe(project.number || '未填')}</strong></span><span>日期：<strong>${safe(project.date || '未填')}</strong></span>
    <span>測線：<strong>${safe(code(project.route.startId))} → ${safe(code(project.route.endId))}</strong></span><span>儀器：<strong>${safe(project.instrument || '未填')}</strong></span><span>起點${project.route.startHeightKind === 'assumed' ? '假設' : '已知'}高程：<strong>${formatHeight(result.startHeight)} m</strong></span>`;
}

function summaryChecks(result) {
  const method = result.adjusted ? result.method === 'distance' ? '按各站長度分配' : '按測站數等分' : '未執行';
  return `<span>ΣBS <strong>${formatHeight(result.sumBS)} m</strong></span><span>ΣFS <strong>${formatHeight(result.sumFS)} m</strong></span><span>閉合差 <strong>${formatMm(result.closureMm)} mm</strong></span><span>容許值 <strong>${result.toleranceMm === null ? '未指定' : `±${formatMm(result.toleranceMm)} mm`}</strong></span><span>改正 <strong>${method}</strong></span>`;
}

function arithmeticSummary(result) {
  if (!result.complete) return '<section class="analysis-panel"><h3>算術複核</h3><p>測線完成後顯示兩種高差計算。</p></section>';
  const delta = result.rawEndHeight - result.startHeight;
  const check = result.riseFallCheck;
  return `<section class="analysis-panel"><h3>算術複核 <span class="${check.ok ? 'check-ok' : 'check-alert'}">${check.ok ? '計算一致' : '計算不一致'}</span></h3>
    <p>ΣBS − ΣFS：${formatHeight(result.sumBS - result.sumFS)} m ＝ 終點 − 起點：${formatHeight(delta)} m</p>
    <p>Σ升 − Σ降：${formatHeight(check.sumRise - check.sumFall)} m ＝ 終點 − 起點：${formatHeight(delta)} m</p>
    <p>兩法點高程最大差：${formatMm(check.maxDiffMm)} mm</p></section>`;
}

function sightBalanceSummary(result) {
  if (!result.stations.some(station => station.bsWire || station.fsWire || station.intermediate.some(sight => sight.wire))) return '';
  const hasBS = result.stations.some(station => station.bsDistanceM !== null);
  const hasFS = result.stations.some(station => station.fsDistanceM !== null);
  return `<section class="analysis-panel"><h3>三絲視距</h3><div class="sight-grid">${result.stations.map(station =>
    `<div>第 ${station.index} 站 · 後視 ${formatHeight(station.bsDistanceM)} m／前視 ${formatHeight(station.fsDistanceM)} m／差 ${formatHeight(station.distanceDifferenceM)} m</div>`).join('')}</div>
    <p>累計 Σ後視距 ${formatHeight(hasBS ? result.sumBsDistanceM : null)} m；Σ前視距 ${formatHeight(hasFS ? result.sumFsDistanceM : null)} m；差 ${formatHeight(hasBS && hasFS ? result.sumDistanceDifferenceM : null)} m。</p>
    ${result.threeWireAlerts.length ? `<p class="wire-alert">${safe(result.threeWireAlerts.join('；'))}</p>` : ''}</section>`;
}

function renderResult() {
  const result = calculate(project);
  const state = result.withinTolerance === true ? 'ok' : result.withinTolerance === false ? 'over' : 'pending';
  const status = state === 'ok' ? '符合指定容許值' : state === 'over' ? '超出指定容許值' : result.complete ? '尚未指定容許值' : '測線尚未完成';
  const limit = result.toleranceMm === null ? '尚未指定' : `±${formatMm(result.toleranceMm)} mm`;
  const gauge = result.complete && result.toleranceMm > 0 ? Math.min(100, Math.abs(result.closureMm) / result.toleranceMm * 100) : null;
  $('#resultSummary').innerHTML = `<div class="result-hero ${state}"><div><span class="result-eyebrow">${safe(code(project.route.startId))} → ${safe(code(project.route.endId))} · ${result.stations.length} 站</span><span class="result-hero-label">閉合差</span><strong class="result-hero-value">${result.complete ? formatMm(result.closureMm) : '待完成'}${result.complete ? '<small> mm</small>' : ''}</strong><span class="result-status">${status}</span></div><div class="result-hero-side"><span>指定容許值</span><strong>${limit}</strong><span>實測終點高程</span><strong>${formatHeight(result.rawEndHeight)} m</strong></div></div>
    ${gauge !== null ? `<div class="result-gauge" aria-label="閉合差佔容許值 ${Math.round(Math.abs(result.closureMm) / result.toleranceMm * 100)}%"><span style="width:${gauge}%"></span></div>` : ''}
    <div class="result-grid"><div><span>後視合計 BS</span><strong>${formatHeight(result.sumBS)} m</strong></div><div><span>前視合計 FS</span><strong>${formatHeight(result.sumFS)} m</strong></div><div><span>改正數分配</span><strong>${result.adjusted ? '已完成' : result.withinTolerance === true ? '待複核／補資料' : '未執行'}</strong></div></div>`;
  $('#resultArithmetic').innerHTML = arithmeticSummary(result);
  $('#resultSightBalance').innerHTML = sightBalanceSummary(result);
  $('#resultTable').innerHTML = resultTable(result);
  $('#summaryTableMeta').innerHTML = summaryMeta(result);
  $('#summaryTableStatus').innerHTML = `<strong>${summaryStatus(result)}</strong><div class="summary-checks">${summaryChecks(result)}</div>`;
  $('#resultMobile').innerHTML = result.stations.length ? result.stations.map(station => {
    const readings = [
      `<div class="result-reading"><b class="reading-chip bs">BS</b><strong>${safe(code(station.bsPointId))}</strong><span>${readingLabel(station.bs, station.bsInverted)} m</span><small>起點 ${formatHeight(station.rawStartHeight)} m</small></div>`,
      ...station.intermediate.map((sight, index) => `<div class="result-reading"><b class="reading-chip is">IS</b><strong>${safe(code(sight.pointId))}</strong><span>${readingLabel(sight.value, sight.inverted)} m</span><small>高程 ${formatHeight(result.adjusted ? station.adjustedIntermediate?.[index]?.adjustedHeight : sight.rawHeight)} m${result.adjusted ? '（改正後）' : ''}</small></div>`),
      ...(station.complete ? [`<div class="result-reading"><b class="reading-chip fs">FS</b><strong>${safe(code(station.fsPointId))}</strong><span>${readingLabel(station.fs, station.fsInverted)} m</span><small>高程 ${formatHeight(result.adjusted ? station.adjustedEndHeight : station.rawEndHeight)} m${result.adjusted ? '（改正後）' : ''}</small></div>`] : []),
    ];
    return `<section class="result-station-card"><h3>測站 ${station.index}<small>${station.complete ? `${safe(code(station.bsPointId))} → ${safe(code(station.fsPointId))}` : '記錄中'}</small></h3>${readings.join('')}</section>`;
  }).join('') : '<p class="note">尚未記錄觀測讀數。</p>';
  const method = result.method === 'distance' ? '按各站測線長度比例' : '按測站數等分';
  $('#resultNote').textContent = [
    ...result.issues,
    result.adjusted ? `已用「${method}」分配閉合差；中間視高程承接所在測站起點的累計改正。` : '',
    result.withinTolerance === false ? '閉合差超限，不執行自動改正；請核對原始讀數與點位。' : '',
    result.riseFallCheck.ok === false ? '高差法算術複核不一致，暫停自動改正。' : '',
    '此處為單一測線的簡易閉合差分配，不代表控制網整體平差。',
  ].filter(Boolean).join(' ');
  return result;
}

function nextCode(type) {
  const used = new Set(project.points.map(item => item.code.toUpperCase()));
  let number = 1;
  while (used.has(`${type}${number}`)) number++;
  return `${type}${number}`;
}

function addPoint(type, selectNext = false) {
  const item = { id: uid(), code: nextCode(type), type, description: '', position: null };
  project.points.push(item);
  if (selectNext) draftNextPointId = item.id;
  renderPoints();
  renderStations();
  renderPhotos();
  queueSave(true);
  if (selectNext) $('#nextReading')?.focus();
  else $(`[data-point-code="${item.id}"]`)?.focus();
  notify(`${item.code} 已建立；可填位置說明並放到圖上。`);
}

function createPlannedPoints() {
  const values = { S: $('#plannedSCount').value.trim(), TP: $('#plannedTPCount').value.trim() };
  const targets = { S: Number(values.S), TP: Number(values.TP) };
  if (Object.values(values).some(value => value === '') || Object.values(targets).some(value => !Number.isInteger(value) || value < 0 || value > 200)) {
    notify('預排點數請填 0～200 的整數。', true);
    return;
  }
  project.pointPlan = { sCount: String(targets.S), tpCount: String(targets.TP) };
  const added = [];
  for (const type of ['S', 'TP']) {
    const current = project.points.filter(item => item.type === type).length;
    for (let i = current; i < targets[type]; i++) {
      const item = { id: uid(), code: nextCode(type), type, description: '', position: null };
      project.points.push(item);
      added.push(item.code);
    }
  }
  renderPointPlan(); renderPoints(); renderStations(); queueSave(true);
  notify(added.length ? `已建立 ${added.join('、')}；讀數保持空白，觀測時再選讀法。` : '現有點位已達預計數量；沒有刪除或重編任何點號。');
}

function deletePoint(id) {
  if (id === project.route.startId || id === project.route.endId || project.setups.some(setup =>
    setup.bsPointId === id || setup.fsPointId === id || (setup.intermediate || []).some(sight => sight.pointId === id)) ||
    project.photos.some(photo => photo.pointId === id)) {
    notify('此點已用於測線、讀數或照片；先調整關聯才能刪除。', true);
    return;
  }
  if (!confirm(`刪除點位 ${code(id)}？`)) return;
  project.points = project.points.filter(item => item.id !== id);
  renderPoints(); renderStations(); renderPhotos(); queueSave(true);
}

function revokePhotos() {
  for (const url of photoUrls.values()) URL.revokeObjectURL(url);
  photoUrls.clear();
  for (const url of equipmentPhotoUrls.values()) URL.revokeObjectURL(url);
  equipmentPhotoUrls.clear();
}

async function renderPhotos() {
  const selected = $('#photoPoint').value;
  $('#photoPoint').innerHTML = options(project.points, selected);
  renderPhotoQueue();
  revokePhotos();
  const equipmentList = $('#equipmentPhotoList');
  equipmentList.innerHTML = project.equipmentPhotos.map(photo => `<article class="photo-card" data-equipment-photo="${safe(photo.id)}">
    <div class="photo-preview"><img alt="${safe(photo.instrument)} 本案設備照片" data-equipment-image="${safe(photo.id)}"></div>
    <div class="photo-body"><strong>${safe(photo.instrument)}</strong><small>${safe(photo.name)} · 拍攝時間 ${safe(photoTime(photo))}</small>
      <label>設備照片說明<input data-equipment-description="${safe(photo.id)}" value="${safe(photo.description)}" maxlength="300"></label>
      <button type="button" data-delete-equipment-photo="${safe(photo.id)}" class="quiet danger-text">刪除此設備照片</button></div></article>`).join('') || '<p class="empty-state">本案尚無當日拍攝的設備照片。</p>';
  for (const photo of project.equipmentPhotos) {
    const media = await loadMedia(photo.mediaId);
    const img = equipmentList.querySelector(`[data-equipment-image="${CSS.escape(photo.id)}"]`);
    if (media && img) {
      const url = URL.createObjectURL(media);
      equipmentPhotoUrls.set(photo.id, url);
      img.src = url;
    }
  }
  const list = $('#photoList');
  list.innerHTML = project.photos.map(photo => `<article class="photo-card" data-photo="${safe(photo.id)}">
    <div class="photo-preview"><img alt="${safe(code(photo.pointId))} 現場照片" data-photo-image="${safe(photo.id)}"></div>
    <div class="photo-body"><strong>${safe(code(photo.pointId))}</strong><small>${safe(photo.name)} · 拍攝時間 ${safe(photoTime(photo))} · 攝影：${safe(photo.photographer || '未記錄')}</small>
      <label>位置說明<input data-photo-description="${safe(photo.id)}" value="${safe(photo.description)}" maxlength="300"></label>
      <button type="button" data-delete-photo="${safe(photo.id)}" class="quiet danger-text">刪除此照片</button></div></article>`).join('') || '<p class="empty-state">尚無點位照片。</p>';
  for (const photo of project.photos) {
    const media = await loadMedia(photo.mediaId);
    const img = list.querySelector(`[data-photo-image="${CSS.escape(photo.id)}"]`);
    if (media && img) {
      const url = URL.createObjectURL(media);
      photoUrls.set(photo.id, url);
      img.src = url;
    }
  }
}

async function addImage(file, usage) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    notify('請選擇 JPG、PNG 或 WebP 圖片。', true); return;
  }
  if (file.size > 60 * 1024 * 1024) { notify('單張圖片上限 60 MB。', true); return; }
  if (usage === 'map' && project.mapMediaId && !confirm('更換底圖會清除目前所有圖上點位標記，是否繼續？')) return;
  const id = uid();
  try {
    await saveMedia(id, file);
    if (usage === 'map') {
      const previous = project.mapMediaId;
      const previousPositions = project.points.map(item => item.position);
      project.mapMediaId = id;
      project.points.forEach(item => { item.position = null; });
      try {
        clearTimeout(saveTimer);
        await saveQueue;
        project.lastModifiedAt = stamp(); updateExportState();
        await saveProject(structuredClone(project));
        renderPoints();
        await renderMap();
        if (previous) await deleteMedia(previous);
        notify('底圖已匯入；請填來源及截圖日期，再放置點位。');
        if ($('#fieldMapDialog').open) $('#fieldMapMessage').textContent = '底圖已匯入。請填來源及截圖日期，然後點圖面標註位置。';
        else if (!project.mapSource) $('#mapSource').focus();
      } catch (error) {
        project.mapMediaId = previous;
        project.points.forEach((item, index) => { item.position = previousPositions[index]; });
        await deleteMedia(id).catch(() => {});
        renderPoints(); await renderMap();
        throw error;
      }
    } else if (usage === 'equipment') {
      const addedAt = stamp();
      project.equipmentPhotos.push({ id: uid(), instrument: project.instrument.trim() || '未填儀器型號', mediaId: id, name: file.name, description: $('#equipmentDescription').value.trim(), addedAt, ...await captureTime(file, addedAt) });
      $('#equipmentDescription').value = '';
      await renderPhotos();
      queueSave(true);
      notify('本案設備照片已保存，並與點位照片分開。');
    } else {
      const pointId = $('#photoPoint').value;
      if (!point(pointId)) { await deleteMedia(id); notify('請先選擇照片對應點位。', true); return; }
      const addedAt = stamp();
      project.photos.push({ id: uid(), pointId, mediaId: id, name: file.name, description: $('#photoDescription').value.trim(), photographer: project.photographer.trim(), addedAt, ...await captureTime(file, addedAt) });
      $('#photoDescription').value = '';
      await renderPhotos();
      queueSave(true);
      notify('照片已連到點位並保留原檔。');
    }
  } catch (error) { notify(`圖片保存失敗：${error.message}`, true); }
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function canShareFile() {
  try { return !!navigator.share && !!navigator.canShare?.({ files: [new File(['x'], 'test.txt', { type: 'text/plain' })] }); } catch (_) { return false; }
}

async function deliverFile(name, blob, share = false) {
  if (share && canShareFile()) {
    try { await navigator.share({ files: [new File([blob], name, { type: blob.type })], title: name }); return true; }
    catch (error) {
      if (error.name === 'AbortError') return false;
      notify(`分享失敗：${error.message}。可按下載按鈕另存檔案。`, true);
      return false;
    }
  }
  download(name, blob);
  return true;
}

async function caseFingerprint(target = project, suppliedMedia = null) {
  const ids = [...new Set([target.mapMediaId, ...(target.photos || []).map(item => item.mediaId), ...(target.equipmentPhotos || []).map(item => item.mediaId)].filter(Boolean))];
  const byId = suppliedMedia ? new Map(suppliedMedia.map(item => [item.id, item.blob])) : null;
  const hashes = [];
  for (const id of ids) {
    const blob = byId ? byId.get(id) : await loadMedia(id);
    if (!blob) throw new Error(`缺少媒體原檔：${id}`);
    hashes.push({ id, sha256: await sha256Blob(blob) });
  }
  return fingerprint(target, hashes);
}

async function verifyBackup(file) {
  if (!file) return;
  try {
    const restored = parseBackup(await file.text());
    const hash = await caseFingerprint(restored.project, restored.media);
    $('#fingerprintResult').textContent = `所選案件檔資料指紋 SHA-256：${hash}。目前案件未被取代。`;
  } catch (error) { $('#fingerprintResult').textContent = `驗證失敗：${error.message}`; }
}

async function exportBackup(share = false) {
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    const backup = await makeBackup(structuredClone(project));
    const name = `${(project.number || project.name || '水準測量').replace(/[\\/:*?"<>|]/g, '_')}_水準測量案件_${new Date().toISOString().slice(0, 10)}.json`;
    if (!await deliverFile(name, new Blob([JSON.stringify(backup)], { type: 'application/json' }), share)) return false;
    project.lastExportedAt = stamp(); queueSave(true, false);
    notify(share ? '完整案件檔已分享。' : '完整案件檔已下載；請在目標資料夾核對檔案。');
    return true;
  } catch (error) { notify(`匯出失敗：${error.message}`, true); return false; }
}

function hasCaseRecords() {
  const entered = value => String(value ?? '').trim() !== '';
  return project.setups.some(setup => entered(setup.bs) || entered(setup.fs) || (setup.intermediate || []).some(sight => entered(sight.value)))
    || project.photos.length > 0 || project.equipmentPhotos.length > 0 || !!project.mapMediaId;
}

async function confirmReplacement() {
  if (!hasCaseRecords()) return true;
  const dialog = $('#replaceDialog');
  dialog.returnValue = 'cancel';
  const action = await new Promise(resolve => {
    const choose = event => {
      const button = event.target.closest('[data-replace]');
      if (!button) return;
      dialog.close(button.dataset.replace);
    };
    const close = () => {
      dialog.removeEventListener('click', choose);
      dialog.removeEventListener('close', close);
      resolve(dialog.returnValue || 'cancel');
    };
    dialog.addEventListener('click', choose);
    dialog.addEventListener('close', close);
    dialog.showModal();
  });
  if (action === 'cancel') return false;
  if (action === 'replace') return true;
  if (!await exportBackup()) return false;
  return confirm('請確認完整案件檔已存到目標資料夾，再繼續取代目前案件。');
}

async function exportPhotoWork(kind, share = false) {
  try {
    const workProject = structuredClone(project);
    if (kind === 'task') {
      workProject.photoTaskMode = true;
      const photographed = new Set(project.photos.map(photo => photo.pointId));
      workProject.photoTargetIds = [...observedPointIds()].filter(id => !photographed.has(id));
      workProject.setups = [];
      workProject.auditLog = [];
      workProject.routeHistory = [];
      workProject.photos = [];
      workProject.equipmentPhotos = [];
    }
    const backup = await makeBackup(workProject);
    const label = kind === 'task' ? '攝影工作檔' : '攝影成果';
    const name = `${(project.number || project.name || '水準測量').replace(/[\\/:*?"<>|]/g, '_')}_${label}_${new Date().toISOString().slice(0, 10)}.json`;
    if (!await deliverFile(name, new Blob([JSON.stringify(backup)], { type: 'application/json' }), share)) return;
    notify(`${label}已${share ? '分享' : '下載'}；請將此檔交給另一位作業者。`);
  } catch (error) { notify(`匯出失敗：${error.message}`, true); }
}

async function mergePhotoBackup(file) {
  if (!file) return;
  try {
    const incoming = parseBackup(await file.text());
    if (incoming.project.id !== project.id) throw new Error('案件識別碼不同，無法合併。');
    const knownPoints = new Set(project.points.map(item => item.id));
    const existingPhotos = new Set(project.photos.map(photo => photo.id));
    const existingMediaIds = new Set([project.mapMediaId, ...project.photos.map(photo => photo.mediaId), ...project.equipmentPhotos.map(photo => photo.mediaId)]);
    const additions = incoming.project.photos.filter(photo => !existingPhotos.has(photo.id));
    if (additions.some(photo => !knownPoints.has(photo.pointId))) throw new Error('攝影檔含本機尚未建立的點位；請先更新本機點位。');
    if (additions.some(photo => existingMediaIds.has(photo.mediaId))) throw new Error('攝影檔的圖像識別碼與本機資料重複，未執行合併。');
    if (additions.some(photo => typeof photo.id !== 'string' || typeof photo.mediaId !== 'string' || typeof photo.addedAt !== 'string' || typeof photo.name !== 'string')) throw new Error('攝影檔的照片紀錄不完整。');
    const mediaById = new Map(incoming.media.map(item => [item.id, item.blob]));
    const newMapId = !project.mapMediaId && incoming.project.mapMediaId ? incoming.project.mapMediaId : null;
    if (newMapId && existingMediaIds.has(newMapId)) throw new Error('攝影檔的位置圖識別碼與本機圖像重複。');
    const mapConflict = !!(project.mapMediaId && incoming.project.mapMediaId && incoming.project.mapMediaId !== project.mapMediaId);
    const sameMap = newMapId || (project.mapMediaId && incoming.project.mapMediaId === project.mapMediaId);
    const pointUpdates = (incoming.project.points || []).filter(item => {
      const current = point(item.id);
      return current && ((typeof item.description === 'string' && item.description.trim() && !current.description) || (sameMap && validPosition(item.position) && !validPosition(current.position)));
    });
    if (!additions.length && !pointUpdates.length && !newMapId) { notify('沒有新的照片或點位資料可合併。'); return; }
    if (!confirm(`此檔有 ${additions.length} 張新照片、${pointUpdates.length} 個待補點位${newMapId ? '及 1 張位置圖' : ''}。合併到目前案件？既有讀數與已填點位不會被覆蓋。${mapConflict ? '兩端底圖不同，圖上位置不會合併。' : ''}`)) return;
    const addedMedia = [];
    const oldPhotos = project.photos;
    const oldPoints = structuredClone(project.points);
    const oldMapId = project.mapMediaId;
    const oldMapSource = project.mapSource;
    clearTimeout(saveTimer);
    await saveQueue;
    try {
      if (newMapId) {
        const blob = mediaById.get(newMapId);
        if (!blob) throw new Error('攝影檔缺少位置圖原檔。');
        await saveMedia(newMapId, blob);
        addedMedia.push(newMapId);
        project.mapMediaId = newMapId;
        if (!project.mapSource) project.mapSource = incoming.project.mapSource || '';
      }
      for (const photo of additions) {
        const blob = mediaById.get(photo.mediaId);
        if (!blob) throw new Error('攝影檔缺少照片原檔。');
        await saveMedia(photo.mediaId, blob);
        addedMedia.push(photo.mediaId);
      }
      for (const item of pointUpdates) {
        const current = point(item.id);
        if (!current.description && typeof item.description === 'string') current.description = item.description.trim().slice(0, 300);
        if (!validPosition(current.position) && sameMap && validPosition(item.position)) current.position = { x: item.position.x, y: item.position.y };
      }
      project.photos = [...oldPhotos, ...additions];
      project.lastModifiedAt = stamp(); updateExportState();
      await saveProject(structuredClone(project));
      $('#mapSource').value = project.mapSource || '';
      $('#fieldMapSource').value = project.mapSource || '';
      renderPoints();
      await renderMap();
      await renderPhotos();
      notify(`已合併 ${additions.length} 張照片、${pointUpdates.length} 個點位；觀測讀數維持原狀。${mapConflict ? '兩端底圖不同，圖上位置未合併。' : ''}`);
    } catch (error) {
      project.photos = oldPhotos;
      project.points = oldPoints;
      project.mapMediaId = oldMapId;
      project.mapSource = oldMapSource;
      await saveProject(structuredClone(project)).catch(() => {});
      for (const id of addedMedia) await deleteMedia(id).catch(() => {});
      throw error;
    }
  } catch (error) { notify(`合併失敗：${error.message}`, true); }
}

async function importBackup(file) {
  if (!file) return;
  try {
    const contents = await file.text();
    const restored = parseBackup(contents);
    if (!await confirmReplacement()) return;
    clearTimeout(saveTimer);
    await saveQueue;
    await replaceProject(restored.project, restored.media);
    project = restored.project;
    if (normalizeProject()) queueSave(true);
    revokePhotos();
    renderAll();
    if (project.photoTaskMode) switchTab('photos');
    notify('案件檔已開啟，請核對點位圖、讀數及照片。');
  } catch (error) { notify(`開啟失敗：${error.message}`, true); }
}

function switchTab(name) {
  for (const tab of ['route', 'measure', 'photos', 'result']) {
    $(`#${tab}Panel`).hidden = tab !== name;
    $(`.tabs [data-tab="${tab}"]`).classList.toggle('active', tab === name);
  }
  document.body.classList.toggle('measure-mode', name === 'measure');
  if (name === 'route') renderPoints();
  if (name === 'photos') renderPhotos();
  window.scrollTo(0, 0);
  updateWakeLock();
}

function renderAll() {
  for (const tab of ['measure', 'result']) $(`.tabs [data-tab="${tab}"]`).hidden = !!project.photoTaskMode;
  $('#caseName').value = project.name || '';
  $('#caseNo').value = project.number || '';
  $('#surveyDate').value = project.date || '';
  $('#observer').value = project.observer || '';
  $('#rodHolder').value = project.rodHolder || '';
  $('#photographer').value = project.photographer || '';
  $('#instrument').value = project.instrument || '';
  $('#datum').value = project.datum || '';
  $('#approxLocation').value = project.approxLocation || '';
  updateGoogleMapsLink();
  $('#startHeight').value = project.route.startHeight || '';
  $('#startHeightKind').value = project.route.startHeightKind || 'known';
  $('#endHeight').value = project.route.endHeight || '';
  $('#toleranceMm').value = project.route.toleranceMm || '';
  $('#toleranceBasis').value = project.route.toleranceBasis || '';
  $('#formulaC').value = project.route.formulaC || '';
  $('#staffLengthM').value = project.route.staffLengthM ?? '5';
  $('#stadiaConstantK').value = project.route.stadiaConstantK ?? '100';
  $('#threeWireToleranceMm').value = project.route.threeWireToleranceMm || '';
  $('#adjustMethod').value = project.route.adjustMethod || 'stations';
  $('#instrumentSerial').value = project.instrumentCheck.serial || '';
  $('#calibrationDate').value = project.instrumentCheck.calibrationDate || '';
  $('#calibrationAgency').value = project.instrumentCheck.calibrationAgency || '';
  for (const [id, key] of Object.entries({ pegA1: 'a1', pegB1: 'b1', pegA2: 'a2', pegB2: 'b2', pegDistanceM: 'distanceM' })) $(`#${id}`).value = project.instrumentCheck.twoPeg[key] || '';
  renderTwoPegResult();
  $('#mapSource').value = project.mapSource || '';
  $('#fieldMapSource').value = project.mapSource || '';
  renderPointPlan(); renderPoints(); renderMap(); renderStations(); renderPhotos(); renderChecklist(); renderEnvironment(); updateExportState();
}

function renderTwoPegResult() {
  const result = twoPegCheck(project.instrumentCheck?.twoPeg);
  $('#twoPegResult').textContent = result?.issue || (result
    ? `視準軸誤差 e＝${formatMm(result.errorMm)} mm；每 100 m 誤差量＝${formatMm(result.per100mMm)} mm。僅列計算值。`
    : '填齊讀數與兩樁距離後顯示計算值。');
}

function handleRouteInput(event) {
  const mapping = { caseName: 'name', caseNo: 'number', surveyDate: 'date', observer: 'observer', rodHolder: 'rodHolder', photographer: 'photographer', instrument: 'instrument', datum: 'datum', approxLocation: 'approxLocation', mapSource: 'mapSource', fieldMapSource: 'mapSource' };
  const routeMapping = { startHeight: 'startHeight', startHeightKind: 'startHeightKind', endHeight: 'endHeight', toleranceMm: 'toleranceMm', toleranceBasis: 'toleranceBasis', formulaC: 'formulaC', staffLengthM: 'staffLengthM', stadiaConstantK: 'stadiaConstantK', threeWireToleranceMm: 'threeWireToleranceMm', adjustMethod: 'adjustMethod' };
  if (mapping[event.target.id]) project[mapping[event.target.id]] = event.target.value;
  else if (routeMapping[event.target.id]) project.route[routeMapping[event.target.id]] = event.target.value;
  else return false;
  if (event.target.id === 'approxLocation') updateGoogleMapsLink();
  if (event.target.id === 'fieldMapSource') $('#mapSource').value = event.target.value;
  if (event.target.id === 'mapSource') $('#fieldMapSource').value = event.target.value;
  if (event.target.id === 'staffLengthM') updateReadingWarnings();
  const result = renderResult(); updateWireFeedback(result); queueSave();
  return true;
}

function parsePair(pair) { return pair.split(':').map(Number); }

function handleStationInput(event) {
  const target = event.target;
  if (target.dataset.wireField !== undefined) {
    const item = project.setups[Number(target.dataset.station)], key = target.dataset.wireField;
    observedTimestamp(item, key, item[key], target.value); item[key] = target.value;
    updateWireFeedback(renderResult()); queueSave(); return true;
  }
  if (target.dataset.isWire !== undefined) {
    const [station, sight, key] = target.dataset.isWire.split(':');
    const item = project.setups[Number(station)].intermediate[Number(sight)];
    observedTimestamp(item, key, item[key], target.value); item[key] = target.value;
    updateWireFeedback(renderResult()); queueSave(); return true;
  }
  if (target.dataset.field !== undefined) {
    const index = Number(target.dataset.station);
    if (target.dataset.field === 'fsPointId' && index + 1 < project.setups.length && project.setups[index + 1].bs !== '' && target.value !== project.setups[index].fsPointId) {
      target.value = project.setups[index].fsPointId;
      notify('下一站已有後視讀數；不可直接改動本轉點。請先移除後續測站再修改。', true);
      return true;
    }
    observedTimestamp(project.setups[index], target.dataset.field, project.setups[index][target.dataset.field], target.value);
    project.setups[index][target.dataset.field] = target.value;
    if (target.dataset.reading !== undefined) updateReadingWarning(target);
    if (target.dataset.field === 'fsPointId') renderStations();
    else { updateWireFeedback(renderResult()); queueSave(); }
    if (target.dataset.field === 'fsPointId') queueSave(true);
    return true;
  }
  if (target.dataset.isPoint !== undefined || target.dataset.isValue !== undefined) {
    const [station, sight] = parsePair(target.dataset.isPoint ?? target.dataset.isValue);
    const item = project.setups[station].intermediate[sight];
    const key = target.dataset.isPoint !== undefined ? 'pointId' : 'value';
    observedTimestamp(item, key, item[key], target.value);
    item[key] = target.value;
    if (target.dataset.isValue !== undefined) updateReadingWarning(target);
    updateWireFeedback(renderResult()); queueSave();
    return true;
  }
  return false;
}

function bindInputs() {
  document.addEventListener('focusin', event => {
    const address = readingAddress(event.target);
    if (address) {
      const current = String(address.item[address.key] ?? '');
      entryStart.set(event.target, current);
      if (current) initialEntries.get(address.item)?.delete(address.key);
    }
  });
  document.addEventListener('input', event => {
    const target = event.target;
    const address = readingAddress(target);
    if (address && (entryStart.get(target) ?? String(address.item[address.key] ?? '')) !== '' && String(address.item[address.key]) !== target.value) {
      updateReadingWarning(target);
      event.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener('input', event => {
    if (handleRouteInput(event)) return;
    if (handleStationInput(event)) return;
    const target = event.target;
    const equipmentFields = { instrumentSerial: 'serial', calibrationDate: 'calibrationDate', calibrationAgency: 'calibrationAgency' };
    const pegFields = { pegA1: 'a1', pegB1: 'b1', pegA2: 'a2', pegB2: 'b2', pegDistanceM: 'distanceM' };
    const envFields = { envWeather: 'weather', envWeatherOther: 'weatherOther', envTemperature: 'temperature', envStart: 'start', envEnd: 'end', envNotes: 'notes' };
    if (envFields[target.id]) { project.environment[envFields[target.id]] = target.value; if (target.id === 'envStart') project.environment.startManual = true; if (target.id === 'envEnd') project.environment.endManual = true; queueSave(); return; }
    if (target.id === 'checklistNotes') { project.checklist.notes = target.value; queueSave(); return; }
    if (equipmentFields[target.id]) { project.instrumentCheck[equipmentFields[target.id]] = target.value; queueSave(); return; }
    if (pegFields[target.id]) { project.instrumentCheck.twoPeg[pegFields[target.id]] = target.value; renderTwoPegResult(); renderChecklist(); queueSave(); return; }
    if (target.id === 'plannedSCount' || target.id === 'plannedTPCount') {
      project.pointPlan[target.id === 'plannedSCount' ? 'sCount' : 'tpCount'] = target.value;
      updatePointPlanStatus(); queueSave(); return;
    }
    if (target.id === 'nextRole') { draftNextRole = target.value; if ($('#nextReading')) updateReadingWarning($('#nextReading')); return; }
    if (target.id === 'nextPoint') { draftNextPointId = target.value; if ($('#nextReading')) updateReadingWarning($('#nextReading')); return; }
    if (target.id === 'nextReading') { draftNextValue = target.value; updateReadingWarning(target); return; }
    if (target.dataset.pointDescription) { point(target.dataset.pointDescription).description = target.value; queueSave(); }
    if (target.dataset.photoDescription) {
      const photo = project.photos.find(item => item.id === target.dataset.photoDescription);
      if (photo) { photo.description = target.value; queueSave(); }
    }
    if (target.dataset.equipmentDescription) {
      const photo = project.equipmentPhotos.find(item => item.id === target.dataset.equipmentDescription);
      if (photo) { photo.description = target.value; queueSave(); }
    }
  });
  document.addEventListener('change', event => {
    const target = event.target;
    if (target.dataset.checkStatus !== undefined) { project.checklist.items[Number(target.dataset.checkStatus)].status = target.value; queueSave(true); return; }
    if (target.id === 'nextInverted') { draftNextInverted = target.checked; return; }
    if (target.dataset.inverted !== undefined) {
      project.setups[Number(target.dataset.station)][target.dataset.inverted] = target.checked;
      renderResult(); queueSave(true); return;
    }
    if (target.dataset.isInverted !== undefined) {
      const [station, sight] = parsePair(target.dataset.isInverted);
      project.setups[station].intermediate[sight].inverted = target.checked;
      renderResult(); queueSave(true); return;
    }
    if (target.id === 'startId' || target.id === 'endId') {
      if (target.id === 'startId' && project.setups.length) {
        target.value = project.route.startId;
        notify('已有測站讀數時不可改起點；請先另建測線或移除測站。', true);
        return;
      }
      if (target.id === 'endId' && project.setups.length && target.value !== project.route.endId) {
        const reason = prompt(`將預定終點由 ${code(project.route.endId)} 改為 ${code(target.value)}，請填現場變更原因：`);
        if (!reason?.trim()) { target.value = project.route.endId; notify('未填變更原因，終點維持原設定。', true); return; }
        project.routeHistory ||= [];
        project.routeHistory.push({ at: new Date().toISOString(), from: code(project.route.endId), to: code(target.value), reason: reason.trim() });
      }
      project.route[target.id] = target.value;
      synchronizeSetups(); renderRouteSelections(); renderStations(); queueSave(true); return;
    }
    if (target.dataset.pointCode) {
      const item = point(target.dataset.pointCode);
      const proposed = target.value.trim();
      if (!proposed || project.points.some(other => other.id !== item.id && other.code.toUpperCase() === proposed.toUpperCase())) {
        target.value = item.code; notify('點號不可空白或重複。', true); return;
      }
      item.code = proposed;
      renderPoints(); renderStations(); renderPhotos(); queueSave(true);
    }
  });
  document.addEventListener('change', async event => {
    const target = event.target;
    if ((target.dataset.inverted !== undefined || target.dataset.isInverted !== undefined) && !editPending) {
      const stationIndex = target.dataset.inverted !== undefined ? Number(target.dataset.station) : parsePair(target.dataset.isInverted)[0];
      const sightIndex = target.dataset.isInverted !== undefined ? parsePair(target.dataset.isInverted)[1] : null;
      const item = sightIndex === null ? project.setups[stationIndex] : project.setups[stationIndex].intermediate[sightIndex];
      const key = sightIndex === null ? target.dataset.inverted : 'inverted';
      const reading = sightIndex === null ? item[key === 'bsInverted' ? 'bs' : 'fs'] : item.value;
      if (reading !== '' && !!item[key] !== target.checked) {
        event.stopImmediatePropagation(); editPending = true;
        const reason = await editReason(`第 ${stationIndex + 1} 站 ${code(sightIndex === null ? item[key === 'bsInverted' ? 'bsPointId' : 'fsPointId'] : item.pointId)}：${item[key] ? '倒尺' : '正立尺'} → ${target.checked ? '倒尺' : '正立尺'}`);
        if (reason) {
          logAction('edit', stationIndex + 1, code(sightIndex === null ? item[key === 'bsInverted' ? 'bsPointId' : 'fsPointId'] : item.pointId), key, item[key] ? '倒尺' : '正立尺', target.checked ? '倒尺' : '正立尺', reason);
          item[key] = target.checked; renderStations(); queueSave(true);
        } else target.checked = !!item[key];
        editPending = false; return;
      }
    }
    const address = readingAddress(target);
    if (!address || editPending) return;
    const from = String(address.item[address.key] ?? '');
    const to = target.value;
    if (from === to) return;
    if (!from) return;
    event.stopImmediatePropagation();
    if (address.key === 'fsPointId' && project.setups[address.station] && project.setups[address.station].bs !== '') {
      target.value = from; notify('下一站已有後視讀數；請先移除後續測站再改前視點位。', true); return;
    }
    editPending = true;
    const pointField = address.key === 'pointId' || address.key === 'fsPointId';
    const reason = await editReason(`第 ${address.station} 站 ${address.pointCode}：${pointField ? code(from) : from} → ${pointField ? code(to) : to}`);
    const result = resolveObservedEdit({ from, to, reason, station: address.station, pointCode: address.pointCode, field: address.key, at: stamp(), id: uid() });
    if (result.accepted) {
      address.item[address.key] = result.value;
      if (pointField) { result.entry.from = code(from); result.entry.to = code(to); }
      project.auditLog.push(result.entry);
      initialEntries.get(address.item)?.delete(address.key);
      renderStations(); queueSave(true);
    } else { target.value = from; updateReadingWarning(target); }
    editPending = false;
  }, true);
}

function bindActions() {
  document.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.tab) { switchTab(target.dataset.tab); return; }
    if (target.dataset.copyWireDistance !== undefined) {
      const index = Number(target.dataset.copyWireDistance);
      const station = calculate(project).stations[index];
      if (station?.bsDistanceM === null || station?.fsDistanceM === null || !station) return;
      const current = String(project.setups[index].distance ?? '').trim();
      const measured = formatHeight(station.bsDistanceM + station.fsDistanceM);
      if (current && !confirm(`本站原測線長度為 ${current} m；改由三絲視距帶入 ${measured} m？`)) return;
      project.setups[index].distance = measured;
      const input = $(`[data-field="distance"][data-station="${index}"]`);
      if (input) input.value = measured;
      updateWireFeedback(renderResult()); queueSave(true); return;
    }
    if (target.dataset.nextUnobserved !== undefined) {
      const observed = observedPointIds();
      const next = project.points.find(item => item.type !== 'BM' && !observed.has(item.id)) || project.points.find(item => item.id === project.route.endId && !observed.has(item.id));
      if (!next) { notify('預排點位已全部觀測；可手動選回測點，或臨時新增點位。'); return; }
      draftNextPointId = next.id;
      draftNextRole = next.id === project.route.endId ? 'FINISH' : next.type === 'TP' ? 'MOVE' : 'IS';
      $('#nextPoint').value = next.id;
      $('#nextRole').value = draftNextRole;
      $('#nextReading')?.focus();
      return;
    }
    if (target.dataset.quickPoint) { addPoint(target.dataset.quickPoint, true); return; }
    if (target.dataset.fieldMap) { openFieldMap(target.dataset.fieldMap); return; }
    if (target.dataset.selectPhotoPoint) { $('#photoPoint').value = target.dataset.selectPhotoPoint; $('#photoDescription').focus(); return; }
    if (target.dataset.place) {
      if (!project.mapMediaId) { notify('請先匯入位置圖。', true); return; }
      placingPointId = target.dataset.place;
      $('#mapHint').textContent = `請在圖上點選 ${code(placingPointId)} 的位置。`;
      $('#mapFrame').classList.add('placing'); return;
    }
    if (target.dataset.deletePoint) { deletePoint(target.dataset.deletePoint); return; }
    if (target.dataset.addNext !== undefined) {
      const index = Number(target.dataset.addNext);
      const setup = project.setups[index];
      const pointId = $('#nextPoint')?.value;
      const role = $('#nextRole')?.value;
      const value = $('#nextReading')?.value.trim();
      if (index !== project.setups.length - 1 || setup.fsPointId) return;
      if (!validReading(setup.bs)) { notify('請先填妥本測站的後視 BS。', true); return; }
      if (updateReadingWarning($(`[data-field="bs"][data-station="${index}"]`))) return;
      if (!point(pointId) || !validReading(value)) { notify('請選擇下一個點位並填入有效讀數。', true); return; }
      if (updateReadingWarning($('#nextReading'))) return;
      if (role === 'FINISH' && pointId !== project.route.endId) { notify(`終點前視須選預定終點 ${code(project.route.endId)}。`, true); return; }
      if (role === 'MOVE' && pointId === project.route.endId) { notify('已到預定終點，請選「終點前視」。', true); return; }
      if (role === 'IS' && pointId === project.route.endId) { notify('預定終點應記為前視 FS。', true); return; }
      if (role === 'MOVE' || role === 'FINISH') {
        setup.fsPointId = pointId; setup.fs = value; setup.fsInverted = draftNextInverted; setup.fsAt = stamp(); updateEnvironmentTimes(setup.fsAt);
        if (role === 'MOVE') project.setups.push({ bsPointId: pointId, bs: '', intermediate: [], fsPointId: '', fs: '', distance: '' });
      } else { const at = stamp(); setup.intermediate.push({ pointId, value, inverted: draftNextInverted, at }); updateEnvironmentTimes(at); }
      draftNextPointId = ''; draftNextValue = ''; draftNextRole = 'IS'; draftNextInverted = false;
      renderStations(); queueSave(true);
      const height = role === 'IS' ? calculate(project).stations[index]?.intermediate.at(-1)?.rawHeight : calculate(project).stations[index]?.rawEndHeight;
      notify(`${code(pointId)} 已記錄；暫算高程 ${formatHeight(height)} m（未改正）。`);
      if (role === 'IS') $('#nextPoint')?.focus();
      else if (role === 'MOVE') $(`[data-field="bs"][data-station="${project.setups.length - 1}"]`)?.focus();
      else switchTab('result');
      return;
    }
    if (target.dataset.convertIs) {
      const [station, sight] = parsePair(target.dataset.convertIs);
      const setup = project.setups[station];
      if (station !== project.setups.length - 1 || sight !== setup.intermediate.length - 1 || setup.fsPointId) return;
      pushUndo('中間視改為前視', station + 1, code(setup.intermediate[sight].pointId), 'role', 'IS', 'FS');
      const reading = setup.intermediate.pop();
      setup.fsPointId = reading.pointId; setup.fs = reading.value; setup.fsInverted = !!reading.inverted;
      setup.fsAt = reading.at; setup.fsUpper = reading.upper || ''; setup.fsLower = reading.lower || ''; setup.fsUpperAt = reading.upperAt; setup.fsLowerAt = reading.lowerAt;
      logAction('convert', station + 1, code(reading.pointId), 'role', 'IS', 'FS', '觀測角色轉換');
      renderStations(); queueSave(true); return;
    }
    if (target.dataset.convertFs !== undefined) {
      const index = Number(target.dataset.convertFs);
      if (index !== project.setups.length - 1) return;
      const setup = project.setups[index];
      pushUndo('前視改為中間視', index + 1, code(setup.fsPointId), 'role', 'FS', 'IS');
      setup.intermediate.push({ pointId: setup.fsPointId, value: setup.fs, inverted: !!setup.fsInverted, at: setup.fsAt, upper: setup.fsUpper || '', lower: setup.fsLower || '', upperAt: setup.fsUpperAt, lowerAt: setup.fsLowerAt });
      logAction('convert', index + 1, code(setup.fsPointId), 'role', 'FS', 'IS', '觀測角色轉換');
      setup.fsPointId = ''; setup.fs = ''; setup.fsInverted = false; setup.fsUpper = ''; setup.fsLower = '';
      setup.fsAt = ''; setup.fsUpperAt = ''; setup.fsLowerAt = '';
      renderStations(); queueSave(true); return;
    }
    if (target.dataset.addIs !== undefined) {
      project.setups[Number(target.dataset.addIs)].intermediate.push({ pointId: '', value: '' });
      renderStations(); queueSave(true); return;
    }
    if (target.dataset.removeIs) {
      const [station, sight] = parsePair(target.dataset.removeIs);
      const previous = project.setups[station].intermediate[sight];
      pushUndo('已移除中間視', station + 1, code(previous.pointId), 'is', previous.value, '');
      logAction('delete', station + 1, code(previous.pointId), 'is', previous.value, '', '移除中間視');
      project.setups[station].intermediate.splice(sight, 1);
      renderStations(); queueSave(true); return;
    }
    if (target.dataset.removeStation !== undefined) {
      const index = Number(target.dataset.removeStation);
      if (confirm(`刪除第 ${index + 1} 站及其後續測站？`)) {
        pushUndo(`已刪除第 ${index + 1} 站及後續測站`, index + 1, code(project.setups[index]?.bsPointId), 'station', JSON.stringify(project.setups.slice(index)), '');
        logAction('delete', index + 1, code(project.setups[index]?.bsPointId), 'station', JSON.stringify(project.setups.slice(index)), '', '刪除測站');
        project.setups.splice(index); renderStations(); queueSave(true);
      }
      return;
    }
    if (target.dataset.deletePhoto) {
      const photo = project.photos.find(item => item.id === target.dataset.deletePhoto);
      if (photo && confirm(`刪除 ${code(photo.pointId)} 的這張照片？`)) {
        const previousPhotos = project.photos;
        project.photos = project.photos.filter(item => item.id !== photo.id);
        clearTimeout(saveTimer);
        project.lastModifiedAt = stamp(); updateExportState();
        const snapshot = structuredClone(project);
        saveQueue = saveQueue.then(() => saveProject(snapshot)).then(() => deleteMedia(photo.mediaId)).then(() => {
          $('#saveState').textContent = '已儲存於此裝置';
        }).catch(error => {
          project.photos = previousPhotos;
          notify(`照片刪除未完成：${error.message}`, true);
          renderPhotos();
        });
        renderPhotos();
      }
      return;
    }
    if (target.dataset.deleteEquipmentPhoto) {
      const photo = project.equipmentPhotos.find(item => item.id === target.dataset.deleteEquipmentPhoto);
      if (photo && confirm(`刪除 ${photo.instrument} 的這張本案設備照片？`)) {
        const previousPhotos = project.equipmentPhotos;
        project.equipmentPhotos = project.equipmentPhotos.filter(item => item.id !== photo.id);
        clearTimeout(saveTimer);
        project.lastModifiedAt = stamp(); updateExportState();
        const snapshot = structuredClone(project);
        saveQueue = saveQueue.then(() => saveProject(snapshot)).then(() => deleteMedia(photo.mediaId)).then(() => {
          $('#saveState').textContent = '已儲存於此裝置';
        }).catch(error => {
          project.equipmentPhotos = previousPhotos;
          notify(`設備照片刪除未完成：${error.message}`, true);
          renderPhotos();
        });
        renderPhotos();
      }
    }
  });
  $('#undoLast').onclick = undoLast;
  $('#undoToastButton').onclick = undoLast;
  $('#addChecklistItem').onclick = () => {
    const label = prompt('自訂檢核項目名稱：')?.trim();
    if (!label) return;
    project.checklist.items.push({ label: label.slice(0, 160), status: '' }); renderChecklist(); queueSave(true);
  };
  $('#sunlightToggle').onclick = () => {
    const enabled = !document.documentElement.classList.contains('sunlight');
    document.documentElement.classList.toggle('sunlight', enabled);
    $('#sunlightToggle').setAttribute('aria-pressed', String(enabled));
    localStorage.setItem('level-survey-sunlight', enabled ? '1' : '0');
  };
  $('#wakeLockToggle').onchange = () => { localStorage.setItem('level-survey-wake-lock', $('#wakeLockToggle').checked ? '1' : '0'); updateWakeLock(); };
  document.addEventListener('visibilitychange', updateWakeLock);
  window.addEventListener('online', updateOnlineState);
  window.addEventListener('offline', updateOnlineState);
  window.addEventListener('beforeunload', event => { if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return; if (project?.lastModifiedAt && (!project.lastExportedAt || project.lastModifiedAt > project.lastExportedAt)) { event.preventDefault(); event.returnValue = ''; } });
  $('#addBM').onclick = () => addPoint('BM');
  $('#addS').onclick = () => addPoint('S');
  $('#addTP').onclick = () => addPoint('TP');
  $('#createPlannedPoints').onclick = createPlannedPoints;
  $('#quickS').onclick = () => addPoint('S', true);
  $('#quickTP').onclick = () => addPoint('TP', true);
  $('#addStation').onclick = () => {
    const previous = project.setups.at(-1);
    if (previous && (!previous.fsPointId || !validReading(previous.fs))) { notify('請先填妥上一站的前視點與讀數。', true); return; }
    if (previous && !validReading(previous.bs)) { notify('請先填妥上一站的後視 BS。', true); return; }
    if (previous?.fsPointId === project.route.endId) { notify('已到預定終點；如需續測，請先調整測線終點。', true); return; }
    if (!project.route.startId) { notify('請先選定起點。', true); return; }
    project.setups.push({ bsPointId: previous?.fsPointId || project.route.startId, bs: '', intermediate: [], fsPointId: '', fs: '', distance: '' });
    renderStations(); queueSave(true);
    $(`[data-field="bs"][data-station="${project.setups.length - 1}"]`)?.focus();
  };
  $('#mapFrame').onclick = event => {
    if (!placingPointId || !project.mapMediaId) return;
    const image = $('#mapImage');
    const rect = image.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * 100;
    const y = (event.clientY - rect.top) / rect.height * 100;
    if (x < 0 || x > 100 || y < 0 || y > 100) return;
    point(placingPointId).position = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
    placingPointId = null;
    $('#mapFrame').classList.remove('placing');
    $('#mapHint').textContent = '點位已放到圖上；可隨時選擇「移動圖上標記」。';
    renderPoints(); queueSave(true);
    if ($('#fieldMapDialog').open) closeFieldMap();
  };
  $('#closeFieldMap').onclick = closeFieldMap;
  $('#fieldMapDialog').addEventListener('cancel', event => { event.preventDefault(); closeFieldMap(); });
  $('#mapFile').onchange = event => { addImage(event.target.files[0], 'map'); event.target.value = ''; };
  $('#fieldMapFile').onchange = event => { addImage(event.target.files[0], 'map'); event.target.value = ''; };
  $('#pasteMap').onclick = async () => {
    try {
      if (!navigator.clipboard?.read) throw new Error('此瀏覽器不支援直接讀取剪貼簿');
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find(value => ['image/png', 'image/jpeg', 'image/webp'].includes(value));
        if (type) { await addImage(await item.getType(type), 'map'); return; }
      }
      notify('剪貼簿沒有可貼入的圖片；請先擷取地圖畫面。', true);
    } catch (error) { notify(`無法直接讀取剪貼簿：${error.message}。請在本頁按 Ctrl+V，或匯入圖片檔。`, true); }
  };
  document.addEventListener('paste', event => {
    if ($('#routePanel').hidden) return;
    const image = [...(event.clipboardData?.items || [])].find(item => ['image/png', 'image/jpeg', 'image/webp'].includes(item.type));
    if (!image) return;
    event.preventDefault();
    addImage(image.getAsFile(), 'map');
  });
  $('#photoFile').onchange = event => { addImage(event.target.files[0], 'photo'); event.target.value = ''; };
  $('#photoGallery').onchange = event => { addImage(event.target.files[0], 'photo'); event.target.value = ''; };
  $('#equipmentFile').onchange = event => { addImage(event.target.files[0], 'equipment'); event.target.value = ''; };
  $('#equipmentGallery').onchange = event => { addImage(event.target.files[0], 'equipment'); event.target.value = ''; };
  $('#exportBackup').onclick = () => exportBackup();
  $('#exportBackup2').onclick = () => exportBackup();
  $('#shareBackup').onclick = () => exportBackup(true);
  const exportCsv = async share => {
    const csv = buildSummaryCsv(project);
    const name = `${(project.number || project.name || '水準測量').replace(/[\\/:*?"<>|]/g, '_')}_水準測量成果總表.csv`;
    if (await deliverFile(name, new Blob([csv], { type: 'text/csv;charset=utf-8' }), share)) notify(`成果總表 CSV 已${share ? '分享' : '下載'}。`);
  };
  $('#exportCsv').onclick = () => exportCsv(false);
  $('#shareCsv').onclick = () => exportCsv(true);
  $('#applyFormula').onclick = () => {
    const result = formulaToleranceMm(project.route.formulaC, project.setups);
    const status = $('#formulaStatus');
    if (result.issue) { status.textContent = result.issue; status.classList.add('danger-text'); return; }
    const nextValue = formatMm(result.valueMm);
    if (project.route.toleranceMm && !confirm(`將原容許值 ${project.route.toleranceMm} mm 改為公式計算的 ${nextValue} mm？`)) return;
    project.route.toleranceMm = nextValue;
    $('#toleranceMm').value = nextValue;
    status.classList.remove('danger-text');
    status.textContent = `測線總長 ${formatHeight(result.lengthKm)} km；已帶入 ${nextValue} mm。`;
    renderResult(); queueSave(true);
  };
  $('#exportPhotoTask').onclick = () => exportPhotoWork('task');
  $('#exportPhotoResult').onclick = () => exportPhotoWork('result');
  $('#sharePhotoTask').onclick = () => exportPhotoWork('task', true);
  $('#sharePhotoResult').onclick = () => exportPhotoWork('result', true);
  $('#verifyBackup').onchange = event => { verifyBackup(event.target.files[0]); event.target.value = ''; };
  $('#mergePhotoBackup').onchange = event => { mergePhotoBackup(event.target.files[0]); event.target.value = ''; };
  $('#importBackup').onchange = event => { importBackup(event.target.files[0]); event.target.value = ''; };
  $('#newCase').onclick = async () => {
    if (!await confirmReplacement()) return;
    clearTimeout(saveTimer); await saveQueue;
    project = blankProject();
    await replaceProject(project, []);
    revokePhotos(); renderAll(); switchTab('route'); notify('已建立新案件。');
  };
  $('#printReport').onclick = printReport;
  $('#printSummary').onclick = printSummary;
}

function printTable(result) {
  return `<table><thead><tr><th>站</th><th>點號</th><th>後視 BS<br>m</th><th>前視 FS<br>m</th><th>中間視 IS<br>m</th><th>觀測時間</th><th>暫算高程<br>m</th><th>改正後高程<br>m</th><th>備註</th></tr></thead><tbody>${resultRows(result)}</tbody></table>`;
}

async function printSummary() {
  const result = calculate(project);
  let hash;
  try { hash = await caseFingerprint(); } catch (error) { notify(`資料指紋計算失敗：${error.message}`, true); return; }
  const report = document.createElement('section');
  report.id = 'printPanel';
  report.className = 'summary-print';
  report.innerHTML = `<header class="print-title"><h1>水準測量成果總表</h1><p>案件：${safe(project.name || '未填')}　案號：${safe(project.number || '未填')}　測量日期：${safe(project.date || '未填')}</p><p>儀器：${safe(project.instrument || '未填')}　儀器觀測者：${safe(project.observer || '未填')}　高程基準／來源：${safe(project.datum || '未填')}</p><p>測線：${safe(code(project.route.startId))} → ${safe(code(project.route.endId))}　起點${project.route.startHeightKind === 'assumed' ? '假設' : '已知'}高程：${formatHeight(result.startHeight)} m</p></header>
    <p class="summary-print-status"><strong>${summaryStatus(result)}</strong></p>${printTable(result)}
    <div class="summary-print-checks">${summaryChecks(result)}<span>實測終點 <strong>${formatHeight(result.rawEndHeight)} m</strong></span></div>
    <p>容許值依據：${safe(project.route.toleranceBasis || '未填')}。</p>${arithmeticSummary(result)}${sightBalanceSummary(result)}
    ${result.issues.length ? `<p class="print-alert">待補／檢核事項：${safe(result.issues.join('；'))}</p>` : ''}
    <p class="print-note">原始讀數、暫算高程與改正後高程分列；改正後高程僅在測線完整且閉合差符合人工指定容許值時產生。本表為單一測線簡易閉合差分配，不代表控制網整體平差。</p>
    <footer>資料指紋 SHA-256：${hash.slice(0, 16)}…｜來源：水準測量現場紀錄 V${VERSION}｜列印日期：${safe(new Date().toLocaleDateString('zh-TW'))}</footer>`;
  $('#printPanel')?.remove();
  document.body.append(report);
  const previousTitle = document.title;
  document.title = `${project.number || project.name || '水準測量'}_水準測量成果總表`;
  const cleanup = () => { document.title = previousTitle; window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  window.print();
}

async function printReport() {
  const result = calculate(project);
  let hash;
  try { hash = await caseFingerprint(); } catch (error) { notify(`資料指紋計算失敗：${error.message}`, true); return; }
  await renderPhotos();
  const observed = observedPointIds();
  const reportedPoints = project.points.filter(item => observed.has(item.id));
  const image = $('#mapImage');
  const mapWidthMm = image.naturalWidth && image.naturalHeight ? Math.min(180, 125 * image.naturalWidth / image.naturalHeight) : 180;
  const map = project.mapMediaId && mapUrl ? `<div class="print-map" style="width:${mapWidthMm.toFixed(2)}mm"><img src="${mapUrl}" alt="水準測量點位圖">${reportedPoints.filter(item => validPosition(item.position)).map(item => `<span class="map-marker ${safe(item.type.toLowerCase())}" style="left:${item.position.x}%;top:${item.position.y}%"><b>${safe(item.code)}</b></span>`).join('')}</div>` : '<p>未附位置圖</p>';
  const photos = project.photos.filter(photo => observed.has(photo.pointId)).map(photo => `<article class="print-photo"><p><strong>點位 ${safe(code(photo.pointId))}</strong>｜${safe(photo.description || point(photo.pointId)?.description || '未填位置說明')}</p><img src="${safe(photoUrls.get(photo.id) || '')}" alt="${safe(code(photo.pointId))} 照片"><small>攝影者：${safe(photo.photographer || '未記錄')}｜原檔：${safe(photo.name)}｜拍攝時間：${safe(photoTime(photo))}</small></article>`).join('');
  const referenceEquipmentPhoto = project.instrument.toUpperCase().includes(DEFAULT_INSTRUMENT) ? '<article class="print-photo reference-equipment"><p><strong>PENTAX AP-128 水準儀</strong>｜公司設備參考照，非本案測量當日拍攝。</p><img src="./equipment/pentax-ap-128-source.png" alt="PENTAX AP-128 公司設備參考照"><small>來源：使用者提供之原始照片，原圖保留。</small></article>' : '';
  const equipmentPhotos = project.equipmentPhotos.map(photo => `<article class="print-photo"><p><strong>${safe(photo.instrument)} 本案設備照片</strong>｜${safe(photo.description || '未填設備說明')}</p><img src="${safe(equipmentPhotoUrls.get(photo.id) || '')}" alt="${safe(photo.instrument)} 設備照片"><small>原檔：${safe(photo.name)}｜拍攝時間：${safe(photoTime(photo))}</small></article>`).join('');
  const instrumentCheck = project.instrumentCheck || {};
  const peg = twoPegCheck(instrumentCheck.twoPeg);
  const pegInputs = instrumentCheck.twoPeg || {};
  const calibration = `<p>儀器編號：${safe(instrumentCheck.serial || '未填')}；最近校正日期：${safe(instrumentCheck.calibrationDate || '未填')}；校正單位：${safe(instrumentCheck.calibrationAgency || '未填')}。</p>
    ${peg ? `<p>兩樁法：a1 ${safe(pegInputs.a1)} m、b1 ${safe(pegInputs.b1)} m、a2 ${safe(pegInputs.a2)} m、b2 ${safe(pegInputs.b2)} m；兩樁距離 D ${safe(pegInputs.distanceM)} m。${peg.issue ? safe(peg.issue) : `視準軸誤差 e ${formatMm(peg.errorMm)} mm；每 100 m 誤差量 ${formatMm(peg.per100mMm)} mm。`}本表僅列計算值。</p>` : ''}`;
  const status = result.withinTolerance === true ? '符合輸入容許值' : result.withinTolerance === false ? '超出容許值，未進行改正' : '尚未完成閉合檢核';
  const report = document.createElement('section');
  report.id = 'printPanel';
  report.innerHTML = `<header class="print-title"><small>水準測量現場紀錄 V${VERSION}</small><h1>${safe(project.name || '水準測量成果')}</h1><p>案件編號：${safe(project.number || '未填')}　測量日期：${safe(project.date || '未填')}　儀器觀測者：${safe(project.observer || '未填')}　扶尺人員：${safe(project.rodHolder || '未填')}　攝影者：${safe(project.photographer || '未填')}</p><p>儀器：${safe(project.instrument || '未填')}　高程基準／來源：${safe(project.datum || '未填')}</p><p>天氣：${safe([project.environment.weather, project.environment.weatherOther].filter(Boolean).join('／') || '未填')}　氣溫：${safe(project.environment.temperature || '未填')} °C　觀測開始：${safe(dateTime(project.environment.start) || '未填')}　觀測結束：${safe(dateTime(project.environment.end) || '未填')}</p><p>現場備註：${safe(project.environment.notes || '未填')}</p></header>
    <h2>一、測線與點位</h2><p>測線：${safe(code(project.route.startId))} → ${safe(code(project.route.endId))}；起點${project.route.startHeightKind === 'assumed' ? '假設' : '已知'}高程：${formatHeight(result.startHeight)} m；${project.route.startId === project.route.endId ? '回測起點高程' : '終點已知高程'}：${formatHeight(result.endHeight)} m。</p>
    <p>約略地址／路名：${safe(project.approxLocation || '未填')}。底圖來源：${safe(project.mapSource || '未填')}。位置圖僅供示意，不作測線長度量測。</p>${map}
    <p class="print-note">下表與圖上標記僅列有觀測讀數的點位；未使用的預排點位不列入成果。</p>
    ${reportedPoints.length ? `<table class="point-print-table"><thead><tr><th>點號</th><th>類別</th><th>位置說明</th></tr></thead><tbody>${reportedPoints.map(item => `<tr><td>${safe(item.code)}</td><td>${safe(item.type)}</td><td>${safe(item.description || '—')}</td></tr>`).join('')}</tbody></table>` : '<p>尚無已觀測點位。</p>'}
    <h2>二、水準測量成果總表</h2><p><strong>${summaryStatus(result)}</strong></p>${printTable(result)}
    <p>後視合計 ${formatHeight(result.sumBS)} m；前視合計 ${formatHeight(result.sumFS)} m；實測終點高程 ${formatHeight(result.rawEndHeight)} m；閉合差 ${formatMm(result.closureMm)} mm。</p>
    <p>人工輸入容許值：${result.toleranceMm === null ? '未指定' : `±${formatMm(result.toleranceMm)} mm`}；依據：${safe(project.route.toleranceBasis || '未填')}；檢核：${status}。改正方式：${result.adjusted ? result.method === 'distance' ? '按各站測線長度比例' : '按測站數等分' : '未執行'}。</p>
    ${arithmeticSummary(result)}${sightBalanceSummary(result)}
    ${project.routeHistory?.length ? `<p>終點變更紀錄：${project.routeHistory.map(item => `${safe(item.at.slice(0, 19))} ${safe(item.from)} → ${safe(item.to)}，原因：${safe(item.reason)}`).join('；')}</p>` : ''}
    ${result.issues.length ? `<p class="print-alert">待補／檢核事項：${safe(result.issues.join('；'))}</p>` : ''}
    <p class="print-note">原始讀數與暫算高程保留；改正後高程僅在測線完整且閉合差符合輸入容許值時產生。中間視承接所在測站起點累計改正。本表為單一測線簡易閉合差分配，不代表控制網整體平差。</p>
    <h2>三、點位照片</h2>${photos || '<p>未附點位照片。</p>'}
    <h2>四、儀器檢校與設備照片</h2>${calibration}${referenceEquipmentPhoto}${equipmentPhotos}${referenceEquipmentPhoto || equipmentPhotos ? '' : '<p>未附設備照片。</p>'}
    <h2>五、開工前檢核</h2><table><thead><tr><th>項目</th><th>紀錄狀態</th></tr></thead><tbody>${project.checklist.items.map(item => `<tr><td>${safe(item.label)}</td><td>${safe({ done: '已執行', pending: '未執行', na: '不適用' }[item.status] || '未選')}</td></tr>`).join('')}</tbody></table><p>檢核備註：${safe(project.checklist.notes || '未填')}</p>
    <h2>六、讀數更正與操作紀錄</h2>${project.auditLog.length ? `<table><thead><tr><th>時間</th><th>測站／點位</th><th>欄位</th><th>原值</th><th>新值</th><th>原因</th></tr></thead><tbody>${project.auditLog.map(item => `<tr><td>${safe(dateTime(item.at))}</td><td>第 ${safe(item.station)} 站／${safe(item.pointCode)}</td><td>${safe(item.field)}</td><td><del>${safe(item.from)}</del></td><td>${safe(item.to)}</td><td>${safe(item.reason)}</td></tr>`).join('')}</tbody></table>` : '<p>無更正紀錄。</p>'}
    <footer>列印時間：${safe(new Date().toLocaleString('zh-TW'))}｜來源工具：水準測量現場紀錄 V${VERSION}｜資料指紋 SHA-256：${hash.slice(0, 16)}…<br>完整指紋：${hash}</footer>`;
  $('#printPanel')?.remove();
  document.body.append(report);
  const reportImages = [...report.querySelectorAll('img')];
  await Promise.all(reportImages.map(img => img.decode().catch(() => {})));
  if (reportImages.some(img => !img.naturalWidth)) {
    report.remove();
    notify('圖面或照片未能載入，請核對案件媒體後再列印。', true);
    return;
  }
  const previousTitle = document.title;
  document.title = `${project.number || project.name || '水準測量'}_水準測量成果`;
  const cleanup = () => { document.title = previousTitle; window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  window.print();
}

async function main() {
  try {
    project = await loadProject() || blankProject();
    if (!project.schema || project.schema !== 1) throw new Error('本機案件格式不受此版本支援。');
    const migrated = normalizeProject();
    bindInputs(); bindActions(); renderAll();
    const sunlight = localStorage.getItem('level-survey-sunlight') === '1';
    document.documentElement.classList.toggle('sunlight', sunlight);
    $('#sunlightToggle').setAttribute('aria-pressed', String(sunlight));
    $('#wakeLockToggle').checked = localStorage.getItem('level-survey-wake-lock') !== '0';
    for (const id of ['shareBackup', 'sharePhotoTask', 'sharePhotoResult', 'shareCsv']) $(`#${id}`).hidden = !canShareFile();
    updateOnlineState(); updateWakeLock();
    if (project.photoTaskMode) switchTab('photos');
    $('#saveState').textContent = '已載入本機案件';
    updateStorageStatus();
    if (migrated) queueSave(true);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  } catch (error) {
    $('#saveState').textContent = '載入失敗';
    notify(`無法載入本機案件：${error.message}`, true);
  }
}

main();
