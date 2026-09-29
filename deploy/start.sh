#!/usr/bin/env bash
# Container entrypoint: virtual display, VNC, Caddy, bb server, and a Chromium that is restarted if it ever exits.
set -euo pipefail
: "${BB_TOKEN:?set BB_TOKEN}" "${GUI_PASSWORD:?set GUI_PASSWORD}"
export PORT="${PORT:-8080}"
mkdir -p /data/chrome /data/backups
rm -f /data/chrome/Singleton* # stale locks from the previous container

Xvfb :99 -screen 0 1600x900x24 -nolisten tcp &
sleep 1
x11vnc -display :99 -forever -shared -nopw -localhost -rfbport 5900 -quiet &
websockify --web /usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900 &

GUI_HASH="$(caddy hash-password --plaintext "$GUI_PASSWORD")"
export GUI_HASH
caddy run --config /app/deploy/Caddyfile --adapter caddyfile &

node /app/server/index.js &

(
  while true; do
    # Background throttling off: the game must run at full speed while nobody is watching.
    # Local-network-access checks off: the https game page talks to ws://localhost (Remote API + rpc.js).
    chromium --no-sandbox --no-first-run --no-default-browser-check --disable-dev-shm-usage \
      --user-data-dir=/data/chrome --remote-debugging-address=127.0.0.1 --remote-debugging-port="$BB_CDP_PORT" \
      --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows \
      --disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,CalculateNativeWinOcclusion \
      --hide-crash-restore-bubble --disable-session-crashed-bubble --password-store=basic \
      --window-position=0,0 --window-size=1600,900 --app=https://bitburner-official.github.io/ || true
    echo "chromium exited; restarting in 3s"
    sleep 3
  done
) &

wait -n
echo "a core process exited; stopping container so Railway restarts it"
exit 1
