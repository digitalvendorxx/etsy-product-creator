# Etsy Product Creator - tek atista her seyi onaran nuclear repair
# Kullanim:
#   iwr -useb https://raw.githubusercontent.com/esenbora/etsy-product-creator/main/repair.ps1 | iex

$ErrorActionPreference = 'Continue'
$T = if ($env:TARGET) { $env:TARGET } else { Join-Path $HOME "etsy-product-creator" }

Write-Host "=== Etsy Product Creator - REPAIR ===" -ForegroundColor Cyan
Write-Host "Hedef: $T"

function Need($c) { $null -ne (Get-Command $c -ErrorAction SilentlyContinue) }

# 1. git/node yoksa winget ile kur
if (-not (Need git)) {
  Write-Host ">> git yok, winget ile kuruluyor..."
  winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}
if (-not (Need node)) {
  Write-Host ">> node yok, winget ile kuruluyor..."
  winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

# 2. Klasor + repo
if (Test-Path (Join-Path $T ".git")) {
  Write-Host ">> Mevcut repo, remote duzeltme + reset..."
  Push-Location $T
  git remote set-url origin "https://github.com/esenbora/etsy-product-creator.git" 2>&1 | Out-Null
  git fetch origin main 2>&1 | Out-Null
  git reset --hard origin/main 2>&1 | Out-Null
  Pop-Location
} else {
  if (Test-Path $T) {
    Write-Host ">> $T var ama git deposu degil, yedek + sil..."
    Move-Item $T "$T.bak-$(Get-Date -Format yyyyMMdd-HHmmss)" -Force
  }
  Write-Host ">> Clone..."
  git clone "https://github.com/esenbora/etsy-product-creator.git" $T 2>&1 | Out-Null
}

if (-not (Test-Path (Join-Path $T "package.json"))) {
  Write-Host "HATA: clone basarisiz, $T altinda package.json yok" -ForegroundColor Red
  return
}

Set-Location $T

# 3. npm install
if (-not (Test-Path "node_modules")) {
  Write-Host ">> npm install..."
  npm install 2>&1 | Out-Null
}

# 4. Klasorler
foreach ($d in @("designs","mockups","output","data","logs","reports","uploads","templates")) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null }
}

# 5. config.json (yoksa)
if (-not (Test-Path "config.json") -and (Test-Path "config.example.json")) {
  Copy-Item "config.example.json" "config.json"
}

# 6. .env (yoksa)
if (-not (Test-Path ".env") -and (Test-Path ".env.example")) {
  Copy-Item ".env.example" ".env"
}

# 7. start-browser.bat
@"
@echo off
cd /d "%~dp0"
npm run browser
"@ | Set-Content -Encoding ASCII (Join-Path $T "start-browser.bat")

# 8. start.bat
@"
@echo off
cd /d "%~dp0"
npm start
"@ | Set-Content -Encoding ASCII (Join-Path $T "start.bat")

# 9. launch.bat (auto-update + browser + server + tarayici)
@"
@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
if not exist logs mkdir logs

if exist .git (
  for /f %%H in ('git rev-parse HEAD 2^>nul') do set CURRENT=%%H
  git fetch --quiet origin main >nul 2>&1
  for /f %%S in ('git status --porcelain 2^>nul ^| find /c /v ""') do set DIRTY=%%S
  if "!DIRTY!"=="0" (
    git pull --ff-only --quiet origin main >nul 2>&1
    for /f %%N in ('git rev-parse HEAD 2^>nul') do set NEW=%%N
    if not "!CURRENT!"=="!NEW!" (
      echo [update] guncelleme alindi, npm install...
      call npm install --silent --no-fund --no-audit
      echo [update] yeniden baslatiliyor...
      timeout /t 1 /nobreak >nul
      start "" "%~f0"
      exit /b
    )
  )
)

netstat -an | find ":9333 " | find "LISTENING" >nul
if errorlevel 1 (
  start "Etsy CDP Browser" /MIN cmd /c "start-browser.bat ^> logs\browser.log 2^>^&1"
)

netstat -an | find ":3000 " | find "LISTENING" >nul
if errorlevel 1 (
  start "Etsy Server" /MIN cmd /c "start.bat ^> logs\server.log 2^>^&1"
)

for /L %%i in (1,1,30) do (
  timeout /t 1 /nobreak >nul
  curl -s -o nul http://localhost:3000 >nul 2>&1
  if not errorlevel 1 goto :ready
)
:ready
start http://localhost:3000
endlocal
"@ | Set-Content -Encoding ASCII (Join-Path $T "launch.bat")

# 10. stop.bat
@"
@echo off
echo Server ve CDP browser kapatiliyor...
for /f ""tokens=5"" %%a in ('netstat -ano ^| find "":3000 "" ^| find ""LISTENING""') do taskkill /F /PID %%a 2>nul
for /f ""tokens=5"" %%a in ('netstat -ano ^| find "":9333 "" ^| find ""LISTENING""') do taskkill /F /PID %%a 2>nul
echo Bitti.
"@ | Set-Content -Encoding ASCII (Join-Path $T "stop.bat")

# 11. Masaustu .bat (her zaman calisir, COM/policy engelinden bagimsiz)
$desktop = [Environment]::GetFolderPath("Desktop")
if (-not (Test-Path $desktop)) { $desktop = Join-Path $HOME "Desktop" }
if (-not (Test-Path $desktop)) { New-Item -ItemType Directory -Path $desktop | Out-Null }

$batPath = Join-Path $desktop "Etsy Creator.bat"
$batContent = "@echo off`r`ncd /d `"$T`"`r`ncall launch.bat`r`n"
Set-Content -Path $batPath -Value $batContent -Encoding ASCII

# 12. Opsiyonel .lnk
try {
  $wsh = New-Object -ComObject WScript.Shell -ErrorAction Stop
  $lnk = $wsh.CreateShortcut((Join-Path $desktop "Etsy Creator.lnk"))
  $lnk.TargetPath = (Join-Path $T "launch.bat")
  $lnk.WorkingDirectory = $T
  $lnk.WindowStyle = 7
  $lnk.Description = "Flowiqa Etsy Product Creator"
  $lnk.Save()
} catch { }

Write-Host ""
Write-Host "=== REPAIR TAMAM ===" -ForegroundColor Green
Write-Host ""
Write-Host "Olusturulan dosyalar:" -ForegroundColor Cyan
Write-Host "  $T\launch.bat"
Write-Host "  $T\start.bat"
Write-Host "  $T\start-browser.bat"
Write-Host "  $T\stop.bat"
Write-Host "  $batPath"
Write-Host ""
Write-Host "SIMDI: Masaustunde 'Etsy Creator' ikonuna cift tik" -ForegroundColor Yellow
Write-Host ""
Write-Host "Eksikler (.env doldurulmadiysa server boot olmaz):"
Write-Host "  notepad $T\.env       -> GEMINI_API_KEY + OPENROUTER_API_KEY"
Write-Host "  notepad $T\config.json -> templateListingId"
