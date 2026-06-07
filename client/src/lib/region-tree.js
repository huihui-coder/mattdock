/** 前端组织树工具（与 server/lib/region-tree 语义一致） */

export function findTreeNode(nodes, id) {
  for (const node of nodes || []) {
    if (node.id === id) return node
    const found = findTreeNode(node.children, id)
    if (found) return found
  }
  return null
}

export function collectAllIds(nodes, out = []) {
  for (const node of nodes || []) {
    out.push(node.id)
    collectAllIds(node.children, out)
  }
  return out
}

export function collectLeafIds(nodes, out = []) {
  for (const node of nodes || []) {
    if (node.children?.length) collectLeafIds(node.children, out)
    else out.push(node.id)
  }
  return out
}

export function collectLeafIdsUnder(nodes, targetId) {
  const node = findTreeNode(nodes, targetId)
  if (!node) return []
  const leaves = []
  const walk = (n) => {
    if (!n.children?.length) leaves.push(n.id)
    else n.children.forEach(walk)
  }
  walk(node)
  return leaves
}

export function treeHasBranches(nodes) {
  for (const node of nodes || []) {
    if (node.children?.length) return true
    if (treeHasBranches(node.children)) return true
  }
  return false
}

export function filterTree(nodes, query) {
  const q = query.trim().toLowerCase()
  if (!q) return nodes
  const result = []
  for (const node of nodes || []) {
    const selfMatch = (node.name || '').toLowerCase().includes(q)
      || (node.id || '').toLowerCase().includes(q)
    const children = filterTree(node.children, query)
    if (selfMatch || children.length) {
      result.push({ ...node, children: children.length ? children : node.children })
    }
  }
  return result
}
