export const VERSION = '0.6.1';

function numberOf(value) {
  const text = String(value ?? '').trim().replace(',', '.');
  if (!/^-?\d+(?:\.\d{1,5})?$/.test(text)) return null;
  const valueNumber = Number(text);
  return Number.isFinite(valueNumber) ? valueNumber : null;
}

export function readingIssue(value, length, station, role, pointCode) {
  const n = numberOf(value);
  if (n === null) return null;
  if (Math.abs(n) > length) return `第 ${station} 站 ${role} ${pointCode} 點讀數 ${n} m 超過尺長 ${length} m，請確認是否誤以 mm 輸入。`;
  if (n < 0) return `第 ${station} 站 ${pointCode} 點（${role}）讀數為負值，如為倒尺請勾選「倒尺」。`;
  return null;
}

function reading(value, inverted = false) {
  const n = numberOf(value);
  return n === null || n < 0 ? null : inverted ? -n : n;
}

const cleanZero = value => Math.abs(value) < 1e-9 ? 0 : value;

export function suggestMmCorrection(value, staffLengthM) {
  const n = numberOf(value);
  const corrected = n === null ? null : n / 1000;
  return n !== null && n > staffLengthM && corrected >= 0 && corrected <= staffLengthM
    ? corrected.toFixed(3) : null;
}

export function analyzeThreeWire(middle, upperValue, lowerValue, staffLengthM = 5, multiplier = 100, toleranceMm = null, inverted = false) {
  const entered = value => String(value ?? '').trim() !== '';
  if (!entered(upperValue) && !entered(lowerValue)) return null;
  const upper = numberOf(upperValue);
  const lower = numberOf(lowerValue);
  if (upper === null || lower === null) return { issue: '上絲與下絲須同時填入有效讀數。' };
  if (upper < 0 || lower < 0 || upper > staffLengthM || lower > staffLengthM) return { issue: '上絲或下絲讀數超出水準尺範圍。' };
  if (!inverted && upper <= lower) return { issue: '正立尺的上絲讀數須大於下絲讀數，請核對尺面方向。' };
  if (inverted && upper >= lower) return { issue: '倒尺的上絲讀數須小於下絲讀數，請核對尺面方向。' };
  const middleDiffMm = (Math.abs(middle) - (upper + lower) / 2) * 1000;
  return {
    upper, lower, middleDiffMm,
    distanceM: multiplier !== null && multiplier > 0 ? multiplier * Math.abs(upper - lower) : null,
    exceedsTolerance: toleranceMm !== null && toleranceMm >= 0 ? Math.abs(middleDiffMm) > toleranceMm + 1e-7 : null,
  };
}

export function formulaToleranceMm(cValue, setups) {
  const c = numberOf(cValue);
  if (c === null || c <= 0) return { issue: '請輸入大於零的 C 值（mm）。' };
  if (!Array.isArray(setups) || !setups.length) return { issue: '尚無測站長度，無法計算容許值。' };
  const lengths = setups.map(setup => numberOf(setup.distance));
  if (lengths.some(length => length === null || length <= 0)) return { issue: '每站須先填入大於零的測線長度，才能使用公式。' };
  const lengthKm = lengths.reduce((sum, length) => sum + length, 0) / 1000;
  return { lengthKm, valueMm: Math.round(c * Math.sqrt(lengthKm) * 100) / 100 };
}

export function twoPegCheck(record) {
  const values = ['a1', 'b1', 'a2', 'b2'].map(key => numberOf(record?.[key]));
  const distanceM = numberOf(record?.distanceM);
  if (values.some(value => value === null) || distanceM === null) return null;
  if (distanceM <= 0) return { issue: '兩樁距離須大於零。' };
  const errorMm = ((values[2] - values[3]) - (values[0] - values[1])) * 1000;
  return { errorMm, per100mMm: errorMm * 100 / distanceM };
}

function riseFallCheck(stations, startHeight, complete, sumBS, sumFS, rawEndHeight) {
  let height = startHeight;
  let sumRise = 0;
  let sumFall = 0;
  let maxDiffMm = 0;
  let compared = 0;
  for (const station of stations) {
    let previousReading = station.bs;
    for (const sight of station.intermediate) {
      const difference = previousReading - sight.value;
      if (difference >= 0) sumRise += difference;
      else sumFall -= difference;
      height += difference;
      maxDiffMm = Math.max(maxDiffMm, Math.abs(height - sight.rawHeight) * 1000);
      compared++;
      previousReading = sight.value;
    }
    if (station.complete) {
      const difference = previousReading - station.fs;
      if (difference >= 0) sumRise += difference;
      else sumFall -= difference;
      height += difference;
      maxDiffMm = Math.max(maxDiffMm, Math.abs(height - station.rawEndHeight) * 1000);
      compared++;
    }
  }
  const delta = complete ? rawEndHeight - startHeight : null;
  const ok = complete ? maxDiffMm <= 0.5 + 1e-7
    && Math.abs(sumRise - sumFall - delta) <= 0.0005 + 1e-9
    && Math.abs(sumBS - sumFS - delta) <= 0.0005 + 1e-9 : null;
  return { sumRise, sumFall, ok, maxDiffMm: compared ? maxDiffMm : null, endHeight: complete ? height : null };
}

export function calculate(project) {
  const issues = [];
  const points = new Map((project.points || []).map(point => [point.id, point]));
  const route = project.route || {};
  const startHeight = numberOf(route.startHeight);
  const endHeight = route.startId === route.endId ? startHeight : numberOf(route.endHeight);
  const compatibleDatum = route.startId === route.endId || route.startHeightKind !== 'assumed';
  const toleranceMm = numberOf(route.toleranceMm);
  const staffLengthM = route.staffLengthM === undefined ? 5 : numberOf(route.staffLengthM);
  const stadiaConstantK = route.stadiaConstantK === undefined ? 100 : numberOf(route.stadiaConstantK);
  const threeWireToleranceMm = numberOf(route.threeWireToleranceMm);
  const setups = project.setups || [];
  const stations = [];
  const threeWireAlerts = [];
  let anchor = route.startId;
  let height = startHeight;
  let sumBS = 0;
  let sumFS = 0;

  if (!points.has(route.startId) || !points.has(route.endId)) issues.push('請指定已建立的起點及終點。');
  if (startHeight === null) issues.push('請輸入起點的已知高程。');
  if (route.startId !== route.endId && endHeight === null) issues.push('不同終點須輸入終點的已知高程，才能檢核閉合差。');
  if (!compatibleDatum) issues.push('起點仍標為假設高程；與另一已知 BM 閉合前，須確認兩端高程基準相同並改為已知高程。');
  if (toleranceMm !== null && toleranceMm < 0) issues.push('容許閉合差須為零或正值。');
  if (staffLengthM === null || staffLengthM <= 0) issues.push('水準尺長度須為大於零的數值。');

  for (let i = 0; i < setups.length; i++) {
    const setup = setups[i];
    const label = `第 ${i + 1} 站`;
    if (setup.bsPointId !== anchor) {
      issues.push(`${label}後視點須為${i === 0 ? '起點' : '上一站前視點'}。`);
      break;
    }
    if (staffLengthM === null || staffLengthM <= 0) break;
    const bsIssue = readingIssue(setup.bs, staffLengthM, i + 1, '後視', points.get(anchor)?.code || '未指定');
    if (bsIssue) { issues.push(bsIssue); break; }
    const bs = reading(setup.bs, setup.bsInverted);
    if (bs === null) {
      issues.push(`${label}的後視讀數尚未填寫。`);
      break;
    }
    if (height === null) break;
    const instrumentHeight = height + bs;
    const bsWire = analyzeThreeWire(bs, setup.bsUpper, setup.bsLower, staffLengthM, stadiaConstantK, threeWireToleranceMm, !!setup.bsInverted);
    if (bsWire?.issue || bsWire?.exceedsTolerance) threeWireAlerts.push(`${label}後視：${bsWire.issue || `三絲中值差 ${formatMm(bsWire.middleDiffMm)} mm 超過輸入容許值 ${formatMm(threeWireToleranceMm)} mm。`}`);
    const intermediate = [];
    let invalidIntermediate = false;
    for (const sight of setup.intermediate || []) {
      const sightIssue = readingIssue(sight.value, staffLengthM, i + 1, '中間視', points.get(sight.pointId)?.code || '未指定');
      if (sightIssue) { issues.push(sightIssue); invalidIntermediate = true; break; }
      const value = reading(sight.value, sight.inverted);
      if (!points.has(sight.pointId) || value === null) {
        issues.push(`${label}有未填齊的中間視。`);
        invalidIntermediate = true;
        break;
      }
      const wire = analyzeThreeWire(value, sight.upper, sight.lower, staffLengthM, stadiaConstantK, threeWireToleranceMm, !!sight.inverted);
      if (wire?.issue || wire?.exceedsTolerance) threeWireAlerts.push(`${label}中間視 ${points.get(sight.pointId)?.code || ''}：${wire.issue || `三絲中值差 ${formatMm(wire.middleDiffMm)} mm 超過輸入容許值 ${formatMm(threeWireToleranceMm)} mm。`}`);
      intermediate.push({ pointId: sight.pointId, value, inverted: !!sight.inverted, wire, rawHeight: instrumentHeight - value });
    }
    if (invalidIntermediate) break;
    const distance = numberOf(setup.distance);
    const fsIssue = readingIssue(setup.fs, staffLengthM, i + 1, '前視', points.get(setup.fsPointId)?.code || '未指定');
    if (fsIssue) { issues.push(fsIssue); break; }
    const fs = reading(setup.fs, setup.fsInverted);
    const stationComplete = fs !== null && points.has(setup.fsPointId);
    const fsWire = fs !== null ? analyzeThreeWire(fs, setup.fsUpper, setup.fsLower, staffLengthM, stadiaConstantK, threeWireToleranceMm, !!setup.fsInverted) : null;
    if (fsWire?.issue || fsWire?.exceedsTolerance) threeWireAlerts.push(`${label}前視：${fsWire.issue || `三絲中值差 ${formatMm(fsWire.middleDiffMm)} mm 超過輸入容許值 ${formatMm(threeWireToleranceMm)} mm。`}`);
    const bsDistanceM = bsWire?.distanceM ?? null;
    const fsDistanceM = fsWire?.distanceM ?? null;
    stations.push({
      index: i + 1, bsPointId: anchor, bs, bsInverted: !!setup.bsInverted, fsPointId: setup.fsPointId, fs, fsInverted: !!setup.fsInverted,
      bsWire, fsWire, bsDistanceM, fsDistanceM,
      distanceDifferenceM: bsDistanceM !== null && fsDistanceM !== null ? cleanZero(bsDistanceM - fsDistanceM) : null,
      instrumentHeight, intermediate, rawStartHeight: height,
      rawEndHeight: stationComplete ? instrumentHeight - fs : null, distance,
      complete: stationComplete,
    });
    sumBS += bs;
    if (!stationComplete) {
      issues.push(`${label}的前視讀數及前視點尚未填齊。`);
      break;
    }
    sumFS += fs;
    height = instrumentHeight - fs;
    anchor = setup.fsPointId;
  }

  const complete = points.has(route.startId) && points.has(route.endId) && startHeight !== null && setups.length > 0 && stations.length === setups.length && stations.every(station => station.complete) && anchor === route.endId && endHeight !== null;
  if (setups.length && stations.length === setups.length && stations.every(station => station.complete) && anchor !== route.endId) issues.push('最後前視點尚未到達預定終點。');
  const closureMm = complete ? (height - endHeight) * 1000 : null;
  const riseFall = riseFallCheck(stations, startHeight, complete, sumBS, sumFS, complete ? height : null);
  if (riseFall.ok === false) issues.push('高差法與視準軸高法計算不一致，請核對原始讀數。');
  const sumBsDistanceM = stations.reduce((sum, station) => sum + (station.bsDistanceM || 0), 0);
  const sumFsDistanceM = stations.reduce((sum, station) => sum + (station.fsDistanceM || 0), 0);
  if (stations.some(station => station.bsWire || station.fsWire) && (stadiaConstantK === null || stadiaConstantK <= 0)) threeWireAlerts.push('視距乘常數 K 須為大於零的數值。');
  const withinTolerance = complete && compatibleDatum && toleranceMm !== null && toleranceMm >= 0
    ? Math.abs(closureMm) <= toleranceMm + 1e-7 : null;
  const method = route.adjustMethod === 'distance' ? 'distance' : 'stations';
  let adjusted = false;
  if (withinTolerance === true && riseFall.ok !== false) {
    if (method === 'distance' && stations.some(station => station.distance === null || station.distance <= 0)) {
      issues.push('按距離分配改正數時，每站須填入大於零的測線長度。');
    } else {
      const totalWeight = method === 'distance'
        ? stations.reduce((sum, station) => sum + station.distance, 0) : stations.length;
      let cumulative = 0;
      for (const station of stations) {
        const weight = method === 'distance' ? station.distance : 1;
        const correction = -closureMm / 1000 * weight / totalWeight;
        station.correction = correction;
        station.adjustedStartHeight = station.rawStartHeight + cumulative;
        station.adjustedIntermediate = station.intermediate.map(sight => ({
          ...sight, adjustedHeight: sight.rawHeight + cumulative,
        }));
        cumulative += correction;
        station.adjustedEndHeight = station.rawEndHeight + cumulative;
      }
      adjusted = true;
    }
  }
  return {
    issues, stations, complete, adjusted, method, startHeight, endHeight,
    rawEndHeight: complete ? height : null, closureMm, toleranceMm, withinTolerance,
    sumBS, sumFS, riseFallCheck: riseFall, threeWireAlerts,
    sumBsDistanceM, sumFsDistanceM, sumDistanceDifferenceM: cleanZero(sumBsDistanceM - sumFsDistanceM),
  };
}

export function formatHeight(value) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(3);
}

export function formatMm(value) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(2);
}

export function formatObservationTime(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
}

function csvCell(value, numeric = false) {
  let text = String(value ?? '');
  if (!numeric && /^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildSummaryCsv(project, result = calculate(project)) {
  const points = new Map((project.points || []).map(point => [point.id, point]));
  const pointCode = id => points.get(id)?.code || '';
  const pointType = id => points.get(id)?.type || '';
  const rows = [];
  const row = values => rows.push(values.map(value => csvCell(value)).join(','));
  row(['案件名稱', project.name || '']);
  row(['案件編號', project.number || '']);
  row(['測量日期', project.date || '']);
  row(['起點', pointCode(project.route?.startId)]);
  row(['終點', pointCode(project.route?.endId)]);
  row(['容許閉合差（mm）', result.toleranceMm === null ? '未指定' : formatMm(result.toleranceMm)]);
  row(['容許值依據', project.route?.toleranceBasis || '']);
  row(['閉合差（mm）', result.complete ? formatMm(result.closureMm) : '未完成']);
  row(['是否已改正', result.adjusted ? '是' : '否']);
  rows.push('');
  row(['測站', '點號', '點位類別', '後視（m）', '中間視（m）', '前視（m）', '倒尺註記', '視準軸高（m）', '原始高程（m）', '改正數（mm）', '改正後高程（m）', '測線長度（m）', '觀測時間', '備註']);
  const readingText = value => value === null ? '' : formatHeight(Math.abs(value));
  const correctionText = (raw, adjusted) => result.adjusted && adjusted !== null && adjusted !== undefined ? formatMm((adjusted - raw) * 1000) : '';
  const addReading = (station, id, role, value, inverted, rawHeight, adjustedHeight, distance, observedAt, note) => {
    const cells = [
      station.index, pointCode(id), pointType(id), role === 'BS' ? readingText(value) : '',
      role === 'IS' ? readingText(value) : '', role === 'FS' ? readingText(value) : '',
      inverted ? `${role} 倒尺` : '', formatHeight(station.instrumentHeight), formatHeight(rawHeight),
      correctionText(rawHeight, adjustedHeight), result.adjusted ? formatHeight(adjustedHeight) : '',
      distance === null || distance === undefined ? '' : formatHeight(distance), formatObservationTime(observedAt), note,
    ];
    rows.push(cells.map((cell, index) => csvCell(cell, [0, 3, 4, 5, 7, 8, 9, 10, 11].includes(index))).join(','));
  };
  for (const station of result.stations) {
    addReading(station, station.bsPointId, 'BS', station.bs, station.bsInverted, station.rawStartHeight, station.adjustedStartHeight, null, project.setups[station.index - 1]?.bsAt, '測站起點後視');
    station.intermediate.forEach((sight, index) => addReading(station, sight.pointId, 'IS', sight.value, sight.inverted,
      sight.rawHeight, station.adjustedIntermediate?.[index]?.adjustedHeight, null, project.setups[station.index - 1]?.intermediate?.[index]?.at, '中間視'));
    if (station.complete) addReading(station, station.fsPointId, 'FS', station.fs, station.fsInverted,
      station.rawEndHeight, station.adjustedEndHeight, station.distance, project.setups[station.index - 1]?.fsAt, '本站前視');
  }
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}
