#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"

labels=(
  com.lisihao.genesispod.watchdog
  com.lisihao.genesispod.ai-service
  com.lisihao.genesispod.frontend
  com.lisihao.genesispod.backend
  com.lisihao.genesispod.infra
)

for label in "${labels[@]}"; do
  launchctl bootout "$DOMAIN" "$TARGET_DIR/$label.plist" >/dev/null 2>&1 || true
done

for label in "${labels[@]}"; do
  rm -f "$TARGET_DIR/$label.plist"
done

echo "GenesisPod launchd services uninstalled."
