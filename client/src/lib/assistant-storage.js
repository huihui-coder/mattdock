const STORAGE_KEY = 'haizhu_assistant_messages_v1';
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
}
