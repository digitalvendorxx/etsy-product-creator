#!/usr/bin/env bash
# Etsy Product Creator - Mac/Linux uninstall
# Kullanim:
#   bash ~/etsy-product-creator/uninstall.sh
# Tek satir (uzaktan):
#   curl -fsSL https://raw.githubusercontent.com/esenbora/etsy-product-creator/main/uninstall.sh | bash

set -e

OS="$(uname -s)"

# Default path; ozel hedef varsa argumanla:
#   bash uninstall.sh /baska/yol
TARGET_DIR="${1:-$HOME/etsy-product-creator}"

echo "=== Etsy Product Creator - kaldirma ==="
echo "Hedef: $TARGET_DIR"
echo ""
echo "Su klasorler/dosyalar silinecek:"
echo "  - $TARGET_DIR  (uygulama, .env, data/cdp-profile, designs, mockups, output)"
case "$OS" in
  Darwin) echo "  - $HOME/Desktop/Etsy Creator.app" ;;
  Linux)  echo "  - $HOME/Desktop/etsy-creator.desktop" ;;
esac
echo ""
echo "DOKUNULMAYACAK (baska seyler de kullaniyor olabilir):"
echo "  - Node, Chrome, Homebrew, git"
echo "  - Playwright Chromium cache"
echo ""
read -r -p "Devam edilsin mi? (e/h) " yn
case "$yn" in
  e|E|y|Y) ;;
  *) echo "iptal"; exit 0 ;;
esac

# Calisan instance varsa kapat
if [ -x "$TARGET_DIR/stop.sh" ]; then
  bash "$TARGET_DIR/stop.sh" 2>/dev/null || true
else
  PID3000=$(lsof -ti :3000 2>/dev/null || true)
  PID9333=$(lsof -ti :9333 2>/dev/null || true)
  [ -n "$PID3000" ] && kill $PID3000 2>/dev/null || true
  [ -n "$PID9333" ] && kill $PID9333 2>/dev/null || true
fi
sleep 1

# Uygulama klasoru
if [ -d "$TARGET_DIR" ]; then
  rm -rf "$TARGET_DIR"
  echo "  silindi: $TARGET_DIR"
fi

# Masaustu
case "$OS" in
  Darwin)
    if [ -d "$HOME/Desktop/Etsy Creator.app" ]; then
      rm -rf "$HOME/Desktop/Etsy Creator.app"
      echo "  silindi: $HOME/Desktop/Etsy Creator.app"
    fi
    ;;
  Linux)
    if [ -f "$HOME/Desktop/etsy-creator.desktop" ]; then
      rm -f "$HOME/Desktop/etsy-creator.desktop"
      echo "  silindi: $HOME/Desktop/etsy-creator.desktop"
    fi
    ;;
esac

echo ""
echo "=== KALDIRMA TAMAM ==="
echo ""
echo "Opsiyonel temizlik (baska app kullanmiyorsa elle):"
echo "  Playwright cache:  rm -rf ~/.cache/ms-playwright ~/Library/Caches/ms-playwright"
echo "  Node:              brew uninstall node   (Mac)   |   sudo apt remove nodejs   (Linux)"
echo "  Chrome:            brew uninstall --cask google-chrome   (Mac)"
