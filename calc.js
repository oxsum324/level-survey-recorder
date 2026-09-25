export const VERSION = '0.1.0';

function numberOf(value) {
  const text = String(value ?? '').trim().replace(',', '.');
  if (!/^-?\d+(?:\.\d{1,5})?$/.test(text)) return null;
  const valueNumber = Number(text);
  return Number.isFinite(valueNumber) ? valueNumber : null;
}

function reading(value) {
  const n = numberOf(value);
  return n !== null && n >= 0 ? n : null;
}

export function calculate(project) {
  const issues = [];
  const points = new Map((project.points || []).map(point => [point.id, point]));
  const route = project.route || {};
  const startHeight = numberOf(route.startHeight);
  const endHeight = route.startId === route.endId ? startHeight : numberOf(route.endHeight);
  const toleranceMm = numberOf(route.toleranceMm);
  const setups = project.setups || [];
  const stations = [];
  let anchor = route.startId;
  let height = startHeight;
  let sumBS = 0;
  let sumFS = 0;

  if (!points.has(route.startId) || !points.has(route.endId)) issues.push('請指定已建立的起點及終點。');
  if (startHeight === null) issues.push('請輸入起點的已知高程。');
  if (route.startId !== route.endId && endHeight === null) issues.push('不同終點須輸入終點的已知高程，才能檢核閉合差。');
  if (toleranceMm !== null && toleranceMm < 0) issues.push('容許閉合差須為零或正值。');

  for (let i = 0; i < setups.length; i++) {
    const setup = setups[i];
    const label = `第 ${i + 1} 站`;
    if (setup.bsPointId !== anchor) {
      issues.push(`${label}後視點須為${i === 0 ? '起點' : '上一站前視點'}。`);
      break;
    }
    const bs = reading(setup.bs);
    if (bs === null) {
      issues.push(`${label}的後視讀數尚未填寫。`);
      break;
    }
    if (height === null) break;
    const instrumentHeight = height + bs;
    const intermediate = [];
    let invalidIntermediate = false;
    for (const sight of setup.intermediate || []) {
      const value = reading(sight.value);
      if (!points.has(sight.pointId) || value === null) {
        issues.push(`${label}有未填齊的中間視。`);
        invalidIntermediate = true;
        break;
      }
      intermediate.push({ pointId: sight.pointId, value, rawHeight: instrumentHeight - value });
    }
    if (invalidIntermediate) break;
    const distance = numberOf(setup.distance);
    const fs = reading(setup.fs);
    const stationComplete = fs !== null && points.has(setup.fsPointId);
    stations.push({
      index: i + 1, bsPointId: anchor, bs, fsPointId: setup.fsPointId, fs,
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
  const withinTolerance = complete && toleranceMm !== null && toleranceMm >= 0
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
