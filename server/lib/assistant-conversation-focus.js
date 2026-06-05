/** 识别「怎么处理 / 它 / 这个」等追问，避免模型跳到其他设备或旧告警 */

const FOLLOWUP_RE =
  /^(要?怎么(办|处理|做|解决)|如何(处理|办|解决)|然后呢|接着|下一步|怎么办|怎么处理|该如何|有什么建议|如何处理)/;

const PRONOUN_RE = /^(它|这个|那个|这事|此设备|该设备|这台|这部)/;

const SHORT_VAGUE_RE = /^.{0,16}$/;

/**
 * @param {Array<{role:string,content:string}>} history 不含本轮用户消息
 * @param {string} [currentPrompt] 本轮用户输入（history 里还没有这条）
 */
function deriveConversationFocus(history, currentPrompt = '') {
  const lastAssistant = [...(history || [])]
    .reverse()
    .find((m) => m.role === 'assistant' && String(m.content || '').trim());

  if (!lastAssistant) return null;

  const q = String(currentPrompt || '').trim();
  if (!q) return null;

  const isFollowUp =
    FOLLOWUP_RE.test(q) ||
    PRONOUN_RE.test(q) ||
    (SHORT_VAGUE_RE.test(q) && /怎么|如何|处理|办|建议/.test(q));

  if (!isFollowUp) return null;

  const prevUser = [...(history || [])]
    .reverse()
    .find((m) => m.role === 'user' && String(m.content || '').trim());

  return {
    isFollowUp: true,
    lastUserQuestion: q,
    previousUserQuestion: prevUser ? String(prevUser.content).trim() : '',
    lastAssistantReply: String(lastAssistant.content).trim().slice(0, 3000),
  };
}

function formatFocusForPrompt(focus) {
  if (!focus?.isFollowUp) return '';
  return [
    '【对话焦点 · 追问必守】',
    '用户当前这句话是在追问**你上一轮回复**中的设备与问题，禁止改答其他设备、其他告警或更早对话里的内容。',
    `用户本轮原话：${focus.lastUserQuestion}`,
    focus.previousUserQuestion
      ? `用户上一轮提问：${focus.previousUserQuestion}`
      : '',
    '你上一轮回复（须以此为处置对象）：',
    focus.lastAssistantReply,
    '---',
    '请仅针对上一轮中写明的设备名称、告警类型（如机械臂 Y 轴电机报警、电池不足等）给出处理步骤；若上一轮写了多条，以最后一条或用户最关心的那条为准。',
  ].join('\n');
}

/**
 * @param {string} prompt
 * @param {{ isFollowUp: boolean } | null} focus
 */
function augmentUserPrompt(prompt, focus) {
  const text = String(prompt || '').trim();
  if (!focus?.isFollowUp) return text;
  return `【系统提示：以下为追问，请严格承接上一轮对话中的设备与告警作答】\n\n${text}`;
}

module.exports = {
  deriveConversationFocus,
  formatFocusForPrompt,
  augmentUserPrompt,
};
