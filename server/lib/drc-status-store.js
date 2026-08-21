/**
 * DRC 链路状态缓存（events · drc_status_notify）
 * drc_state: 0 未连接 / 1 连接中 / 2 已连接
 */

const store = new Map();

const STATE_TEXT = {
  0: '未连接',
  1: '连接中',
  2: '已连接',
};

function setDrcStatus(gatewaySn, data = {}) {
  const id = String(gatewaySn || '').trim();
  if (!id) return null;
  const stateRaw = data.drc_state ?? data.drcState ?? data.state;
  const state = Number(stateRaw);
  const next = {
    gatewaySn: id,
    drcState: Number.isFinite(state) ? state : null,
    drcStateText: STATE_TEXT[state] || '未知',
    result: data.result != null ? Number(data.result) : null,
    updatedAt: new Date().toISOString(),
  };
  store.set(id, next);
  return next;
}

function patchDrcState(gatewaySn, drcState) {
  return setDrcStatus(gatewaySn, { drc_state: drcState, result: 0 });
}

function getDrcStatus(gatewaySn) {
  const id = String(gatewaySn || '').trim();
  if (!id) return null;
  return store.get(id) || null;
}

function isDrcConnected(gatewaySn) {
  return Number(getDrcStatus(gatewaySn)?.drcState) === 2;
}

module.exports = {
  STATE_TEXT,
  setDrcStatus,
  patchDrcState,
  getDrcStatus,
  isDrcConnected,
};
