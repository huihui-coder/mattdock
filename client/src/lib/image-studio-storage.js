const STORAGE_KEY = 'haizhu_image_studio_v1'
const MAX_TASKS = 40

function stripForStorage(task) {
  if (!task) return null
  return {
    id: task.id,
    status: task.status,
    prompt: task.prompt,
    references: (task.references || []).map((r) => ({
      url: r.url,
      name: r.name || '',
    })),
    model: task.model,
    modelLabel: task.modelLabel,
    resolution: task.resolution,
    aspectRatio: task.aspectRatio,
    count: task.count,
    results: task.results || [],
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    runtimeMs: task.runtimeMs,
    error: task.error,
    isEdit: !!task.isEdit,
  }
}

/** 从 localStorage 恢复；RUNNING 任务保留，由页面挂载后自动续跑 */
function hydrateStoredTasks(list) {
  return list.map((task) => {
    if (task.status !== 'RUNNING') return task
    return {
      ...task,
      runtimeMs: task.startedAt
        ? Date.now() - new Date(task.startedAt).getTime()
        : task.runtimeMs,
    }
  })
}

export function loadImageStudioTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    if (!Array.isArray(list)) return []
    return hydrateStoredTasks(list.filter((t) => t && t.id && t.prompt))
  } catch {
    return []
  }
}

export function saveImageStudioTasks(tasks) {
  let list = tasks.map(stripForStorage).filter(Boolean)
  while (list.length > MAX_TASKS) list = list.slice(-MAX_TASKS)

  const tryWrite = (items) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  }

  try {
    tryWrite(list)
    return true
  } catch (e) {
    if (e?.name !== 'QuotaExceededError') return false
    while (list.length > 5) {
      list = list.slice(Math.ceil(list.length / 4))
      try {
        tryWrite(list)
        return true
      } catch (err) {
        if (err?.name !== 'QuotaExceededError') return false
      }
    }
    return false
  }
}

export function clearImageStudioTasks() {
  localStorage.removeItem(STORAGE_KEY)
}

export async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export async function buildStoredReferences(files) {
  const refs = []
  for (const file of files) {
    if (!file) continue
    refs.push({
      url: await fileToDataUrl(file),
      name: file.name || 'reference.png',
    })
  }
  return refs
}

/** 将持久化的 data URL 还原为 File，供刷新后续跑图生图 */
export async function dataUrlToFile(dataUrl, filename = 'reference.png') {
  if (!dataUrl || typeof dataUrl !== 'string') return null
  if (dataUrl.startsWith('blob:')) return null
  if (!dataUrl.startsWith('data:')) return null
  try {
    const res = await fetch(dataUrl)
    const blob = await res.blob()
    return new File([blob], filename || 'reference.png', { type: blob.type || 'image/png' })
  } catch {
    return null
  }
}
