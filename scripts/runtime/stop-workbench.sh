#!/usr/bin/env bash
# scripts/runtime/stop-workbench.ps1 的 Linux/macOS 对应版本。
# 用法: scripts/runtime/stop-workbench.sh [--port 4317]
set -e
cd "$(dirname "$0")/../.."
PORT=4317
while [ $# -gt 0 ]; do
  case "$1" in
    --port|-p) PORT="$2"; shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

# 读取与 Windows RSSHub 停止脚本相同的 pidFile/baseUrl 配置；没有 Node 时退回默认值。
RSSHUB_PID_FILE="data/rsshub.pid"
RSSHUB_PORT=1200
if command -v node >/dev/null 2>&1; then
  CONFIG_VALUES=$(node --input-type=module -e '
    import fs from "node:fs";
    import path from "node:path";
    const root = process.cwd();
    let config = {};
    try { config = JSON.parse(fs.readFileSync(path.join(root, "config.local.json"), "utf8")); } catch {}
    const pidFile = config.rsshub?.pidFile || "data/rsshub.pid";
    let port = 1200;
    try { port = Number(new URL(config.rsshub?.baseUrl || "http://127.0.0.1:1200").port) || 1200; } catch {}
    console.log(path.resolve(root, pidFile));
    console.log(port);
  ' 2>/dev/null || true)
  if [ -n "$CONFIG_VALUES" ]; then
    RSSHUB_PID_FILE=$(printf '%s\n' "$CONFIG_VALUES" | sed -n '1p')
    RSSHUB_PORT=$(printf '%s\n' "$CONFIG_VALUES" | sed -n '2p')
  fi
fi

stop_rsshub() {
  RSSHUB_STOPPED=0
  if [ -f "$RSSHUB_PID_FILE" ]; then
    RSSHUB_PID=$(tr -d '[:space:]' < "$RSSHUB_PID_FILE")
    RSSHUB_PID_VALID=1
    case "$RSSHUB_PID" in *[!0-9]*|0|'') RSSHUB_PID_VALID=0 ;; esac
    if [ "$RSSHUB_PID_VALID" -eq 1 ] && kill -0 "$RSSHUB_PID" 2>/dev/null; then
      if kill "$RSSHUB_PID" 2>/dev/null; then
        echo "已停止 RSSHub 服务 (PID $RSSHUB_PID)。"
        RSSHUB_STOPPED=1
      fi
    fi
    rm -f "$RSSHUB_PID_FILE"
  fi

  # PID 文件缺失或过期时，按配置端口兜底查找监听进程。
  if [ "$RSSHUB_STOPPED" -eq 0 ]; then
    RSSHUB_PIDS=""
    if command -v lsof >/dev/null 2>&1; then
      RSSHUB_PIDS=$(lsof -tiTCP:"$RSSHUB_PORT" -sTCP:LISTEN 2>/dev/null || true)
    elif command -v ss >/dev/null 2>&1; then
      RSSHUB_PIDS=$(ss -ltnp 2>/dev/null | grep ":$RSSHUB_PORT " | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true)
    fi
    if [ -n "$RSSHUB_PIDS" ]; then
      for RSSHUB_PID in $RSSHUB_PIDS; do
        if kill "$RSSHUB_PID" 2>/dev/null; then
          echo "已停止 RSSHub 端口 $RSSHUB_PORT 服务 (PID $RSSHUB_PID)。"
        fi
      done
    else
      echo "RSSHub 未在运行（端口 $RSSHUB_PORT）。"
    fi
  fi
}

stop_rsshub

stopped=0
# 优先用启动脚本记录的 pid 文件
if [ -f logs/workbench.pid ]; then
  PID=$(cat logs/workbench.pid)
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" && echo "已停止工作台服务 (PID $PID)。" && stopped=1
  fi
  rm -f logs/workbench.pid
fi

# 兜底：查找监听该端口的 node 进程
if [ "$stopped" -eq 0 ]; then
  PIDS=""
  if command -v lsof >/dev/null 2>&1; then
    PIDS=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
  elif command -v ss >/dev/null 2>&1; then
    PIDS=$(ss -ltnp 2>/dev/null | grep ":$PORT " | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)
  fi
  if [ -z "$PIDS" ]; then
    echo "端口 $PORT 上没有监听的进程，工作台未在运行。"
    exit 0
  fi
  for PID in $PIDS; do
    if [ "$(ps -p "$PID" -o comm= 2>/dev/null)" != "node" ]; then
      echo "端口 $PORT 被 PID $PID（非 node 进程）占用，跳过。"
      continue
    fi
    kill "$PID" && echo "已停止工作台服务 (PID $PID)。"
  done
fi
