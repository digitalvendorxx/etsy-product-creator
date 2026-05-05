#!/usr/bin/env bash
# Tek tik launcher: update + CDP browser + server + tarayicida ac.
# Masaustu shortcut buna point eder.
#
# Akis:
#   1. release branch'ten guncelleme kontrol et (rollback safe)
#   2. CDP browser cevapsizsa ac, hazir olana kadar bekle
#   3. Server cevapsizsa baslat, hazir olana kadar bekle
#   4. Default tarayicida http://localhost:<port> ac

set -e
cd "$(dirname "$0")"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
say()  { echo -e "${YELLOW}>> $*${NC}"; }
ok()   { echo -e "${GREEN}   $*${NC}"; }
warn() { echo -e "${RED}   $*${NC}"; }

CDP_PORT=$(node -e "try { console.log(JSON.parse(require('fs').readFileSync('config.json')).cdpPort||9333) } catch { console.log(9333) }" 2>/dev/null)
SERVER_PORT="${PORT:-3001}"

# 1. Update check (release branch)
say "Guncelleme kontrol..."
if git rev-parse --git-dir >/dev/null 2>&1; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  git fetch --quiet origin "$BRANCH" --tags 2>/dev/null || true
  LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "")
  REMOTE=$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo "$LOCAL")
  if [ -n "$LOCAL" ] && [ -n "$REMOTE" ] && [ "$LOCAL" != "$REMOTE" ]; then
    say "Yeni surum mevcut ($BRANCH), guncelleniyor..."
    PREV="$LOCAL"
    if git pull --ff-only origin "$BRANCH" >/dev/null 2>&1 \
       && npm install --silent --no-audit --no-fund >/dev/null 2>&1 \
       && node --check lib/license.js >/dev/null 2>&1 \
       && node --check server.js >/dev/null 2>&1; then
      ok "Guncelleme basarili"
    else
      warn "Guncelleme bozuk, rollback..."
      git reset --hard "$PREV" >/dev/null
      npm install --silent --no-audit --no-fund >/dev/null 2>&1 || true
    fi
  else
    ok "Guncel"
  fi
fi

# 2. CDP browser
say "CDP browser ($CDP_PORT)..."
if curl -sf --max-time 1 "http://localhost:$CDP_PORT/json/version" >/dev/null 2>&1; then
  ok "Zaten acik"
else
  say "Aciliyor..."
  nohup npm run browser > /tmp/epc-browser.log 2>&1 &
  disown 2>/dev/null || true
  for _ in $(seq 1 30); do
    sleep 0.5
    if curl -sf --max-time 1 "http://localhost:$CDP_PORT/json/version" >/dev/null 2>&1; then
      ok "Hazir"
      break
    fi
  done
fi

# 3. Server
say "Server ($SERVER_PORT)..."
if curl -sf --max-time 1 "http://localhost:$SERVER_PORT/" -o /dev/null; then
  ok "Zaten calisiyor"
else
  nohup npm start > /tmp/epc-server.log 2>&1 &
  disown 2>/dev/null || true
  for _ in $(seq 1 30); do
    sleep 0.5
    if curl -sf --max-time 1 "http://localhost:$SERVER_PORT/" -o /dev/null; then
      ok "Hazir"
      break
    fi
  done
fi

# 4. Tarayicida ac
URL="http://localhost:$SERVER_PORT"
case "$(uname)" in
  Darwin) open "$URL" ;;
  Linux) xdg-open "$URL" 2>/dev/null || true ;;
esac

echo ""
ok "Hazir: $URL"
echo "   Loglar: /tmp/epc-browser.log + /tmp/epc-server.log"
