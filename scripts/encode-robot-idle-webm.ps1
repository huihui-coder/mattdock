# 压缩待机动画并生成透明 WebM
# 用法: .\scripts\encode-robot-idle-webm.ps1
# 将 robot-idle-new.source.mp4 放在同目录（未压缩原片，不提交 git）
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root "client\public\videos"
$source = Join-Path $dir "robot-idle-new.source.mp4"
$mp4 = Join-Path $dir "robot-idle-new.mp4"
$webm = Join-Path $dir "robot-idle-new.webm"
if (-not (Test-Path $source)) {
  if (Test-Path $mp4) { $source = $mp4 } else { Write-Error "缺少 $source 或 $mp4"; exit 1 }
}
# 绿幕抠像 → 透明 WebM（勿用黑底 colorkey）
$vfWebm = "scale=320:-2:flags=lanczos,fps=24,chromakey=0x00FF00:0.18:0.04,format=yuva420p"
ffmpeg -y -i $source -vf $vfWebm -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 200k -an -auto-alt-ref 0 $webm
# MP4 仅作仓库备份，前端只播 WebM（MP4 无法保留透明会露出绿底）
ffmpeg -y -i $source -vf "scale=320:-2:flags=lanczos,fps=24" `
  -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -an -movflags +faststart $mp4
Write-Host "已生成透明 $webm 与压缩 $mp4"
