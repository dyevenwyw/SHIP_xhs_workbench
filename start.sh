#!/bin/bash
# 小红书创作工作台 一键启动脚本
# 用法: bash start.sh [server|web|all]
# 前置: 本机需安装 Node.js >= 18，并已执行 npm install
set -e
cd "$(dirname "$0")"
ROOT="$(pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ 未找到 node，请先安装 Node.js >= 18 (https://nodejs.org)"
  exit 1
fi

# 若存在 .env 则加载（LLM 密钥等，优先级最高；也可手动 export）
if [ -f "$ROOT/.env" ]; then
  set -a; . "$ROOT/.env"; set +a
fi

SERVER_PORT=${WEB_SERVER_PORT:-3099}
WEB_PORT=${WEB_PORT:-5180}

do_server() {
  echo "▶ 启动后端 (http://localhost:$SERVER_PORT)..."
  mkdir -p "$ROOT/tmp"
  if lsof -iTCP:$SERVER_PORT -sTCP:LISTEN >/dev/null 2>&1; then
    echo "  ✔ 端口 $SERVER_PORT 已在监听，跳过启动"
  else
    node "$ROOT/server/src/index.js" > "$ROOT/tmp/server.log" 2>&1 &
    echo "  ✔ 后端已后台启动 (PID $!, 日志: tmp/server.log)"
  fi
}

do_web() {
  echo "▶ 启动前端 (http://localhost:$WEB_PORT)..."
  if lsof -iTCP:$WEB_PORT -sTCP:LISTEN >/dev/null 2>&1; then
    echo "  ✔ 端口 $WEB_PORT 已在监听，跳过启动"
    return
  fi
  if [ ! -d "$ROOT/web/node_modules" ]; then
    echo "   前端依赖未安装，正在安装..."
    npm run install:all || { echo "   依赖安装失败"; exit 1; }
  fi
  (cd "$ROOT/web" && npm run dev) &
  echo "  ✔ 前端已后台启动 (PID $!)"
}

case "${1:-all}" in
  server) do_server ;;
  web)    do_web ;;
  all)    do_server; do_web ;;
  *) echo "用法: bash start.sh [server|web|all]"; exit 1 ;;
esac

echo ""
echo "✅ 完成。"
echo "  - 工作台页面:        http://localhost:$WEB_PORT"
echo "  - 后端健康检查:      http://localhost:$SERVER_PORT/api/health"
echo "  - 停止: 后端 kill \$(lsof -tiTCP:$SERVER_PORT -sTCP:LISTEN) ；前端 pkill -f vite"