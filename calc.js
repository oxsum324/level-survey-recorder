export const VERSION = '0.4.4';

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
  if (n < 0) return '讀數為負值，如為倒尺請勾選「倒尺」。';
  return null;
}

function reading(value, inverted = false) {
  const n = numberOf(value);
  return n === null || n < 0 ? null : inverted ? -n : n;
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
  const setups = project.setups || [];
  const stations = [];
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
      intermediate.push({ pointId: sight.pointId, value, inverted: !!sight.inverted, rawHeight: instrumentHeight - value });
    }
    if (invalidIntermediate) break;
    const distance = numberOf(setup.distance);
    const fsIssue = readingIssue(setup.fs, staffLengthM, i + 1, '前視', points.get(setup.fsPointId)?.code || '未指定');
    if (fsIssue) { issues.push(fsIssue); break; }
    const fs = reading(setup.fs, setup.fsInverted);
    const stationComplete = fs !== null && points.has(setup.fsPointId);
    stations.push({
      index: i + 1, bsPointId: anchor, bs, bsInverted: !!setup.bsInverted, fsPointId: setup.fsPointId, fs, fsInverted: !!setup.fsInverted,
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
  const withinTolerance = complete && compatibleDatum && toleranceMm !== null && toleranceMm >= 0
    ? Math.abs(closureMm) <= toleranceMm + 1e-7 : null;
  const method = route.adjustMethod === 'distance' ? 'distance' : 'stations';
  let adjusted = false;
  if (withinTolerance === true) {
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
    sumBS, sumFS,
  };
}

export function formatHeight(value) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(3);
}

export function formatMm(value) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(2);
}
