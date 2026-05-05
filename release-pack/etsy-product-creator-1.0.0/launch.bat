@echo off
REM Tek tik launcher (Windows): update + CDP browser + server + tarayicida ac.
REM Masaustu kisayolu buna point eder.

setlocal
cd /d "%~dp0"

REM 1. Update check (release branch)
echo ^>^> Guncelleme kontrol...
git rev-parse --git-dir >nul 2>&1
if %ERRORLEVEL%==0 (
  for /f %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b
  git fetch --quiet origin %BRANCH% --tags 2>nul
  for /f %%i in ('git rev-parse HEAD') do set LOCAL=%%i
  for /f %%i in ('git rev-parse origin/%BRANCH% 2^>nul') do set REMOTE=%%i
  if not "%LOCAL%"=="%REMOTE%" (
    echo    Yeni surum mevcut, guncelleniyor...
    set PREV=%LOCAL%
    git pull --ff-only origin %BRANCH% >nul 2>&1
    call npm install --silent --no-audit --no-fund >nul 2>&1
    node --check lib\license.js >nul 2>&1
    if %ERRORLEVEL% neq 0 (
      echo    Guncelleme bozuk, rollback...
      git reset --hard %PREV% >nul
      call npm install --silent --no-audit --no-fund >nul 2>&1
    ) else (
      echo    Guncelleme basarili
    )
  ) else (
    echo    Guncel
  )
)

REM CDP port (config.json'dan oku, fallback 9333)
set CDP_PORT=9333
for /f "tokens=*" %%p in ('node -e "try { console.log(JSON.parse(require('fs').readFileSync('config.json')).cdpPort^|^|9333) } catch { console.log(9333) }" 2^>nul') do set CDP_PORT=%%p

set SERVER_PORT=3001
if defined PORT set SERVER_PORT=%PORT%

REM 2. CDP browser
echo ^>^> CDP browser (%CDP_PORT%)...
node -e "require('http').get('http://localhost:%CDP_PORT%/json/version', { timeout: 1000 }, r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))" 2>nul
if %ERRORLEVEL%==0 (
  echo    Zaten acik
) else (
  echo    Aciliyor...
  start "EPC Browser" /MIN cmd /c "npm run browser"
  for /l %%i in (1,1,30) do (
    timeout /t 1 /nobreak >nul
    node -e "require('http').get('http://localhost:%CDP_PORT%/json/version', { timeout: 1000 }, r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))" 2>nul
    if not errorlevel 1 goto cdp_ready
  )
  :cdp_ready
  echo    Hazir
)

REM 3. Server
echo ^>^> Server (%SERVER_PORT%)...
node -e "require('http').get('http://localhost:%SERVER_PORT%/', { timeout: 1000 }, r => process.exit(0)).on('error', () => process.exit(1))" 2>nul
if %ERRORLEVEL%==0 (
  echo    Zaten calisiyor
) else (
  start "EPC Server" /MIN cmd /c "npm start"
  for /l %%i in (1,1,30) do (
    timeout /t 1 /nobreak >nul
    node -e "require('http').get('http://localhost:%SERVER_PORT%/', { timeout: 1000 }, r => process.exit(0)).on('error', () => process.exit(1))" 2>nul
    if not errorlevel 1 goto srv_ready
  )
  :srv_ready
  echo    Hazir
)

REM 4. Tarayicida ac
start "" "http://localhost:%SERVER_PORT%"
echo.
echo Hazir: http://localhost:%SERVER_PORT%

endlocal
