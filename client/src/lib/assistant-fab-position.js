const STORAGE_KEY = 'assistant_fab_position'
export const FAB_EDGE_MARGIN = 20

export function loadFabPosition() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const { left, top } = JSON.parse(raw)
    if (typeof left === 'number' && typeof top === 'number') return { left, top }
  } catch {
    /* ignore */
  }
  return null
}

export function saveFabPosition(pos) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos))
  } catch {
    /* ignore */
  }
}

export function defaultFabPosition(fabWidth = 59, fabHeight = 59) {
  return {
    left: Math.max(FAB_EDGE_MARGIN, window.innerWidth - fabWidth - FAB_EDGE_MARGIN),
    top: Math.max(FAB_EDGE_MARGIN, window.innerHeight - fabHeight - FAB_EDGE_MARGIN),
  }
}

export function snapFabToRightEdge(top, fabWidth, fabHeight) {
  return {
    left: Math.max(FAB_EDGE_MARGIN, window.innerWidth - fabWidth - FAB_EDGE_MARGIN),
    top: Math.max(
      FAB_EDGE_MARGIN,
      Math.min(top, window.innerHeight - fabHeight - FAB_EDGE_MARGIN),
    ),
  }
}
