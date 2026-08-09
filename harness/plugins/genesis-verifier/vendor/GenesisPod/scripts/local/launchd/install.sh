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

staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/genesispod-launchd.XXXXXX")"
cleanup() {
  rm -rf "$staging_dir"
}
trap cleanup EXIT

for label in "${labels[@]}"; do
  cp "$PLIST_DIR/$label.plist" "$staging_dir/$label.plist"
done

# The runtime node may point the frontend job at a verified production release.
# Preserve that host-specific ProgramArguments block while removing legacy
# automatic-start keys. A fresh install still uses the repository template.
frontend_label="com.lisihao.genesispod.frontend"
frontend_target="$TARGET_DIR/$frontend_label.plist"
if [[ -f "$frontend_target" ]]; then
  cp "$frontend_target" "$staging_dir/$frontend_label.plist"
  for key in RunAtLoad KeepAlive ThrottleInterval StartInterval; do
    /usr/libexec/PlistBuddy -c "Delete :$key" \
      "$staging_dir/$frontend_label.plist" >/dev/null 2>&1 || true
  done
  echo "Preserving installed frontend runtime configuration."
fi

for label in "${labels[@]}"; do
  plutil -lint "$staging_dir/$label.plist" >/dev/null
done

for label in "${labels[@]}"; do
  launchctl bootout "$DOMAIN/$label" >/dev/null 2>&1 || true
  launchctl bootout "$DOMAIN" "$TARGET_DIR/$label.plist" >/dev/null 2>&1 || true
  launchctl disable "$DOMAIN/$label" >/dev/null 2>&1 || true
done

for label in "${labels[@]}"; do
  cp "$staging_dir/$label.plist" "$TARGET_DIR/$label.plist"
done

echo "GenesisPod on-demand launchd definitions installed disabled and unloaded."
echo "Logs: $LOG_DIR"
echo "Start: bash $ROOT_DIR/scripts/local/launchd/control.sh start"
echo "Start with AI: bash $ROOT_DIR/scripts/local/launchd/control.sh start --with-ai"
echo "Stop: bash $ROOT_DIR/scripts/local/launchd/control.sh stop"
echo "Status: bash $ROOT_DIR/scripts/local/launchd/control.sh status"
