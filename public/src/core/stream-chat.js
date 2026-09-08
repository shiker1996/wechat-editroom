// src/core/stream-chat.js — 流式对话公共逻辑（editorial / social-editor 共用）
// 负责：流式消息气泡（含思考过程折叠）、NDJSON 逐行消费、按钮忙态与失败态。
// 差异通过参数传入：title（气泡标题）、errorLabel（错误文案前缀）、
// onDone（收到 done 事件后的回调，参数为 event.data，无 data 时为 {}）、
// requireReply（要求本轮必须收到可展示的 assistant 回复）、
// rethrow（失败时是否把错误抛给调用方，true 时仍会在消息气泡中保留失败提示）。
import { toast } from "./ui.js";
import { consumeAgentEvent, scrollToLatest } from "./agent-events.js";
import { securityHeaders } from "./http.js";
// Unified stream contract: tool.requested, assistant.delta.

export async function streamChat({ url, body, messages, button, busyLabel, doneLabel, title, errorLabel, onDone, requireReply = false, rethrow = false, confirmation = "" }) {
  const sm = document.createElement("div");
  sm.className = "editorial-message assistant streaming";
  sm.innerHTML = `<b>${title} · 实时回应</b><details class="thinking-box" hidden><summary>思考过程</summary><div class="thinking-text"></div></details><div class="reply-text markdown-body"></div>`;
  const scrollMessagesToLatest = () => scrollToLatest(messages);
  messages.append(sm);
  scrollMessagesToLatest();
  const st = sm.querySelector(".reply-text");
  const thinkingText = sm.querySelector(".thinking-text");
  const thinkingBox = sm.querySelector(".thinking-box");
  const toolCards = document.createElement("div");
  toolCards.className = "agent-tool-cards";
  sm.insertBefore(toolCards, st);
  button.disabled = true;
  button.textContent = busyLabel;
  let done = null;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await securityHeaders({ confirmation })) },
      body: JSON.stringify(body),
    });
    if (!response.ok) { const d = await response.json().catch(() => ({})); throw new Error(d.error || `HTTP ${response.status}`); }
    if (!response.body) throw new Error("浏览器未收到流式响应");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const consume = (line) => {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      const completed=consumeAgentEvent(event,{toolCards,replyText:st,thinkingBox,thinkingText,errorLabel});
      if(completed)done=completed;
      scrollMessagesToLatest();
    };
    while (true) {
      const { done: end, value } = await reader.read();
      if (end) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() || "";
      for (const line of parts) consume(line);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    if (!done) throw new Error(`${errorLabel}连接提前结束，请重试`);
    if (requireReply && !String(st?.textContent || "").trim()) throw new Error(`${errorLabel}未返回有效回复，请重试`);
    sm.classList.remove("streaming");
    await onDone?.(done === true ? {} : done);
    scrollMessagesToLatest();
    return done;
  } catch (error) {
    sm.classList.remove("streaming");
    sm.classList.add("failed");
    const message = error instanceof Error ? error.message : String(error || `${errorLabel}调用失败`);
    if (st && !sm.querySelector(".stream-error")) {
      const notice = document.createElement("p");
      notice.className = "stream-error";
      notice.textContent = `本轮处理失败：${message}`;
      st.append(notice);
    }
    // 失败提示是在已有气泡中追加的；思考过程或工具卡较长时必须重新滚动，
    // 否则用户仍停留在最后一条工具事件，看起来像“什么也没返回”。
    scrollMessagesToLatest();
    if (rethrow) throw error;
    toast(message, "error");
    return null;
  } finally {
    button.disabled = false;
    button.textContent = doneLabel;
  }
}
