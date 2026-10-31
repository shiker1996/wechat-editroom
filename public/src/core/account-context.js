import { request } from "./http.js";
import { escapeHtml } from "./ui.js";
import { streamChat } from "./stream-chat.js";

const LIST_FIELDS = new Set(["contentPillars", "voiceGuardrails"]);
const DEFAULT_EDITORIAL_CATEGORIES = [
  ["产品与技术动态", "产品发布、技术变化与具体技术事件"],
  ["大厂与商业战略", "大厂业务布局、竞争、合作、收购与经营决策"],
  ["职场与组织变化", "岗位、薪酬、裁员、管理制度和工作方式变化"],
  ["开源项目与开发者生态", "开源项目、开发者社区和生态变化"],
  ["行业趋势与市场变化", "跨主体或跨时间的行业发展、市场结构与采用信号"],
  ["政策与公共议题", "监管、公共治理及对目标读者有明确影响的公共事件"],
];

function valueOf(context, field) {
  const value = field === "editorialCategories" && !Array.isArray(context?.[field])
    ? DEFAULT_EDITORIAL_CATEGORIES.map(([name, description]) => ({ name, description }))
    : context?.[field];
  if (field === "editorialCategories" && Array.isArray(value)) return value.map((item) => `${typeof item === "string" ? item : item.name || ""} | ${typeof item === "string" ? item : item.description || ""}`).join("\n");
  if (field === "scoring") return JSON.stringify(value && typeof value === "object" ? value : {}, null, 2);
  return Array.isArray(value) ? value.join("\n") : String(value || "");
}

export function accountContextFormMarkup(context = {}, { compact = false } = {}) {
  const field = (name, label, options = {}) => {
    const value = valueOf(context, name);
    const required = options.required ? " required" : "";
    const wide = options.wide ? " wide" : "";
    const placeholder = options.placeholder ? ` placeholder="${escapeHtml(options.placeholder)}"` : "";
    const hint = options.hint ? `<small>${escapeHtml(options.hint)}</small>` : "";
    if (options.textarea) return `<label class="account-context-field${wide}"><span>${escapeHtml(label)}${options.required ? " *" : ""}</span><textarea name="${name}" rows="${options.rows || (compact ? 3 : 4)}"${required}${placeholder}>${escapeHtml(value)}</textarea>${hint}</label>`;
    return `<label class="account-context-field${wide}"><span>${escapeHtml(label)}${options.required ? " *" : ""}</span><input name="${name}" value="${escapeHtml(value)}"${required}${placeholder}>${hint}</label>`;
  };
  return `<form class="account-context-form${compact ? " is-compact" : ""}" data-account-context-form>
    <details class="account-context-ai-chat">
      <summary><span><b>AI 对话助手</b><small>按阶段完善账号画像，可查看实时思考过程和工具调用</small></span><i>展开对话</i></summary>
      <div class="account-context-chat-log editorial-messages" data-account-context-chat-log><div class="editorial-message assistant"><b>AI 画像助手</b><p>告诉我你希望这个公众号写给谁、关注什么，或直接说“根据名称和简介帮我起草”。我会按阶段逐步更新表单。</p></div></div>
      <div class="account-context-chat-compose"><textarea data-account-context-chat-input rows="2" placeholder="例如：读者主要是后端开发者，我希望更关注国内大厂变化和能落地的工程经验"></textarea><button type="button" class="outline-button" data-account-context-assist>发送</button></div>
      <p class="account-context-chat-note">AI 只会预填表单草案，不会改写公众号名称和简介，也不会自动保存。思考过程和工具调用会实时显示；请检查后再点击页面底部的保存按钮。</p>
    </details>
    <div class="account-context-form-grid">
      ${field("name", "公众号名称", { required: true, placeholder: "例如：见字" })}
      ${field("description", "一句话简介", { required: true, placeholder: "你希望读者如何理解这个账号？" })}
      ${field("readerProfile", "核心读者", { required: true, wide: true, textarea: true, placeholder: "例如：一线程序员、技术负责人和关注 AI 工具的产品经理", hint: "写清楚读者是谁，以及他们在意什么。" })}
      ${field("contentPillars", "内容支柱", { required: true, wide: true, textarea: true, placeholder: "每行一个方向，例如：\n开发者工具与工程实践\n技术行业变化对工作的影响", hint: "每行一个长期关注的内容方向，系统会据此过滤热点和生成选题。" })}
      ${field("editorialCategories", "选题分类", { required: true, wide: true, textarea: true, placeholder: "每行一个分类，使用“名称 | 分类说明”\n程序员身边事 | 影响程序员日常工作、收入或职业选择的事件\nAI 与科技热点 | AI 产品、技术进展及其真实影响", hint: "每个公众号可配置 2–12 类；新分类会用于后续热点打标和榜单。" })}
      ${field("scoring", "选题评分配置（JSON）", { wide: true, textarea: true, rows: compact ? 5 : 8, placeholder: "{\n  \"categoryPreference\": {},\n  \"marketScopeCategoryPreference\": {}\n}", hint: "categoryPreference 是不分国内外的分类偏好；marketScopeCategoryPreference 可按“市场范围 → 账号分类”设置额外分值。留空对象表示不额外加分。" })}
      ${field("voiceGuardrails", "写作边界", { wide: true, textarea: true, placeholder: "每行一条，例如：\n事实与观点分开\n不制造焦虑", hint: "可选。告诉系统哪些表达方式要坚持或避免。" })}
      ${field("followReason", "读者为什么关注", { wide: true, textarea: true, placeholder: "关注后能持续获得什么？" })}
      ${field("conversionBridge", "内容承接", { wide: true, textarea: true, placeholder: "可选：文章可以自然承接哪些产品、服务或社群？" })}
    </div>
    <div class="account-context-form-actions"><span data-account-context-message>保存后会写入本机 account-context.json</span><button type="submit" class="primary-button" data-account-context-save>${compact ? "保存账号定位" : "初始化账号定位"}</button></div>
  </form>`;
}

export function readAccountContextForm(form) {
  const payload = {};
  for (const field of form.querySelectorAll("[name]")) {
    const value = field.value.trim();
    if (field.name === "scoring") {
      try {
        const parsed = JSON.parse(value || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        payload.scoring = parsed;
      } catch {
        throw new Error("选题评分配置必须是有效的 JSON 对象");
      }
    } else if (field.name === "editorialCategories") {
      payload[field.name] = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
        const separator = line.indexOf("|");
        return { name: (separator < 0 ? line : line.slice(0, separator)).trim(), description: separator < 0 ? line.trim() : line.slice(separator + 1).trim() };
      });
    } else payload[field.name] = LIST_FIELDS.has(field.name) ? value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) : value;
  }
  return payload;
}

function accountContextDraftForAssistant(form) {
  const fieldValue = (name) => form.elements.namedItem(name)?.value.trim() || "";
  const draft = { name: fieldValue("name"), description: fieldValue("description") };
  for (const name of ["readerProfile", "followReason", "conversionBridge"]) draft[name] = fieldValue(name);
  for (const name of ["contentPillars", "voiceGuardrails"]) draft[name] = fieldValue(name).split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  draft.editorialCategories = fieldValue("editorialCategories").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf("|");
    return { name: (separator < 0 ? line : line.slice(0, separator)).trim(), description: (separator < 0 ? line : line.slice(separator + 1)).trim() };
  });
  try { draft.scoring = JSON.parse(fieldValue("scoring") || "{}"); } catch { draft.scoring = {}; }
  return draft;
}

function applyAccountContextDraft(form, draft) {
  if (!draft || typeof draft !== "object") return;
  for (const key of ["readerProfile", "followReason", "conversionBridge"]) {
    const field = form.elements.namedItem(key);
    if (field && typeof draft[key] === "string") field.value = draft[key];
  }
  for (const key of ["contentPillars", "voiceGuardrails"]) {
    const field = form.elements.namedItem(key);
    if (field && Array.isArray(draft[key])) field.value = draft[key].join("\n");
  }
  const categoriesField = form.elements.namedItem("editorialCategories");
  if (categoriesField && Array.isArray(draft.editorialCategories)) categoriesField.value = draft.editorialCategories.map((item) => `${item.name} | ${item.description}`).join("\n");
  const scoringField = form.elements.namedItem("scoring");
  if (!scoringField || !draft.scoring) return;
  let existing = {};
  try { existing = JSON.parse(scoringField.value || "{}"); } catch { existing = {}; }
  const categories = new Set((draft.editorialCategories || []).map((item) => item.name));
  const existingPreference = existing.categoryPreference && typeof existing.categoryPreference === "object" ? existing.categoryPreference : {};
  const draftPreference = draft.scoring.categoryPreference && typeof draft.scoring.categoryPreference === "object" ? draft.scoring.categoryPreference : {};
  const existingScoped = existing.marketScopeCategoryPreference && typeof existing.marketScopeCategoryPreference === "object" ? existing.marketScopeCategoryPreference : {};
  const draftScoped = draft.scoring.marketScopeCategoryPreference && typeof draft.scoring.marketScopeCategoryPreference === "object" ? draft.scoring.marketScopeCategoryPreference : {};
  const marketScopeCategoryPreference = {};
  for (const scope of new Set([...Object.keys(existingScoped), ...Object.keys(draftScoped)])) {
    const merged = { ...(existingScoped[scope] || {}), ...(draftScoped[scope] || {}) };
    const filtered = Object.fromEntries(Object.entries(merged).filter(([category]) => categories.has(category)));
    if (Object.keys(filtered).length) marketScopeCategoryPreference[scope] = filtered;
  }
  scoringField.value = JSON.stringify({ ...existing, ...draft.scoring, categoryPreference: Object.fromEntries((draft.editorialCategories || []).map((item) => [item.name, draftPreference[item.name] ?? existingPreference[item.name] ?? 0])), marketScopeCategoryPreference }, null, 2);
}

export async function saveAccountContextForm(form) {
  const button = form.querySelector("[data-account-context-save]");
  const message = form.querySelector("[data-account-context-message]");
  const original = button?.textContent || "保存";
  if (button) { button.disabled = true; button.textContent = "保存中…"; }
  if (message) message.textContent = "正在写入本机配置…";
  try {
    const result = await request("/api/system/account-context", { method: "PUT", body: JSON.stringify(readAccountContextForm(form)) });
    if (message) message.textContent = "已保存。新的账号定位会用于后续批次和选题评估。";
    return result;
  } catch (error) {
    if (message) message.textContent = error.message || "保存失败，请检查必填项。";
    throw error;
  } finally {
    if (button) { button.disabled = false; button.textContent = original; }
  }
}

export async function mountAccountContextEditor(target, { compact = false, onSaved } = {}) {
  if (!target) return null;
  target.innerHTML = `<div class="account-context-loading">正在读取账号底稿…</div>`;
  try {
    const result = await request("/api/system/account-context");
    target.innerHTML = accountContextFormMarkup(result.context || {}, { compact });
    const chatLog = target.querySelector("[data-account-context-chat-log]");
    const chatInput = target.querySelector("[data-account-context-chat-input]");
    const sendButton = target.querySelector("[data-account-context-assist]");
    const conversation = [{ role: "assistant", content: "告诉我你希望这个公众号写给谁、关注什么，或直接说“根据名称和简介帮我起草”。我会按阶段逐步更新表单。" }];
    const stageLabels = { readerProfile: "核心读者", contentPillars: "内容支柱", editorialCategories: "选题分类", voiceGuardrails: "写作边界", followReason: "关注理由与内容承接", scoring: "分类评分偏好", complete: "全部完成" };
    sendButton?.addEventListener("click", async () => {
      const text = chatInput?.value.trim() || "";
      if (!text) return;
      const form = sendButton.closest("form");
      const status = form?.querySelector("[data-account-context-message]");
      const currentDraft = accountContextDraftForAssistant(form);
      if (!currentDraft.name || !currentDraft.description) {
        if (status) status.textContent = "先填写公众号名称和简介，再开始画像对话。";
        return;
      }
      if (text.length > 1200) {
        if (status) status.textContent = "这条消息有点长，请控制在 1200 字以内。";
        return;
      }
      conversation.push({ role: "user", content: text });
      const userMessage = document.createElement("div");
      userMessage.className = "editorial-message user";
      userMessage.innerHTML = "<b>你</b><p></p>";
      userMessage.querySelector("p").textContent = text;
      chatLog?.append(userMessage);
      chatInput.value = "";
      if (status) status.textContent = "AI 正在根据当前表单和对话整理建议。";
      try {
        await streamChat({
          url: "/api/system/account-context/assist/stream",
          body: { name: currentDraft.name, description: currentDraft.description, currentDraft, history: conversation.slice(0, -1), answer: text },
          messages: chatLog,
          button: sendButton,
          busyLabel: "AI 正在完善画像…",
          doneLabel: "发送",
          title: "AI 画像助手",
          errorLabel: "账号画像助手",
          requireReply: true,
          rethrow: true,
          onDone: (result) => {
            const reply = result.reply || "我已更新建议，请检查表单。";
            conversation.push({ role: "assistant", content: reply });
            if (result.draft) applyAccountContextDraft(form, result.draft);
            if (status) status.textContent = result.stage === "complete"
              ? "账号画像各阶段已完成；请检查上方表单后手动保存。"
              : result.updated
                ? `AI 已更新当前阶段（${stageLabels[result.stage] || result.stage}）；请检查上方表单，再回答下一步问题。`
                : `当前阶段是“${stageLabels[result.stage] || result.stage}”，AI 正在和你确认这一项。`;
          },
        });
      } catch (error) {
        if (status) status.textContent = error.message || "对话失败，请重试。";
      } finally {
        chatInput?.focus();
      }
    });
    chatInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendButton?.click(); }
    });
    target.querySelector("[data-account-context-form]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const saved = await saveAccountContextForm(event.currentTarget);
        onSaved?.(saved);
      } catch { /* 错误已显示在表单内 */ }
    });
    return result;
  } catch (error) {
    target.innerHTML = `<div class="account-context-error">账号配置暂时无法读取：${escapeHtml(error.message || "未知错误")}</div>`;
    return null;
  }
}
