#Requires -Version 5.1
# Etsy Product Creator - Windows kurulum
# Kullanim: PowerShell icinde   .\setup.ps1
# "Running scripts is disabled" hatasi alirsan:
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Say($m)  { Write-Host ">> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "   $m" -ForegroundColor Green }
function Warn($m) { Write-Host "   UYARI: $m" -ForegroundColor Yellow }
function Need($c) { $null -ne (Get-Command $c -ErrorAction SilentlyContinue) }
function RefreshPath {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
              [System.Environment]::GetEnvironmentVariable("Path","User")
}

Write-Host "=== Etsy Product Creator - Windows kurulum ===" -ForegroundColor Magenta

# 1. winget
if (-not (Need winget)) {
  throw "winget bulunamadi. Windows 10/11 guncel olmali. https://aka.ms/getwinget"
}

# 2. Git
if (-not (Need git)) {
  Say "Git kuruluyor (winget)..."
  winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
  RefreshPath
}
Ok "Git: $(git --version)"

# 3. Node 18+
$needNode = $true
if (Need node) {
  $major = [int](((node -v) -replace '^v','') -split '\.')[0]
  if ($major -ge 18) { $needNode = $false }
}
if ($needNode) {
  Say "Node LTS kuruluyor (winget)..."
  winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
  RefreshPath
}
Ok "Node: $(node -v)"

# 4. Chrome / Opera tespit
function Detect-Browser {
  $paths = @(
    "C:\Program Files\Opera\launcher.exe",
    "$env:LOCALAPPDATA\Programs\Opera\launcher.exe",
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($p in $paths) { if (Test-Path $p) { return $p } }
  return $null
}

$BrowserPath = Detect-Browser
if (-not $BrowserPath) {
  Say "Google Chrome kuruluyor (winget)..."
  winget install --id Google.Chrome -e --source winget --accept-package-agreements --accept-source-agreements
  RefreshPath
  $BrowserPath = Detect-Browser
}
if ($BrowserPath) { Ok "Browser: $BrowserPath" } else { Warn "Browser tespit edilemedi, config.json elle doldur" }

# 5. npm install
if (-not (Test-Path (Join-Path $Root "node_modules"))) {
  Say "npm install..."
  npm install
}
Ok "node_modules OK"

# 6. Playwright Chromium
$pwCache = Join-Path $env:LOCALAPPDATA "ms-playwright"
if (-not (Test-Path $pwCache)) {
  Say "Playwright Chromium kuruluyor..."
  try { npx -y playwright install chromium } catch { Warn "Playwright indirme hatasi: $_" }
}

# 7. config.json
$cfgPath = Join-Path $Root "config.json"
if (-not (Test-Path $cfgPath)) {
  $cpJson = if ($BrowserPath) { ($BrowserPath -replace '\\','\\') } else { "" }
  $cfg = @"
{
  "mockup": { "x": 280, "y": 350, "width": 400, "height": 500 },
  "keepPhotoIndexes": [],
  "keepPhotoCount": 6,
  "operaPath": "$cpJson",
  "cdpPort": 9333,
  "templateListingId": "REPLACE_WITH_YOUR_ETSY_TEMPLATE_LISTING_ID"
}
"@
  Set-Content -Path $cfgPath -Value $cfg -Encoding UTF8
  Ok "config.json yazildi"
}

# 8. .env
$envPath = Join-Path $Root ".env"
if (-not (Test-Path $envPath)) {
  Copy-Item (Join-Path $Root ".env.example") $envPath
  Ok ".env olusturuldu (bos)"
}

# 9. Calisma klasorleri
foreach ($d in @("designs","mockups","output","data","logs","reports","uploads","templates")) {
  if (-not (Test-Path (Join-Path $Root $d))) {
    New-Item -ItemType Directory -Path (Join-Path $Root $d) | Out-Null
  }
}
Ok "Klasorler hazir"

# 10. Yedek manuel scriptler (launch.bat asil giris noktasi, repo'da var)
@"
@echo off
cd /d "%~dp0"
npm run browser
"@ | Set-Content -Encoding ASCII (Join-Path $Root "start-browser.bat")

@"
@echo off
cd /d "%~dp0"
npm start
"@ | Set-Content -Encoding ASCII (Join-Path $Root "start.bat")

# 11. Masaustu kisayolu launch.bat'a point et
try {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $launchPath = Join-Path $Root "launch.bat"
  if (Test-Path $launchPath) {
    $wsh = New-Object -ComObject WScript.Shell
    $lnk = $wsh.CreateShortcut((Join-Path $desktop "Etsy Product Creator.lnk"))
    $lnk.TargetPath = $launchPath
    $lnk.WorkingDirectory = $Root
    $lnk.IconLocation = "shell32.dll,13"
    $lnk.Save()
    Ok "Masaustu kisayolu olusturuldu: 'Etsy Product Creator'"
  }
} catch { Warn "Masaustu kisayol atlandi: $_" }

Write-Host ""
Write-Host "=== KURULUM TAMAM ===" -ForegroundColor Green
Write-Host ""
Write-Host "KALAN ADIMLAR:"
Write-Host "  1. .env ac, doldur:"
Write-Host "       GEMINI_API_KEY=...        (zorunlu)"
Write-Host "       OPENROUTER_API_KEY=...    (zorunlu)"
Write-Host "  2. config.json -> templateListingId alanini doldur"
Write-Host "  3. Tek tik baslatmak icin: masaustunden 'Etsy Product Creator' kisayolu"
Write-Host "     veya: launch.bat (update + browser + server + tarayici acilir)"
Write-Host "     Ilk acilista /activate sayfasi lisans key ister."
Write-Host ""
Write-Host "  Yedek manuel: start-browser.bat + start.bat"
Write-Host "  Saglik kontrolu: npm run doctor"
