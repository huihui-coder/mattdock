/** 区域树：上下级关系与可见范围 */

function buildRegionTree(regions) {
  const map = new Map(regions.map((r) => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortNodes = (list) => {
    list.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'zh-CN'));
    list.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

function getDescendantIds(regionId, regions) {
  const ids = [regionId];
  const children = regions.filter((r) => r.parentId === regionId);
  for (const child of children) {
    ids.push(...getDescendantIds(child.id, regions));
  }
  return ids;
}

function getVisibleRegionIds(regionId, regions) {
  if (!regionId) return regions.map((r) => r.id);
  const exists = regions.some((r) => r.id === regionId);
  if (!exists) return [regionId];
  return getDescendantIds(regionId, regions);
}

function isDescendantOf(regionId, ancestorId, regions) {
  if (!regionId || !ancestorId) return false;
  if (regionId === ancestorId) return true;
  return getDescendantIds(ancestorId, regions).includes(regionId);
}

function validateParentAssignment(regionId, parentId, regions) {
  if (!parentId) return;
  if (parentId === regionId) throw new Error('不能将区域设为自己的上级');
  if (!regions.some((r) => r.id === parentId)) throw new Error('上级区域不存在');
  if (isDescendantOf(parentId, regionId, regions)) {
    throw new Error('不能将下级区域设为上级（会形成环）');
  }
}

function countUsersByRegion(users, regions) {
  const counts = Object.fromEntries(regions.map((r) => [r.id, 0]));
  for (const user of users) {
    const rid = user.regionId;
    if (rid && counts[rid] != null) counts[rid] += 1;
  }
  return counts;
}

module.exports = {
  buildRegionTree,
  getDescendantIds,
  getVisibleRegionIds,
  isDescendantOf,
  validateParentAssignment,
  countUsersByRegion,
};
