#!/usr/bin/env bash
# solar-login-resume.sh — 登录恢复 (L2, LaunchAgent, 2026-06-13)
#
# 来源: 监护人"8点登录进来 harness 应该自检、推进"。
# 分层自启 L2: 你图形登录触发 (有登录态, claude pane 能真干活)。
# 与 L1 (开机 Daemon 只读自检) 互补: L1 睁眼, L2 干活。
#
# 做什么:
#   1. 确认 solard/watchdog 活 (不活则通过 launchctl kickstart 拉起)
#   2. 空窗补偿: 检测"距 solard 上次心跳多久", 若 > 阈值 (重启/睡眠造成的
#      空窗), 一次性批量推一遍当前所有 ready 节点 (补上空窗期没派的活)
#   3. 启动宣告 emit
#
# 幂等: solard 已在 active 跑会持续推, 本脚本的补偿是"登录瞬间补一把", 限流防爆。

set -uo pipefail

HARNESS_DIR="${HARNESS_DIR:-${HOME}/.solar/harness}"
EVENTS="${HARNESS_DIR}/events/all.jsonl"
PYTHON="${PYTHON:-/opt/homebrew/bin/python3}"
[[ -x "$PYTHON" ]] || PYTHON="python3"
GAP_THRESHOLD_SEC="${SOLAR_LOGIN_GAP_THRESHOLD:-600}"  # 心跳停 >10min 视为空窗
RESUME_LIMIT="${SOLAR_LOGIN_RESUME_LIMIT:-8}"           # 补偿一次性最多推几个 sprint

now_iso() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
emit() {
  mkdir -p "$(dirname "$EVENTS")" 2>/dev/null || true
  printf '{"ts":"%s","event":"%s","by":"login-resume","severity":"%s","data":%s}\n' \
    "$(now_iso)" "$1" "$2" "$3" >> "$EVENTS" 2>/dev/null || true
}

echo "[login-resume] $(now_iso) start"

# ── 1. 确认核心进程活 (不活则拉起) ────────────────────────────────────────────
ensure() {
  local pat="$1" label="$2"
  if pgrep -f "$pat" >/dev/null 2>&1; then
    echo "[login-resume] $label: 活"
    return 0
  fi
  echo "[login-resume] $label: 死 → kickstart"
  launchctl kickstart -k "gui/$(id -u)/$label" 2>/dev/null || true
  emit "login_kicked_${label}" "warn" "{\"label\":\"$label\"}"
}
ensure "coordinator-watchdog" "com.solar.watchdog"
ensure "solard.py run" "com.solar.solard"

# ── 2. 空窗补偿 (重启/睡眠后心跳停太久 → 补推一把) ─────────────────────────────
gap="$("$PYTHON" - "$HARNESS_DIR" <<'PY' 2>/dev/null
import json, os, sys, datetime
H = sys.argv[1]
try:
    hb = json.load(open(os.path.join(H, "run", "solard", "heartbeat.json")))
    ts = datetime.datetime.fromisoformat(str(hb.get("ts","")).replace("Z","+00:00"))
    print(int((datetime.datetime.now(datetime.timezone.utc) - ts).total_seconds()))
except Exception:
    print(99999)  # 无心跳 = 视为大空窗
PY
)"
echo "[login-resume] solard 心跳空窗: ${gap}s (阈值 ${GAP_THRESHOLD_SEC}s)"

if [[ "$gap" -gt "$GAP_THRESHOLD_SEC" ]]; then
  echo "[login-resume] 空窗超阈值 → 补偿: 批量推 ready 节点 (limit ${RESUME_LIMIT})"
  pushed="$("$PYTHON" - "$HARNESS_DIR" "$RESUME_LIMIT" <<'PY' 2>/dev/null
import json, glob, os, sys, subprocess
H, limit = sys.argv[1], int(sys.argv[2])
sys.path.insert(0, os.path.join(H, "lib"))
TERM = {"passed","done","failed","cancelled","superseded","interrupted","eval_pass"}
try:
    import graph_scheduler as gs
except Exception:
    print(0); sys.exit()
done = 0
for f in sorted(glob.glob(os.path.join(H, "sprints", "sprint-*.task_graph.json"))):
    if done >= limit:
        break
    sid = os.path.basename(f)[:-len(".task_graph.json")]
    try:
        if json.load(open(os.path.join(H, "sprints", f"{sid}.status.json"))).get("status") in TERM:
            continue
        g = gs.load_graph(f)
        if not gs.ready_nodes(g):
            continue
    except Exception:
        continue
    r = subprocess.run(
        [sys.executable, os.path.join(H, "lib", "graph_node_dispatcher.py"),
         "dispatch-ready", "--graph", f],
        capture_output=True, text=True, timeout=120,
        env={**os.environ, "HARNESS_DIR": H})
    if r.returncode == 0:
        done += 1
print(done)
PY
)"
  [[ -z "$pushed" ]] && pushed=0
  echo "[login-resume] 补偿推了 ${pushed} 个 sprint"
  emit "login_gap_compensated" "warn" "{\"gap_sec\":${gap},\"sprints_pushed\":${pushed}}"
else
  echo "[login-resume] 空窗在阈值内, solard 正常推进, 无需补偿"
fi

# ── 3. 登录宣告 ───────────────────────────────────────────────────────────────
emit "login_resume_done" "info" "{\"gap_sec\":${gap}}"
echo "[login-resume] done"
exit 0
