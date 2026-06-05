/** 客户端操作审计（导出、下载等纯前端行为） */
export function logClientAudit(action, detail = {}) {
  const token = localStorage.getItem('auth_token') || ''
  if (!token) return
  fetch('/api/audit/client-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
    body: JSON.stringify({ action, detail }),
  }).catch(() => {})
}
