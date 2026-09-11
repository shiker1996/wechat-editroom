import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { poll } from "../core/poll.js";
import { LOG_LIST_LIMIT, LOG_POLL_INTERVAL_MS, RUN_TRACE_POLL_INTERVAL_MS } from "../core/constants.js";
import { escapeHtml, formatDate, toast } from "../core/ui.js";

let bound = false;
let currentLogType;
let currentLogQuery = "";
let currentLogStatus = "";
let logsPoller = null;
let traceDetailRecords = new Map();
let traceReplayFixture = null;
let traceSegmentFilter = null;
let tracePoller = null;
let activeTraceId = "";
let traceFingerprint = "";
let traceRefreshInFlight = false;
let traceWaterfallExpanded = new Set();
let traceWaterfallFilterId = "";
const TRACE_OVERVIEW_MIN_HEIGHT = 0;
const TRACE_OVERVIEW_HEIGHT_KEY = "write-assistant.run-trace-overview-height";
const RETRYABLE_RUN_STATUSES = new Set(["failed", "aborted", "interrupted", "limit"]);

function traceFailedToolRunIds(trace = {}) {
  const ids = new Set();
  const failedStatus = (value) => ["failed", "error"].includes(String(value || "").toLowerCase());
  for (const call of [...(trace.toolCalls || []), ...(trace.toolExecutions || [])]) {
    if ((failedStatus(call.status) || Boolean(call.error_code || call.errorCode)) && (call.agent_run_id || call.agentRunId)) {
      ids.add(String(call.agent_run_id || call.agentRunId));
    }
  }
  for (const item of trace.events || []) {
    const event = item?.event || item || {};
    const failed = String(event.type || "").toLowerCase() === "tool.failed" ||
      (String(event.type || "").toLowerCase().startsWith("tool.") && (failedStatus(event.status) || Boolean(event.error)));
    if (failed && (event.agentRunId || event.agent_run_id)) ids.add(String(event.agentRunId || event.agent_run_id));
  }
  return ids;
}

function traceStatus(trace = {}) {
  const runs = Array.isArray(trace.runs) ? trace.runs : trace.run ? [trace.run] : [];
  const statuses = new Set(["failed", "aborted", "interrupted", "limit", "cancelled"]);
  if (runs.some((run) => ["running", "testing"].includes(String(run.status || "").toLowerCase()))) return "running";
  const sourceRuns = [...(trace.sourceRuns || []), ...(trace.subscriptionRuns || [])];
  if (String(trace.status || "").toLowerCase() === "failed" || runs.some((run) => statuses.has(String(run.status || "").toLowerCase())) || traceFailedToolRunIds(trace).size || sourceRuns.some((run) => ["failed", "error", "partial"].includes(String(run.status || "").toLowerCase()) || run.error)) return "failed";
  if (runs.length && runs.every((run) => String(run.status || "").toLowerCase() === "completed")) return "completed";
  return String(trace.status || runs[0]?.status || "idle").toLowerCase();
}

function traceOverviewHeightBounds() {
  const viewportHeight = Number(window.innerHeight || 720);
  return { min: TRACE_OVERVIEW_MIN_HEIGHT, max: Math.max(TRACE_OVERVIEW_MIN_HEIGHT, viewportHeight - 190) };
}

function setTraceOverviewHeight(value, { persist = true } = {}) {
  const overview = document.getElementById("run-trace-overview");
  const resizer = document.getElementById("run-trace-resizer");
  if (!overview || !resizer) return 0;
  const bounds = traceOverviewHeightBounds();
  const height = Math.round(Math.min(bounds.max, Math.max(bounds.min, Number(value) || bounds.min)));
  overview.style.setProperty("--run-trace-overview-height", `${height}px`);
  resizer.setAttribute("aria-valuemin", String(bounds.min));
  resizer.setAttribute("aria-valuemax", String(bounds.max));
  resizer.setAttribute("aria-valuenow", String(height));
  resizer.setAttribute("aria-valuetext", `轨迹区域高度 ${height} 像素`);
  if (persist) {
    try { window.localStorage.setItem(TRACE_OVERVIEW_HEIGHT_KEY, String(height)); } catch { /* storage unavailable */ }
  }
  return height;
}

function restoreTraceOverviewHeight() {
  try {
    const value = Number(window.localStorage.getItem(TRACE_OVERVIEW_HEIGHT_KEY));
    if (Number.isFinite(value) && value > 0) setTraceOverviewHeight(value);
  } catch { /* storage unavailable */ }
}

function bindTraceOverviewResizer() {
  const resizer = document.getElementById("run-trace-resizer");
  if (!resizer || resizer.dataset.bound === "true") return;
  resizer.dataset.bound = "true";
  const keyboardStep = 24;
  resizer.addEventListener("keydown", (event) => {
    const measured = document.getElementById("run-trace-overview")?.getBoundingClientRect().height;
    const current = Number.isFinite(measured) ? measured : Number(resizer.getAttribute("aria-valuenow")) || 300;
    const keys = ["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const bounds = traceOverviewHeightBounds();
    const delta = event.key === "ArrowUp" ? -keyboardStep : event.key === "ArrowDown" ? keyboardStep : event.key === "PageUp" ? -keyboardStep * 4 : event.key === "PageDown" ? keyboardStep * 4 : 0;
    setTraceOverviewHeight(event.key === "Home" ? bounds.min : event.key === "End" ? bounds.max : current + delta);
  });
  resizer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const overview = document.getElementById("run-trace-overview");
    if (!overview) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = overview.getBoundingClientRect().height;
    const pointerId = event.pointerId;
    resizer.classList.add("is-dragging");
    document.body.classList.add("run-trace-resizing");
    resizer.setPointerCapture?.(pointerId);
    const move = (moveEvent) => setTraceOverviewHeight(startHeight + moveEvent.clientY - startY, { persist: false });
    const end = () => {
      resizer.releasePointerCapture?.(pointerId);
      resizer.classList.remove("is-dragging");
      document.body.classList.remove("run-trace-resizing");
      const finalHeight = Number(resizer.getAttribute("aria-valuenow"));
      if (Number.isFinite(finalHeight)) setTraceOverviewHeight(finalHeight);
      resizer.removeEventListener("pointermove", move);
      resizer.removeEventListener("pointerup", end);
      resizer.removeEventListener("pointercancel", end);
      resizer.removeEventListener("lostpointercapture", end);
    };
    resizer.addEventListener("pointermove", move);
    resizer.addEventListener("pointerup", end);
    resizer.addEventListener("pointercancel", end);
    resizer.addEventListener("lostpointercapture", end);
  });
  restoreTraceOverviewHeight();
}

function setTraceLiveStatus(message) {
  const live = document.querySelector("#run-trace-dialog .run-trace-live");
  if (live) live.innerHTML = `<i></i> ${escapeHtml(message)}`;
}

function traceDataFingerprint(trace = {}, metrics = {}) {
  const last = (items = []) => {
    const item = items[items.length - 1] || {};
    return [item.id, item.sequence, item.created_at, item.finished_at, item.status].filter(Boolean).join(":");
  };
  const runState = (trace.runs || []).map((run) => [run.id, run.status, run.finished_at || run.finishedAt].join(":")).join("|");
  const sourceRuns = [...(trace.sourceRuns || []), ...(trace.subscriptionRuns || [])];
  return [runState, trace.events?.length || 0, last(trace.events), trace.modelCalls?.length || 0, last(trace.modelCalls), trace.toolCalls?.length || 0, last(trace.toolCalls), trace.checkpoints?.length || 0, last(trace.checkpoints), sourceRuns.length, last(sourceRuns), metrics.durationMs, metrics.modelCalls, metrics.toolCalls].join("/");
}

function shouldFollowScrollEnd(element, threshold = 32) {
  if (!element) return true;
  return element.scrollHeight - element.clientHeight - element.scrollTop <= threshold;
}

function traceContent(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function traceTime(value) {
  const text = String(value || "");
  return text ? text.replace("T", " ").replace(/\.\d{3}Z$/, "").replace(/Z$/, "") : "—";
}

function traceDate(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function tracePreview(value, limit = 180) {
  const text = traceContent(value).replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function boundedDetailText(value, limit = 6000) {
  const text = traceContent(value);
  if (text.length <= limit) return text;
  const head = Math.max(240, Math.floor(limit * 0.72));
  const tail = Math.max(120, limit - head);
  return `${text.slice(0, head)}\n\n… 已截断 ${text.length - head - tail} 字符，完整内容请下载运行输入 …\n\n${text.slice(-tail)}`;
}

function runInputData(runInput) {
  return runInput?.input || runInput || {};
}

function inputDownloadUrl(stageId = '', attempt = null) {
  if (!activeTraceId) return '';
  const query = new URLSearchParams();
  if (stageId) query.set('stageId', stageId);
  if (attempt != null) query.set('attempt', String(attempt));
  return `/api/runs/${encodeURIComponent(activeTraceId)}/input/download${query.toString() ? `?${query}` : ''}`;
}

function modelInputForCall(call, replayFixture, runInput) {
  const data = runInputData(runInput);
  const callId = call?.id ?? call?.call_id ?? call?.callId;
  const stageId = call?.stage_id || call?.stageId || '';
  const stage = (data.stages || []).find((item) => String(item.modelCallId ?? '') === String(callId))
    || (data.stages || []).find((item) => stageId && String(item.stageId || '') === String(stageId));
  const snapshotId = call?.generation_snapshot_id || call?.generationSnapshotId || '';
  const snapshot = (replayFixture?.snapshots || []).find((item) => String(item.id) === String(snapshotId));
  const messages = Array.isArray(snapshot?.promptMessages) ? snapshot.promptMessages : [];
  if (messages.length) {
    const prompt = messages.map((message) => `[${String(message.role || 'context').toUpperCase()}]\n${traceContent(message.content)}`).join('\n\n');
    return { inputPreview: boundedDetailText(prompt), inputLabel: 'Model Prompt 输入', inputSource: `generation snapshot #${snapshot.id}`, inputStageId: stageId, inputDownload: inputDownloadUrl(stageId) };
  }
  if (stage?.preview) return { inputPreview: boundedDetailText(stage.preview), inputLabel: '阶段模型输入', inputSource: stage.stageId || stageId || '运行输入', inputStageId: stage.stageId || stageId, inputAttempt: stage.attempt, inputDownload: inputDownloadUrl(stage.stageId || stageId, stage.attempt) };
  const record = (data.records || []).find((item) => stageId && String(item.stageId || '') === String(stageId)) || (data.records || [])[0];
  return record?.preview ? { inputPreview: boundedDetailText(record.preview), inputLabel: '运行输入', inputSource: record.label || '任务输入', inputStageId: record.stageId || stageId, inputDownload: inputDownloadUrl(record.stageId || stageId) } : null;
}

function inputForRun(run, runInput) {
  const data = runInputData(runInput);
  const stageId = run?.stage_id || run?.stageId || '';
  const stage = (data.stages || []).find((item) => stageId && String(item.stageId || '') === String(stageId));
  const record = (data.records || []).find((item) => stageId && String(item.stageId || '') === String(stageId)) || (data.records || [])[0];
  const value = stage?.preview || record?.preview;
  return value ? { inputPreview: boundedDetailText(value), inputLabel: stage ? '阶段输入' : '运行输入', inputSource: stage?.stageId || record?.label || '任务输入', inputStageId: stage?.stageId || record?.stageId || stageId, inputAttempt: stage?.attempt, inputDownload: inputDownloadUrl(stage?.stageId || record?.stageId || stageId, stage?.attempt) } : null;
}

function traceRecordRef(kind, record = {}, index = 0) {
  const identity = record.id || record.call_id || record.callId || record.sequence || record.created_at || record.started_at || "item";
  return `${kind}:${identity}:${index}`;
}

function traceToolEntries(trace = {}) {
  const calls = Array.isArray(trace.toolCalls) && trace.toolCalls.length ? trace.toolCalls : (trace.toolExecutions || []);
  const eventsByRequest = new Map();
  (trace.events || []).forEach((item) => {
    const event = item.event || item;
    if (!String(event.type || "").startsWith("tool.")) return;
    const requestId = event.requestId || event.request_id || event.toolCallId || event.tool_call_id;
    if (!requestId) return;
    const key = String(requestId);
    if (!eventsByRequest.has(key)) eventsByRequest.set(key, []);
    eventsByRequest.get(key).push(item);
  });
  return calls.map((call, index) => {
    const requestId = String(call.request_id || call.requestId || call.agent_tool_call_id || call.id || "");
    const lifecycle = eventsByRequest.get(requestId) || [];
    const requested = lifecycle.find((item) => String((item.event || item).type || "") === "tool.requested");
    const completed = lifecycle.find((item) => /tool\.(completed|failed)/.test(String((item.event || item).type || "")));
    const eventTime = (item) => item?.created_at || item?.event?.created_at || "";
    return {
      ...call,
      kind: "tool",
      traceRef: traceRecordRef("tool", call, index),
      time: eventTime(requested) || call.started_at || call.created_at || "",
      endTime: eventTime(completed) || call.finished_at || call.completed_at || "",
      lifecycleCount: lifecycle.length,
    };
  });
}

function traceToolRefMap(trace = {}) {
  return new Map(traceToolEntries(trace).map((call) => [String(call.request_id || call.requestId || call.agent_tool_call_id || call.id || ""), call.traceRef]));
}

function classifyTraceEvent(event = {}) {
  const type = String(event.type || event.name || "event").toLowerCase();
  if (/^model\./.test(type) || /model|llm/.test(type)) return "model";
  if (/^tool\./.test(type) || /tool|capability/.test(type)) return "tool";
  if (/checkpoint|artifact|snapshot|save/.test(type)) return "checkpoint";
  if (/^run\./.test(type) || /run|stage|workflow/.test(type)) return "system";
  if (/prompt|message|input|user/.test(type)) return "prompt";
  return "context";
}

function traceEventLabel(event = {}) {
  const type = String(event.type || event.name || "event");
  const labels = {
    system: "系统",
    "run.started": "运行启动", "run.completed": "运行完成", "run.failed": "运行失败",
    "run.cancelled": "运行取消", "run.retry": "运行重试", "tool.requested": "工具请求",
    "tool.running": "工具执行中", "tool.completed": "工具完成", "tool.failed": "工具失败",
    "model.thinking": "模型思考",
  };
  return labels[type] || type;
}

function traceRunMap(trace) {
  return new Map((trace.runs || []).map((run) => [run.id, run]));
}

function traceTimeBounds(trace, runs, replayFixture = null) {
  const points = [];
  const add = (value) => { const ms = traceDate(value); if (Number.isFinite(ms) && ms !== Number.MAX_SAFE_INTEGER) points.push(ms); };
  const span = (start, end) => { add(start); add(end); };
  runs.forEach((run) => span(run.started_at || run.startedAt, run.finished_at || run.finishedAt));
  (trace.events || []).forEach((item) => add(item.created_at || item.event?.created_at));
  (trace.modelCalls || []).forEach((call) => { add(call.created_at); if (call.created_at && call.latency_ms != null) add(new Date(new Date(call.created_at).getTime() + Number(call.latency_ms || 0)).toISOString()); });
  [...(trace.toolCalls || []), ...(trace.toolExecutions || [])].forEach((call) => span(call.started_at || call.created_at, call.finished_at || call.completed_at));
  (trace.checkpoints || []).forEach((checkpoint) => add(checkpoint.created_at));
  [...(trace.sourceRuns || []), ...(trace.subscriptionRuns || [])].forEach((run) => span(run.started_at || run.startedAt, run.ended_at || run.endedAt));
  const start = points.length ? Math.min(...points) : Date.now();
  const end = points.length ? Math.max(start + 1, ...points) : start + 1;
  return { start, end, duration: Math.max(1, end - start) };
}

function traceSegment(laneKind, kind, start, end, bounds, title, ref = "", segmentClass = "run-trace-lane-segment") {
  const startMs = traceDate(start);
  const endMs = traceDate(end);
  if (startMs === Number.MAX_SAFE_INTEGER) return "";
  const left = Math.max(0, Math.min(99.5, (startMs - bounds.start) / bounds.duration * 100));
  const right = endMs === Number.MAX_SAFE_INTEGER ? left + 0.8 : Math.max(left + 0.8, Math.min(100, (endMs - bounds.start) / bounds.duration * 100));
  const endValue = endMs === Number.MAX_SAFE_INTEGER ? startMs : endMs;
  return `<button type="button" class="${escapeHtml(segmentClass)} ${escapeHtml(kind)}" data-trace-segment data-trace-segment-lane="${escapeHtml(laneKind)}" data-trace-segment-kind="${escapeHtml(kind)}" data-trace-segment-ref="${escapeHtml(ref)}" data-trace-segment-start="${startMs}" data-trace-segment-end="${endValue}" data-trace-time="${startMs}" style="left:${left.toFixed(2)}%;width:${Math.min(100 - left, right - left).toFixed(2)}%" title="${escapeHtml(title || kind)}" aria-label="${escapeHtml(title || kind)}"></button>`;
}

function clearTraceTimelineHighlight() {
  document.querySelectorAll("#run-trace-overview [data-trace-segment].is-highlighted").forEach((segment) => segment.classList.remove("is-highlighted"));
}

function clearTraceSegmentFilter() {
  traceSegmentFilter = null;
  traceWaterfallFilterId = "";
  document.querySelectorAll("#run-trace-overview [data-trace-segment].is-active").forEach((segment) => segment.classList.remove("is-active"));
  document.querySelectorAll("#run-trace-content .trace-row").forEach((row) => { row.hidden = false; row.classList.remove("is-time-filtered"); });
  const label = document.getElementById("run-trace-segment-selection");
  if (label) {
    label.hidden = true;
    const heading = label.querySelector("b");
    if (heading) heading.textContent = "时间筛选";
  }
  syncTraceWaterfallRows();
}

function traceWaterfallSubtree(rowId) {
  const rows = [...document.querySelectorAll("#run-trace-overview [data-trace-waterfall-id]")];
  const children = new Map();
  rows.forEach((row) => {
    const parent = row.dataset.traceWaterfallParent || "";
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(row);
  });
  const subtree = new Set();
  const visit = (id) => {
    if (!id || subtree.has(id)) return;
    subtree.add(id);
    (children.get(id) || []).forEach((child) => visit(child.dataset.traceWaterfallId));
  };
  visit(rowId);
  return { rows, children, subtree };
}

function syncTraceWaterfallRows() {
  const { rows, children } = traceWaterfallSubtree("");
  if (!rows.length) return;
  const filterSubtree = traceWaterfallFilterId ? traceWaterfallSubtree(traceWaterfallFilterId).subtree : null;
  const rowById = new Map(rows.map((row) => [row.dataset.traceWaterfallId, row]));
  rows.forEach((row) => {
    const id = row.dataset.traceWaterfallId || "";
    const hasChildren = (children.get(id) || []).length > 0;
    let visible = true;
    let parent = row.dataset.traceWaterfallParent || "";
    while (parent) {
      if (!traceWaterfallExpanded.has(parent)) { visible = false; break; }
      parent = rowById.get(parent)?.dataset.traceWaterfallParent || "";
    }
    row.hidden = !visible;
    row.classList.toggle("is-collapsed", hasChildren && !traceWaterfallExpanded.has(id));
    row.classList.toggle("is-expanded", hasChildren && traceWaterfallExpanded.has(id));
    row.classList.toggle("is-node-selected", id === traceWaterfallFilterId);
    if (hasChildren) row.setAttribute("aria-expanded", String(traceWaterfallExpanded.has(id)));
    else row.removeAttribute("aria-expanded");
  });
  if (!traceWaterfallFilterId) return;
  const selected = rowById.get(traceWaterfallFilterId);
  if (!selected) return;
  const refs = new Set();
  rows.forEach((row) => {
    if (filterSubtree.has(row.dataset.traceWaterfallId) && row.dataset.traceRef) refs.add(row.dataset.traceRef);
  });
  document.querySelectorAll("#run-trace-content .trace-row").forEach((row) => {
    row.hidden = !refs.has(row.dataset.traceRef || "");
    row.classList.toggle("is-time-filtered", !row.hidden);
  });
  const label = document.getElementById("run-trace-segment-selection");
  if (label) {
    label.hidden = false;
    const heading = label.querySelector("b");
    if (heading) heading.textContent = "节点筛选";
    const labelText = label.querySelector("[data-trace-selection-text]");
    if (labelText) labelText.textContent = `${selected.querySelector("b")?.textContent || "当前节点"} · 当前节点及子节点日志`;
  }
}

function applyTraceWaterfallNodeFilter(row) {
  if (!row) return;
  const id = row.dataset.traceWaterfallId || "";
  if (!id) return;
  clearTraceSegmentFilter();
  const hasChildren = [...document.querySelectorAll("#run-trace-overview [data-trace-waterfall-parent]")].some((item) => item.dataset.traceWaterfallParent === id);
  if (hasChildren) {
    if (traceWaterfallExpanded.has(id)) traceWaterfallExpanded.delete(id);
    else traceWaterfallExpanded.add(id);
  }
  traceWaterfallFilterId = id;
  syncTraceWaterfallRows();
}

function applyTraceSegmentFilter(segment) {
  if (!segment) return clearTraceSegmentFilter();
  traceWaterfallFilterId = "";
  syncTraceWaterfallRows();
  const start = Number(segment.dataset.traceSegmentStart);
  const end = Number(segment.dataset.traceSegmentEnd);
  const lane = segment.dataset.traceSegmentLane || "system";
  const ref = segment.dataset.traceSegmentRef || "";
  const same = traceSegmentFilter && traceSegmentFilter.segment === segment;
  if (same) return clearTraceSegmentFilter();
  traceSegmentFilter = { segment, start, end, lane };
  document.querySelectorAll("#run-trace-overview [data-trace-segment].is-active").forEach((item) => item.classList.remove("is-active"));
  segment.classList.add("is-active");
  document.querySelectorAll("#run-trace-content [data-trace-filter]").forEach((button) => button.classList.toggle("active", button.dataset.traceFilter === "all"));
  const rows = [...document.querySelectorAll("#run-trace-content .trace-row")];
  const refMatches = ref && rows.some((row) => row.dataset.traceRef === ref);
  const kindMatches = (row) => {
    const kind = row.dataset.traceKind;
    if (lane === "model") return kind === "model";
    if (lane === "tool") return kind === "tool";
    if (lane === "input") return row.dataset.tracePrompt === "true" || kind === "prompt" || kind === "context";
    return kind === "system";
  };
  let matched = 0;
  rows.forEach((row) => {
    const time = Number(row.dataset.traceTime);
    const inRange = Number.isFinite(time) && time >= start && time <= Math.max(start, end);
    const visible = refMatches ? row.dataset.traceRef === ref : kindMatches(row) && inRange;
    row.hidden = !visible;
    row.classList.toggle("is-time-filtered", visible);
    if (visible) matched += 1;
  });
  if (!matched) {
    const candidates = rows.filter(kindMatches).sort((a, b) => Math.abs(Number(a.dataset.traceTime) - start) - Math.abs(Number(b.dataset.traceTime) - start));
    if (candidates[0]) { candidates[0].hidden = false; candidates[0].classList.add("is-time-filtered"); matched = 1; }
  }
  const label = document.getElementById("run-trace-segment-selection");
  if (label) {
    label.hidden = false;
    const labelText = label.querySelector("[data-trace-selection-text]");
    if (labelText) {
      labelText.textContent = lane === "tool"
        ? `${segment.title || "工具调用"} · 1 次调用 · ${Math.max(0, matched - 1)} 个生命周期事件`
        : `${segment.title || lane} · ${matched} 条日志`;
    }
  }
}

function highlightTraceTimeline(record) {
  clearTraceTimelineHighlight();
  if (!record?.time) return;
  const time = traceDate(record.time);
  if (time === Number.MAX_SAFE_INTEGER) return;
  const allowedKinds = record.kind === "model" ? ["model"] : record.kind === "tool" ? ["tool"] : record.kind === "checkpoint" ? ["checkpoint"] : ["prompt", "system"];
  const candidates = [...document.querySelectorAll("#run-trace-overview [data-trace-segment]")].filter((segment) => allowedKinds.includes(segment.dataset.traceSegmentKind));
  if (!candidates.length) return;
  const nearest = candidates.reduce((best, segment) => Math.abs(Number(segment.dataset.traceTime) - time) < Math.abs(Number(best.dataset.traceTime) - time) ? segment : best);
  nearest.classList.add("is-highlighted");
}

function registerTraceDetail(record) {
  const key = `trace-item-${traceDetailRecords.size + 1}`;
  traceDetailRecords.set(key, record);
  return key;
}

function showTraceDetail(key) {
  const record = traceDetailRecords.get(key);
  const panel = document.getElementById("run-trace-detail");
  const body = document.getElementById("run-trace-detail-body");
  const layout = document.querySelector(".run-trace-body");
  if (!record || !panel || !body) return;
  panel.hidden = false;
  layout?.classList.add("has-detail");
  const preview = record.preview ? traceContent(record.preview) : "暂无预览";
  const raw = traceContent(record.raw || record);
  const startTime = record.time ? traceTime(record.time) : "—";
  const endTime = record.endTime ? traceTime(record.endTime) : "";
  const duration = record.duration || (record.time && record.endTime ? `${Math.max(0, traceDate(record.endTime) - traceDate(record.time))} ms` : "");
  const round = record.round != null ? `<div><dt>轮次</dt><dd>第 ${escapeHtml(String(Number(record.round) + 1))} 轮</dd></div>` : "";
  const agentRun = record.agentRunId ? `<div><dt>运行</dt><dd>${escapeHtml(record.agentRunId)}</dd></div>` : "";
  const defaultDetailTab = record.inputPreview && record.kind === "system" ? "input" : record.kind === "model" || record.isPrompt ? "preview" : "summary";
  const detailTabButton = (value, label) => `<button type="button" class="run-trace-detail-tab${defaultDetailTab === value ? " active" : ""}" role="tab" aria-selected="${defaultDetailTab === value}" data-trace-detail-tab="${value}">${label}</button>`;
  const inputTab = record.inputPreview ? detailTabButton("input", "输入") : "";
  const inputBlock = record.inputPreview ? `<section class="run-trace-detail-panel run-trace-detail-input" data-trace-detail-panel="input" role="tabpanel"${defaultDetailTab === "input" ? "" : " hidden"}><div class="run-trace-detail-input-head"><h4>${escapeHtml(record.inputLabel || "运行输入")}</h4>${record.inputDownload ? `<a class="run-trace-input-download" href="${escapeHtml(record.inputDownload)}" download>下载完整输入</a>` : ""}</div>${record.inputSource ? `<small>${escapeHtml(record.inputSource)}</small>` : ""}<pre>${escapeHtml(record.inputPreview)}</pre></section>` : "";
  body.innerHTML = `<div class="run-trace-detail-kicker"><span class="trace-row-marker ${escapeHtml(record.kind || "context")}">${escapeHtml(record.marker || "CTX")}</span><span>${escapeHtml(record.label || "事件")}</span></div><dl class="run-trace-detail-meta"><div><dt>时间</dt><dd>${escapeHtml(startTime)}${endTime ? ` → ${escapeHtml(endTime)}` : ""}</dd></div><div><dt>来源</dt><dd>${escapeHtml(record.source || "运行事件")}</dd></div><div><dt>状态</dt><dd>${escapeHtml(record.status || "—")}</dd></div>${record.stage ? `<div><dt>阶段</dt><dd>${escapeHtml(record.stage)}</dd></div>` : ""}${round}${agentRun}${duration ? `<div><dt>耗时</dt><dd>${escapeHtml(duration)}</dd></div>` : ""}</dl><div class="run-trace-detail-tabs" role="tablist" aria-label="事件详情视图">${detailTabButton("summary", "概览")}${inputTab}${detailTabButton("preview", "预览")}${detailTabButton("raw", "原始内容")}</div>${inputBlock}<section class="run-trace-detail-panel run-trace-detail-preview" data-trace-detail-panel="summary" role="tabpanel"${defaultDetailTab === "summary" ? "" : " hidden"}><h4>时间摘要</h4><p>${escapeHtml(record.summary || "暂无摘要")}</p></section><section class="run-trace-detail-panel run-trace-detail-preview" data-trace-detail-panel="preview" role="tabpanel"${defaultDetailTab === "preview" ? "" : " hidden"}><h4>预览</h4><pre>${escapeHtml(preview)}</pre></section><section class="run-trace-detail-panel run-trace-detail-raw" data-trace-detail-panel="raw" role="tabpanel"${defaultDetailTab === "raw" ? "" : " hidden"}><h4>原始内容</h4><pre>${escapeHtml(raw)}</pre></section>`;
  highlightTraceTimeline(record);
  document.querySelectorAll("#run-trace-content .trace-row.is-selected").forEach((row) => row.classList.remove("is-selected"));
  document.querySelector(`#run-trace-content [data-trace-item="${CSS.escape(key)}"]`)?.classList.add("is-selected");
}

function closeTraceDetail() {
  const panel = document.getElementById("run-trace-detail");
  const layout = document.querySelector(".run-trace-body");
  if (panel) panel.hidden = true;
  layout?.classList.remove("has-detail");
  document.querySelectorAll("#run-trace-content .trace-row.is-selected").forEach((row) => row.classList.remove("is-selected"));
  clearTraceTimelineHighlight();
}

function focusTraceModelCall(modelCallId) {
  const id = String(modelCallId || '').trim();
  if (!id) return;
  const row = [...document.querySelectorAll('#run-trace-content .trace-row')]
    .find((item) => String(item.dataset.traceRef || '').startsWith(`model:${id}:`));
  if (!row) return toast('该模型调用已不在当前 Trace 留存范围内', 'error');
  row.hidden = false;
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  showTraceDetail(row.dataset.traceItem);
}

function bindLogs() {
  if (bound) return;
  bound = true;
  bindTraceOverviewResizer();
  document.getElementById("log-type-filter").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-log-type]");
    if (!btn) return;
    $$("[data-log-type]", document.getElementById("log-type-filter")).forEach((b) => {
      b.classList.toggle("active", b === btn);
      b.setAttribute("aria-selected", String(b === btn));
    });
    currentLogType = btn.dataset.logType || undefined;
    loadLogs(currentLogType).catch((error) => toast(error.message, "error"));
  });
  document.getElementById("log-refresh").addEventListener("click", () => {
    loadLogs(currentLogType).then(() => toast("日志已刷新")).catch((error) => toast(error.message, "error"));
  });
  document.getElementById("log-query")?.addEventListener("input", (event) => {
    currentLogQuery = String(event.target.value || "").trim().toLowerCase();
    loadLogs(currentLogType).catch((error) => toast(error.message, "error"));
  });
  document.getElementById("log-status")?.addEventListener("change", (event) => {
    currentLogStatus = String(event.target.value || "");
    loadLogs(currentLogType).catch((error) => toast(error.message, "error"));
  });
  document.getElementById("log-governance-save")?.addEventListener("click", () => saveLogGovernance().catch((error) => toast(error.message, "error")));
  document.getElementById("log-list").addEventListener("click", (event) => {
    const cancelButton = event.target.closest("[data-cancel-ai-job]");
    if (cancelButton) {
      event.preventDefault();
      if (!window.confirm("确认取消这个排队中的 AI 任务？")) return;
      cancelButton.disabled = true;
      request(`/api/jobs/${encodeURIComponent(cancelButton.dataset.cancelAiJob)}/cancel`, { method: "POST", body: "{}" })
        .then(() => { toast("排队任务已取消"); return loadLogs(currentLogType); })
        .catch((error) => { cancelButton.disabled = false; toast(error.message, "error"); });
      return;
    }
    const button = event.target.closest("[data-open-run-trace]");
    if (!button) return;
    event.preventDefault();
    openRunTrace(button.dataset.openRunTrace);
  });
  document.getElementById("close-run-trace")?.addEventListener("click", () => document.getElementById("run-trace-dialog")?.close());
  document.getElementById("close-run-trace-detail")?.addEventListener("click", closeTraceDetail);
  document.getElementById("run-trace-detail-body")?.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-trace-detail-tab]");
    if (!tab) return;
    const value = tab.dataset.traceDetailTab || "summary";
    const detailBody = document.getElementById("run-trace-detail-body");
    detailBody.querySelectorAll("[data-trace-detail-tab]").forEach((button) => {
      const active = button === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    detailBody.querySelectorAll("[data-trace-detail-panel]").forEach((section) => {
      section.hidden = section.dataset.traceDetailPanel !== value;
    });
  });
  const traceOverviewRoot = document.getElementById("run-trace-overview");
  traceOverviewRoot?.addEventListener("click", (event) => {
    const segment = event.target.closest("[data-trace-segment]");
    if (segment) { applyTraceSegmentFilter(segment); return; }
    if (event.target.closest("[data-clear-trace-segment]")) clearTraceSegmentFilter();
    const row = event.target.closest("[data-trace-waterfall-id]");
    if (row) applyTraceWaterfallNodeFilter(row);
  });
  traceOverviewRoot?.addEventListener("keydown", (event) => {
    const segment = event.target.closest("[data-trace-segment]");
    if (segment && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); applyTraceSegmentFilter(segment); }
    const row = event.target.closest("[data-trace-waterfall-id]");
    if (row && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); applyTraceWaterfallNodeFilter(row); }
  });
  const traceContentRoot = document.getElementById("run-trace-content");
  traceContentRoot?.addEventListener("click", (event) => {
    const filter = event.target.closest("[data-trace-filter]");
    if (filter) {
      clearTraceSegmentFilter();
      const value = filter.dataset.traceFilter || "all";
      traceContentRoot.querySelectorAll("[data-trace-filter]").forEach((button) => button.classList.toggle("active", button === filter));
      traceContentRoot.querySelectorAll("[data-trace-kind]").forEach((row) => {
        const kind = row.dataset.traceKind;
        const matches = value === "all" || kind === value || (value === "prompt" && row.dataset.tracePrompt === "true");
        row.hidden = !matches;
      });
      return;
    }
    const row = event.target.closest("[data-trace-item]");
    if (row) showTraceDetail(row.dataset.traceItem);
  });
  traceContentRoot?.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.closest("[data-trace-item]")) {
      event.preventDefault(); showTraceDetail(event.target.closest("[data-trace-item]").dataset.traceItem);
    }
  });
  document.getElementById("run-trace-input")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-focus-model-call]");
    if (!button) return;
    event.preventDefault();
    focusTraceModelCall(button.dataset.focusModelCall);
  });
  document.getElementById("run-trace-dialog")?.addEventListener("close", () => {
    tracePoller?.cancel();
    tracePoller = null;
    activeTraceId = "";
    traceFingerprint = "";
    traceRefreshInFlight = false;
    traceWaterfallExpanded = new Set();
    traceWaterfallFilterId = "";
    document.body.classList.remove("run-trace-open");
    closeTraceDetail();
    clearTraceSegmentFilter();
  });
}

async function loadLogGovernance() {
  const result = await request("/api/system/log-governance");
  const config = result.governance || {};
  const values = [["log-governance-model-limit", config.modelCallsLimit], ["log-governance-model-days", config.modelCallsDays], ["log-governance-tool-days", config.toolExecutionsDays]];
  values.forEach(([id, value]) => { const input = document.getElementById(id); if (input && value != null) input.value = value; });
  const archive = document.getElementById("log-governance-archive");
  if (archive && config.archiveEnabled != null) archive.checked = config.archiveEnabled !== false;
}

async function saveLogGovernance() {
  const read = (id) => Number(document.getElementById(id)?.value || 0);
  const status = document.getElementById("log-governance-status");
  const button = document.getElementById("log-governance-save");
  button.disabled = true;
  if (status) status.textContent = "正在保存并清理…";
  try {
    const result = await request("/api/system/log-governance", { method: "PUT", confirmation: "plugin-admin", body: JSON.stringify({ modelCallsLimit: read("log-governance-model-limit"), modelCallsDays: read("log-governance-model-days"), toolExecutionsDays: read("log-governance-tool-days"), archiveEnabled: Boolean(document.getElementById("log-governance-archive")?.checked), cleanup: true }) });
    if (status) status.textContent = `已保存；清理模型 ${result.cleanup?.modelCalls ?? 0} 条、工具 ${result.cleanup?.toolExecutions ?? 0} 条${result.cleanup?.archived ? `，归档 ${result.cleanup.archived} 条` : ""}`;
    toast("日志治理配置已保存");
  } finally { button.disabled = false; }
}

function traceRows(items, render, empty = "暂无记录") {
  if (!Array.isArray(items) || !items.length) return `<div class="run-trace-empty">${empty}</div>`;
  return items.map(render).join("");
}

function traceWaterfallEntries(trace, runs, replayFixture = null) {
  const rootRunId = trace.rootRunId || trace.root_run_id || runs.find((run) => !run.parent_run_id && !run.parentRunId)?.id || runs[0]?.id || "";
  const entries = [];
  const byId = new Map();
  const runNodeId = (id) => id ? `run:${id}` : "";
  const spanEnd = (record) => {
    const start = record.time || record.created_at || record.started_at || "";
    if (record.endTime || record.finished_at || record.completed_at) return record.endTime || record.finished_at || record.completed_at;
    if (record.latency_ms != null && start) return new Date(new Date(start).getTime() + Number(record.latency_ms || 0)).toISOString();
    if (record.duration_ms != null && start) return new Date(new Date(start).getTime() + Number(record.duration_ms || 0)).toISOString();
    return "";
  };
  const add = (node) => { entries.push(node); byId.set(node.id, node); return node; };
  const runForId = (id) => runs.find((run) => String(run.id) === String(id));
  const nearestRun = (time) => {
    const point = traceDate(time);
    const containing = runs.filter((run) => {
      const start = traceDate(run.started_at || run.startedAt);
      const end = traceDate(run.finished_at || run.finishedAt);
      return point !== Number.MAX_SAFE_INTEGER && start !== Number.MAX_SAFE_INTEGER && point >= start && point <= end;
    }).sort((a, b) => (traceDate(b.started_at || b.startedAt) - traceDate(a.started_at || a.startedAt)) || (traceDate(a.finished_at || a.finishedAt) - traceDate(b.finished_at || b.finishedAt)));
    return containing[0] || runs[0];
  };
  runs.forEach((run, index) => {
    const id = runNodeId(run.id);
    const parentId = run.parent_run_id || run.parentRunId ? runNodeId(run.parent_run_id || run.parentRunId) : (String(run.id) === String(rootRunId) ? "" : runNodeId(rootRunId));
    add({ id, parentId, depth: 0, kind: "system", lane: "system", marker: "SYS", traceRef: traceRecordRef("system-run", run, index), time: run.started_at || run.startedAt || "", endTime: run.finished_at || run.finishedAt || "", label: `运行 · ${run.entry_point || run.entryPoint || run.skill_id || run.skillId || run.id || "Workflow"}`, meta: `${run.stage_id || run.stageId || "job"} · ${run.status || "未知"}`, title: run.entry_point || run.entryPoint || run.skill_id || run.skillId || "运行" });
  });
  [...(trace.sourceRuns || []), ...(trace.subscriptionRuns || [])].forEach((run, index) => {
    const source = run.source || run.source_name || run.source_type || run.source_key || "采集来源";
    const start = run.started_at || run.startedAt || "";
    const end = run.ended_at || run.endedAt || "";
    const status = run.status || "未知";
    add({ id: `source:${run.id || index}:${source}`, parentId: runNodeId(run.root_run_id || run.rootRunId || rootRunId), depth: 0, kind: "context", lane: "source", marker: "SRC", traceRef: traceRecordRef("source", run, index), time: start, endTime: end, label: `${run.source_name ? "来源明细 · " : "采集 · "}${source}`, stage: run.stage_id || run.stageId || "collect", status, source: run.source_name ? "subscription_runs" : "source_runs", summary: `${run.item_count ?? 0} 条${run.error ? ` · ${run.error}` : ""}`, preview: run.error || run, raw: run, duration: start && end ? `${Math.max(0, traceDate(end) - traceDate(start))} ms` : "" });
  });
  const modelNodes = (trace.modelCalls || []).map((call, index) => add({ id: `model:${traceRecordRef("model", call, index)}`, parentId: runNodeId(call.agent_run_id || call.agentRunId || call.run_id || call.runId) || runNodeId(nearestRun(call.created_at)?.id), depth: 0, kind: "model", lane: "model", marker: "LLM", traceRef: traceRecordRef("model", call, index), time: call.created_at || "", endTime: spanEnd({ time: call.created_at, latency_ms: call.latency_ms }), label: call.purpose || call.model || "模型调用", meta: `${call.provider || "模型"} · ${call.model || "—"} · ${call.status || "未知"}`, title: call.purpose || call.model || "模型调用" }));
  const toolNodes = traceToolEntries(trace).map((call) => add({ id: `tool:${call.traceRef}`, parentId: runNodeId(call.agent_run_id || call.agentRunId || call.run_id || call.runId) || runNodeId(nearestRun(call.time)?.id), depth: 0, kind: "tool", lane: "tool", marker: "TOOL", traceRef: call.traceRef, time: call.time, endTime: call.endTime, label: call.capability || "工具调用", meta: `${call.status || "未知"} · ${call.lifecycleCount || 0} 个生命周期事件`, title: call.capability || "工具调用" }));
  const modelForTime = (time) => modelNodes.filter((node) => {
    const point = traceDate(time); const start = traceDate(node.time); const end = traceDate(node.endTime);
    return point !== Number.MAX_SAFE_INTEGER && start !== Number.MAX_SAFE_INTEGER && point >= start && point <= (end === Number.MAX_SAFE_INTEGER ? start : end);
  }).sort((a, b) => (traceDate(a.endTime) - traceDate(a.time)) - (traceDate(b.endTime) - traceDate(b.time)))[0];
  promptRowsFromTrace(trace, replayFixture).forEach((item, index) => {
    const parent = modelForTime(item.time) || nearestRun(item.time);
    add({ id: `input:${index}:${traceDate(item.time)}`, parentId: parent?.id || "", depth: 0, kind: item.kind === "system" ? "prompt" : item.kind, lane: "input", marker: item.marker || "USER", traceRef: item.traceRef || traceRecordRef("input", item, index), time: item.time, endTime: "", label: item.label || "提示词", meta: `${item.stage || "输入"} · ${item.status || "已记录"}`, title: item.label || "提示词" });
  });
  buildTraceEventItems(trace).filter((item) => item.kind === "system").forEach((item, index) => add({ id: `event:${index}:${traceDate(item.time)}`, parentId: runNodeId(item.agentRunId) || runNodeId(nearestRun(item.time)?.id), depth: 0, kind: "system", lane: "system", marker: "SYS", traceRef: item.traceRef || traceRecordRef("system", item, index), time: item.time, endTime: item.endTime || "", label: item.label || "系统事件", meta: `${item.source || "事件"} · ${item.status || "已记录"}`, title: item.label || "系统事件" }));
  (trace.checkpoints || []).forEach((checkpoint, index) => add({ id: `checkpoint:${index}`, parentId: runNodeId(checkpoint.agent_run_id || checkpoint.agentRunId) || runNodeId(nearestRun(checkpoint.created_at)?.id), depth: 0, kind: "checkpoint", lane: "checkpoint", marker: "SAVE", traceRef: traceRecordRef("checkpoint", checkpoint, index), time: checkpoint.created_at || "", endTime: "", label: `Checkpoint #${checkpoint.sequence ?? "—"}`, meta: checkpoint.state?.resumable ? "可恢复" : "已保存", title: "Checkpoint" }));
  const children = new Map();
  entries.forEach((entry) => { const parent = byId.has(entry.parentId) ? entry.parentId : ""; if (!children.has(parent)) children.set(parent, []); children.get(parent).push(entry); });
  children.forEach((items) => items.sort((a, b) => traceDate(a.time) - traceDate(b.time) || a.kind.localeCompare(b.kind)));
  const flattened = [];
  const walk = (parentId, depth) => { (children.get(parentId) || []).forEach((entry) => { entry.depth = depth; flattened.push(entry); walk(entry.id, depth + 1); }); };
  walk("", 0);
  return flattened;
}

function renderTraceOverview(trace, metrics, runs, replayFixture = null) {
  const overview = document.getElementById("run-trace-overview");
  if (!overview) return;
  const bounds = traceTimeBounds(trace, runs, replayFixture);
  const prompts = promptRowsFromTrace(trace, replayFixture);
  const tools = traceToolEntries(trace);
  const entries = traceWaterfallEntries(trace, runs, replayFixture);
  const status = traceStatus(trace);
  const statusLabel = status === "completed" ? "COMPLETED" : status === "running" || status === "testing" ? "RUNNING" : status.toUpperCase();
  const markerClass = (kind) => kind === "model" ? "model" : kind === "tool" ? "tool" : kind === "checkpoint" ? "checkpoint" : kind === "prompt" || kind === "context" ? "prompt" : "system";
  const rows = entries.map((entry) => {
    const segment = traceSegment(entry.lane, entry.kind, entry.time, entry.endTime, bounds, entry.title, entry.traceRef, "run-trace-waterfall-segment");
    const hasChildren = entries.some((child) => child.parentId === entry.id);
    const caret = `<span class="run-trace-waterfall-caret" aria-hidden="true">${hasChildren ? "▸" : "·"}</span>`;
    return `<div class="run-trace-waterfall-row" role="button" tabindex="0" aria-label="${escapeHtml(hasChildren ? `展开并筛选 ${entry.label || "节点"}` : `筛选 ${entry.label || "节点"}`)}" style="--trace-depth:${entry.depth}" data-trace-waterfall-id="${escapeHtml(entry.id)}" data-trace-waterfall-parent="${escapeHtml(entry.parentId || "")}" data-trace-ref="${escapeHtml(entry.traceRef || "")}" data-trace-waterfall-kind="${escapeHtml(entry.kind)}"><div class="run-trace-waterfall-label">${caret}<span class="trace-row-marker ${markerClass(entry.kind)}">${escapeHtml(entry.marker || "CTX")}</span><div><b>${escapeHtml(entry.label || "事件")}</b><small>${escapeHtml(entry.meta || "")}</small></div></div><div class="run-trace-waterfall-track">${segment}</div></div>`;
  }).join("");
  const sourceCount = (trace.sourceRuns?.length || 0) + (trace.subscriptionRuns?.length || 0);
  overview.innerHTML = `<div class="run-trace-waterfall-head"><span><b>CALL TREE</b><small>${entries.length} 个 span · 父子调用关系</small></span><span><b>WATERFALL</b><small>真实起止时间 · 可并行</small></span></div><div class="run-trace-waterfall-list">${rows || `<div class="run-trace-empty">暂无可视化链路</div>`}</div><div class="run-trace-overview-scale"><span>0 ms</span><span>${escapeHtml(String(metrics.durationMs ?? bounds.duration))} ms · ${escapeHtml(statusLabel)}</span></div><div class="run-trace-overview-legend"><span><i class="system"></i>运行/系统 ${runs.length}</span><span><i class="prompt"></i>输入 ${prompts.length}</span><span><i class="model"></i>模型 ${trace.modelCalls?.length || 0}</span><span><i class="tool"></i>工具 ${tools.length}</span><span><i class="checkpoint"></i>保存 ${trace.checkpoints?.length || 0}</span><span><i class="prompt"></i>采集来源 ${sourceCount}</span></div><div class="run-trace-segment-selection" id="run-trace-segment-selection" hidden><span><b>时间筛选</b><strong data-trace-selection-text></strong></span><button type="button" data-clear-trace-segment>清除筛选</button></div>`;
  syncTraceWaterfallRows();
}

function promptRowsFromTrace(trace, replayFixture) {
  const rows = [];
  (replayFixture?.snapshots || []).forEach((snapshot) => {
    const matchingModel = (trace.modelCalls || []).find((call) => String(call.generation_snapshot_id || call.generationSnapshotId || "") === String(snapshot.id));
    const snapshotTime = matchingModel?.created_at || trace.runs?.find((run) => run.generation_snapshot_id || run.generationSnapshotId)?.started_at || "";
    (snapshot.promptMessages || []).forEach((message, index) => {
      const role = String(message.role || "context").toLowerCase();
      rows.push({ kind: role === "system" ? "system" : role === "user" ? "prompt" : "context", marker: role === "system" ? "SYS" : role === "user" ? "USER" : "CTX", label: role === "system" ? "系统提示词" : role === "user" ? "用户提示词" : `${role} 消息`, stage: snapshot.purpose || "generation snapshot", status: "已固化", source: `提示词快照 #${snapshot.id}`, time: snapshotTime || snapshot.createdAt || "", summary: tracePreview(message.content, 220), preview: traceContent(message.content), raw: message, isPrompt: true, order: index });
    });
  });
  (trace.events || []).forEach((item) => {
    const event = item.event || item;
    const messages = Array.isArray(event.messages) ? event.messages : [];
    messages.forEach((message, index) => {
      const role = String(message.role || "context").toLowerCase();
      rows.push({ kind: role === "system" ? "system" : role === "user" ? "prompt" : "context", marker: role === "system" ? "SYS" : role === "user" ? "USER" : "CTX", label: role === "system" ? "系统提示词" : role === "user" ? "用户提示词" : `${role} 消息`, stage: event.stageId || event.stage_id || "", status: "事件载荷", source: event.type || "event", time: item.created_at || event.created_at || "", summary: tracePreview(message.content, 220), preview: traceContent(message.content), raw: message, isPrompt: true, order: index });
    });
  });
  return rows;
}

function buildTraceEventItems(trace) {
  const events = [...(trace.events || [])].sort((left, right) => traceDate(left.created_at || left.event?.created_at) - traceDate(right.created_at || right.event?.created_at) || Number(left.sequence || 0) - Number(right.sequence || 0));
  const runs = traceRunMap(trace);
  const toolRefs = traceToolRefMap(trace);
  const items = [];
  let thinkingGroup = null;
  events.forEach((item) => {
    const event = item.event || item;
    const type = String(event.type || event.name || "event");
    const run = runs.get(item.agent_run_id || event.agentRunId);
    if (type === "model.thinking") {
      if (thinkingGroup && thinkingGroup.agentRunId === (item.agent_run_id || event.agentRunId)) {
        thinkingGroup.count += 1;
        thinkingGroup.text += String(event.text || "");
        thinkingGroup.endTime = item.created_at || event.created_at || thinkingGroup.endTime;
        thinkingGroup.summary = `${thinkingGroup.count} 个增量片段 · ${tracePreview(thinkingGroup.text, 220)}`;
        thinkingGroup.raw.events.push(item);
        return;
      }
      thinkingGroup = { kind: "model", marker: "THINK", label: "模型思考", stage: run?.stage_id || run?.stageId || "", status: "增量摘要", source: "agent_run_events", time: item.created_at || event.created_at || "", endTime: item.created_at || event.created_at || "", summary: `1 个增量片段 · ${tracePreview(event.text || "模型思考", 220)}`, preview: String(event.text || "模型思考"), raw: { events: [item] }, agentRunId: item.agent_run_id || event.agentRunId || "", count: 1, text: String(event.text || "") };
      items.push(thinkingGroup);
      return;
    }
    thinkingGroup = null;
    const kind = classifyTraceEvent(event);
    const requestId = event.requestId || event.request_id || event.toolCallId || event.tool_call_id || "";
    const message = event.message || event.summary || event.reason || event.error || event.text || event.data || event.payload || "事件已记录";
    const status = event.status || (type.includes("completed") ? "completed" : type.includes("failed") ? "failed" : type.split(".")[1] || "事件");
    items.push({ kind, marker: kind === "model" ? "LLM" : kind === "tool" ? "TOOL" : kind === "system" ? "SYS" : kind === "checkpoint" ? "SAVE" : kind === "prompt" ? "USER" : "CTX", label: traceEventLabel(event), stage: event.stageId || event.stage_id || run?.stage_id || run?.stageId || "", status, source: type, time: item.created_at || event.created_at || "", summary: tracePreview(message, 220), preview: traceContent(message), raw: item, agentRunId: item.agent_run_id || event.agentRunId || "", isPrompt: kind === "prompt", traceRef: kind === "tool" ? (toolRefs.get(String(requestId)) || "") : "" });
  });
  return items;
}

function renderTraceTimeline(trace, replayFixture, runInput) {
  const items = [];
  const add = (item) => items.push({ ...item, timeMs: traceDate(item.time), order: items.length });
  (trace.runs || (trace.run ? [trace.run] : [])).forEach((run, index) => { const input = inputForRun(run, runInput); add({ kind: "system", marker: "SYS", label: `运行启动 · ${run.entry_point || run.entryPoint || run.skill_id || run.skillId || run.id || "Workflow"}`, stage: run.stage_id || run.stageId || "Workflow", status: run.status || "未知", source: "agent_runs", time: run.started_at || run.startedAt || "", endTime: run.finished_at || run.finishedAt || "", summary: `${run.status || "未知"}${run.finished_at ? ` · 结束于 ${traceTime(run.finished_at)}` : ""}`, preview: run.error || "运行阶段已记录", raw: run, duration: run.finished_at && run.started_at ? `${Math.max(0, new Date(run.finished_at) - new Date(run.started_at))} ms` : "", agentRunId: run.id, traceRef: traceRecordRef("system-run", run, index), ...(input || {}) }); });
  [...(trace.sourceRuns || []), ...(trace.subscriptionRuns || [])].forEach((run, index) => {
    const source = run.source || run.source_name || run.source_type || run.source_key || "采集来源";
    const start = run.started_at || run.startedAt || "";
    const end = run.ended_at || run.endedAt || "";
    add({ kind: "context", marker: "SRC", label: `${run.source_name ? "来源明细 · " : "采集 · "}${source}`, stage: run.stage_id || run.stageId || "collect", status: run.status || "未知", source: run.source_name ? "subscription_runs" : "source_runs", time: start, endTime: end, summary: `${run.item_count ?? 0} 条${run.error ? ` · ${run.error}` : ""}`, preview: run.error || run, raw: run, duration: start && end ? `${Math.max(0, traceDate(end) - traceDate(start))} ms` : "", traceRef: traceRecordRef("source", run, index) });
  });
  buildTraceEventItems(trace).forEach((item) => add(item));
  (trace.modelCalls || []).forEach((call, index) => { const input = modelInputForCall(call, replayFixture, runInput); add({ kind: "model", marker: "LLM", label: call.purpose || call.model || "模型调用", stage: call.stage_id || call.stageId || "", status: call.status || "未知", source: "model_calls", time: call.created_at || "", endTime: call.created_at && call.latency_ms != null ? new Date(new Date(call.created_at).getTime() + Number(call.latency_ms || 0)).toISOString() : "", summary: `${[call.provider, call.model].filter(Boolean).join(" · ") || "模型"} · ${call.latency_ms ?? 0} ms · prompt ${call.prompt_tokens ?? "—"} · completion ${call.completion_tokens ?? "—"}`, preview: call.error || call.output_text || call.reasoning_text || "模型调用已记录", raw: call, duration: call.latency_ms != null ? `${call.latency_ms} ms` : "", agentRunId: call.agent_run_id || call.agentRunId || "", round: call.agent_step ?? call.agentStep, traceRef: traceRecordRef("model", call, index), ...(input || {}) }); });
  traceToolEntries(trace).forEach((call) => {
    const lifecycleText = call.lifecycleCount ? ` · ${call.lifecycleCount} 个生命周期事件` : "";
    add({ kind: "tool", marker: "TOOL", label: call.capability || "工具调用", stage: call.stage_id || call.stageId || "", status: call.status || "未知", source: "tool_call", time: call.time, endTime: call.endTime, summary: `${call.side_effect || call.sideEffect || "none"} · 复用策略 ${call.replay_policy || call.replayPolicy || "never"}${lifecycleText}`, preview: traceContent(call.result_summary || call.error_code || call.input_summary || "工具调用已记录"), raw: call, duration: call.time && call.endTime ? `${Math.max(0, traceDate(call.endTime) - traceDate(call.time))} ms` : (call.duration_ms != null ? `${call.duration_ms} ms` : ""), agentRunId: call.agent_run_id || call.agentRunId || "", round: call.agent_step ?? call.agentStep, traceRef: call.traceRef });
  });
  (trace.checkpoints || []).forEach((checkpoint, index) => add({ kind: "checkpoint", marker: "SAVE", label: `Checkpoint #${checkpoint.sequence ?? "—"}`, stage: checkpoint.state?.phase || "", status: checkpoint.state?.resumable ? "可恢复" : "已保存", source: "agent_checkpoints", time: checkpoint.created_at || "", summary: checkpoint.state?.nextStep ? `下一步：${checkpoint.state.nextStep}` : "运行状态快照", preview: traceContent(checkpoint.state || checkpoint), raw: checkpoint, agentRunId: checkpoint.agent_run_id || "", traceRef: traceRecordRef("checkpoint", checkpoint, index) }));
  promptRowsFromTrace(trace, replayFixture).forEach((item, index) => add({ ...item, traceRef: item.traceRef || traceRecordRef("input", item, index) }));
  items.sort((left, right) => left.timeMs - right.timeMs || left.order - right.order);
  const counts = items.reduce((map, item) => { map[item.kind] = (map[item.kind] || 0) + 1; return map; }, {});
  const filterItems = [["all", "全部", items.length], ["prompt", "提示词", items.filter((item) => item.isPrompt).length], ["context", "事件", counts.context || 0], ["model", "模型", counts.model || 0], ["tool", "工具", counts.tool || 0], ["checkpoint", "保存", counts.checkpoint || 0]].filter(([value, , count]) => value === "all" || count > 0);
  const rows = items.map((item) => { const key = registerTraceDetail(item); const round = item.round != null ? `第 ${Number(item.round) + 1} 轮` : ""; const traceClass = ({ context: "trace-kind-context", model: "trace-kind-model", tool: "trace-kind-tool", checkpoint: "trace-kind-checkpoint", prompt: "trace-kind-prompt", system: "trace-kind-system" })[item.kind] || "trace-kind-context"; return `<article class="trace-row ${traceClass}" tabindex="0" role="button" data-trace-kind="${escapeHtml(item.kind)}" data-trace-prompt="${item.isPrompt ? "true" : "false"}" data-trace-time="${traceDate(item.time)}" data-trace-ref="${escapeHtml(item.traceRef || "")}" data-trace-item="${escapeHtml(key)}"><span class="trace-row-marker">${escapeHtml(item.marker || "CTX")}</span><div><b>${escapeHtml(item.label || "事件")}</b><span class="trace-row-subline">${escapeHtml([round, item.stage, item.status].filter(Boolean).join(" · "))}</span><small>${escapeHtml(item.summary || "")}</small></div><time>${escapeHtml(traceTime(item.time))}</time></article>`; }).join("");
  return `<section class="run-trace-section trace-kind-context run-trace-timeline-section"><div class="run-trace-section-heading"><h3><i>FLOW</i> Workflow / Agent Run · 按时间排序的事件流 <small>${items.length} 条</small></h3><div class="run-trace-filters" role="toolbar" aria-label="事件流筛选">${filterItems.map(([value, label, count]) => `<button type="button" class="run-trace-filter${value === "all" ? " active" : ""}" data-trace-filter="${value}">${label} <small>${count}</small></button>`).join("")}</div></div><div class="run-trace-list">${rows || `<div class="run-trace-empty">暂无事件记录</div>`}</div></section>`;
}

function renderRunInput(runInput, rootRunId) {
  const panel = document.getElementById("run-trace-input");
  if (!panel) return;
  const data = runInput?.input || runInput || {};
  const records = Array.isArray(data.records) ? data.records : [];
  const stages = Array.isArray(data.stages) ? data.stages : [];
  const downloadUrl = `/api/runs/${encodeURIComponent(rootRunId)}/input/download`;
  if (!data.available || (!records.length && !stages.length)) {
    panel.innerHTML = `<div class="run-trace-input-head"><span><b>RUN INPUT</b><small>业务输入</small></span></div><p class="run-trace-input-empty">${escapeHtml(data.message || "该运行未记录输入")}</p>`;
    return;
  }
  const recordMarkup = records.map((record) => `<article class="run-trace-input-record"><div class="run-trace-input-record-head"><b>${escapeHtml(record.label || "运行输入")}</b><span>${escapeHtml(String(record.length ?? 0))} 字符${record.truncated ? " · 已截断" : ""}</span></div><pre>${escapeHtml(record.preview || "")}</pre></article>`).join("");
  const stageMarkup = stages.length ? `<details class="run-trace-input-stages"><summary>阶段输入（${stages.length} 条）</summary>${stages.map((record) => { const stageId = String(record.stageId || ""); const stageDownload = `${downloadUrl}?stageId=${encodeURIComponent(stageId)}&attempt=${encodeURIComponent(String(record.attempt || 1))}`; const model = record.modelCall || null; const modelId = record.modelCallId ?? model?.id ?? null; const modelMeta = model ? `${model.provider || "模型"} · ${model.model || "—"} · prompt ${model.promptTokens ?? model.estimatedInputTokens ?? "—"} · completion ${model.completionTokens ?? "—"}` : (modelId ? `模型调用 #${modelId}` : "未关联模型调用"); const modelLink = modelId ? `<button type="button" class="run-trace-input-model-link" data-focus-model-call="${escapeHtml(String(modelId))}">查看模型调用</button>` : ""; return `<article class="run-trace-input-stage"><div><span><b>${escapeHtml(stageId || "阶段")}</b><span>Attempt ${escapeHtml(String(record.attempt || 1))} · ${escapeHtml(String(record.length ?? 0))} 字符${record.truncated ? " · 已截断" : ""}</span></span><span class="run-trace-input-stage-actions"><a class="run-trace-input-download" href="${stageDownload}" download>下载</a>${modelLink}</span></div><small class="run-trace-input-model-meta">${escapeHtml(modelMeta)}</small><pre>${escapeHtml(record.preview || "")}</pre></article>`; }).join("")}</details>` : "";
  panel.innerHTML = `<div class="run-trace-input-head"><span><b>RUN INPUT</b><small>业务输入 · 页面按范围预览</small></span><a class="run-trace-input-download" href="${downloadUrl}" download>下载完整输入</a></div><div class="run-trace-input-records">${recordMarkup}</div>${stageMarkup}`;
}

function renderRunTrace(trace, metrics, rootRunId, replayFixture = null, runInput = null) {
  const summary = document.getElementById("run-trace-summary");
  const content = document.getElementById("run-trace-content");
  const runs = trace.runs || (trace.run ? [trace.run] : []);
  traceDetailRecords = new Map();
  traceReplayFixture = replayFixture;
  renderTraceOverview(trace, metrics, runs, replayFixture);
  const metricItems = [
    ["Runs", metrics.runCount ?? runs.length], ["成功率", `${metrics.successRate ?? 0}%`],
    ["耗时", `${metrics.durationMs ?? 0} ms`], ["模型调用", metrics.modelCalls ?? trace.modelCalls?.length ?? 0],
    ["工具调用", metrics.toolCalls ?? trace.toolCalls?.length ?? 0], ["重试", `${metrics.retryRate ?? 0}%`],
    ["门禁失败", metrics.gateFailures ?? 0],
  ];
  summary.innerHTML = metricItems.map(([label, value]) => `<span><b>${escapeHtml(String(value))}</b><small>${escapeHtml(label)}</small></span>`).join("");
  const collectionTrace = runs.some((run) => run.entry_point === "collection" || run.entryPoint === "collection");
  document.getElementById("run-trace-title").textContent = `${collectionTrace ? "采集 Workflow Trace" : "运行详情"} · ${rootRunId}`;
  document.getElementById("run-trace-subtitle").textContent = collectionTrace ? "以调用树展示采集任务、来源执行、模型调用与质量过滤；时间条保留真实起止与并行关系。" : "以调用树展示任务、输入、Model、Tool 与 Checkpoint；时间条保留真实起止与并行关系。";
  content.innerHTML = renderTraceTimeline(trace, replayFixture, runInput);
  syncTraceWaterfallRows();
  const supportsActions = !collectionTrace;
  const active = supportsActions && (trace.runs || []).some((run) => ["running", "testing"].includes(run.status));
  const resumable = supportsActions && Boolean(trace.resumable);
  // 工具失败可能被 Agent 吸收为下一轮上下文，最终 Run 不一定是 failed；
  // 只看 Run 状态会把仍可恢复/重试的 Trace 渲染成无操作状态。
  const failedToolRuns = traceFailedToolRunIds(trace);
  const retryable = supportsActions && ((trace.runs || []).some((run) => RETRYABLE_RUN_STATUSES.has(String(run.status || "").toLowerCase())) || (trace.runs || []).some((run) => failedToolRuns.has(String(run.id)) && !["running", "testing"].includes(String(run.status || "").toLowerCase())));
  const actionsMarkup = `${active ? `<button type="button" class="ghost-button" data-run-action="cancel" data-run-id="${escapeHtml(rootRunId)}">取消运行</button>` : ""}${resumable ? `<button type="button" class="outline-button" data-run-action="resume" data-run-id="${escapeHtml(rootRunId)}">从 checkpoint 恢复</button>` : ""}${retryable ? `<button type="button" class="outline-button" data-run-action="retry" data-run-id="${escapeHtml(rootRunId)}">重试失败阶段</button>` : ""}`;
  summary.insertAdjacentHTML("beforeend", actionsMarkup ? `<span class="run-trace-summary-actions"><span class="run-trace-action-buttons">${actionsMarkup}</span><span class="run-trace-action-note">恢复和重试会再次校验能力、权限与快照。</span></span>` : "");
  summary.querySelectorAll("[data-run-action]").forEach((button) => button.addEventListener("click", () => runTraceAction(button.dataset.runAction, button.dataset.runId).catch((error) => toast(error.message, "error"))));
}

async function runTraceAction(action, rootRunId) {
  if (action === "cancel" && !window.confirm("确认取消当前运行？已完成的步骤不会回滚。")) return;
  const actions = document.getElementById("run-trace-summary");
  actions?.querySelectorAll("[data-run-action]").forEach((button) => { button.disabled = true; });
  try {
    const result = await request(`/api/runs/${encodeURIComponent(rootRunId)}/${action}`, { method: "POST", body: "{}" });
    if (result?.code === "RUN_ENTRY_CONTEXT_REQUIRED") toast(`请从「${result.entryPoint || "原业务入口"}」提交恢复请求（resumeFrom=${result.resumeFrom}）`, "error");
    else if (result?.requeued) {
      const nextRootRunId = result.newRootRunId || (result.id ? `job:${result.id}` : rootRunId);
      toast(action === "resume" ? "恢复任务已重新入队，正在打开新的 Run Trace" : "重试任务已重新入队，正在打开新的 Run Trace");
      await openRunTrace(nextRootRunId);
    } else { toast(action === "cancel" ? "取消请求已提交" : `${action === "resume" ? "恢复" : "重试"}预检完成`); await openRunTrace(rootRunId); }
  } catch (error) {
    if (error.data?.code === "RUN_ENTRY_CONTEXT_REQUIRED") toast(`请从「${error.data.entryPoint || "原业务入口"}」提交恢复请求（resumeFrom=${error.data.resumeFrom}）`, "error");
    else throw error;
  } finally { actions?.querySelectorAll("[data-run-action]").forEach((button) => { button.disabled = false; }); }
}

async function fetchTraceSnapshot(id, includeReplay = false) {
  const encoded = encodeURIComponent(id);
  const query = "?eventLimit=5000&modelCallLimit=2000&toolLimit=2000";
  const requestOptions = { cache: "no-store" };
  const requests = [request(`/api/runs/${encoded}${query}`, requestOptions), request(`/api/runs/${encoded}/metrics`, requestOptions), request(`/api/runs/${encoded}/input`, requestOptions)];
  if (includeReplay) requests.push(request(`/api/runs/${encoded}/replay`, requestOptions));
  const results = await Promise.allSettled(requests);
  if (results[0].status === "rejected") throw results[0].reason;
  return { trace: results[0].value, metrics: results[1].status === "fulfilled" ? results[1].value : {}, runInput: results[2].status === "fulfilled" ? results[2].value : { input: { available: false, message: "运行输入加载失败" } }, replayFixture: includeReplay && results[3]?.status === "fulfilled" ? results[3].value : null };
}

async function refreshOpenRunTrace(id, { initial = false } = {}) {
  const snapshot = await fetchTraceSnapshot(id, initial);
  const dialog = document.getElementById("run-trace-dialog");
  if (!dialog?.open || activeTraceId !== id) return { changed: false, active: false };
  const nextFingerprint = traceDataFingerprint(snapshot.trace, snapshot.metrics);
  const active = (snapshot.trace.runs || []).some((run) => ["running", "testing"].includes(run.status));
  if (!initial && nextFingerprint === traceFingerprint) return { changed: false, active };
  const selectedRef = document.querySelector("#run-trace-content .trace-row.is-selected")?.dataset.traceRef || "";
  const filterRef = document.querySelector("#run-trace-overview [data-trace-segment].is-active")?.dataset.traceSegmentRef || "";
  const detailWasOpen = !document.getElementById("run-trace-detail")?.hidden;
  const contentElement = document.getElementById("run-trace-content");
  const waterfallElement = document.querySelector(".run-trace-waterfall-list");
  const contentScrollTop = contentElement?.scrollTop || 0;
  const waterfallScrollTop = waterfallElement?.scrollTop || 0;
  const followContentTail = initial || shouldFollowScrollEnd(contentElement);
  const followWaterfallTail = initial || shouldFollowScrollEnd(waterfallElement);
  traceFingerprint = nextFingerprint;
  if (initial && snapshot.replayFixture) traceReplayFixture = snapshot.replayFixture;
  renderRunTrace(snapshot.trace, snapshot.metrics, id, traceReplayFixture, snapshot.runInput);
  if (selectedRef && detailWasOpen) {
    const selected = [...document.querySelectorAll("#run-trace-content .trace-row")].find((row) => row.dataset.traceRef === selectedRef);
    if (selected) showTraceDetail(selected.dataset.traceItem);
  }
  if (filterRef) {
    const segment = [...document.querySelectorAll("#run-trace-overview [data-trace-segment]")].find((item) => item.dataset.traceSegmentRef === filterRef);
    if (segment) applyTraceSegmentFilter(segment);
  }
  requestAnimationFrame(() => {
    const content = document.getElementById("run-trace-content");
    const waterfall = document.querySelector(".run-trace-waterfall-list");
    if (content) content.scrollTop = followContentTail ? content.scrollHeight : contentScrollTop;
    if (waterfall) waterfall.scrollTop = followWaterfallTail ? waterfall.scrollHeight : waterfallScrollTop;
  });
  const status = traceStatus(snapshot.trace);
  setTraceLiveStatus(active ? `LIVE CAPTURE · ${new Date().toLocaleTimeString()}` : `已${status === "failed" ? "失败" : "完成"} · ${new Date().toLocaleTimeString()}`);
  return { changed: true, active };
}

function startTraceAutoRefresh(id) {
  tracePoller?.cancel();
  activeTraceId = id;
  tracePoller = poll(async () => {
    const dialog = document.getElementById("run-trace-dialog");
    if (!dialog?.open || activeTraceId !== id) return true;
    if (traceRefreshInFlight) return false;
    traceRefreshInFlight = true;
    try {
      const result = await refreshOpenRunTrace(id);
      return !result.active;
    } catch {
      setTraceLiveStatus("LIVE CAPTURE · 同步失败，稍后重试");
      return false;
    } finally { traceRefreshInFlight = false; }
  }, { interval: RUN_TRACE_POLL_INTERVAL_MS, maxInterval: RUN_TRACE_POLL_INTERVAL_MS, timeout: Number.MAX_SAFE_INTEGER });
  tracePoller.promise.catch(() => {});
}

async function openRunTrace(rootRunId) {
  const id = String(rootRunId || "").trim();
  if (!id) return;
  tracePoller?.cancel();
  tracePoller = null;
  activeTraceId = id;
  traceFingerprint = "";
  traceRefreshInFlight = false;
  traceWaterfallExpanded = new Set();
  traceWaterfallFilterId = "";
  const dialog = document.getElementById("run-trace-dialog");
  document.getElementById("run-trace-title").textContent = `运行详情 · ${id}`;
  document.getElementById("run-trace-subtitle").textContent = "正在加载持久化 Trace…";
  document.getElementById("run-trace-overview")?.replaceChildren();
  document.getElementById("run-trace-summary").replaceChildren();
  document.getElementById("run-trace-input")?.replaceChildren();
  traceDetailRecords = new Map(); traceReplayFixture = null; closeTraceDetail();
  document.getElementById("run-trace-content").innerHTML = '<div class="empty-state">正在加载运行链路、提示词与执行记录…</div>';
  if (!dialog.open) { document.body.classList.add("run-trace-open"); dialog.showModal(); }
  setTraceLiveStatus("LIVE CAPTURE · 正在同步");
  try {
    const result = await refreshOpenRunTrace(id, { initial: true });
    if (result.active) startTraceAutoRefresh(id);
  } catch (error) {
    document.getElementById("run-trace-content").innerHTML = `<div class="empty-state">运行 Trace 加载失败：${escapeHtml(error.message || String(error))}</div>`;
    setTraceLiveStatus("LIVE CAPTURE · 加载失败");
  }
}

function discussionOutputForDisplay(item) {
  const raw = String(item.output_text || '').trim();
  if (item.subtype !== 'discussion-research' || !raw) return { text: raw, raw: '' };
  const heading = raw.match(/^[ \t]*#[ \t]+事件研判报告[ \t]*$/mu);
  if (!heading) return { text: raw, raw: '' };
  const text = raw.slice(heading.index).trim();
  return { text, raw: text === raw ? '' : raw };
}

// 模型调用日志：点击展开调用详情（元信息、文本输出、推理过程、原生工具调用）
function renderModelDetail(item, logKey) {
  const detailKey = escapeHtml(`${logKey}:detail`);
  let budget = null;
  if (item.output_budget_json) {
    try { budget = JSON.parse(item.output_budget_json); } catch { budget = null; }
  }
  const meta = [
    item.model ? `模型：${escapeHtml(item.model)}` : "",
    item.estimated_input_tokens != null ? `估算输入 ${item.estimated_input_tokens}` : "",
    item.prompt_tokens != null ? `prompt ${item.prompt_tokens}` : "",
    item.completion_tokens != null ? `completion ${item.completion_tokens}` : "",
    item.reasoning_tokens != null ? `reasoning ${item.reasoning_tokens}` : "",
    item.latency_ms != null ? `耗时 ${item.latency_ms}ms` : "",
    `压缩：${item.compressed ? "是" : "否"}`,
  ].filter(Boolean).map((part) => `<span>${part}</span>`).join("");
  const budgetBlock = budget
    ? `<details class="log-budget" data-log-detail="${escapeHtml(`${logKey}:budget`)}"><summary>输出预算</summary><pre class="log-output">${escapeHtml(JSON.stringify(budget, null, 2))}</pre></details>`
    : "";
  let toolCalls = [];
  if (item.tool_calls_json) {
    try { toolCalls = JSON.parse(item.tool_calls_json); } catch { toolCalls = []; }
  }
  if (!Array.isArray(toolCalls)) toolCalls = [];
  const toolBlock = toolCalls.length
    ? `<details class="log-tool-calls" data-log-detail="${escapeHtml(`${logKey}:tools`)}"><summary>原生工具调用（${toolCalls.length}）</summary><pre class="log-output">${escapeHtml(JSON.stringify(toolCalls, null, 2))}</pre></details>`
    : "";
  const displayOutput = discussionOutputForDisplay(item);
  const rawOutputBlock = displayOutput.raw
    ? `<details class="log-raw-output"><summary>原始输出（已隐藏前置进度文本）</summary><pre class="log-output">${escapeHtml(displayOutput.raw)}</pre></details>`
    : "";
  const outputBlock = displayOutput.text
    ? `<pre class="log-output">${escapeHtml(displayOutput.text)}</pre>${rawOutputBlock}`
    : toolCalls.length
      ? '<p class="log-output-empty">（本轮无文本输出，已留档原生工具调用）</p>'
      : item.reasoning_text
        ? '<p class="log-output-empty">（本轮无文本输出，已留档推理过程）</p>'
        : '<p class="log-output-empty">（无输出留档）</p>';
  const reasoningBlock = item.reasoning_text
    ? `<details class="log-reasoning" data-log-detail="${escapeHtml(`${logKey}:reasoning`)}"><summary>推理过程</summary><pre class="log-output">${escapeHtml(item.reasoning_text)}</pre></details>`
    : "";
  return `<details class="log-model-detail" data-log-detail="${detailKey}"><summary>调用详情</summary><div class="log-meta log-model-meta">${meta}</div>${budgetBlock}${outputBlock}${toolBlock}${reasoningBlock}</details>`;
}

async function loadLogs(logType) {
  const qs = logType ? `?type=${encodeURIComponent(logType)}&limit=${LOG_LIST_LIMIT}` : `?limit=${LOG_LIST_LIMIT}`;
  const logs = await request("/api/logs" + qs, { cache: "no-store" });
  const filteredLogs = logs.filter((item) => {
    if (currentLogStatus && String(item.status || "") !== currentLogStatus) return false;
    if (!currentLogQuery) return true;
    return `${item.id || ""} ${item.root_run_id || ""} ${item.workflow_run_id || ""} ${item.stage_id || ""} ${item.subtype || ""} ${item.message || ""}`.toLowerCase().includes(currentLogQuery);
  });
  document.getElementById("log-count").textContent = filteredLogs.length === logs.length ? `${logs.length} 条` : `${filteredLogs.length} / ${logs.length} 条`;
  const list = document.getElementById("log-list");
  const expandedDetails = new Set([...list.querySelectorAll("details[data-log-detail][open]")].map((detail) => detail.dataset.logDetail));
  list.innerHTML = filteredLogs.length
    ? filteredLogs.map((item) => {
        const ts = formatDate(item.ts, { year:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false });
        const sc =
          item.status === "completed" || item.status === "ok" || item.status === "success" ? "ok"
          : ["failed", "error", "interrupted", "aborted", "limit", "cancelled"].includes(item.status) ? "bad"
          : item.status === "running" || item.status === "testing" ? "running" : "idle";
        const tl = item.log_type === "collection" ? "采集任务" : item.log_type === "ai" ? "AI" : item.log_type === "source" ? "来源明细" : item.log_type === "model" ? "模型" : item.log_type;
        const message = item.message || "";
        // 超过 200 字符的消息截断展示，点击可展开完整内容
        const body = message.length > 200
          ? `<details class="log-expand"><summary>${escapeHtml(message.slice(0, 200))}…</summary><span>${escapeHtml(message)}</span></details>`
          : `<span>${escapeHtml(message)}</span>`;
        const logKey = `${item.log_type}:${item.id}`;
        const providerDisplay=item.log_type === "model" ? (item.provider_display || [item.provider,item.model].filter(Boolean).join(" · ")) : item.provider;
        const traceButton = item.root_run_id ? `<button type="button" class="inline-button log-trace-button" data-open-run-trace="${escapeHtml(item.root_run_id)}">${item.log_type === "collection" ? "查看采集 Workflow Trace" : "查看 Run Trace"}</button>` : "";
        const cancelButton = item.log_type === "ai" && item.status === "queued" ? `<button type="button" class="inline-button log-cancel-job-button" data-cancel-ai-job="${escapeHtml(item.id)}">取消排队</button>` : "";
        const actions = traceButton || cancelButton ? `<div class="log-actions">${traceButton}${cancelButton}</div>` : "";
        return `<article class="log-entry ${sc}"><div class="log-head"><span class="log-type-badge">${tl}</span><time>${escapeHtml(ts)}</time>${item.batch_id ? `<span class="log-batch">${escapeHtml(item.batch_id)}</span>` : ""}<span class="log-status status-pill ${sc}">${escapeHtml(item.status)}</span></div><div class="log-body"><code>${escapeHtml(item.subtype || "")}</code>${body}</div>${providerDisplay ? `<div class="log-meta"><span>${item.log_type === "model" ? "供应商 / 模型" : "服务商"}：${escapeHtml(providerDisplay)}</span></div>` : ""}${actions}${item.log_type === "model" ? renderModelDetail(item, logKey) : ""}</article>`;
      }).join("")
    : `<div class="empty-state">${logs.length ? "没有符合当前筛选条件的日志。" : "暂无日志记录。"}</div>`;
  list.querySelectorAll("details[data-log-detail]").forEach((detail) => {
    detail.open = expandedDetails.has(detail.dataset.logDetail);
  });
}

// 自动刷新：复用 poll.js，离开日志视图时静默结束轮询
function startLogsAutoRefresh() {
  logsPoller?.cancel();
  logsPoller = poll(async () => {
    if (!document.getElementById("view-logs")?.classList.contains("active")) return true;
    await loadLogs(currentLogType).catch(() => {});
    return false;
  }, { interval: LOG_POLL_INTERVAL_MS, maxInterval: LOG_POLL_INTERVAL_MS, timeout: Number.MAX_SAFE_INTEGER });
  logsPoller.promise.catch(() => {});
}
export default async function loadLogsView() {
  bindLogs();
  startLogsAutoRefresh();
  loadLogGovernance().catch(() => {});
  return loadLogs(currentLogType);
}

export { openRunTrace };
