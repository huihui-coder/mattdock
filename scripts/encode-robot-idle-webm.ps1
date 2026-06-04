# 绿幕待机动画：压缩 + 抠像生成透明 WebM
# 1. 将绿幕原片放到 client/public/videos/robot-idle-new.source.mp4
# 2. 运行: .\scripts\encode-robot-idle-webm.ps1
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root "client\public\videos"
$source = Join-Path $dir "robot-idle-new.source.mp4"
$mp4 = Join-Path $dir "robot-idle-new.mp4"
$webm = Join-Path $dir "robot-idle-new.webm"

if (-not (Test-Path $source)) {
  Write-Error "请先将绿幕原片保存为: $source"
  exit 1
}

# 压缩：320 宽、24fps、无音轨
ffmpeg -y -i $source -vf "scale=320:-2:flags=lanczos,fps=24" `
  -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -an -movflags +faststart $mp4

# 绿幕抠像 → VP9 透明 WebM（勿用黑底 colorkey）
ffmpeg -y -i $mp4 -vf "chromakey=0x00FF00:0.30:0.08,format=yuva420p" `
  -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 200k -an -auto-alt-ref 0 $webm

Get-Item $mp4, $webm | Format-Table Name, @{ N = 'KB'; E = { [math]::Round($_.Length / 1KB, 1) } }
Write-Host "完成: $mp4 , $webm"
