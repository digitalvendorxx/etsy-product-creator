#!/usr/bin/env bash
# Tek satirlik kurulum (yeni makine, repo henuz yok):
#   curl -fsSL https://raw.githubusercontent.com/digitalvendorxx/etsy-product-creator/main/install.sh | bash
# Ozel hedef:
#   curl -fsSL .../install.sh | bash -s -- /baska/yol

set -e

REPO_URL="https://github.com/digitalvendorxx/etsy-product-creator.git"
TARGET_DIR="${1:-$HOME/etsy-product-creator}"

echo "=== Etsy Product Creator - tek satir kurulum ==="
echo "Hedef: $TARGET_DIR"

need() { command -v "$1" >/dev/null 2>&1; }
die()  { echo "ERROR: $*" >&2; exit 1; }

OS="$(uname -s)"

# 1. Git
if ! need git; then
  echo ">> git yok, kuruluyor..."
  case "$OS" in
    Darwin)
      if ! need brew; then
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        [ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
        [ -x /usr/local/bin/brew ]    && eval "$(/usr/local/bin/brew shellenv)"
      fi
      brew install git
      ;;
    Linux) sudo apt-get update && sudo apt-get install -y git ;;
    MINGW*|MSYS*|CYGWIN*) die "Windows: install.ps1 kullan" ;;
    *) die "Bilinmeyen OS, git elle kur" ;;
  esac
fi
echo "   git: $(git --version)"

# 2. Clone veya pull
if [ -d "$TARGET_DIR/.git" ]; then
  echo ">> Mevcut klasor, guncelleniyor..."
  cd "$TARGET_DIR"
  git pull --ff-only origin main || die "git pull basarisiz (local degisiklik var mi?)"
elif [ -e "$TARGET_DIR" ]; then
  die "$TARGET_DIR var ama git deposu degil. Sil veya baska hedef sec: bash install.sh /baska/yol"
else
  echo ">> Clone: $REPO_URL"
  git clone "$REPO_URL" "$TARGET_DIR"
  cd "$TARGET_DIR"
fi

# 3. setup.sh
[ -f setup.sh ] || die "setup.sh bulunamadi"
chmod +x setup.sh
bash setup.sh

cat <<EOF

=== TUMU TAMAM ===
Klasor: $TARGET_DIR

Sirayla:
  cd "$TARGET_DIR"
  nano .env                  # GEMINI + OPENROUTER key
  ./start-browser.sh         # etsy + pinterest login (1 kere)
  ./start.sh                 # server :3000
  open http://localhost:3000
EOF
