# Hosted Bitburner: the game runs 24/7 in a real Chromium on a virtual display, next to the bb server.
#   /          -> noVNC (watch/play the game; basic auth GUI_USER / GUI_PASSWORD)
#   /api/*     -> bb server (Bearer BB_TOKEN)
#   /healthz   -> 200
# Persistent state lives on the /data volume: Chromium profile (the game save) and save backups.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium xvfb x11vnc novnc python3-websockify caddy fonts-dejavu-core ca-certificates procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY game ./game
COPY deploy ./deploy
COPY AGENTS.md ./

ENV DISPLAY=:99 BB_BACKUP_DIR=/data/backups BB_CDP_PORT=9222 GUI_USER=boyce
CMD ["bash", "/app/deploy/start.sh"]
