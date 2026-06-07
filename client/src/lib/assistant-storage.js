const STORAGE_KEY = 'haizhu_assistant_messages_v1';
const READ_CURSOR_KEY = 'haizhu_assistant_read_cursor_v1';
const MAX_MESSAGES = 40;

export function loadAssistantMessages() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveAssistantMessages(messages) {
  const trimmed = messages.slice(-MAX_MESSAGES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  return trimmed;
}

export function clearAssistantMessages() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(READ_CURSOR_KEY);
}

/** 已读游标：messages[0..cursor) 视为已读 */
export function loadReadCursor(messageCount = 0) {
  try {
    const raw = localStorage.getItem(READ_CURSOR_KEY);
    if (raw === null) return messageCount;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(n, messageCount)) : messageCount;
  } catch {
    return messageCount;
  }
}

export function saveReadCursor(index) {
  localStorage.setItem(READ_CURSOR_KEY, String(Math.max(0, index)));
}

export function countUnreadAssistantMessages(messages, readCursor) {
  const cursor = Math.max(0, Math.min(readCursor, messages.length));
  return messages.slice(cursor).filter((m) => {
    if (m.role !== 'assistant') return false;
    return Boolean(String(m.content || '').trim()) || m.failed;
  }).length;
}
