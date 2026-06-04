const DEFAULT_DOCK_RADIUS_M = Number(process.env.ALERT_DOCK_RADIUS_M) || 150;

function toCoord(loc) {
  if (!loc || loc.latitude == null || loc.longitude == null) return null;
  const lat = Number(loc.latitude);
  const lon = Number(loc.longitude);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  return { lat, lon, height: loc.height ?? 0 };
}

/** 哈弗辛公式，返回米 */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters) {
  if (meters == null || Number.isNaN(meters)) return '未知';
  if (meters >= 1000) return `约 ${(meters / 1000).toFixed(2)} km`;
  return `约 ${Math.round(meters)} m`;
}

/**
 * 计算无人机最后位置与机场的距离上下文
 * @param {object} droneLoc  无人机最后 GPS
 * @param {object} airportLoc 机场 GPS
 * @param {number} dockRadiusM 判定「在机场附近」的半径（米）
 */
function computeLocationDistanceContext(droneLoc, airportLoc, dockRadiusM = DEFAULT_DOCK_RADIUS_M) {
  const drone = toCoord(droneLoc);
  const airport = toCoord(airportLoc);

  if (!drone || !airport) {
    return {
      ok: false,
      summary: '无法计算距机场距离（缺少无人机或机场 GPS 坐标）',
      promptBlock: '【位置与距离】\n缺少完整坐标，无法计算直线距离。请主要依据内外部监控画面判断。',
      webhookLine: '',
    };
  }

  const meters = haversineMeters(drone.lat, drone.lon, airport.lat, airport.lon);
  const distanceText = formatDistance(meters);
  const gpsNearDock = meters <= dockRadiusM;

  const promptBlock = [
    '【位置与距离】',
    `机场坐标：${airport.lat.toFixed(6)}, ${airport.lon.toFixed(6)}`,
    `无人机最后坐标：${drone.lat.toFixed(6)}, ${drone.lon.toFixed(6)}（高度 ${drone.height}m）`,
    `直线距离：${distanceText}（机场半径参考 ${dockRadiusM}m，GPS 是否在范围内：${gpsNearDock ? '是' : '否'}）`,
    '',
    '请结合以上距离与内外部监控画面综合判断：',
    '- 画面显示在机场外部/周边 → 倾向已降落到备降点，说明最后大致位置；',
    '- 画面显示飞机仍在机场内部 → 倾向霍尔传感器/在舱检测异常误报。',
  ].join('\n');

  const webhookLine = `\n> 距机场直线距离：${distanceText}`;

  return {
    ok: true,
    meters,
    distanceText,
    gpsNearDock,
    dockRadiusM,
    drone,
    airport,
    summary: `无人机最后位置距机场直线 ${distanceText}`,
    promptBlock,
    webhookLine,
  };
}

module.exports = {
  DEFAULT_DOCK_RADIUS_M,
  haversineMeters,
  formatDistance,
  computeLocationDistanceContext,
};
