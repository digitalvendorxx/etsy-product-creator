#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "=== Etsy Product Creator kurulum ==="
OS="$(uname -s)"

need() { command -v "$1" >/dev/null 2>&1; }
die()  { echo "ERROR: $*" >&2; exit 1; }

install_brew() {
  if ! need brew; then
    echo ">> Homebrew kuruluyor..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    [ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
    [ -x /usr/local/bin/brew ]    && eval "$(/usr/local/bin/brew shellenv)"
  fi
}

install_node_mac()   { install_brew; brew install node; }
install_chrome_mac() { install_brew; brew install --cask google-chrome; }
install_git_mac()    { install_brew; brew install git; }

install_node_linux() {
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
}
install_chrome_linux() {
  wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  sudo apt-get install -y /tmp/chrome.deb
  rm -f /tmp/chrome.deb
}
install_git_linux() { sudo apt-get update && sudo apt-get install -y git; }

# 1. Git
if ! need git; then
  case "$OS" in
    Darwin) install_git_mac ;;
    Linux)  install_git_linux ;;
    *) die "Git yok. Elle kur: https://git-scm.com" ;;
  esac
fi
echo "   Git: $(git --version)"

# 2. Node 18+
need_node_install=0
if ! need node; then
  need_node_install=1
else
  MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
  [ "$MAJOR" -lt 18 ] && need_node_install=1
fi
if [ "$need_node_install" = "1" ]; then
  case "$OS" in
    Darwin) install_node_mac ;;
    Linux)  install_node_linux ;;
    MINGW*|MSYS*|CYGWIN*) die "Windows: setup.ps1 kullan" ;;
    *) die "Bilinmeyen OS, Node 20 LTS elle kur" ;;
  esac
fi
echo "   Node: $(node -v)"

# 3. Chrome / Opera tespit
detect_browser() {
  case "$OS" in
    Darwin)
      for p in \
        "/Applications/Opera.app/Contents/MacOS/Opera" \
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"; do
        [ -f "$p" ] && echo "$p" && return
      done
      ;;
    Linux)
      for p in /usr/bin/opera /usr/bin/google-chrome /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/brave-browser; do
        [ -x "$p" ] && echo "$p" && return
      done
      ;;
  esac
}

BROWSER_PATH="$(detect_browser)"
if [ -z "$BROWSER_PATH" ]; then
  case "$OS" in
    Darwin) install_chrome_mac; BROWSER_PATH="$(detect_browser)" ;;
    Linux)  install_chrome_linux; BROWSER_PATH="$(detect_browser)" ;;
  esac
fi
[ -n "$BROWSER_PATH" ] && echo "   Browser: $BROWSER_PATH"

# 4. npm install
if [ ! -d node_modules ]; then
  echo ">> npm install..."
  npm install
fi
echo "   node_modules OK"

# 5. Playwright Chromium (cookie-mode fallback)
if [ ! -d "$HOME/Library/Caches/ms-playwright" ] && [ ! -d "$HOME/.cache/ms-playwright" ]; then
  echo ">> Playwright Chromium kuruluyor..."
  npx -y playwright install chromium || true
fi

# 6. config.json
if [ ! -f config.json ]; then
  if [ -n "$BROWSER_PATH" ]; then
    cat > config.json <<EOF
{
  "mockup": { "x": 280, "y": 350, "width": 400, "height": 500 },
  "keepPhotoIndexes": [],
  "keepPhotoCount": 6,
  "operaPath": "$BROWSER_PATH",
  "cdpPort": 9333,
  "templateListingId": "REPLACE_WITH_YOUR_ETSY_TEMPLATE_LISTING_ID"
}
EOF
    echo "   config.json yazildi"
  else
    cp config.example.json config.json
    echo "   config.json: operaPath alanini ELLE doldur"
  fi
fi

# 7. .env
if [ ! -f .env ]; then
  cp .env.example .env
  echo "   .env olusturuldu (bos)"
fi

# 8. Calisma klasorleri
for d in designs mockups output data logs reports uploads templates; do
  mkdir -p "$d"
done
echo "   Klasorler hazir"

# 9. Kisayol scriptleri
cat > start-browser.sh <<'EOF'
#!/usr/bin/env bash
cd "$(dirname "$0")"
npm run browser
EOF
chmod +x start-browser.sh

cat > start.sh <<'EOF'
#!/usr/bin/env bash
cd "$(dirname "$0")"
npm start
EOF
chmod +x start.sh

cat <<EOF

=== KURULUM TAMAM ===

KALAN ADIMLAR:
  1. .env ac, doldur:
       GEMINI_API_KEY=...        (zorunlu, design generation)
       OPENROUTER_API_KEY=...    (zorunlu, tag/title/description AI)

  2. config.json -> templateListingId alanina kendi sablon Etsy listing ID gir.

  3. CDP browser baslat (etsy + pinterest login icin):
       ./start-browser.sh
     Acilan pencerede etsy.com + pinterest.com login ol. Pencere acik kalsin.

  4. Yeni terminalde server:
       ./start.sh

  5. Tarayicida: http://localhost:3000
EOF
