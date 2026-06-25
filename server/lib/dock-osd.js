/** Dock OSD 分片合并 */

function mergeOsdSnapshot(prev = {}, incoming = {}) {
  if (!incoming || typeof incoming !== 'object') return { ...prev };
  const next = { ...prev };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      next[key] &&
      typeof next[key] === 'object' &&
      !Array.isArray(next[key])
    ) {
      next[key] = mergeOsdSnapshot(next[key], value);
    } else {
      next[key] = value;
    }
  }
  return next;
}

module.exports = {
  mergeOsdSnapshot,
};
