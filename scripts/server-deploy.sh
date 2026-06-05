#!/usr/bin/env bash
# 服务器安全部署：git pull 前暂存运行时 JSON，拉完原样恢复，绝不覆盖飞行记录/告警配置等
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="$ROOT/haizhuDB"
BACKUP_DIR="${TMPDIR:-/tmp}/haizhu-monitor-runtime-$$"

RUNTIME_JSON=(
  alert-config.json
  flight-history.json
  ai-token-usage.json
  alert-history.json
  users.json
)

cd "$ROOT"

mkdir -p "$BACKUP_DIR"

echo "[deploy] 备份运行时数据到 $BACKUP_DIR"
for f in "${RUNTIME_JSON[@]}"; do
  if [[ -f "$DB/$f" ]]; then
    cp -a "$DB/$f" "$BACKUP_DIR/"
    rm -f "$DB/$f"
    echo "  - 已暂移 $f"
  fi
done

echo "[deploy] git pull"
git pull --ff-only

echo "[deploy] 恢复运行时数据"
for f in "${RUNTIME_JSON[@]}"; do
  if [[ -f "$BACKUP_DIR/$f" ]]; then
    cp -a "$BACKUP_DIR/$f" "$DB/"
    echo "  - 已恢复 $f"
  fi
done

rm -rf "$BACKUP_DIR"

bash "$ROOT/scripts/init-haizhuDB.sh"

echo "[deploy] 构建前端"
(cd "$ROOT/client" && npm run build)

echo "[deploy] 重启服务"
pm2 restart haizhu-monitor

echo "[deploy] 完成"
