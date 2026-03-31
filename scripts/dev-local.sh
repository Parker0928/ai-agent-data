#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

wait_pg_container() {
  echo "等待 Postgres 就绪…"
  for _ in $(seq 1 40); do
    if docker compose --profile dev exec -T postgres pg_isready -U postgres -d ai_agent_data >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

if nc -z -w 1 127.0.0.1 5432 2>/dev/null; then
  echo "[OK] 本机 127.0.0.1:5432 已有服务（当作 Postgres 使用）"
elif docker info >/dev/null 2>&1; then
  echo "[1/2] 启动 Postgres 容器（docker compose）…"
  docker compose --profile dev up postgres -d
  wait_pg_container || {
    echo "[错误] Postgres 未在预期时间内就绪，请执行: docker compose --profile dev logs postgres"
    exit 1
  }
else
  echo "[错误] 本机 5432 无数据库，且 Docker 不可用。"
  echo "请任选其一："
  echo "  · 启动 Docker Desktop 后: npm run dev:db"
  echo "  · 或自行安装 Postgres，创建库 ai_agent_data，用户/密码与 apps/api/.env.development 中 DATABASE_URL 一致"
  exit 1
fi

echo "[2/2] 并行启动 API(3000) + Web（Vite 代理到 API）…"
echo "  前端: http://localhost:5173  （或见终端里 Vite 打印的 Local 地址）"
echo ""
exec npm run dev
