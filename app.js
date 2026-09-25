import { calculate, formatHeight, formatMm, VERSION } from './calc.js';
import { loadProject, saveProject, saveMedia, loadMedia, deleteMedia, replaceProject, makeBackup, parseBackup } from './store.js';

const $ = selector => document.querySelector(selector);
const uid = () => crypto.randomUUID();
const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
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

function blankProject() {
  const bm = { id: uid(), code: 'BM1', type: 'BM', description: '', position: null };
  return {
    schema: 1, appVersion: VERSION, id: uid(), name: '', number: '', date: new Date().toISOString().slice(0, 10),
    observer: '', instrument: DEFAULT_INSTRUMENT, instrumentDefaultApplied: true, datum: '', approxLocation: '', points: [bm], mapMediaId: null, mapSource: '', photos: [], equipmentPhotos: [],
    route: { startId: bm.id, endId: bm.id, startHeight: '', endHeight: '', toleranceMm: '', adjustMethod: 'stations' },
    setups: [], routeHistory: [], updatedAt: new Date().toISOString(),
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
}

function queueSave(immediate = false) {
  project.updatedAt = new Date().toISOString();
  $('#saveState').textContent = '儲存中…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const snapshot = structuredClone(project);
    saveQueue = saveQueue.then(() => saveProject(snapshot)).then(() => {
      $('#saveState').textContent = '已儲存於此裝置';
    }).catch(error => {
      $('#saveState').textContent = '儲存失敗';
      notify(`儲存失敗：${error.message}`, true);
    });
  }, immediate ? 0 : 300);
}

function options(items, selected, placeholder = '請選擇點位') {
  return `<option value="">${safe(placeholder)}</option>` + items.map(item =>
    `<option value="${safe(item.id)}" ${item.id === selected ? 'selected' : ''}>${safe(item.code)} · ${safe(item.type)}</option>`).join('');
}

function renderRouteSelections() {
  const bms = project.points.filter(item => item.type === 'BM');
  $('#startId').innerHTML = options(bms, project.route.startId);
  $('#endId').innerHTML = options(bms, project.route.endId);
  $('#endHeightLabel').hidden = project.route.startId === project.route.endId;
  $('#photoPoint').innerHTML = options(project.points, $('#photoPoint').value);
  $('#routeSummary').textContent = `${code(project.route.startId)} → ${code(project.route.endId)}｜${project.setups.length} 站`;
}

function renderPoints() {
  $('#pointList').innerHTML = project.points.map(item => `<div class="point-card" data-point="${safe(item.id)}">
    <div class="point-badge ${safe(item.type.toLowerCase())}">${safe(item.type)}</div>
    <label>點號<input data-point-code="${safe(item.id)}" value="${safe(item.code)}" maxlength="24"></label>
    <label>點位說明<input data-point-description="${safe(item.id)}" value="${safe(item.description)}" maxlength="300" placeholder="固定標誌、構造物位置"></label>
    <div class="point-actions"><button type="button" data-place="${safe(item.id)}">${item.position ? '移動圖上標記' : '放到圖上'}</button><button type="button" data-delete-point="${safe(item.id)}" class="quiet danger-text">刪除</button></div>
  </div>`).join('');
  $('#mapMarkers').innerHTML = project.points.filter(item => item.position).map(item =>
    `<span class="map-marker ${safe(item.type.toLowerCase())}" style="left:${item.position.x}%;top:${item.position.y}%" title="${safe(item.code)}"><b>${safe(item.code)}</b></span>`).join('');
  renderRouteSelections();
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

function renderStations() {
  synchronizeSetups();
  $('#stationList').innerHTML = project.setups.map((setup, index) => `<section class="card station" data-station="${index}">
    <div class="station-head"><h3>測站 ${index + 1}｜${index ? `由 ${safe(code(setup.bsPointId))} 後視開始` : `由 ${safe(code(project.route.startId))} 起測`}</h3><button type="button" data-remove-station="${index}" class="quiet danger-text">刪除此站及後續站</button></div>
    ${index === 0 ? `<div class="reading-row"><span class="reading-role">起點</span><strong>${safe(code(setup.bsPointId))}</strong><label>後視 BS（m）<input ${decimals} data-field="bs" data-station="${index}" value="${safe(setup.bs)}" placeholder="0.000"></label></div>` : `<p class="note">${safe(code(setup.bsPointId))} 的後視 BS 請在上一站的前視點同一列填寫。</p>`}
    ${(setup.intermediate || []).map((sight, sightIndex) => `<div class="reading-row"><span class="reading-role">中間視 IS</span>
      <label>點位<select data-is-point="${index}:${sightIndex}">${options(project.points, sight.pointId)}</select></label>
      <label>讀數（m）<input ${decimals} data-is-value="${index}:${sightIndex}" value="${safe(sight.value)}" placeholder="0.000"></label>
      <div class="reading-actions">${sightIndex === setup.intermediate.length - 1 && !setup.fsPointId ? `<button type="button" data-convert-is="${index}:${sightIndex}">改為前視／換站點</button>` : ''}<button type="button" data-remove-is="${index}:${sightIndex}" class="quiet danger-text">移除</button></div></div>`).join('')}
    ${setup.fsPointId || setup.fs !== '' ? `<div class="reading-row turn-row"><span class="reading-role">前視／換站點</span>
      <label>同一點位<select data-field="fsPointId" data-station="${index}">${options(project.points, setup.fsPointId)}</select></label>
      <label>本測站前視 FS（m）<input ${decimals} data-field="fs" data-station="${index}" value="${safe(setup.fs)}" placeholder="0.000"></label>
      ${project.setups[index + 1] ? `<label>搬站後同點後視 BS（m）<input ${decimals} data-field="bs" data-station="${index + 1}" value="${safe(project.setups[index + 1].bs)}" placeholder="0.000"></label>` : `<p class="note">${setup.fsPointId === project.route.endId ? '此點為預定終點，完成前視後即可閉合檢核。' : '搬站後，仍在此點讀取下一站後視。'}</p>`}
      ${!project.setups[index + 1] ? `<button type="button" data-convert-fs="${index}" class="quiet">改為中間視</button>` : ''}</div>` : ''}
    ${index === project.setups.length - 1 && !setup.fsPointId && setup.fs === '' ? `<div class="next-reading"><h4>下一個觀測點</h4><div class="grid three">
      <label>點位<select id="nextPoint">${options(project.points, draftNextPointId)}</select></label>
      <label>本點讀法<select id="nextRole"><option value="IS" ${draftNextRole === 'IS' ? 'selected' : ''}>中間視 IS（儀器不搬站）</option><option value="FS" ${draftNextRole === 'FS' ? 'selected' : ''}>前視 FS（此點可接續下一站後視）</option></select></label>
      <label>讀數（m）<input id="nextReading" ${decimals} value="${safe(draftNextValue)}" placeholder="0.000"></label></div>
      <button type="button" data-add-next="${index}" class="primary">記錄此點</button><p class="note">選前視後，如需搬站，下一站後視會自動連到同一點；到達預定終點時不需搬站。</p></div>` : ''}
    <label class="station-distance">本測站長度（m，按距離分配時必填）<input ${decimals} data-field="distance" data-station="${index}" value="${safe(setup.distance)}" placeholder="例如 35.0"></label>
  </section>`).join('') || '<div class="empty-state">先在「測線與點位」指定起點，再開始第一站後視。</div>';
  const last = project.setups.at(-1);
  $('#addStation').hidden = !!last && (!last.fsPointId || last.fsPointId === project.route.endId);
  $('#addStation').textContent = !last ? `開始第一站：後視 ${code(project.route.startId)}` : `搬站：於 ${code(last.fsPointId)} 讀後視`;
  renderRouteSelections();
  renderResult();
}

function resultRows(result) {
  const adjusted = result.adjusted;
  const output = [];
  result.stations.forEach((station, index) => {
    if (index === 0) output.push(`<tr><td>${station.index}</td><td>${safe(code(station.bsPointId))}</td><td>${formatHeight(station.bs)}</td><td></td><td></td><td>${formatHeight(station.rawStartHeight)}</td><td>${adjusted ? formatHeight(station.adjustedStartHeight) : '—'}</td><td>起點後視</td></tr>`);
    for (const [sightIndex, sight] of station.intermediate.entries()) {
      const adjustedSight = station.adjustedIntermediate?.[sightIndex];
      output.push(`<tr><td>${station.index}</td><td>${safe(code(sight.pointId))}</td><td></td><td></td><td>${formatHeight(sight.value)}</td><td>${formatHeight(sight.rawHeight)}</td><td>${adjusted ? formatHeight(adjustedSight?.adjustedHeight) : '—'}</td><td>中間視</td></tr>`);
    }
    if (station.complete) {
      const next = result.stations[index + 1];
      const note = next ? '本點前視、搬站後同點後視' : project.setups[index + 1] ? '本點前視；搬站後同點後視待填' : station.fsPointId === project.route.endId ? '預定終點前視' : '本站前視，待搬站';
      output.push(`<tr><td>${station.index}${next ? `→${next.index}` : ''}</td><td>${safe(code(station.fsPointId))}</td><td>${next ? formatHeight(next.bs) : ''}</td><td>${formatHeight(station.fs)}</td><td></td><td>${formatHeight(station.rawEndHeight)}</td><td>${adjusted ? formatHeight(station.adjustedEndHeight) : '—'}</td><td>${note}${adjusted ? `；本站改正 ${formatMm(station.correction * 1000)} mm` : ''}</td></tr>`);
    }
  });
  return output.join('');
}

function resultTable(result) {
  return `<div class="table-wrap"><table><thead><tr><th>站</th><th>點號</th><th>後視 BS<br>m</th><th>前視 FS<br>m</th><th>中間視 IS<br>m</th><th>暫算高程<br>m</th><th>改正後高程<br>m</th><th>備註</th></tr></thead><tbody>${resultRows(result)}</tbody></table></div>`;
}

function renderResult() {
  const result = calculate(project);
  const rows = [
    `<div><span>後視合計</span><strong>${formatHeight(result.sumBS)} m</strong></div>`,
    `<div><span>前視合計</span><strong>${formatHeight(result.sumFS)} m</strong></div>`,
    `<div><span>實測終點高程</span><strong>${formatHeight(result.rawEndHeight)} m</strong></div>`,
    `<div><span>閉合差</span><strong>${result.complete ? `${formatMm(result.closureMm)} mm` : '待完成'}</strong></div>`,
    `<div><span>容許值</span><strong>${result.toleranceMm === null ? '尚未指定' : `±${formatMm(result.toleranceMm)} mm`}</strong></div>`,
    `<div><span>檢核</span><strong class="${result.withinTolerance === false ? 'danger-text' : ''}">${result.withinTolerance === true ? '符合輸入容許值' : result.withinTolerance === false ? '超出容許值' : '尚不能判定'}</strong></div>`,
    `<div><span>改正數分配</span><strong>${result.adjusted ? '已完成' : result.withinTolerance === true ? '待補分配資料' : '未執行'}</strong></div>`,
  ];
  $('#resultSummary').innerHTML = `<div class="result-grid">${rows.join('')}</div>`;
  $('#resultTable').innerHTML = resultTable(result);
  const method = result.method === 'distance' ? '按各站測線長度比例' : '按測站數等分';
  $('#resultNote').textContent = [
    ...result.issues,
    result.adjusted ? `已用「${method}」分配閉合差；中間視高程承接所在測站起點的累計改正。` : '',
    result.withinTolerance === false ? '閉合差超限，不執行自動改正；請核對原始讀數與點位。' : '',
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
  revokePhotos();
  const equipmentList = $('#equipmentPhotoList');
  equipmentList.innerHTML = project.equipmentPhotos.map(photo => `<article class="photo-card" data-equipment-photo="${safe(photo.id)}">
    <div class="photo-preview"><img alt="${safe(photo.instrument)} 本案設備照片" data-equipment-image="${safe(photo.id)}"></div>
    <div class="photo-body"><strong>${safe(photo.instrument)}</strong><small>${safe(photo.name)} · ${safe(photo.addedAt.slice(0, 10))}</small>
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
    <div class="photo-body"><strong>${safe(code(photo.pointId))}</strong><small>${safe(photo.name)} · ${safe(photo.addedAt.slice(0, 10))}</small>
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
        await saveProject(structuredClone(project));
        renderPoints();
        await renderMap();
        if (previous) await deleteMedia(previous);
        notify('底圖已匯入；請填來源及截圖日期，再放置點位。');
        if (!project.mapSource) $('#mapSource').focus();
      } catch (error) {
        project.mapMediaId = previous;
        project.points.forEach((item, index) => { item.position = previousPositions[index]; });
        await deleteMedia(id).catch(() => {});
        renderPoints(); await renderMap();
        throw error;
      }
    } else if (usage === 'equipment') {
      project.equipmentPhotos.push({ id: uid(), instrument: project.instrument.trim() || '未填儀器型號', mediaId: id, name: file.name, description: $('#equipmentDescription').value.trim(), addedAt: new Date().toISOString() });
      $('#equipmentDescription').value = '';
      await renderPhotos();
      queueSave(true);
      notify('本案設備照片已保存，並與點位照片分開。');
    } else {
      const pointId = $('#photoPoint').value;
      if (!point(pointId)) { await deleteMedia(id); notify('請先選擇照片對應點位。', true); return; }
      project.photos.push({ id: uid(), pointId, mediaId: id, name: file.name, description: $('#photoDescription').value.trim(), addedAt: new Date().toISOString() });
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
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function exportBackup() {
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    const backup = await makeBackup(structuredClone(project));
    const name = `${(project.number || project.name || '水準測量').replace(/[\\/:*?"<>|]/g, '_')}_水準測量案件_${new Date().toISOString().slice(0, 10)}.json`;
    download(name, new Blob([JSON.stringify(backup)], { type: 'application/json' }));
    notify('完整案件檔已下載；請在目標資料夾核對檔案。');
  } catch (error) { notify(`匯出失敗：${error.message}`, true); }
}

async function importBackup(file) {
  if (!file) return;
  try {
    const contents = await file.text();
    const restored = parseBackup(contents);
    if (!confirm('開啟案件檔會取代目前裝置中的水準測量案件。請先確認已匯出目前案件。是否繼續？')) return;
    clearTimeout(saveTimer);
    await saveQueue;
    await replaceProject(restored.project, restored.media);
    project = restored.project;
    if (normalizeProject()) queueSave(true);
    revokePhotos();
    renderAll();
    notify('案件檔已開啟，請核對點位圖、讀數及照片。');
  } catch (error) { notify(`開啟失敗：${error.message}`, true); }
}

function switchTab(name) {
  for (const tab of ['route', 'measure', 'photos']) {
    $(`#${tab}Panel`).hidden = tab !== name;
    $(`.tabs [data-tab="${tab}"]`).classList.toggle('active', tab === name);
  }
  if (name === 'photos') renderPhotos();
  window.scrollTo(0, 0);
  queueSave(true);
}

function renderAll() {
  $('#caseName').value = project.name || '';
  $('#caseNo').value = project.number || '';
  $('#surveyDate').value = project.date || '';
  $('#observer').value = project.observer || '';
  $('#instrument').value = project.instrument || '';
  $('#datum').value = project.datum || '';
  $('#approxLocation').value = project.approxLocation || '';
  updateGoogleMapsLink();
  $('#startHeight').value = project.route.startHeight || '';
  $('#endHeight').value = project.route.endHeight || '';
  $('#toleranceMm').value = project.route.toleranceMm || '';
  $('#adjustMethod').value = project.route.adjustMethod || 'stations';
  $('#mapSource').value = project.mapSource || '';
  renderPoints(); renderMap(); renderStations(); renderPhotos();
}

function handleRouteInput(event) {
  const mapping = { caseName: 'name', caseNo: 'number', surveyDate: 'date', observer: 'observer', instrument: 'instrument', datum: 'datum', approxLocation: 'approxLocation', mapSource: 'mapSource' };
  const routeMapping = { startHeight: 'startHeight', endHeight: 'endHeight', toleranceMm: 'toleranceMm', adjustMethod: 'adjustMethod' };
  if (mapping[event.target.id]) project[mapping[event.target.id]] = event.target.value;
  else if (routeMapping[event.target.id]) project.route[routeMapping[event.target.id]] = event.target.value;
  else return false;
  if (event.target.id === 'approxLocation') updateGoogleMapsLink();
  renderResult(); queueSave();
  return true;
}

function parsePair(pair) { return pair.split(':').map(Number); }

function handleStationInput(event) {
  const target = event.target;
  if (target.dataset.field !== undefined) {
    const index = Number(target.dataset.station);
    if (target.dataset.field === 'fsPointId' && index + 1 < project.setups.length && project.setups[index + 1].bs !== '' && target.value !== project.setups[index].fsPointId) {
      target.value = project.setups[index].fsPointId;
      notify('下一站已有後視讀數；不可直接改動本轉點。請先移除後續測站再修改。', true);
      return true;
    }
    project.setups[index][target.dataset.field] = target.value;
    if (target.dataset.field === 'fsPointId') renderStations();
    else { renderResult(); queueSave(); }
    if (target.dataset.field === 'fsPointId') queueSave(true);
    return true;
  }
  if (target.dataset.isPoint !== undefined || target.dataset.isValue !== undefined) {
    const [station, sight] = parsePair(target.dataset.isPoint ?? target.dataset.isValue);
    project.setups[station].intermediate[sight][target.dataset.isPoint !== undefined ? 'pointId' : 'value'] = target.value;
    renderResult(); queueSave();
    return true;
  }
  return false;
}

function bindInputs() {
  document.addEventListener('input', event => {
    if (handleRouteInput(event)) return;
    if (handleStationInput(event)) return;
    const target = event.target;
    if (target.id === 'nextPoint') { draftNextPointId = target.value; return; }
    if (target.id === 'nextRole') { draftNextRole = target.value; return; }
    if (target.id === 'nextReading') { draftNextValue = target.value; return; }
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
}

function bindActions() {
  document.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.tab) { switchTab(target.dataset.tab); return; }
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
      if (!point(pointId) || !validReading(value)) { notify('請選擇下一個點位並填入有效讀數。', true); return; }
      if (role === 'FS') { setup.fsPointId = pointId; setup.fs = value; }
      else setup.intermediate.push({ pointId, value });
      draftNextPointId = ''; draftNextValue = '';
      renderStations(); queueSave(true);
      if (role === 'IS') $('#nextPoint')?.focus();
      else if (pointId !== project.route.endId) $('#addStation')?.focus();
      return;
    }
    if (target.dataset.convertIs) {
      const [station, sight] = parsePair(target.dataset.convertIs);
      const setup = project.setups[station];
      if (station !== project.setups.length - 1 || sight !== setup.intermediate.length - 1 || setup.fsPointId) return;
      const reading = setup.intermediate.pop();
      setup.fsPointId = reading.pointId; setup.fs = reading.value;
      renderStations(); queueSave(true); return;
    }
    if (target.dataset.convertFs !== undefined) {
      const index = Number(target.dataset.convertFs);
      if (index !== project.setups.length - 1) return;
      const setup = project.setups[index];
      setup.intermediate.push({ pointId: setup.fsPointId, value: setup.fs });
      setup.fsPointId = ''; setup.fs = '';
      renderStations(); queueSave(true); return;
    }
    if (target.dataset.addIs !== undefined) {
      project.setups[Number(target.dataset.addIs)].intermediate.push({ pointId: '', value: '' });
      renderStations(); queueSave(true); return;
    }
    if (target.dataset.removeIs) {
      const [station, sight] = parsePair(target.dataset.removeIs);
      project.setups[station].intermediate.splice(sight, 1);
      renderStations(); queueSave(true); return;
    }
    if (target.dataset.removeStation !== undefined) {
      const index = Number(target.dataset.removeStation);
      if (confirm(`刪除第 ${index + 1} 站及其後續測站？`)) {
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
  $('#addBM').onclick = () => addPoint('BM');
  $('#addS').onclick = () => addPoint('S');
  $('#addTP').onclick = () => addPoint('TP');
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
  };
  $('#mapFile').onchange = event => { addImage(event.target.files[0], 'map'); event.target.value = ''; };
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
  $('#exportBackup').onclick = exportBackup;
  $('#exportBackup2').onclick = exportBackup;
  $('#importBackup').onchange = event => { importBackup(event.target.files[0]); event.target.value = ''; };
  $('#newCase').onclick = async () => {
    if (!confirm('建立新案件將取代此裝置的目前案件與照片。請先匯出完整案件檔。確定繼續？')) return;
    clearTimeout(saveTimer); await saveQueue;
    project = blankProject();
    await replaceProject(project, []);
    revokePhotos(); renderAll(); switchTab('route'); notify('已建立新案件。');
  };
  $('#printReport').onclick = printReport;
}

function printTable(result) {
  return `<table><thead><tr><th>站</th><th>點號</th><th>後視 BS<br>m</th><th>前視 FS<br>m</th><th>中間視 IS<br>m</th><th>暫算高程<br>m</th><th>改正後高程<br>m</th><th>備註</th></tr></thead><tbody>${resultRows(result)}</tbody></table>`;
}

async function printReport() {
  const result = calculate(project);
  await renderPhotos();
  const image = $('#mapImage');
  const mapWidthMm = image.naturalWidth && image.naturalHeight ? Math.min(180, 125 * image.naturalWidth / image.naturalHeight) : 180;
  const map = project.mapMediaId && mapUrl ? `<div class="print-map" style="width:${mapWidthMm.toFixed(2)}mm"><img src="${mapUrl}" alt="水準測量點位圖">${project.points.filter(item => item.position).map(item => `<span class="map-marker ${safe(item.type.toLowerCase())}" style="left:${item.position.x}%;top:${item.position.y}%"><b>${safe(item.code)}</b></span>`).join('')}</div>` : '<p>未附位置圖</p>';
  const photos = project.photos.map(photo => `<article class="print-photo"><p><strong>點位 ${safe(code(photo.pointId))}</strong>｜${safe(photo.description || point(photo.pointId)?.description || '未填位置說明')}</p><img src="${safe(photoUrls.get(photo.id) || '')}" alt="${safe(code(photo.pointId))} 照片"><small>原檔：${safe(photo.name)}｜加入日期：${safe(photo.addedAt.slice(0, 10))}</small></article>`).join('');
  const referenceEquipmentPhoto = project.instrument.toUpperCase().includes(DEFAULT_INSTRUMENT) ? '<article class="print-photo"><p><strong>PENTAX AP-128 水準儀</strong>｜公司設備參考照，非本案測量當日拍攝。</p><img src="./equipment/pentax-ap-128-source.png" alt="PENTAX AP-128 公司設備參考照"><small>來源：使用者提供之原始照片，原圖保留。</small></article>' : '';
  const equipmentPhotos = project.equipmentPhotos.map(photo => `<article class="print-photo"><p><strong>${safe(photo.instrument)} 本案設備照片</strong>｜${safe(photo.description || '未填設備說明')}</p><img src="${safe(equipmentPhotoUrls.get(photo.id) || '')}" alt="${safe(photo.instrument)} 設備照片"><small>原檔：${safe(photo.name)}｜加入日期：${safe(photo.addedAt.slice(0, 10))}</small></article>`).join('');
  const status = result.withinTolerance === true ? '符合輸入容許值' : result.withinTolerance === false ? '超出容許值，未進行改正' : '尚未完成閉合檢核';
  const report = document.createElement('section');
  report.id = 'printPanel';
  report.innerHTML = `<header class="print-title"><small>水準測量現場紀錄 V${VERSION}</small><h1>${safe(project.name || '水準測量成果')}</h1><p>案件編號：${safe(project.number || '未填')}　測量日期：${safe(project.date || '未填')}　觀測者：${safe(project.observer || '未填')}</p><p>儀器：${safe(project.instrument || '未填')}　高程基準／來源：${safe(project.datum || '未填')}</p></header>
    <h2>一、測線與點位</h2><p>測線：${safe(code(project.route.startId))} → ${safe(code(project.route.endId))}；起點已知高程：${formatHeight(result.startHeight)} m；終點已知高程：${formatHeight(result.endHeight)} m。</p>
    <p>約略地址／路名：${safe(project.approxLocation || '未填')}。底圖來源：${safe(project.mapSource || '未填')}。位置圖僅供示意，不作測線長度量測。</p>${map}
    <table class="point-print-table"><thead><tr><th>點號</th><th>類別</th><th>位置說明</th></tr></thead><tbody>${project.points.map(item => `<tr><td>${safe(item.code)}</td><td>${safe(item.type)}</td><td>${safe(item.description || '—')}</td></tr>`).join('')}</tbody></table>
    <h2>二、原始讀數與高程成果</h2>${printTable(result)}
    <p>後視合計 ${formatHeight(result.sumBS)} m；前視合計 ${formatHeight(result.sumFS)} m；實測終點高程 ${formatHeight(result.rawEndHeight)} m；閉合差 ${formatMm(result.closureMm)} mm。</p>
    <p>人工輸入容許值：${result.toleranceMm === null ? '未指定' : `±${formatMm(result.toleranceMm)} mm`}；檢核：${status}。改正方式：${result.adjusted ? result.method === 'distance' ? '按各站測線長度比例' : '按測站數等分' : '未執行'}。</p>
    ${project.routeHistory?.length ? `<p>終點變更紀錄：${project.routeHistory.map(item => `${safe(item.at.slice(0, 19))} ${safe(item.from)} → ${safe(item.to)}，原因：${safe(item.reason)}`).join('；')}</p>` : ''}
    ${result.issues.length ? `<p class="print-alert">待補／檢核事項：${safe(result.issues.join('；'))}</p>` : ''}
    <p class="print-note">原始讀數與暫算高程保留；改正後高程僅在測線完整且閉合差符合輸入容許值時產生。中間視承接所在測站起點累計改正。本表為單一測線簡易閉合差分配，不代表控制網整體平差。</p>
    <h2>三、點位照片</h2>${photos || '<p>未附點位照片。</p>'}
    <h2>四、設備照片</h2>${referenceEquipmentPhoto}${equipmentPhotos}${referenceEquipmentPhoto || equipmentPhotos ? '' : '<p>未附設備照片。</p>'}
    <footer>列印時間：${safe(new Date().toLocaleString('zh-TW'))}｜來源工具：水準測量現場紀錄 V${VERSION}</footer>`;
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
    $('#saveState').textContent = '已載入本機案件';
    if (migrated) queueSave(true);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  } catch (error) {
    $('#saveState').textContent = '載入失敗';
    notify(`無法載入本機案件：${error.message}`, true);
  }
}

main();
