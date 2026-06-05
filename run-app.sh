#!/usr/bin/env bash
# 以「桌面 app 模式」运行：单进程同源提供前端 + API（Phase 0）
# 开发时请仍用 frontend 的 npm run dev（带热更新），此脚本用于“当成品 app 跑”。
set -e
cd "$(dirname "$0")"

# 前端未构建则先构建
if [ ! -d frontend/dist ]; then
  echo "首次运行，正在构建前端…"
  (cd frontend && npm run build)
fi

echo "启动应用（FastAPI 同源托管前端 + API）…"
(cd backend && venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000) &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null" EXIT

# 等后端就绪（首启需加载本地模型，稍候）后自动打开
until curl -s http://localhost:8000/essays >/dev/null 2>&1; do sleep 1; done
echo "已就绪 → http://localhost:8000"
open http://localhost:8000 2>/dev/null || true

wait $SERVER_PID
