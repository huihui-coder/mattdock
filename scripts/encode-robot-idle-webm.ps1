# 从黑底 MP4 生成透明 WebM（仅抠近黑像素，避免白色机身被吃掉）
# 用法: .\scripts\encode-robot-idle-webm.ps1
$root = Split-Path -Parent $PSScriptRoot
$mp4 = Join-Path $root "client\public\videos\robot-idle.mp4"
$webm = Join-Path $root "client\public\videos\robot-idle.webm"
if (-not (Test-Path $mp4)) { Write-Error "缺少 $mp4"; exit 1 }
ffmpeg -y -i $mp4 -vf "colorkey=0x000000:0.08:0.015,format=yuva420p" `
  -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 220k -an -auto-alt-ref 0 $webm
Write-Host "已生成 $webm"
