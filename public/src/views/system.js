import { request } from "../core/http.js";
import { state } from "../core/state.js";
import { escapeHtml, toast, confirmAction } from "../core/ui.js";

let bound = false;
let validatedBackup = null;
let runtimeModels = null;
let runtimeSettings = null;
let extensionConfigurations = [];
let selectedExtension = null;
let extensionQuery = "";
let extensionType = "";
let codexRuntimeStatus = null;
let activeLocalRuntimeStep = "supplier";
let lastCreatedLocalModelId = "";

function modelCatalogButton(item,connectionLabel=''){
  const active=selectedExtension===item.type+":"+item.id;
  const marks={system:'SYS',skill:'SK',tool:'TL',collector:'CL','model-connection':'API','model-provider':'AI','agent-runtime':'RT'};
  const labels={system:'系统',skill:'技能',tool:'工具',collector:'采集器','model-connection':'供应商','model-provider':'模型','agent-runtime':'运行时'};
  const relation=connectionLabel?` · 供应商：${escapeHtml(connectionLabel)}`:'';
  return `<button type="button" class="${active?'active':''}" data-system-extension="${escapeHtml(item.type+":"+item.id)}"><span class="configuration-resource-mark">${marks[item.type]||'EX'}</span><span class="configuration-resource-copy"><b>${escapeHtml(item.name||item.id)}</b><small>${labels[item.type]||item.type} · ${escapeHtml(item.id)}${relation}</small></span><i class="configuration-resource-state ${item.state.configured?'ready':'attention'}" title="${item.state.configured?'已就绪':'需要配置'}"></i></button>`;
}
function renderModelCatalogList(){
  const node=document.getElementById("system-extension-list");if(!node)return;
  const connections=new Map(extensionConfigurations.filter((item)=>item.type==='model-connection').map((item)=>[item.id,item.name||item.id]));
  const catalogItems=extensionConfigurations.filter((item)=>!(item.type==='system'&&item.id==='llm-stage-routing'));
  const items=catalogItems.filter((item)=>(!extensionType||item.type===extensionType)&&(!extensionQuery||(`${item.name||''} ${item.id}`).toLowerCase().includes(extensionQuery)));
  const count=document.getElementById("configuration-filter-count");
  if(count)count.textContent=items.length+' / '+catalogItems.length;
  node.innerHTML=items.length?items.map((item)=>modelCatalogButton(item,item.type==='model-provider'?(connections.get(item.state.values?.connectionId)||item.state.values?.connectionId||'未绑定'):'')).join(''):'<div class="configuration-empty"><b>没有匹配项</b><span>试试清空搜索或切换能力类型。</span></div>';
}
function renderConfigurationList(){
  renderModelCatalogList();
}

function bindSystem() {
  if (bound) return;
  bound = true;
  document.getElementById("add-rsshub-env")?.addEventListener("click", () => addRsshubKvRow());
  document.getElementById("system-extension-editor")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-agent-runtime-connect='codex']")) connectCodexRuntime().catch((error) => toast(error.message, "error"));
    if (event.target.closest("[data-agent-runtime-disconnect='codex']")) disconnectCodexRuntime().catch((error) => toast(error.message, "error"));
    const modelStep = event.target.closest("[data-agent-runtime-model-step]")?.dataset.agentRuntimeModelStep;
    const modelStepAction = event.target.closest("[data-agent-runtime-step-action]")?.dataset.agentRuntimeStepAction;
    if (modelStep || modelStepAction) showAgentRuntimeLocalStep(modelStep || modelStepAction);
    const modelId = event.target.closest("[data-open-local-runtime-model]")?.dataset.openLocalRuntimeModel;
    if (modelId) selectSystemExtension(`model-provider:${modelId}`);
  });
  document.getElementById("system-extension-editor")?.addEventListener("change", (event) => {
    const select = event.target.closest("[data-agent-runtime-default]");
    if (select) saveDefaultAgentRuntime(select.value).catch((error) => { toast(error.message, "error"); loadCodexRuntimeStatus(); });
  });
  document.querySelector(".config-tabbar")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-config-tab]");
    if (button) selectConfigTab(button.dataset.configTab);
  });
  document.getElementById("system-extension-list")?.addEventListener("click",(event)=>{const button=event.target.closest("[data-system-extension]");if(button)selectSystemExtension(button.dataset.systemExtension);});
  document.getElementById("system-extension-search")?.addEventListener("input",(event)=>{extensionQuery=event.target.value.trim().toLowerCase();renderConfigurationList();});
  document.getElementById("system-extension-type")?.addEventListener("change",(event)=>{extensionType=event.target.value;renderConfigurationList();});
  document.getElementById("system-extension-editor")?.addEventListener("click",(event)=>{const remove=event.target.closest("[data-rsshub-remove]");if(!remove)return;const row=remove.closest(".rsshub-kv-row");if(row.dataset.existing==="true"){row.classList.toggle("pending-delete");row.querySelector("[data-rsshub-clear]").checked=row.classList.contains("pending-delete");remove.textContent=row.classList.contains("pending-delete")?"撤销":"删除";}else row.remove();updateRsshubPendingHint();});
  document.getElementById("rsshub-env-fields")?.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-rsshub-remove]");
    if (!remove) return;
    const row = remove.closest(".rsshub-kv-row");
    if (row.dataset.existing === "true") {
      row.classList.toggle("pending-delete");
      row.querySelector("[data-rsshub-clear]").checked = row.classList.contains("pending-delete");
      remove.textContent = row.classList.contains("pending-delete") ? "撤销" : "删除";
    } else {
      row.remove();
    }
    updateRsshubPendingHint();
  });
  bindBackupActions();
}

function bindBackupActions() {
  document.getElementById("download-backup")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "正在生成…";
    try {
      const response = await fetch("/api/system/backup");
      if (!response.ok) throw new Error((await response.json()).error || "备份失败");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] || "write-assistant-backup.zip";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("备份已通过完整性校验并开始下载");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
  document.getElementById("clear-cache")?.addEventListener("click", async (event) => {
    if (!await confirmAction("清理 GitHub API 与来源正文缓存？缓存会随下次采集自动重建，数据库与产物不受影响。", { confirmText: "清理缓存" })) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await request("/api/system/cache/clear", { method: "POST", body: JSON.stringify({ kind: "all" }) });
      const total = (result.cleared || []).reduce((sum, item) => sum + item.removed, 0);
      toast("缓存已清理（" + total + " 项）");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById("backup-file")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    const status = document.getElementById("backup-validation");
    const restore = document.getElementById("restore-backup");
    validatedBackup = null;
    restore.disabled = true;
    if (!file) {
      status.textContent = "尚未选择备份包";
      status.className = "backup-validation";
      return;
    }
    status.textContent = "正在校验备份包…";
    status.className = "backup-validation checking";
    try {
      const result = await request("/api/system/backup/validate", { method: "POST", headers: { "content-type": "application/zip" }, body: file });
      validatedBackup = file;
      restore.disabled = false;
      status.textContent = `校验通过 · ${result.fileCount} 个文件 · ${(result.totalBytes / 1024 / 1024).toFixed(1)} MB · ${new Date(result.createdAt).toLocaleString("zh-CN")}`;
      status.className = "backup-validation valid";
    } catch (error) {
      status.textContent = `校验失败 · ${error.message}`;
      status.className = "backup-validation invalid";
    }
  });
  document.getElementById("restore-backup")?.addEventListener("click", async (event) => {
    if (!validatedBackup) return;
    if (!await confirmAction("恢复将用备份数据替换当前工作台数据。系统会先自动保存一份恢复前快照，是否继续？", { confirmText: "确认恢复" })) return;
    const button = event.currentTarget;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "正在恢复…";
    try {
      const result = await request("/api/system/backup/restore", { method: "POST", confirmation: "backup-restore", headers: { "content-type": "application/zip" }, body: validatedBackup });
      toast(`恢复完成，已保留恢复前快照 ${result.safetyBackup}，即将刷新页面`);
      setTimeout(() => location.reload(), 800);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      button.disabled = !validatedBackup;
      button.textContent = original;
    }
  });
}

function selectConfigTab(name) {
  document.querySelectorAll("[data-config-tab]").forEach((button) => {
    const active = button.dataset.configTab === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-config-panel]").forEach((panel) => {
    const active = panel.dataset.configPanel === name;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
  try { sessionStorage.setItem("runtime-config-tab", name); } catch {}
}

function extensionRoute(item,suffix=""){return `/api/system/configuration/${encodeURIComponent(item.type)}/${encodeURIComponent(item.id)}${suffix}`;}
function renderSystemExtensionList(){const node=document.getElementById("system-extension-list");if(!node)return;const labels={system:"系统",skill:"技能",tool:"工具",collector:"采集器"};const marks={system:"SYS",skill:"SK",tool:"TL",collector:"CL"};const items=extensionConfigurations.filter((item)=>item.type!=='model-provider'&&item.type!=='model-connection'&&(!extensionType||item.type===extensionType)&&(!extensionQuery||`${item.name||''} ${item.id}`.toLowerCase().includes(extensionQuery)));const count=document.getElementById("configuration-filter-count");if(count)count.textContent=`${items.length} / ${extensionConfigurations.length}`;node.innerHTML=items.length?items.map((item)=>`<button type="button" class="${selectedExtension===`${item.type}:${item.id}`?'active':''}" data-system-extension="${escapeHtml(`${item.type}:${item.id}`)}"><span class="configuration-resource-mark">${marks[item.type]||'EX'}</span><span class="configuration-resource-copy"><b>${escapeHtml(item.name||item.id)}</b><small>${labels[item.type]||item.type} · ${escapeHtml(item.id)}</small></span><i class="configuration-resource-state ${item.state.configured?'ready':'attention'}" title="${item.state.configured?'已就绪':'需要配置'}"></i></button>`).join(""):'<div class="configuration-empty"><b>没有匹配项</b><span>试试清空搜索或切换能力类型。</span></div>';}function systemSchemaField(name,rule,value){const id=`system-extension-${name}`,common=`id="${id}" data-system-extension-field="${escapeHtml(name)}" data-value-type="${escapeHtml(rule.type||'string')}"`;const heading=`${escapeHtml(rule.title||name)}${rule.description?`<small>${escapeHtml(rule.description)}</small>`:''}`;if(rule.enum)return `<label>${heading}<select ${common}>${rule.enum.map((item,index)=>`<option value="${escapeHtml(item)}" ${item===value?'selected':''}>${escapeHtml(rule.enumNames?.[index]||item)}</option>`).join("")}</select></label>`;if(rule.type==='boolean')return `<label><span>${heading}</span><input ${common} type="checkbox" ${value?'checked':''}></label>`;if(rule.type==='array'){const text=Array.isArray(value)?value.join("\n"):"";return `<label>${heading}<textarea ${common} rows="4" placeholder="每行一项">${escapeHtml(text)}</textarea></label>`;}const configured=value==='__configured__';if(rule.format==='textarea')return `<label>${heading}<textarea ${common} rows="5" ${configured?'placeholder="已配置；留空保持不变"':''}>${configured?'':escapeHtml(value??'')}</textarea></label>`;const type=rule.secret||rule.format==='password'?'password':rule.type==='integer'||rule.type==='number'?'number':rule.format==='url'?'url':'text';return `<label>${heading}<input ${common} type="${type}" value="${configured?'':escapeHtml(value??'')}" ${configured?'placeholder="已配置；留空保持不变"':''}></label>`;}
function renderSystemExtensionEditor(item,target=null){const node=target||document.getElementById("system-extension-editor");if(!node)return;if(!item){node.innerHTML='<div class="configuration-empty"><b>选择一项能力</b><span>查看配置字段、凭据状态与运行诊断。</span></div>';return;}const state=item.state,schema=state.schema||{properties:{}};const issues=state.issues||[];const advanced=item.type==='collector'&&item.id==='rsshub-collector'?`<section class="resource-advanced"><div class="config-panel-heading"><div><span class="kicker">KEY-VALUE SECRET</span><h4>RSSHub 扩展变量</h4></div><p>键名受控校验，秘密值只显示配置状态。</p></div><div class="kv-file-head"><span>KEY</span><span>VALUE</span><button type="button" class="text-button" data-add-rsshub-kv>＋ 新增变量</button></div><div id="rsshub-env-fields" class="rsshub-kv-list"></div><div id="rsshub-pending-hint" class="kv-pending-hint" hidden></div><button type="button" class="outline-button" data-save-rsshub-kv>保存扩展变量</button></section>`:'';const deleteBtn=item.type==='model-provider'?'<button type="button" class="ghost-button" data-delete-model-provider style="color:var(--red)">删除模型</button>':'';node.innerHTML=`<header class="configuration-editor-head"><div><span class="kicker">${escapeHtml(item.type.toUpperCase())} / ${escapeHtml(item.id)}</span><h4>${escapeHtml(item.name||item.id)}</h4><p>${state.configured?'该能力已通过配置校验，可以投入运行。':'完成以下配置后，能力才会进入运行队列。'}</p></div><span class="configuration-status-badge ${state.configured?'ready':'attention'}"><i></i>${state.configured?'已就绪':'需要配置'}</span></header>${issues.length?`<div class="configuration-issues"><b>需要处理</b>${issues.map((issue)=>`<span>${escapeHtml(issue.message||issue.field)}</span>`).join('')}</div>`:''}<form id="system-extension-form"><div class="configuration-fields">${Object.entries(schema.properties||{}).map(([name,rule])=>systemSchemaField(name,rule,state.values?.[name])).join("")}</div><div class="configuration-form-actions"><small>保存前会校验字段格式；密钥不会在页面回显。</small><div>${deleteBtn}<button type="button" class="ghost-button" data-system-extension-test>测试配置</button><button type="submit" class="primary-button">保存并应用</button></div></div></form>${advanced}`;const form=node.querySelector("form");form.onsubmit=(event)=>{event.preventDefault();saveSystemExtension(item,form,node).catch((error)=>toast(error.message, "error"));};form.querySelector("[data-system-extension-test]").onclick=()=>testSystemExtension(item).catch((error)=>toast(error.message, "error"));if(deleteBtn)node.querySelector("[data-delete-model-provider]").onclick=()=>deleteModelProviderUnified(item).catch((error)=>toast(error.message,"error"));if(advanced){renderRsshubKv(runtimeSettings?.rsshub||[]);node.querySelector('[data-add-rsshub-kv]').onclick=addRsshubKvRow;node.querySelector('[data-save-rsshub-kv]').onclick=(event)=>saveRsshubConfiguration(event.currentTarget);}}function selectSystemExtension(key){selectedExtension=key;try{sessionStorage.setItem("system-extension-selection",key);const [type,id]=key.split(':');history.replaceState(null,"",`#system/configuration/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);}catch{}renderConfigurationList();renderSystemExtensionEditor(extensionConfigurations.find((item)=>`${item.type}:${item.id}`===key));}
function renderAgentRuntimeEditor(item){
  const status=codexRuntimeStatus||{};
  const runtimes=[...new Set(['local-harness',...(status.availableRuntimes||['codex'])])];
  const labels={'local-harness':'见字本地 Runtime',codex:'Codex Runtime',workbuddy:'WorkBuddy Runtime'};
  const defaultRuntime=runtimes.includes(status.defaultRuntime)?status.defaultRuntime:'local-harness';
  const connected=Boolean(status.configured);
  const connectionLabel=status.error?'状态读取失败':connected?'已连接':'未连接';
  const options=runtimes.map((runtime)=>`<option value="${escapeHtml(runtime)}" ${runtime===defaultRuntime?'selected':''}>${escapeHtml(labels[runtime]||runtime)}</option>`).join('');
  const ready=item?.state?.configured;
  if(defaultRuntime==='local-harness'){
    return '<header class="configuration-editor-head"><div><span class="kicker">AGENT RUNTIME / LOCAL MODEL</span><h4>执行环境与平台授权</h4><p>默认 Runtime 决定下方显示对应的授权或模型配置。</p></div><span class="configuration-status-badge '+(ready?'ready':'attention')+'"><i></i>'+(ready?'可用':'需要配置')+'</span></header><div class="agent-runtime-editor"><label class="agent-runtime-default-field">默认 Agent Runtime<select data-agent-runtime-default>'+options+'</select><small>本地 Runtime 使用见字本地模型配置；Codex Runtime 使用 ChatGPT 账号授权。</small></label><section class="local-model-setup" aria-labelledby="local-model-setup-title"><header class="local-model-setup-head"><div><span class="kicker">LOCAL MODEL PATH</span><h3 id="local-model-setup-title">见字本地 Runtime 的模型配置</h3><p>仅影响见字本地 Runtime 执行的任务，Codex 账号的模型不会被这里的配置修改。</p></div><span class="local-model-path-badge">供应商 → 模型 → 可选路由</span></header><ol class="local-model-setup-steps"><li><b><i>01</i>连接供应商</b><small>配置 API 地址和凭据</small><button type="button" class="outline-button" data-agent-runtime-model-action="connection">添加供应商</button></li><li><b><i>02</i>添加默认模型</b><small>选择供应商、填写模型 ID，并设为默认</small><button type="button" class="outline-button" data-agent-runtime-model-action="provider">添加模型</button></li><li><b><i>03</i>按阶段覆盖（可选）</b><small>未配置时，各阶段继承默认模型</small><button type="button" class="outline-button" data-agent-runtime-model-action="routing">配置路由</button></li></ol></section><p class="agent-runtime-editor-note">默认模型用于本地 Runtime 的通用调用；阶段模型路由可选配置。</p></div>';
  }
  if(defaultRuntime!=='codex'){
    return '<header class="configuration-editor-head"><div><span class="kicker">AGENT RUNTIME / PLATFORM ACCOUNTS</span><h4>执行环境与平台授权</h4><p>默认 Runtime 决定下方显示对应的平台授权配置。</p></div><span class="configuration-status-badge '+(ready?'ready':'attention')+'"><i></i>'+(ready?'可用':'需要配置')+'</span></header><div class="agent-runtime-editor"><label class="agent-runtime-default-field">默认 Agent Runtime<select data-agent-runtime-default>'+options+'</select></label><section class="agent-runtime-provider-entry"><b>'+escapeHtml(labels[defaultRuntime]||defaultRuntime)+'</b><p>该 Runtime 已注册；对应的平台授权配置将在适配器接入后显示。</p></section></div>';
  }
  return `<header class="configuration-editor-head"><div><span class="kicker">AGENT RUNTIME / PLATFORM ACCOUNTS</span><h4>执行环境与平台授权</h4><p>选择默认执行环境，并在这里管理各平台独立的授权。不同平台的账号凭据互不共用。</p></div><span class="configuration-status-badge ${ready?'ready':'attention'}"><i></i>${ready?'可用':'需要授权'}</span></header><div class="agent-runtime-editor"><label class="agent-runtime-default-field">默认 Agent Runtime<select data-agent-runtime-default>${options}</select><small>此设置只选择 Agent 执行后端；见字本地 Runtime 的供应商、模型和阶段路由在本地模型配置中管理。</small></label><section class="agent-runtime-provider-entry"><header><div><span class="kicker">CODEX ADAPTER</span><b>Codex Runtime</b></div><span class="configuration-status-badge ${connected?'ready':'attention'}"><i></i>${connectionLabel}</span></header><div class="agent-runtime-provider-account"><small>ChatGPT 账号</small><span>${status.error?'连接状态暂不可读':connected?escapeHtml(status.email||'已授权'):'尚未连接 ChatGPT 账号。'}</span></div><div class="agent-runtime-provider-actions"><button type="button" class="outline-button" data-agent-runtime-connect="codex">${connected?'重新连接':'连接 ChatGPT'}</button>${connected?'<button type="button" class="ghost-button" data-agent-runtime-disconnect="codex">断开连接</button>':''}</div></section><p class="agent-runtime-editor-note">Codex 使用 ChatGPT 授权账号执行已接入的任务。未接入外部 Runtime 的任务仍由见字本地 Runtime 执行；本地模型路由不会调整 Codex 的模型。任务提示词、工具授权和结果校验仍由见字管理。</p></div>`;
}

const renderExtensionEditorBase=renderSystemExtensionEditor;
renderSystemExtensionEditor=function(item,target=null){
  const node=target||document.getElementById("system-extension-editor");
  if(item?.type==='agent-runtime'){
    if(node){
      node.innerHTML=renderAgentRuntimeEditor(item);
      if((codexRuntimeStatus?.defaultRuntime||'local-harness')==='local-harness')initializeLocalRuntimeSteps(node);
    }
    return;
  }
  renderExtensionEditorBase(item,node);
  if(item?.type==='model-provider'){
    const supplier=node.querySelector('#system-extension-connectionId');
    if(supplier){supplier.disabled=true;supplier.setAttribute('aria-disabled','true');}
  }
  if(item?.type!=='model-connection')return;
  const actions=node.querySelector('.configuration-form-actions>div');
  if(!actions)return;
  actions.insertAdjacentHTML('afterbegin','<button type="button" class="ghost-button" data-delete-model-connection style="color:var(--red)">删除供应商</button>');
  actions.querySelector('[data-delete-model-connection]').onclick=()=>deleteModelConnectionUnified(item).catch((error)=>toast(error.message,'error'));
};
function initializeLocalRuntimeSteps(editor){
  const steps=editor.querySelector('.local-model-setup-steps');
  if(!steps)return;
  steps.className='local-model-step-tabs';
  steps.setAttribute('role','tablist');
  steps.setAttribute('aria-label','本地 Runtime 配置步骤');
  steps.innerHTML='<li><button type="button" role="tab" aria-controls="agent-runtime-local-step-content" data-agent-runtime-model-step="supplier">01 添加供应商</button></li><li><button type="button" role="tab" aria-controls="agent-runtime-local-step-content" data-agent-runtime-model-step="model">02 添加模型</button></li><li><button type="button" role="tab" aria-controls="agent-runtime-local-step-content" data-agent-runtime-model-step="routing">03 阶段路由</button></li>';
  steps.insertAdjacentHTML('afterend','<div id="agent-runtime-local-step-content" class="local-model-step-content" role="tabpanel"></div>');
  showAgentRuntimeLocalStep(activeLocalRuntimeStep);
}
function showAgentRuntimeLocalStep(step){
  if(!['supplier','model','routing'].includes(step))return;
  activeLocalRuntimeStep=step;
  document.querySelectorAll('.local-model-step-tabs [data-agent-runtime-model-step]').forEach((button)=>{
    const active=button.dataset.agentRuntimeModelStep===step;
    button.classList.toggle('active',active);
    button.setAttribute('aria-selected',String(active));
  });
  const target=document.getElementById('agent-runtime-local-step-content');
  if(!target)return;
  if(step==='routing'){
    const item=extensionConfigurations.find((entry)=>entry.type==='system'&&entry.id==='llm-stage-routing');
    if(item){renderInlineStageRouting(item,target);return;}
    target.innerHTML='<div class="configuration-empty"><b>阶段路由配置暂不可用</b><span>请刷新配置目录后重试。</span></div>';
    return;
  }
  target.dataset.localSetup='true';
  const render=step==='supplier'?addModelConnection:addModelProvider;
  render({target,localSetup:true}).catch((error)=>toast(error.message,'error'));
}
function renderInlineStageRouting(item,target){
  renderSystemExtensionEditor(item,target);
  const form=target.querySelector('#system-extension-form');
  if(form)form.onsubmit=(event)=>{
    event.preventDefault();
    saveInlineStageRouting(item,form,target).catch((error)=>toast(error.message,'error'));
  };
}
async function saveInlineStageRouting(item,form,target){
  item.state=await request(extensionRoute(item),{method:'PUT',body:JSON.stringify(readSystemExtensionForm(form))});
  updateConfigurationReadiness();
  renderConfigurationList();
  toast('阶段模型路由已保存');
  renderInlineStageRouting(item,target);
}
function readSystemExtensionForm(form){return Object.fromEntries([...form.querySelectorAll("[data-system-extension-field]")].map((field)=>{let value=field.type==='checkbox'?field.checked:field.value;const type=field.dataset.valueType;if(type==='array')value=String(value).split(/\r?\n/).map((item)=>item.trim()).filter(Boolean);if((type==='integer'||type==='number')&&value!=='')value=Number(value);return [field.dataset.systemExtensionField,value];}));}
function agentRuntimeCatalogItem(){
  const defaultRuntime=codexRuntimeStatus?.defaultRuntime||'local-harness';
  return {type:'agent-runtime',id:'agent-runtime-settings',name:'执行环境与平台授权',state:{configured:defaultRuntime==='local-harness'||Boolean(codexRuntimeStatus?.configured),values:{defaultRuntime,connected:Boolean(codexRuntimeStatus?.configured)}}};
}
function updateConfigurationReadiness(){
  const catalogItems=extensionConfigurations.filter((item)=>!(item.type==='system'&&item.id==='llm-stage-routing'));
  const ready=catalogItems.filter((item)=>item.state.configured).length;
  const summary=document.getElementById("configuration-readiness");
  if(summary)summary.innerHTML=`<strong>${ready}/${catalogItems.length}</strong><span>目录能力配置项；其余按需配置，不代表整体就绪率</span>`;
}
async function loadExtensionConfigurations(){
  const result=await request("/api/system/configuration/catalog");
  extensionConfigurations=[agentRuntimeCatalogItem(),...(result.items||[])];
  updateConfigurationReadiness();
  const match=location.hash.match(/^#system\/configuration\/([^/]+)\/(.+)$/);
  if(match)selectedExtension=`${decodeURIComponent(match[1])}:${decodeURIComponent(match[2])}`;
  else if(!selectedExtension)try{selectedExtension=sessionStorage.getItem("system-extension-selection")||"";}catch{}
  const current=extensionConfigurations.find((item)=>`${item.type}:${item.id}`===selectedExtension);
  if(!current)selectedExtension=extensionConfigurations[0]?`${extensionConfigurations[0].type}:${extensionConfigurations[0].id}`:null;
  renderConfigurationList();
  renderSystemExtensionEditor(extensionConfigurations.find((item)=>`${item.type}:${item.id}`===selectedExtension));
}
async function loadCodexRuntimeStatus(){
  try{
    codexRuntimeStatus=await request('/api/agent-runtimes/codex/status');
    const itemIndex=extensionConfigurations.findIndex((item)=>item.type==='agent-runtime');
    if(itemIndex>=0)extensionConfigurations[itemIndex]=agentRuntimeCatalogItem();
    updateConfigurationReadiness();
    renderConfigurationList();
    if(selectedExtension==='agent-runtime:agent-runtime-settings')renderSystemExtensionEditor(extensionConfigurations[itemIndex]);
  }catch(error){
    codexRuntimeStatus={configured:false,defaultRuntime:'local-harness',availableRuntimes:['codex'],error:true};
    const itemIndex=extensionConfigurations.findIndex((item)=>item.type==='agent-runtime');
    if(itemIndex>=0)extensionConfigurations[itemIndex]=agentRuntimeCatalogItem();
    updateConfigurationReadiness();
    renderConfigurationList();
    if(selectedExtension==='agent-runtime:agent-runtime-settings')renderSystemExtensionEditor(extensionConfigurations[itemIndex]);
  }
}
async function connectCodexRuntime(){const result=await request('/api/agent-runtimes/codex/oauth/start',{method:'POST',body:'{}'});location.assign(result.authorizationUrl);}
async function saveDefaultAgentRuntime(defaultRuntime){const result=await request('/api/agent-runtimes/default',{method:'PUT',body:JSON.stringify({defaultRuntime})});const labels={'local-harness':'见字本地 Runtime',codex:'Codex Runtime',workbuddy:'WorkBuddy Runtime'};toast(`${labels[result.defaultRuntime]||result.defaultRuntime} 已设为默认 Agent Runtime`);await loadCodexRuntimeStatus();}
async function disconnectCodexRuntime(){if(!await confirmAction('断开 Codex 后，见字将不能再使用该 ChatGPT 授权运行 Agent。是否继续？',{confirmText:'断开连接'}))return;await request('/api/agent-runtimes/codex/oauth/disconnect',{method:'POST',body:'{}'});toast('Codex 账号已断开');await loadCodexRuntimeStatus();}
async function saveSystemExtension(item,form){const state=await request(extensionRoute(item),{method:"PUT",body:JSON.stringify(readSystemExtensionForm(form))});item.state=state;toast("扩展配置已保存");if(item.type==='model-provider'||item.type==='model-connection')await Promise.all([loadModelSettings(),loadExtensionConfigurations()]);else await loadExtensionConfigurations();renderConfigurationList();renderSystemExtensionEditor(extensionConfigurations.find((entry)=>`${entry.type}:${entry.id}`===`${item.type}:${item.id}`));}
async function testSystemExtension(item){
  if(item.type==='model-provider'){
    const result=await request("/api/models/test",{method:"POST",body:JSON.stringify({provider:item.id})});
    toast(`${result.provider} · ${result.model} · 连接成功`);return;
  }
  const result=await request(extensionRoute(item,"/test"),{method:"POST",body:"{}"});
  toast(result.pass?"扩展配置测试通过":"扩展配置尚未就绪");
}

function rsshubKvMarkup(field = { key: "", configured: false }, existing = false) {
  return `<div class="rsshub-kv-row" data-existing="${existing}">
    <input class="kv-key" data-rsshub-key value="${escapeHtml(field.key)}" placeholder="PLATFORM_TOKEN" ${existing ? "readonly" : ""} aria-label="环境变量名">
    <input class="kv-value" data-rsshub-value type="password" value="" placeholder="${field.configured ? "•••••••• · 留空保持原值" : "输入配置值"}" autocomplete="off" aria-label="${escapeHtml(field.key || "新环境变量")}的值">
    <span class="env-state ${field.configured ? "configured" : ""}">${field.configured ? "已配置" : "新增"}</span>
    <input type="checkbox" data-rsshub-clear hidden>
    <button type="button" class="kv-remove" data-rsshub-remove aria-label="删除 ${escapeHtml(field.key || "新环境变量")}">删除</button>
  </div>`;
}

function updateRsshubPendingHint() {
  const hint = document.getElementById("rsshub-pending-hint");
  if (!hint) return;
  const count = document.querySelectorAll("#rsshub-env-fields .rsshub-kv-row.pending-delete").length;
  hint.hidden = count === 0;
  hint.textContent = count ? `有 ${count} 项待删除，保存后生效` : "";
}

function renderRsshubKv(fields) {
  const node = document.getElementById("rsshub-env-fields");
  node.innerHTML = fields.length ? fields.map((field) => rsshubKvMarkup(field, true)).join("") : '<div class="kv-empty">尚无 RSSHub 环境变量，按需新增即可。</div>';
  updateRsshubPendingHint();
}

function addRsshubKvRow() {
  const node = document.getElementById("rsshub-env-fields");
  node.querySelector(".kv-empty")?.remove();
  node.insertAdjacentHTML("beforeend", rsshubKvMarkup());
  node.querySelector(".rsshub-kv-row:last-child .kv-key")?.focus();
}

async function loadModelSettings() {
  runtimeModels = await request("/api/models");
  // 与 main.js 共用一份模型快照，避免模型配置改动后其他视图拿到旧数据
  state.models = runtimeModels;
  window.__models = runtimeModels;
}

async function addModelConnection({target=null,localSetup=false}={}) {
  const editor=target||document.getElementById("system-extension-editor");
  if(!editor)return;
  editor.innerHTML=`<div class="config-panel-heading"><div><span class="kicker">MODEL CONNECTION</span><h4>添加供应商</h4></div><p>供应商连接只需配置一次；后续可以在它下面添加多个模型。</p></div>
  <form class="add-model-provider-form">
    <div class="model-config-grid">
      <label>供应商 ID<input id="mc-id" required pattern="[a-z0-9-]+" placeholder="例如：openai"></label>
      <label>供应商名称<input id="mc-label" required placeholder="例如：OpenAI"></label>
      <label class="wide">Base URL<input id="mc-base-url" required placeholder="https://api.example.com/v1"></label>
      <label class="wide">API Key<input id="mc-api-key" type="password" required autocomplete="new-password" placeholder="输入供应商 API Key"></label>
    </div>
    <div class="configuration-form-actions"><small>密钥加密保存在本机；供应商设置可在配置目录中继续维护。</small><div><button type="button" class="ghost-button" data-mc-cancel>取消</button><button type="submit" class="primary-button">保存并继续</button></div></div>
  </form>`;
  editor.querySelector("[data-mc-cancel]").onclick=()=>renderSystemExtensionEditor(extensionConfigurations.find((entry)=>`${entry.type}:${entry.id}`===selectedExtension));
  if(localSetup)editor.querySelector("[data-mc-cancel]").onclick=()=>showAgentRuntimeLocalStep('supplier');
  editor.querySelector("form").onsubmit=async(event)=>{
    event.preventDefault();
    const payload={id:editor.querySelector("#mc-id").value.trim().toLowerCase(),label:editor.querySelector("#mc-label").value.trim(),baseUrl:editor.querySelector("#mc-base-url").value.trim(),apiKey:editor.querySelector("#mc-api-key").value};
    const result=await request("/api/system/configuration/model-connection",{method:"POST",body:JSON.stringify(payload)});
    toast("供应商已注册");
    if(localSetup){
      await Promise.all([loadModelSettings(),loadExtensionConfigurations()]);
      showAgentRuntimeLocalStep('model');
      return;
    }
    selectedExtension=`model-connection:${result.id}`;
    await Promise.all([loadModelSettings(),loadExtensionConfigurations()]);
    renderConfigurationList();
    renderSystemExtensionEditor(extensionConfigurations.find((entry)=>`${entry.type}:${entry.id}`===selectedExtension));
  };
  editor.querySelector("#mc-id")?.focus();
}

async function addModelProvider({target=null,localSetup=false}={}) {
  const editor=target||document.getElementById("system-extension-editor");
  if(!editor)return;
  const connections=(extensionConfigurations.filter((item)=>item.type==='model-connection'));
  if(!connections.length){
    if(localSetup)editor.innerHTML='<div class="configuration-empty"><b>先完成第一步</b><span>添加供应商后，才能选择供应商并创建模型。</span><button type="button" class="outline-button" data-agent-runtime-step-action="supplier">去添加供应商</button></div>';
    else toast("请先添加一个供应商连接", "error");
    return;
  }
  const connectionOptions=connections.map((item)=>'<option value="'+escapeHtml(item.id)+'">'+escapeHtml(item.name||item.id)+'</option>').join('');
  editor.innerHTML=`<div class="config-panel-heading"><div><span class="kicker">MODEL PROVIDER</span><h4>添加模型</h4></div><p>注册新的 OpenAI 兼容模型渠道；密钥通过统一配置资源的凭据字段保存，不写入环境文件。</p></div>
  <form class="add-model-provider-form">
    <div class="model-config-grid">
      <label>配置 ID<input id="mp-id" readonly placeholder="保存时自动生成"><small>保存时按“供应商-模型”自动生成；同名冲突会追加序号。</small></label>
      <label>配置名称<input id="mp-label" required placeholder="例如：主力模型"></label>
      <label>供应商<select id="mp-connection" required>${connectionOptions}</select><small>地址、密钥和协议继承自供应商；模型能力单独配置。</small></label>
      <label>模型名称<input id="mp-name" required placeholder="gpt-4.1"></label>
      <label>上下文窗口<input id="mp-context-window" type="number" min="4096" value="128000"></label>
      <label>最大输出 Token<input id="mp-max-output" type="number" min="256" placeholder="16384"><small>可选，留空默认 16384。</small></label>
    </div>
    <div class="configuration-form-actions"><small>注册后即可在目录中编辑更多字段、设置凭据与默认模型。</small><div><button type="button" class="ghost-button" data-mp-cancel>取消</button><button type="submit" class="primary-button">创建并编辑</button></div></div>
  </form>`;
  if(localSetup&&lastCreatedLocalModelId)editor.insertAdjacentHTML('afterbegin','<div class="local-model-step-result"><b>默认模型已创建</b><span>'+escapeHtml(lastCreatedLocalModelId)+'</span><button type="button" class="text-button" data-open-local-runtime-model="'+escapeHtml(lastCreatedLocalModelId)+'">编辑模型参数 →</button></div>');
  editor.querySelector("[data-mp-cancel]").onclick=()=>renderSystemExtensionEditor(extensionConfigurations.find((entry)=>`${entry.type}:${entry.id}`===selectedExtension));
  if(localSetup)editor.querySelector("[data-mp-cancel]").onclick=()=>showAgentRuntimeLocalStep('model');
  editor.querySelector("form").onsubmit=async(event)=>{
    event.preventDefault();
    const payload={
      label:editor.querySelector("#mp-label").value.trim(),
      connectionId:editor.querySelector("#mp-connection").value,
      model:editor.querySelector("#mp-name").value.trim(),
      contextWindow:Number(editor.querySelector("#mp-context-window").value),
      maxOutputTokens:Number(editor.querySelector("#mp-max-output").value)||undefined,
      ...(localSetup?{makeDefault:true}:{}),
    };
    const result=await request("/api/system/configuration/model-provider",{method:"POST",body:JSON.stringify(payload)});
    toast("模型已注册");
    if(localSetup){
      lastCreatedLocalModelId=result.id;
      await Promise.all([loadModelSettings(),loadExtensionConfigurations()]);
      showAgentRuntimeLocalStep('model');
      return;
    }
    await loadModelSettings();
    await loadExtensionConfigurations();
    renderConfigurationList();
    renderSystemExtensionEditor(result.item||extensionConfigurations.find((entry)=>`${entry.type}:${entry.id}`===`model-provider:${result.id}`));
  };
  editor.querySelector("#mp-id")?.focus();
}

async function deleteModelProviderUnified(item) {
  const isDefault=item.id===runtimeModels?.defaultProvider;
  const fallback=runtimeModels?.providers?.find((provider)=>provider.name!==item.id&&provider.enabled!==false);
  let impact=`删除后，该模型将不能再被新任务选用；已指定「${item.id}」的任务会在运行时失败，需改选其他模型。`;
  if(isDefault){
    impact=fallback
      ?`「${item.id}」是当前默认模型，删除后默认模型将回退为「${fallback.label||fallback.name}」，新任务将改用它。`
      :`「${item.id}」是当前默认模型，且没有其他启用的模型可回退，删除会被服务端拒绝。`;
  }
  if(!await confirmAction(`${impact} 该模型的扩展配置与 API 凭据将一并清除，是否继续？`,{confirmText:"删除模型"}))return;
  await request(`/api/models/config/${encodeURIComponent(item.id)}`,{method:"DELETE"});
  toast("模型已删除");
  await Promise.all([loadModelSettings(),loadExtensionConfigurations()]);
}

async function deleteModelConnectionUnified(item){
  const models=extensionConfigurations.filter((entry)=>entry.type==='model-provider'&&entry.state.values?.connectionId===item.id);
  const impact=models.length
    ?`供应商「${item.name||item.id}」下还有 ${models.length} 个模型。请先删除这些模型或把它们改绑到其他供应商。`
    :`删除供应商「${item.name||item.id}」后，它的连接配置和 API Key 将被清除。`;
  if(!await confirmAction(impact,{confirmText:models.length?'知道了':'删除供应商'}))return;
  if(models.length)return;
  await request(`/api/system/configuration/model-connection/${encodeURIComponent(item.id)}`,{method:'DELETE'});
  toast('供应商已删除');
  selectedExtension=null;
  await Promise.all([loadModelSettings(),loadExtensionConfigurations()]);
  renderConfigurationList();
}

async function loadRuntimeSettings() {
  const data = await request("/api/system/settings");
  runtimeSettings = data;
  renderRsshubKv(data.rsshub);
  document.getElementById("runtime-paths").innerHTML = `<span><b>工作区</b>${escapeHtml(data.paths.workspaceRoot)}</span><span><b>RSSHub</b>${escapeHtml(data.paths.rsshubRoot)}</span><span><b>服务</b>${escapeHtml(data.paths.rsshubUrl)} · ${escapeHtml(data.paths.redditCdpUrl)}</span>`;
}

async function saveRsshubConfiguration(button) {
  const original=button.textContent;button.disabled=true;button.textContent="保存中…";
  try{await request("/api/system/settings",{method:"PUT",body:JSON.stringify({app:[],rsshub:collectRsshubFields()})});await loadRuntimeSettings();const item=extensionConfigurations.find((entry)=>entry.id==='rsshub-collector');if(item)renderSystemExtensionEditor(item);toast("RSSHub 扩展变量已保存");}
  finally{button.disabled=false;button.textContent=original;}
}

function collectRsshubFields() {
  return [...document.querySelectorAll("#rsshub-env-fields .rsshub-kv-row")].map((row) => ({
    key: row.querySelector("[data-rsshub-key]").value,
    value: row.querySelector("[data-rsshub-value]").value,
    clear: row.querySelector("[data-rsshub-clear]").checked,
  }));
}

export default async function loadSystemView() {
  bindSystem();
  await Promise.all([loadRuntimeSettings(), loadModelSettings(), loadExtensionConfigurations(), loadCodexRuntimeStatus()]);
  renderConfigurationList();
}
