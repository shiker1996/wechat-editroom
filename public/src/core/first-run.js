import { request } from "./http.js";
import { escapeHtml } from "./ui.js";

const STORAGE_KEY = "jianzhi.first-run-wizard.v1";
const STEP_LABELS = ["连接模型", "配置采集", "生产路径", "开始交付"];
let step = 0;
let snapshot = null;

function readProgress() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}

function writeProgress(patch) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readProgress(), ...patch })); } catch { /* 隐私模式下不持久化向导状态 */ }
}

function suggestedStep() {
  if (!snapshot?.modelReady) return 0;
  if (!snapshot?.sourceReady) return 1;
  if (!snapshot?.hasBatch) return 2;
  return 3;
}

function routeStep(route) {
  const view = String(route || "").split("/")[0];
  if (view === "system") return 0;
  if (["sources", "batches"].includes(view)) return 1;
  if (["overview", "topics", "social-topics", "social-editor", "social-custom", "social-event", "editorial", "editor", "preview", "cover"].includes(view)) return 2;
  return null;
}

function renderProgressDock() {
  const host = document.getElementById("first-run-progress");
  if (!host) return;
  const progress = readProgress();
  if (progress.completed) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }
  const tasks = [Boolean(snapshot?.modelReady), Boolean(snapshot?.sourceReady), Boolean(snapshot?.hasBatch), false];
  const completedCount = tasks.filter(Boolean).length;
  const label = snapshot ? `${completedCount}/4 项已完成` : "打开查看配置进度";
  const current = Math.min(4, Math.max(0, completedCount + 1));
  host.hidden = false;
  host.innerHTML = `<button type="button" class="first-run-progress-trigger" data-first-run-open aria-label="打开首次使用引导"><span class="first-run-progress-count">${completedCount}<small>/4</small></span><span class="first-run-progress-copy"><b>首次使用</b><small>${label}</small></span><span class="first-run-progress-bar" aria-hidden="true"><i style="width:${completedCount / 4 * 100}%"></i></span><span class="first-run-progress-step">${current}</span></button>`;
}

export function shouldOpenFirstRunWizard() {
  return Boolean(window.desktopBridge?.isDesktop) && !readProgress().seen;
}

function routeTo(route) {
  const targetStep = routeStep(route);
  if (targetStep !== null) {
    step = Math.max(step, targetStep);
    writeProgress({ currentStep: step });
  }
  document.getElementById("first-run-dialog")?.close();
  renderProgressDock();
  window.go?.(route);
}

async function readSnapshot() {
  const [models, sourceData, capabilities, rsshub, batches] = await Promise.all([
    request("/api/models").catch(() => ({})),
    request("/api/collection-sources").catch(() => ({ items: [] })),
    request("/api/collection-capabilities").catch(() => ({ items: [] })),
    request("/api/system/runtime/rsshub/status").catch(() => ({ ready: false, installed: false, dependenciesInstalled: false, reason: "状态暂时无法读取" })),
    request("/api/batches?limit=20").catch(() => []),
  ]);
  const providers = Array.isArray(models.providers) ? models.providers : [];
  const sourceItems = Array.isArray(sourceData.items) ? sourceData.items : [];
  const groups = Array.isArray(capabilities.items) ? capabilities.items : [];
  return {
    modelReady: providers.some((item) => item.enabled !== false && item.configured === true),
    modelLabel: providers.find((item) => item.enabled !== false && item.configured === true)?.label || "尚未配置可用模型",
    sourceReady: groups.some((item) => item.ready === true),
    sourceItems,
    groups,
    rsshubStatus: capabilities.rsshub || rsshub,
    hasBatch: Array.isArray(batches) && batches.length > 0,
  };
}

function statusPill(ready, readyText, pendingText) {
  return `<span class="first-run-status ${ready ? "is-ready" : "is-pending"}"><i></i>${ready ? readyText : pendingText}</span>`;
}

function renderRail() {
  const rail = document.getElementById("first-run-steps");
  if (!rail) return;
  rail.innerHTML = STEP_LABELS.map((label, index) => `<button type="button" class="first-run-step ${index === step ? "is-active" : ""} ${index < step ? "is-done" : ""}" data-first-run-step="${index}"><b>${String(index + 1).padStart(2, "0")}</b><span>${label}</span><em>${index < step ? "完成" : index === step ? "进行中" : "待进入"}</em></button>`).join("");
}

function renderBody() {
  const body = document.getElementById("first-run-body");
  const next = document.getElementById("first-run-next");
  const back = document.getElementById("first-run-back");
  if (!body || !snapshot) return;
  const modelStatus = statusPill(snapshot.modelReady, "已连接", "待配置");
  const sourceStatus = statusPill(snapshot.sourceReady, "至少一个入口可用", "尚未配置采集源");
  const sourceRows = snapshot.groups.length
    ? snapshot.groups.map((item) => {
      const rsshubStatus = snapshot.rsshubStatus || {};
      let rsshubAction = "";
      let detail = item.ready ? `${item.enabledSourceCount} 个采集源已启用` : escapeHtml(item.reason || "暂不可用");
      if (item.id === "rsshub") {
        if (!rsshubStatus.installed) {
          detail = "尚未安装 RSSHub";
          rsshubAction = `<button type="button" class="outline-button first-run-install-rsshub" data-first-run-rsshub-action="install">启用 RSSHub</button>`;
        } else if (!rsshubStatus.dependenciesInstalled) {
          detail = "RSSHub 依赖尚未安装";
          rsshubAction = `<button type="button" class="outline-button first-run-install-rsshub" data-first-run-rsshub-action="install">安装依赖</button>`;
        } else if (!rsshubStatus.healthy) {
          detail = "RSSHub 已安装，当前未启动";
          rsshubAction = `<button type="button" class="outline-button first-run-install-rsshub" data-first-run-rsshub-action="start">启动 RSSHub</button>`;
        } else {
          detail = "RSSHub 已安装并运行";
        }
      }
      const rowReady = item.id === "rsshub" ? Boolean(item.ready && rsshubStatus.healthy) : item.ready;
      return `<div class="first-run-source-row"><span class="source-dot ${rowReady ? "is-ready" : ""}"></span><b>${escapeHtml(item.label)}</b><small>${detail}</small>${rsshubAction}</div>`;
    }).join("")
    : `<div class="first-run-empty">还没有读取到采集能力状态，可以稍后在“采集源”页面配置。</div>`;
  const page = [
    `<div class="first-run-eyebrow">01 / RUNTIME FOUNDATION</div><h3>先让见字具备生成能力</h3><p class="first-run-lead">文章和图文都需要一个可用的模型连接。采集源是获取新素材的入口，也可以先使用已有批次继续体验。</p><div class="first-run-status-card"><div><b>模型连接</b><small>${escapeHtml(snapshot.modelLabel)}</small></div>${modelStatus}</div><div class="first-run-callout"><b>建议先完成这一项</b><span>打开运行与配置中心，填入 API Key 并测试连接。返回后向导会自动刷新状态。</span></div><button type="button" class="primary-button first-run-action" data-first-run-route="system">去配置模型 →</button>`,
    `<div class="first-run-eyebrow">02 / SOURCE READINESS</div><h3>选择你要使用的素材入口</h3><p class="first-run-lead">批次会自动采集所有已启用的来源，不再额外勾选。未配置的 Reddit、RSSHub、GitHub 不会进入批次，也不会产生待处理失败。</p><div class="first-run-status-card"><div><b>采集能力</b><small>${snapshot.sourceReady ? "可以建立批次并开始采集" : "至少配置一个采集源后再开始"}</small></div>${sourceStatus}</div><div class="first-run-source-list">${sourceRows}</div><div class="first-run-action-row"><button type="button" class="primary-button" data-first-run-route="sources">配置采集源 →</button><button type="button" class="outline-button" data-first-run-route="batches">建立今日批次</button></div>`,
    `<div class="first-run-eyebrow">03 / TWO DELIVERABLES</div><h3>一篇文章，一组图文</h3><p class="first-run-lead">见字把两个产出路径分开，避免用户在一个复杂页面里找按钮。先有候选题，再进入对应工作区完成生成、排版和发布准备。</p><div class="first-run-delivery-grid"><article><span class="first-run-delivery-mark article-mark">文</span><div><b>公众号文章</b><p>热点全景 → 文章选题 → 编辑器 → 排版 → 发布登记</p><button type="button" class="text-button" data-first-run-route="overview">开始文章路径 →</button></div></article><article><span class="first-run-delivery-mark social-mark">图</span><div><b>社交图文</b><p>图文选题 → 故事板 → 图片产物 → 下载发布</p><button type="button" class="text-button" data-first-run-route="social-topics">开始图文路径 →</button></div></article></div><div class="first-run-note">应用内的“发布”会生成可交付的文章 HTML、图片和发布记录；微信公众号后台发布仍由你确认。</div>`,
    `<div class="first-run-eyebrow">04 / READY TO SHIP</div><h3>现在就做一次完整交付</h3><p class="first-run-lead">配置完成后，按下面任一入口开始。向导不会锁住工作台，你也可以从“帮助 → 首次使用说明”再次打开。</p><div class="first-run-checklist"><div>${snapshot.modelReady ? "✓" : "○"}<span>模型连接${snapshot.modelReady ? "已就绪" : "待配置"}</span></div><div>${snapshot.sourceReady ? "✓" : "○"}<span>采集入口${snapshot.sourceReady ? "已就绪" : "可稍后配置"}</span></div><div>${snapshot.hasBatch ? "✓" : "○"}<span>${snapshot.hasBatch ? "已有批次，可继续生产" : "还没有批次，先建立今日批次"}</span></div></div><div class="first-run-launch-grid"><button type="button" class="primary-button" data-first-run-route="overview">进入文章生产</button><button type="button" class="outline-button" data-first-run-route="social-topics">进入图文生产</button><button type="button" class="ghost-button" data-first-run-route="editor">直接打开文章编辑器</button><button type="button" class="ghost-button" data-first-run-route="social-editor">直接打开图文编辑器</button></div>`,
  ][step];
  body.innerHTML = page;
  if (next) next.textContent = step === STEP_LABELS.length - 1 ? "完成首次设置" : "下一步";
  if (back) back.hidden = step === 0;
  renderRail();
  renderProgressDock();
}

async function refreshWizard() {
  snapshot = await readSnapshot();
  renderBody();
}

export async function openFirstRunWizard({ force = false } = {}) {
  const dialog = document.getElementById("first-run-dialog");
  if (!dialog) return;
  if (!force && !shouldOpenFirstRunWizard()) return;
  const progress = readProgress();
  writeProgress({ seen: true });
  step = 0;
  dialog.showModal();
  document.getElementById("first-run-body").innerHTML = `<div class="first-run-loading">正在读取本机配置…</div>`;
  try {
    await refreshWizard();
    step = Math.max(Number(progress.currentStep) || 0, suggestedStep());
    renderBody();
  } catch {
    document.getElementById("first-run-body").innerHTML = `<div class="first-run-empty">配置状态暂时无法读取，请直接进入运行与配置中心检查。</div>`;
  }
}

export function bindFirstRunWizard() {
  const dialog = document.getElementById("first-run-dialog");
  if (!dialog || dialog.dataset.bound) return;
  dialog.dataset.bound = "true";
  renderProgressDock();
  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-first-run-open]")) return;
    event.preventDefault();
    openFirstRunWizard({ force: true });
  });
  window.addEventListener("focus", () => {
    if (readProgress().completed) return;
    refreshWizard().catch(() => {});
  });
  dialog.addEventListener("click", (event) => {
    const rsshubButton = event.target.closest("[data-first-run-rsshub-action]");
    if (rsshubButton) {
      event.preventDefault();
      event.stopPropagation();
      const action = rsshubButton.dataset.firstRunRsshubAction;
      const isInstall = action === "install";
      rsshubButton.disabled = true;
      rsshubButton.textContent = isInstall ? "安装中…" : "启动中…";
      const endpoint = isInstall ? "/api/system/runtime/rsshub/install" : "/api/system/runtime/rsshub/start";
      request(endpoint, { method: "POST", body: "{}" })
        .then((result) => {
          if (result?.warning || result?.started === false || result?.healthy === false) {
            throw new Error(result.warning || "RSSHub 已安装，但启动失败，请检查运行日志");
          }
          return refreshWizard();
        })
        .catch((error) => {
          rsshubButton.disabled = false;
          rsshubButton.textContent = isInstall ? "安装失败，重试" : "启动失败，重试";
          const message = document.createElement("small");
          message.className = "first-run-install-error";
          message.textContent = error.message || "RSSHub 安装失败";
          rsshubButton.parentElement?.querySelector(".first-run-install-error")?.remove();
          rsshubButton.parentElement?.appendChild(message);
        });
      return;
    }
    const route = event.target.closest("[data-first-run-route]")?.dataset.firstRunRoute;
    if (route) return routeTo(route);
    const selectedStep = event.target.closest("[data-first-run-step]")?.dataset.firstRunStep;
    if (selectedStep !== undefined) { step = Number(selectedStep); return renderBody(); }
    if (event.target.closest("[data-first-run-next]")) {
      if (step < STEP_LABELS.length - 1) { step += 1; writeProgress({ currentStep: step }); renderBody(); }
      else { writeProgress({ completed: true, seen: true, currentStep: step }); renderProgressDock(); dialog.close(); }
    }
    if (event.target.closest("[data-first-run-back]") && step > 0) { step -= 1; renderBody(); }
    if (event.target.closest("[data-first-run-later]")) { writeProgress({ seen: true }); dialog.close(); }
  });
  dialog.addEventListener("close", () => { writeProgress({ seen: true }); renderProgressDock(); });
  window.openFirstRunWizard = () => openFirstRunWizard({ force: true });
}
