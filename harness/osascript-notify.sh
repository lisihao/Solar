#!/bin/bash
# ── osascript-notify.sh ──
# Sprint sprint-20260418-065436, D1: macOS 桌面通知
#
# 用法: osascript-notify.sh <title> <message> [sound]
# sound: Glass (默认) | Ping | Blow | Pop | Purr | none
# 容错: macOS 未授权通知时不报错
#
# 2026-06-13 止血改造 (监护人反馈通知刷屏):
#   1. 默认静默 — 必须显式 SOLAR_NOTIFY=1 才弹桌面通知 (默认只写日志)
#   2. 节流 — 同一 title 在 SOLAR_NOTIFY_THROTTLE_SEC (默认 1800s) 内只弹一次
#   3. 所有调用一律留痕到 logs/notify.log, 不丢失告警信息
# 根因: 哨兵每次扫描重复 emit 同一告警, 调一次弹一次, 无去重 → 一分钟弹几十个。

set -uo pipefail

TITLE="${1:-Solar Harness}"
MESSAGE="${2:-Notification}"
SOUND="${3:-Glass}"

HARNESS_DIR="${HARNESS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
LOG="${HARNESS_DIR}/logs/notify.log"
THROTTLE_DIR="${HARNESS_DIR}/run/notify-throttle"
THROTTLE_SEC="${SOLAR_NOTIFY_THROTTLE_SEC:-1800}"

mkdir -p "$(dirname "$LOG")" "$THROTTLE_DIR" 2>/dev/null || true

# 一律留痕 (即使不弹桌面, 告警信息也不丢)
printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TITLE" "$MESSAGE" >> "$LOG" 2>/dev/null || true

# 默认静默: 未显式开启 SOLAR_NOTIFY=1 则只记日志, 不弹桌面
if [[ "${SOLAR_NOTIFY:-0}" != "1" ]]; then
  exit 0
fi

# 节流: 同一 title 在 THROTTLE_SEC 内只弹一次
key="$(printf '%s' "$TITLE" | tr -c 'A-Za-z0-9' '_' | cut -c1-64)"
stamp="${THROTTLE_DIR}/${key}.last"
now="$(date +%s)"
if [[ -f "$stamp" ]]; then
  last="$(cat "$stamp" 2>/dev/null || echo 0)"
  if [[ $((now - last)) -lt $THROTTLE_SEC ]]; then
    exit 0  # 节流期内, 不重复弹
  fi
fi
echo "$now" > "$stamp" 2>/dev/null || true

if [[ "$SOUND" == "none" ]]; then
  osascript -e "display notification \"${MESSAGE}\" with title \"${TITLE}\"" 2>/dev/null || true
else
  osascript -e "display notification \"${MESSAGE}\" with title \"${TITLE}\" sound name \"${SOUND}\"" 2>/dev/null || true
fi

exit 0
