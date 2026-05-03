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

# 10. Kisayol bat
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

# 11. Birlesik launcher
@"
@echo off
cd /d "%~dp0"
if not exist logs mkdir logs

REM Otomatik guncelleme (sessiz)
if exist .git (
  for /f %%H in ('git rev-parse HEAD 2^>nul') do set CURRENT=%%H
  git fetch --quiet origin main >nul 2>&1
  for /f %%S in ('git status --porcelain 2^>nul ^| find /c /v ""') do set DIRTY=%%S
  if "%DIRTY%"=="0" (
    git pull --ff-only --quiet origin main >nul 2>&1
    for /f %%N in ('git rev-parse HEAD 2^>nul') do set NEW=%%N
    if not "%CURRENT%"=="%NEW%" (
      echo [update] guncelleme alindi, npm install...
      call npm install --silent --no-fund --no-audit >nul 2>&1
    )
  )
)

REM CDP browser (port 9333) - acik degilse baslat
netstat -an | find ":9333 " | find "LISTENING" >nul
if errorlevel 1 (
  start "Etsy CDP Browser" /MIN cmd /c "start-browser.bat ^> logs\browser.log 2^>^&1"
)

REM Server (port 3000) - acik degilse baslat
netstat -an | find ":3000 " | find "LISTENING" >nul
if errorlevel 1 (
  start "Etsy Server" /MIN cmd /c "start.bat ^> logs\server.log 2^>^&1"
)

REM Server hazir olunca tarayici
for /L %%i in (1,1,30) do (
  timeout /t 1 /nobreak >nul
  curl -s -o nul http://localhost:3000 >nul 2>&1
  if not errorlevel 1 goto :ready
)
:ready
start http://localhost:3000
"@ | Set-Content -Encoding ASCII (Join-Path $Root "launch.bat")

# Stop scripti
@"
@echo off
echo Server ve CDP browser kapatiliyor...
for /f ""tokens=5"" %%a in ('netstat -ano ^| find "":3000 "" ^| find ""LISTENING""') do taskkill /F /PID %%a 2>nul
for /f ""tokens=5"" %%a in ('netstat -ano ^| find "":9333 "" ^| find ""LISTENING""') do taskkill /F /PID %%a 2>nul
echo Bitti.
"@ | Set-Content -Encoding ASCII (Join-Path $Root "stop.bat")

# 12. Masaustu kisayolu (.lnk)
try {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $lnkPath = Join-Path $desktop "Etsy Creator.lnk"
  $wsh = New-Object -ComObject WScript.Shell
  $lnk = $wsh.CreateShortcut($lnkPath)
  $lnk.TargetPath = (Join-Path $Root "launch.bat")
  $lnk.WorkingDirectory = $Root
  $lnk.WindowStyle = 7   # minimized
  $lnk.Description = "Flowiqa Etsy Product Creator"
  $lnk.Save()
  Ok "Masaustu: 'Etsy Creator.lnk' (cift tik ile baslat)"
} catch {
  Warn "Masaustu kisayolu olusturulamadi: $_"
}

Write-Host ""
Write-Host "=== KURULUM TAMAM ===" -ForegroundColor Green
Write-Host ""
Write-Host "KALAN ADIMLAR:"
Write-Host "  1. .env ac, doldur:"
Write-Host "       GEMINI_API_KEY=...        (zorunlu)"
Write-Host "       OPENROUTER_API_KEY=...    (zorunlu)"
Write-Host "  2. config.json -> templateListingId alanini doldur"
Write-Host ""
Write-Host "BASLATMA (3 yoldan biri):"
Write-Host "  A) Masaustunde 'Etsy Creator' ikonuna cift tik (onerilen)"
Write-Host "  B) launch.bat  (tek komut, hepsi otomatik)"
Write-Host "  C) Eski yol:  start-browser.bat + start.bat"
Write-Host ""
Write-Host "ILK ACILISTA: Acilan Chrome penceresinde etsy.com + pinterest.com login ol."
