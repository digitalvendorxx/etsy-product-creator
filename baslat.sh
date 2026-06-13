#!/bin/bash
# Baby Puzzle Creator — localhost baslatici
# VS Code'da terminale: ./baslat.sh
# veya Finder'dan cift tikla.

cd "$(dirname "$0")"

PORT=3002
URL="http://localhost:$PORT"

echo "==> Eski server temizleniyor (port $PORT)..."
PID=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN 2>/dev/null | awk 'NR==2{print $2}')
if [ -n "$PID" ]; then
  kill -9 "$PID" 2>/dev/null
  sleep 1
fi

echo "==> Server baslatiliyor (PORT=$PORT)..."
PORT=$PORT npm start &
SERVER_PID=$!

echo "==> Server hazirlanmasi bekleniyor..."
for i in {1..30}; do
  if curl -s --max-time 1 "$URL/api/health" >/dev/null 2>&1; then
    echo "==> Server hazir: $URL (PID $SERVER_PID)"
    break
  fi
  sleep 1
done

echo "==> Tarayicida aciliyor: $URL"
open "$URL"

echo ""
echo "Server arkada calisiyor. Durdurmak icin: kill $SERVER_PID"
echo "Veya bu terminali kapat (npm start fg ise Ctrl+C)."
echo ""
wait $SERVER_PID
