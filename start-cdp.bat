@echo off
REM Etsy Product Creator - CDP browser launcher
REM Reads operaPath/cdpPort from config.json and launches a separate
REM browser instance with --remote-debugging-port and a dedicated profile.
REM Your normal browser stays open. Log in to Etsy once on first run.

setlocal EnableDelayedExpansion
set "ROOT=%~dp0"
set "PROFILE=%ROOT%data\cdp-profile"
set "CONFIG=%ROOT%config.json"

if not exist "%CONFIG%" (
  echo config.json bulunamadi: %CONFIG%
  pause
  exit /b 1
)

REM Pull operaPath and cdpPort out of config.json via node
for /f "usebackq delims=" %%P in (`node -e "const c=require('%CONFIG:\=\\%');process.stdout.write(c.operaPath||c.chromePath||'')"`) do set "BROWSER=%%P"
for /f "usebackq delims=" %%P in (`node -e "const c=require('%CONFIG:\=\\%');process.stdout.write(String(c.cdpPort||9333))"`) do set "PORT=%%P"

if "%BROWSER%"=="" (
  echo config.json icinde operaPath veya chromePath yok.
  pause
  exit /b 1
)

if not exist "%BROWSER%" (
  echo Tarayici bulunamadi: %BROWSER%
  pause
  exit /b 1
)

if not exist "%PROFILE%" mkdir "%PROFILE%"

echo Baslatiliyor: %BROWSER%
echo Profil: %PROFILE%
echo CDP port: %PORT%
echo.
echo Bu pencereyi kapatabilirsiniz, tarayici acik kalir.

start "" "%BROWSER%" --remote-debugging-port=%PORT% --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check
