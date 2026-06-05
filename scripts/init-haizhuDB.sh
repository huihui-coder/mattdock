#!/usr/bin/env bash
# 首次部署：仅当运行时 JSON 不存在时，从 *.example.json 复制（不覆盖已有文件）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="$ROOT/haizhuDB"

mkdir -p "$DB"

for example in "$DB"/*.example.json; do
  [[ -f "$example" ]] || continue
  name=$(basename "$example" .example.json)
  target="$DB/${name}.json"
  if [[ ! -f "$target" ]]; then
    cp "$example" "$target"
    echo "[init-haizhuDB] 已创建 $target"
  fi
done

echo "[init-haizhuDB] 完成（已有文件未改动）"
