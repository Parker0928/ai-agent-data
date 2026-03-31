#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! docker info >/dev/null 2>&1; then
  echo "[错误] 连不上 Docker。请先打开 Docker Desktop，再执行本脚本。"
  exit 1
fi

echo "[1/3] 启动 dev 栈（postgres + api + web-dev）…"
docker compose --profile dev up --build -d

echo "[2/3] 等待 API 在宿主机 3020 上就绪（最多约 3 分钟）…"
ok=0
for i in $(seq 1 90); do
  if curl -sf "http://127.0.0.1:3020/api/health" >/dev/null; then
    ok=1
    break
  fi
  sleep 2
done

if [[ "$ok" -ne 1 ]]; then
  echo "[错误] API 未在预期时间内就绪。请查看: docker compose --profile dev logs api"
  exit 1
fi

echo "[3/3] API 已就绪。"
echo ""
echo "  前端: http://localhost:8080"
echo "  API:  http://localhost:3020"
echo "  登录账号见 apps/web/.env.development（VITE_DEV_EMAIL / VITE_DEV_PASSWORD）"
echo ""
echo "  跟随日志: docker compose --profile dev logs -f web-dev api"
echo "  停止栈:   docker compose --profile dev down"
