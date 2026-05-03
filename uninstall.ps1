# Etsy Product Creator - Windows uninstall
# Kullanim (lokal):
#   powershell -ExecutionPolicy Bypass -File "$HOME\etsy-product-creator\uninstall.ps1"
# Tek satir (uzaktan):
#   iwr -useb https://raw.githubusercontent.com/esenbora/etsy-product-creator/main/uninstall.ps1 | iex

$ErrorActionPreference = 'Stop'

$TARGET = if ($env:TARGET) { $env:TARGET } else { Join-Path $HOME "etsy-product-creator" }
$DESKTOP = [Environment]::GetFolderPath("Desktop")
$LNK = Join-Path $DESKTOP "Etsy Creator.lnk"

Write-Host "=== Etsy Product Creator - kaldirma ===" -ForegroundColor Cyan
Write-Host "Hedef: $TARGET"
Write-Host ""
Write-Host "Su klasorler/dosyalar silinecek:"
Write-Host "  - $TARGET  (uygulama, .env, data\cdp-profile, designs, mockups, output)"
Write-Host "  - $LNK"
Write-Host ""
Write-Host "DOKUNULMAYACAK:"
Write-Host "  - Node, Chrome, git (winget ile yuklendi, baska app kullaniyor olabilir)"
Write-Host "  - Playwright Chromium cache"
Write-Host ""
$ans = Read-Host "Devam edilsin mi? (e/h)"
if ($ans -notmatch '^[eEyY]') { Write-Host "iptal"; exit 0 }

# Calisan instance kapat
$stopBat = Join-Path $TARGET "stop.bat"
if (Test-Path $stopBat) {
  & cmd /c $stopBat 2>$null
} else {
  Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
  }
  Get-NetTCPConnection -LocalPort 9333 -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}
Start-Sleep -Seconds 1

# Klasor sil
if (Test-Path $TARGET) {
  Remove-Item $TARGET -Recurse -Force
  Write-Host "  silindi: $TARGET"
}

# Kisayol sil
if (Test-Path $LNK) {
  Remove-Item $LNK -Force
  Write-Host "  silindi: $LNK"
}

Write-Host ""
Write-Host "=== KALDIRMA TAMAM ===" -ForegroundColor Green
Write-Host ""
Write-Host "Opsiyonel temizlik (baska app kullanmiyorsa elle):"
Write-Host "  Playwright cache:  Remove-Item `$env:LOCALAPPDATA\ms-playwright -Recurse"
Write-Host "  Node:              winget uninstall OpenJS.NodeJS.LTS"
Write-Host "  Chrome:            winget uninstall Google.Chrome"
