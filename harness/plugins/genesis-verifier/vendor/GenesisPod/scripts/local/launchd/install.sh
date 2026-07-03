#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PLIST_DIR="$ROOT_DIR/scripts/local/launchd/plists"
TARGET_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/GenesisPod"
DOMAIN="gui/$(id -u)"

labels=(
  com.lisihao.genesispod.infra
  com.lisihao.genesispod.backend
  com.lisihao.genesispod.frontend
  com.lisihao.genesispod.ai-service
  com.lisihao.genesispod.watchdog
)

mkdir -p "$TARGET_DIR" "$LOG_DIR"

for label in "${labels[@]}"; do
  launchctl bootout "$DOMAIN" "$TARGET_DIR/$label.plist" >/dev/null 2>&1 || true
done

if command -v tmux >/dev/null 2>&1 && tmux has-session -t genesispod-fixed 2>/dev/null; then
  tmux kill-session -t genesispod-fixed
fi

for label in "${labels[@]}"; do
  cp "$PLIST_DIR/$label.plist" "$TARGET_DIR/$label.plist"
done

launchctl bootstrap "$DOMAIN" "$TARGET_DIR/com.lisihao.genesispod.infra.plist"
launchctl bootstrap "$DOMAIN" "$TARGET_DIR/com.lisihao.genesispod.backend.plist"
launchctl bootstrap "$DOMAIN" "$TARGET_DIR/com.lisihao.genesispod.frontend.plist"
launchctl bootstrap "$DOMAIN" "$TARGET_DIR/com.lisihao.genesispod.ai-service.plist"
launchctl bootstrap "$DOMAIN" "$TARGET_DIR/com.lisihao.genesispod.watchdog.plist"

for label in "${labels[@]}"; do
  launchctl enable "$DOMAIN/$label" >/dev/null 2>&1 || true
done

launchctl kickstart -k "$DOMAIN/com.lisihao.genesispod.infra" || true
launchctl kickstart -k "$DOMAIN/com.lisihao.genesispod.backend" || true
launchctl kickstart -k "$DOMAIN/com.lisihao.genesispod.frontend" || true
launchctl kickstart -k "$DOMAIN/com.lisihao.genesispod.ai-service" || true
launchctl kickstart -k "$DOMAIN/com.lisihao.genesispod.watchdog" || true

echo "GenesisPod launchd services installed."
echo "Logs: $LOG_DIR"
echo "Health: bash $ROOT_DIR/scripts/local/launchd/health.sh"
