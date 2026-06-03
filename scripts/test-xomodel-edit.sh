#!/usr/bin/env bash
# 在服务器上直连 xomodel 图生图（不经过 Express）
# 用法: bash scripts/test-xomodel-edit.sh [图片路径]
set -euo pipefail
cd "$(dirname "$0")/.."

IMG="${1:-scripts/_test_input.png}"
if [[ ! -f "$IMG" ]]; then
  echo "生成 1x1 测试图: $IMG"
  echo 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > "$IMG"
fi

set -a
# shellcheck disable=SC1091
source <(grep -E '^XOMODEL_' .env | sed 's/\r$//')
set +a

KEY="${XOMODEL_API_KEY:-}"
MODEL="${XOMODEL_IMAGE_MODEL:-gpt-image-2}"
BASE="${XOMODEL_API_URL:-https://api.xomodel.com}"
BASE="${BASE%/}"

if [[ -z "$KEY" ]]; then
  echo "错误: .env 未配置 XOMODEL_API_KEY"
  exit 1
fi

echo "=== 服务器 curl 图生图 ==="
echo "POST $BASE/v1/images/edits"
echo "model=$MODEL image=$IMG ($(du -h "$IMG" | cut -f1))"

OUT=$(mktemp)
CODE=$(curl -s -w '%{http_code}' -o "$OUT" \
  --connect-timeout 30 --max-time 300 \
  -X POST "$BASE/v1/images/edits" \
  -H "Authorization: Bearer $KEY" \
  -F "model=$MODEL" \
  -F "image[]=@$IMG" \
  -F "prompt=add a red dot on white background" \
  -F "size=auto" \
  -F "quality=standard" \
  -F "output_format=png")

echo "HTTP $CODE"
head -c 500 "$OUT"
echo
rm -f "$OUT"
[[ "$CODE" =~ ^2 ]] || exit 1
