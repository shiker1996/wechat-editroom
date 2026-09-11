import { request } from "./http.js";
import { escapeHtml } from "./ui.js";

const LIST_FIELDS = new Set(["contentPillars", "voiceGuardrails"]);

function valueOf(context, field) {
  const value = context?.[field];
  return Array.isArray(value) ? value.join("\n") : String(value || "");
}

export function accountContextFormMarkup(context = {}, { compact = false } = {}) {
  const field = (name, label, options = {}) => {
    const value = valueOf(context, name);
    const required = options.required ? " required" : "";
    const wide = options.wide ? " wide" : "";
    const placeholder = options.placeholder ? ` placeholder="${escapeHtml(options.placeholder)}"` : "";
    const hint = options.hint ? `<small>${escapeHtml(options.hint)}</small>` : "";
    if (options.textarea) return `<label class="account-context-field${wide}"><span>${escapeHtml(label)}${options.required ? " *" : ""}</span><textarea name="${name}" rows="${compact ? 3 : 4}"${required}${placeholder}>${escapeHtml(value)}</textarea>${hint}</label>`;
    return `<label class="account-context-field${wide}"><span>${escapeHtml(label)}${options.required ? " *" : ""}</span><input name="${name}" value="${escapeHtml(value)}"${required}${placeholder}>${hint}</label>`;
  };
  return `<form class="account-context-form${compact ? " is-compact" : ""}" data-account-context-form>
    <div class="account-context-form-grid">
      ${field("name", "公众号名称", { required: true, placeholder: "例如：见字" })}
      ${field("description", "一句话简介", { required: true, placeholder: "你希望读者如何理解这个账号？" })}
      ${field("readerProfile", "核心读者", { required: true, wide: true, textarea: true, placeholder: "例如：一线程序员、技术负责人和关注 AI 工具的产品经理", hint: "写清楚读者是谁，以及他们在意什么。" })}
      ${field("contentPillars", "内容支柱", { required: true, wide: true, textarea: true, placeholder: "每行一个方向，例如：\n开发者工具与工程实践\n技术行业变化对工作的影响", hint: "每行一个长期关注的内容方向，系统会据此过滤热点和生成选题。" })}
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
    payload[field.name] = LIST_FIELDS.has(field.name) ? value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) : value;
  }
  return payload;
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
