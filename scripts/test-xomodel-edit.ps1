# Direct xomodel image edit test (no Express)
# Usage: powershell -File scripts/test-xomodel-edit.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$testImg = Join-Path $PSScriptRoot '_test_input.png'
if (-not (Test-Path $testImg)) {
  $pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  [IO.File]::WriteAllBytes($testImg, [Convert]::FromBase64String($pngB64))
}

$envMap = @{}
Get-Content '.env' -Encoding UTF8 | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') { $envMap[$matches[1].Trim()] = $matches[2].Trim() }
}
$key = $envMap['XOMODEL_API_KEY']
$model = if ($envMap['XOMODEL_IMAGE_MODEL']) { $envMap['XOMODEL_IMAGE_MODEL'] } else { 'gpt-image-2' }
$base = if ($envMap['XOMODEL_API_URL']) { $envMap['XOMODEL_API_URL'].TrimEnd('/') } else { 'https://api.xomodel.com' }

if (-not $key) { Write-Error 'Missing XOMODEL_API_KEY in .env'; exit 1 }

Write-Host '=== image edit curl test ==='
Write-Host "POST $base/v1/images/edits"
Write-Host "model=$model"

$out = Join-Path $PSScriptRoot '_test_edit_response.json'
$sw = [System.Diagnostics.Stopwatch]::StartNew()
curl.exe -s -w "`nHTTP_CODE:%{http_code}" -X POST "$base/v1/images/edits" `
  -H "Authorization: Bearer $key" `
  -F "model=$model" `
  -F "image[]=@$testImg;type=image/png" `
  -F "prompt=add a red dot on white background, minimal" `
  -F "size=auto" `
  -F "quality=high" `
  -F "output_format=png" `
  -o $out
$sw.Stop()

Write-Host ("elapsed: " + [math]::Round($sw.Elapsed.TotalSeconds, 1) + "s")
$raw = Get-Content $out -Raw -ErrorAction SilentlyContinue
if ($raw -and $raw.Contains('"error"')) {
  Write-Host $raw.Substring(0, [Math]::Min(600, $raw.Length))
  exit 1
}
Write-Host 'OK -> scripts\_test_edit_response.json'
if ($raw.Length -gt 200) { Write-Host ($raw.Substring(0, 200) + '...') }
