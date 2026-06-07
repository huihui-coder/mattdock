function parseFlightTimeRange(startTime, endTime) {
  return {
    start: startTime ? new Date(startTime).getTime() : 0,
    end: endTime ? new Date(endTime).getTime() : Infinity,
  };
}

function matchesFlightType(record, type) {
  if (!type || type === 'all') return true;
  if (type === 'airport') return record.deviceType === 'drone';
  return record.deviceType === type;
}

function matchesFlightTime(record, start, end) {
  const time = new Date(record.startTime).getTime();
  return time >= start && time <= end;
}

const MAX_FLIGHT_MILEAGE_M = 1_000_000; // 1000 km，超过视为异常数据

function isValidCompletedFlight(record) {
  const mileage = record.totalMileage || 0;
  const duration = record.totalDuration || 0;
  if (mileage <= 0 || duration <= 5) return false;
  if (mileage > MAX_FLIGHT_MILEAGE_M) return false;
  return true;
}

function filterFlightHistory(history, { type, startTime, endTime } = {}) {
  const { start, end } = parseFlightTimeRange(startTime, endTime);
  return history.filter((row) => {
    if (!matchesFlightType(row, type)) return false;
    return matchesFlightTime(row, start, end);
  });
}

function buildFlightStats(history) {
  const valid = history.filter(isValidCompletedFlight);
  return {
    count: valid.length,
    mileage: valid.reduce((acc, cur) => acc + (cur.totalMileage || 0), 0),
    duration: valid.reduce((acc, cur) => acc + (cur.totalDuration || 0), 0),
  };
}

function buildFlightRanking(history) {
  const deviceMap = new Map();
  for (const r of history) {
    if (!isValidCompletedFlight(r)) continue;
    const id = r.deviceId || r.deviceName;
    const name = (r.deviceName || r.deviceId || '').replace(/-无人机$/, '');
    if (!deviceMap.has(id)) {
      deviceMap.set(id, { deviceId: id, deviceName: name, count: 0, mileage: 0, duration: 0 });
    }
    const d = deviceMap.get(id);
    d.count += 1;
    d.mileage += (r.totalMileage || 0);
    d.duration += (r.totalDuration || 0);
  }
  return Array.from(deviceMap.values());
}

function buildDailyDistribution(history, startTime, endTime) {
  const { start, end } = parseFlightTimeRange(startTime, endTime);
  const buckets = new Map();
  const dayMs = 86400000;
  const startDay = new Date(start);
  startDay.setHours(0, 0, 0, 0);
  for (let t = startDay.getTime(); t <= end; t += dayMs) {
    const key = new Date(t).toISOString().slice(0, 10);
    buckets.set(key, { date: key, count: 0, mileage: 0, duration: 0 });
  }
  for (const r of history) {
    if (!isValidCompletedFlight(r)) continue;
    const key = new Date(r.startTime).toISOString().slice(0, 10);
    if (!buckets.has(key)) continue;
    const b = buckets.get(key);
    b.count += 1;
    b.mileage += r.totalMileage || 0;
    b.duration += r.totalDuration || 0;
  }
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function mergeFlightRecords(active, history) {
  return [...active, ...history].sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
}

function paginateRecords(records, page, limit) {
  const total = records.length;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(limit, 10) || 20));
  const startIdx = (pageNum - 1) * pageSize;
  return {
    total,
    page: pageNum,
    limit: pageSize,
    records: records.slice(startIdx, startIdx + pageSize),
  };
}

module.exports = {
  MAX_FLIGHT_MILEAGE_M,
  parseFlightTimeRange,
  matchesFlightType,
  matchesFlightTime,
  isValidCompletedFlight,
  filterFlightHistory,
  buildFlightStats,
  buildFlightRanking,
  buildDailyDistribution,
  mergeFlightRecords,
  paginateRecords,
};
