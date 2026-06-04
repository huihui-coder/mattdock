# 可选：从绿幕 MP4 生成透明 WebM（输出到独立文件，不覆盖 robot-idle-new.*）
# 用法: .\scripts\encode-robot-idle-webm.ps1
# 输入任选其一：robot-idle-new.source.mp4 / robot-idle-new.mp4（只读，不修改）
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root "client\public\videos"
$source = Join-Path $dir "robot-idle-new.source.mp4"
if (-not (Test-Path $source)) {
  $source = Join-Path $dir "robot-idle-new.mp4"
}
$outWebm = Join-Path $dir "robot-idle-alpha.webm"
if (-not (Test-Path $source)) {
  Write-Error "缺少输入视频（robot-idle-new.source.mp4 或 robot-idle-new.mp4）"
  exit 1
}
$vfWebm = "scale=320:-2:flags=lanczos,fps=24,chromakey=0x00FF00:0.18:0.04,format=yuva420p"
ffmpeg -y -i $source -vf $vfWebm -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 200k -an -auto-alt-ref 0 $outWebm
Write-Host "已生成 $outWebm（未改动 robot-idle-new.webm / .mp4）"
