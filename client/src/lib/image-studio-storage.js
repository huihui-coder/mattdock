const STORAGE_KEY = 'haizhu_image_studio_v1'
const MAX_TASKS = 40

function stripForStorage(task) {
  if (!task || task.status === 'RUNNING') return null
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

export function loadImageStudioTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    if (!Array.isArray(list)) return []
    return list.filter((t) => t && t.id && t.prompt)
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
