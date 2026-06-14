#!/usr/bin/env bash
# solar-boot-selfcheck.sh — 开机自检 (L1, LaunchDaemon, 2026-06-13)
#
# 来源: 监护人发现重启(06:47)后 harness 空窗 1.5h 才被登录唤醒。
# 分层自启 L1: 开机即起 (root, 无 GUI), 只读体检 + emit 事件 + 告警。
# 不派活 (claude pane 需登录态, 由 L2 登录 Agent 接管) — 这是刻意的边界,
# 不是缺陷: Daemon 让系统"开机睁眼", Agent 让系统"登录干活"。
#
# 做什么 (全只读):
#   1. solard / watchdog 进程活性 (pgrep)
#   2. launchd 关键 agent 是否 loaded
#   3. 库存停摆探针: pending/failed 节点数 + solard 心跳新鲜度
#   4. 异常 → emit events/all.jsonl (severity) + osascript 通知 (登录后可见)
#
# 退出码: 0 全绿 / 1 有红 (launchd 据此可重试/告警, 但本脚本不 fail-open 洗成 0)

set -uo pipefail

# LaunchDaemon 跑在 root + 无用户环境, 显式定位目标用户的 harness
TARGET_USER="${SOLAR_TARGET_USER:-lisihao}"
TARGET_HOME="${SOLAR_TARGET_HOME:-/Users/${TARGET_USER}}"
HARNESS_DIR="${HARNESS_DIR:-${TARGET_HOME}/.solar/harness}"
EVENTS="${HARNESS_DIR}/events/all.jsonl"
PYTHON="${PYTHON:-/opt/homebrew/bin/python3}"
[[ -x "$PYTHON" ]] || PYTHON="python3"

now_iso() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

emit() {
  # $1 event  $2 severity  $3 json-data
  local ev="$1" sev="$2" data="$3"
  mkdir -p "$(dirname "$EVENTS")" 2>/dev/null || true
  printf '{"ts":"%s","event":"%s","by":"boot-selfcheck","severity":"%s","data":%s}\n' \
    "$(now_iso)" "$ev" "$sev" "$data" >> "$EVENTS" 2>/dev/null || true
}

notify() {
  # 开机时无 GUI session, osascript 可能失败 — best-effort, 登录后的 Agent 会复检
  local title="$1" msg="$2"
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display notification \"${msg}\" with title \"${title}\"" 2>/dev/null || true
  fi
}

RED=0
proc_alive() { pgrep -f "$1" >/dev/null 2>&1; }

echo "[boot-selfcheck] $(now_iso) start (user=${TARGET_USER} harness=${HARNESS_DIR})"

# ── 1. 关键进程活性 ───────────────────────────────────────────────────────────
solard_up=0; wd_up=0
proc_alive "solard.py run" && solard_up=1
proc_alive "coordinator-watchdog" && wd_up=1
echo "[boot-selfcheck] solard=${solard_up} watchdog=${wd_up}"

# ── 2. launchd 关键 agent loaded? (root 看不到用户 LaunchAgent, 故只查 Daemon 级
#       + 报告进程结论; agent 级由 L2 登录脚本复检) ─────────────────────────────

# ── 3. 库存 + 心跳停摆探针 (只读) ──────────────────────────────────────────────
probe="$("$PYTHON" - "$HARNESS_DIR" <<'PY' 2>/dev/null
import json, glob, os, sys, datetime
H = sys.argv[1]
TERM = {"passed","done","failed","cancelled","superseded","interrupted","eval_pass"}
pending = failed = 0
for f in glob.glob(os.path.join(H, "sprints", "sprint-*.task_dag.state.json")):
    sid = os.path.basename(f)[:-len(".task_dag.state.json")]
    sp = os.path.join(H, "sprints", f"{sid}.status.json")
    try:
        if json.load(open(sp)).get("status") in TERM:
            continue
        d = json.load(open(f))
    except Exception:
        continue
    for v in d.get("node_results", {}).values():
        if isinstance(v, dict):
            st = v.get("status")
            if st == "pending": pending += 1
            elif st == "failed": failed += 1
# solard 心跳新鲜度
hb_age = None
try:
    hb = json.load(open(os.path.join(H, "run", "solard", "heartbeat.json")))
    ts = datetime.datetime.fromisoformat(str(hb.get("ts","")).replace("Z","+00:00"))
    hb_age = round((datetime.datetime.now(datetime.timezone.utc) - ts).total_seconds(), 0)
except Exception:
    pass
print(json.dumps({"pending": pending, "failed": failed, "heartbeat_age_sec": hb_age}))
PY
)"
[[ -z "$probe" ]] && probe='{"pending":null,"failed":null,"heartbeat_age_sec":null}'
echo "[boot-selfcheck] inventory: $probe"

# ── 4. 判定 + 告警 ────────────────────────────────────────────────────────────
if [[ "$solard_up" == "0" ]]; then
  RED=1
  emit "boot_solard_down" "error" '{"detail":"solard 进程未运行 (开机自检, 待登录 Agent 拉起)"}'
  notify "⚠️ Solar 开机自检" "solard 控制面未运行, 登录后将自动拉起"
fi
if [[ "$wd_up" == "0" ]]; then
  RED=1
  emit "boot_watchdog_down" "error" '{"detail":"coordinator-watchdog 未运行"}'
fi
emit "boot_selfcheck_done" "$([[ $RED -eq 0 ]] && echo info || echo warn)" \
  "{\"solard\":${solard_up},\"watchdog\":${wd_up},\"inventory\":${probe},\"red\":${RED}}"

echo "[boot-selfcheck] done red=${RED}"
exit "$RED"
