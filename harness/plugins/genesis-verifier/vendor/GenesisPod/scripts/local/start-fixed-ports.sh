#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SESSION_NAME="${GENESISPOD_TMUX_SESSION:-genesispod-fixed}"
NODE_PATH_PREFIX="${GENESISPOD_NODE_PATH_PREFIX:-/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin}"

cd "$ROOT_DIR"

echo "GenesisPod fixed local ports"
echo "frontend : http://localhost:3000"
echo "backend  : http://localhost:3001"
echo "ai       : http://localhost:5050"
echo "tmux     : $SESSION_NAME"

docker compose --env-file .env up -d postgres redis flaresolverr
node scripts/local/sync-solar-youtube-library.js

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "tmux session already exists: $SESSION_NAME"
  echo "Attach with: tmux attach -t $SESSION_NAME"
  exit 0
fi

tmux new-session -d -s "$SESSION_NAME" -n backend \
  "cd '$ROOT_DIR/backend' && PATH='$NODE_PATH_PREFIX' PORT=3001 BACKEND_PORT=3001 npm run build && PATH='$NODE_PATH_PREFIX' PORT=3001 BACKEND_PORT=3001 node dist/main.js"

tmux new-window -t "$SESSION_NAME" -n frontend \
  "cd '$ROOT_DIR/frontend' && npm run dev -- --hostname 0.0.0.0 --port 3000"

tmux new-window -t "$SESSION_NAME" -n ai-service \
  "cd '$ROOT_DIR/ai-service' && .venv/bin/uvicorn main:app --host 0.0.0.0 --port 5050"

echo "Started fixed-port services in tmux session: $SESSION_NAME"
echo "Attach with: tmux attach -t $SESSION_NAME"
