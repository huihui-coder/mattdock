/**
 * Dock3 机载 AI 状态缓存（来自 drc/up · drc_ai_info_push）
 * 官方字段：ai_model_list[{index, signed_name}]、selected_ai_model.index、identify_on
 */

const store = new Map();

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeModelItem(item, fallbackIndex) {
  if (typeof item === 'number') {
    return { index: item, name: `模型 ${item}` };
  }
  if (typeof item === 'string') {
    return { index: fallbackIndex, name: item };
  }
  if (!item || typeof item !== 'object') {
    return { index: fallbackIndex, name: `模型 ${fallbackIndex}` };
  }
  const index = Number(
    item.index ?? item.model_index ?? item.ai_model_index ?? fallbackIndex,
  );
  const name = String(
    item.signed_name
      || item.name
      || item.model_name
      || item.label
      || item.title
      || `模型 ${Number.isFinite(index) ? index : fallbackIndex}`,
  );
  return {
    index: Number.isFinite(index) ? index : fallbackIndex,
    name,
    signedName: item.signed_name != null ? String(item.signed_name) : name,
  };
}

/** 官方 + 现场兼容字段 */
function normalizeAiInfoPush(data = {}) {
  const list = asArray(
    data.ai_model_list
      || data.model_list
      || data.models
      || data.ai_models
      || data.list,
  );
  const models = list.map((item, i) => normalizeModelItem(item, i));

  const selectedObj = data.selected_ai_model || data.selectedAiModel || null;
  const selectedRaw =
    selectedObj?.index
    ?? data.selected_index
    ?? data.ai_model_index
    ?? data.current_index
    ?? data.index
    ?? null;
  const selectedIndex =
    selectedRaw === null || selectedRaw === undefined
      ? null
      : Number(selectedRaw);

  const identifyRaw = data.identify_on ?? data.ai_identify_on ?? null;
  const spotlightZoomOn = data.spotlight_zoom_on ?? data.spotlight_on ?? null;
  const aiSpotlight = data.ai_spotlight_zoom || null;

  return {
    models,
    selectedIndex: Number.isFinite(selectedIndex) ? selectedIndex : null,
    identifyOn: (() => {
      if (identifyRaw === null || identifyRaw === undefined) return null;
      return Number(identifyRaw) === 1 ? 1 : 0;
    })(),
    spotlightOn: spotlightZoomOn == null ? null : Number(spotlightZoomOn),
    spotlightState: aiSpotlight?.state != null ? Number(aiSpotlight.state) : null,
    spotlightStateReason: aiSpotlight?.state_reason != null
      ? Number(aiSpotlight.state_reason)
      : null,
    scoreMode: selectedObj?.score_mode ?? data.score_mode ?? null,
    score: selectedObj?.score ?? data.score ?? null,
    labels: asArray(selectedObj?.labels).map((l, i) => ({
      index: Number(l?.index ?? i),
      name: String(l?.name || `标签 ${i}`),
    })),
    raw: data,
    updatedAt: new Date().toISOString(),
  };
}

function setAiInfo(gatewaySn, pushData) {
  const id = String(gatewaySn || '').trim();
  if (!id) return null;
  const normalized = normalizeAiInfoPush(pushData || {});
  const prev = store.get(id) || {};
  const next = {
    gatewaySn: id,
    ...normalized,
    selectedIndex:
      normalized.selectedIndex != null
        ? normalized.selectedIndex
        : (prev.selectedIndex ?? null),
    identifyOn:
      normalized.identifyOn != null
        ? normalized.identifyOn
        : (prev.identifyOn ?? null),
    models: normalized.models.length ? normalized.models : (prev.models || []),
    // 本地跟随态：推送有 spotlight 时以设备为准
    spotlightTracking:
      normalized.spotlightState === 3
        ? true
        : (normalized.spotlightOn === 0
          ? false
          : (prev.spotlightTracking || false)),
    spotlightTargetIndex: prev.spotlightTargetIndex ?? null,
  };
  store.set(id, next);
  return next;
}

function ensureEntry(gatewaySn) {
  const id = String(gatewaySn || '').trim();
  if (!id) return null;
  if (!store.has(id)) {
    store.set(id, {
      gatewaySn: id,
      models: [],
      selectedIndex: null,
      identifyOn: null,
      spotlightOn: null,
      spotlightTracking: false,
      spotlightTargetIndex: null,
      scoreMode: null,
      score: null,
      labels: [],
      raw: null,
      updatedAt: new Date().toISOString(),
    });
  }
  return store.get(id);
}

function patchSelectedIndex(gatewaySn, index) {
  const prev = ensureEntry(gatewaySn);
  if (!prev) return null;
  const next = {
    ...prev,
    selectedIndex: Number(index),
    updatedAt: new Date().toISOString(),
  };
  store.set(prev.gatewaySn, next);
  return next;
}

function patchIdentifyOn(gatewaySn, on) {
  const prev = ensureEntry(gatewaySn);
  if (!prev) return null;
  const next = {
    ...prev,
    identifyOn: on ? 1 : 0,
    spotlightTracking: on ? (prev.spotlightTracking || false) : false,
    spotlightTargetIndex: on ? (prev.spotlightTargetIndex ?? null) : null,
    updatedAt: new Date().toISOString(),
  };
  store.set(prev.gatewaySn, next);
  return next;
}

function patchSpotlightTrack(gatewaySn, { tracking, targetIndex } = {}) {
  const prev = ensureEntry(gatewaySn);
  if (!prev) return null;
  const next = {
    ...prev,
    spotlightTracking: !!tracking,
    spotlightTargetIndex:
      tracking && Number.isInteger(Number(targetIndex))
        ? Number(targetIndex)
        : null,
    updatedAt: new Date().toISOString(),
  };
  store.set(prev.gatewaySn, next);
  return next;
}

function getAiInfo(gatewaySn) {
  const id = String(gatewaySn || '').trim();
  if (!id) return null;
  return store.get(id) || null;
}

module.exports = {
  normalizeAiInfoPush,
  setAiInfo,
  patchSelectedIndex,
  patchIdentifyOn,
  patchSpotlightTrack,
  getAiInfo,
};
