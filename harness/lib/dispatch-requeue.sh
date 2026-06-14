#!/usr/bin/env bash
# lib/dispatch-requeue.sh — 派发失败持久重排队 (P0-D3, 2026-06-09 架构审计)
#
# 修复: dispatch_to_pane 3 次 tmux 重试失败后 return 1, 任务直接丢失;
#       配额耗尽 fail-closed 直接拒绝, 配额恢复后无法补跑。
#
# Exports:
#   dispatch_requeue_add     <sid> <pane> <instruction_file> <reason> → 失败任务入队(带退避)
#   dispatch_requeue_process                                          → 主循环调用, 重试到期项
#   dispatch_requeue_depth                                            → 未消费项计数
#
# Rules:
#   - 单文件 run/dispatch-requeue.jsonl, flock + 原子重写 (同 lib/queue.sh 模式)
#   - retry_count 按 (sid, instruction_file) 累计; 退避 60s * 2^retry (quota 类固定 900s)
#   - retry_count >= SOLAR_DISPATCH_MAX_REQUEUE (默认 5) → 标记 failed,
#     emit_event + osascript 通知, 不再重试 (转人工)

_REQUEUE_FILE="${HARNESS_DIR:-$HOME/.solar/harness}/run/dispatch-requeue.jsonl"
SOLAR_DISPATCH_MAX_REQUEUE="${SOLAR_DISPATCH_MAX_REQUEUE:-5}"

dispatch_requeue_add() {
    local sid="${1:?dispatch_requeue_add: sid required}"
    local pane="${2:-}"
    local instruction_file="${3:-}"
    local reason="${4:-dispatch_failed}"

    local result
    result=$(python3 -c "
import json, datetime, fcntl, hashlib, os, secrets, sys

qf, sid, pane, ifile, reason, max_retry = sys.argv[1:7]
max_retry = int(max_retry)
now = datetime.datetime.now(datetime.timezone.utc)
now_str = now.strftime('%Y-%m-%dT%H:%M:%SZ')
key = hashlib.sha256(f'{sid}|{ifile}'.encode()).hexdigest()[:12]

os.makedirs(os.path.dirname(qf), exist_ok=True)
with open(qf + '.lock', 'a') as lf:
    fcntl.flock(lf, fcntl.LOCK_EX)
    try:
        items = []
        if os.path.exists(qf):
            for line in open(qf):
                line = line.strip()
                if not line: continue
                try: items.append(json.loads(line))
                except Exception: pass

        prev_retry = -1
        for it in items:
            if it.get('key') == key:
                prev_retry = max(prev_retry, int(it.get('retry_count', 0)))
                if not it.get('consumed', False):
                    it['consumed'] = True
                    it['consume_reason'] = 'superseded_by_newer_retry'
        retry = prev_retry + 1

        if retry >= max_retry:
            print(f'exhausted:{retry}')
            status = 'failed'
        else:
            status = 'pending'

        backoff = 900 if reason.startswith('quota') else 60 * (2 ** retry)
        not_before = (now + datetime.timedelta(seconds=backoff)).strftime('%Y-%m-%dT%H:%M:%SZ')
        items.append({
            'id': 'rq-' + now.strftime('%Y%m%dT%H%M%SZ') + '-' + secrets.token_hex(3),
            'key': key, 'sid': sid, 'pane_hint': pane,
            'instruction_file': ifile, 'reason': reason,
            'retry_count': retry, 'not_before': not_before,
            'enqueued_at': now_str, 'status': status,
            'consumed': status == 'failed',
        })
        tmp = qf + '.tmp'
        with open(tmp, 'w') as f:
            for it in items:
                f.write(json.dumps(it, ensure_ascii=False) + '\n')
        os.replace(tmp, qf)
        if status == 'pending':
            print(f'requeued:{retry}:{not_before}')
    finally:
        fcntl.flock(lf, fcntl.LOCK_UN)
" "$_REQUEUE_FILE" "$sid" "$pane" "$instruction_file" "$reason" "$SOLAR_DISPATCH_MAX_REQUEUE" 2>/dev/null)

    case "$result" in
        exhausted:*)
            local n="${result#exhausted:}"
            type log &>/dev/null && log "[requeue] sid=${sid} 重试 ${n} 次仍失败, 转人工" || true
            type emit_event &>/dev/null && \
                emit_event "$sid" "dispatch_requeue_exhausted" "coordinator" \
                    "{\"pane\":\"${pane}\",\"retries\":${n},\"reason\":\"${reason}\"}" || true
            bash "${HARNESS_DIR:-$HOME/.solar/harness}/osascript-notify.sh" \
                "Solar 派发重试耗尽" "sprint ${sid:0:40} 重试 ${n} 次仍失败, 需人工介入" 2>/dev/null || true
            return 1
            ;;
        requeued:*)
            type log &>/dev/null && log "[requeue] sid=${sid} 已入队 (${result#requeued:})" || true
            return 0
            ;;
        *)
            type log &>/dev/null && log "[requeue] WARN: requeue 写入失败 sid=${sid}" || true
            return 1
            ;;
    esac
}

dispatch_requeue_process() {
    [[ -f "$_REQUEUE_FILE" ]] || return 0

    # Pop 一条到期项 (优先 retry 少的); 标记 consumed 后再尝试派发,
    # 失败时 dispatch_to_pane 失败路径会以 retry+1 重新入队 → 不会丢。
    local item
    item=$(python3 -c "
import json, datetime, fcntl, os, sys
qf = sys.argv[1]
now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
with open(qf + '.lock', 'a') as lf:
    fcntl.flock(lf, fcntl.LOCK_EX)
    try:
        items = []
        for line in open(qf):
            line = line.strip()
            if not line: continue
            try: items.append(json.loads(line))
            except Exception: pass
        due = [(i, it) for i, it in enumerate(items)
               if not it.get('consumed', False) and it.get('not_before', '') <= now]
        due.sort(key=lambda p: (int(p[1].get('retry_count', 0)), p[0]))
        if not due:
            sys.exit(0)
        i, it = due[0]
        items[i] = dict(it, consumed=True, consume_reason='retry_attempted', consumed_at=now)
        tmp = qf + '.tmp'
        with open(tmp, 'w') as f:
            for x in items:
                f.write(json.dumps(x, ensure_ascii=False) + '\n')
        os.replace(tmp, qf)
        print(json.dumps(it, ensure_ascii=False))
    finally:
        fcntl.flock(lf, fcntl.LOCK_UN)
" "$_REQUEUE_FILE" 2>/dev/null)

    [[ -n "$item" ]] || return 0

    local sid pane ifile retry
    sid=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('sid',''))" "$item" 2>/dev/null)
    pane=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('pane_hint',''))" "$item" 2>/dev/null)
    ifile=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('instruction_file',''))" "$item" 2>/dev/null)
    retry=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('retry_count',0))" "$item" 2>/dev/null)

    [[ -n "$sid" && -n "$pane" ]] || return 0
    # sprint 已终态则放弃重试
    local st=""
    [[ -f "${SPRINTS_DIR:-$HOME/.solar/harness/sprints}/${sid}.status.json" ]] && \
        st=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('status',''))" \
            "${SPRINTS_DIR:-$HOME/.solar/harness/sprints}/${sid}.status.json" 2>/dev/null)
    case "$st" in
        passed|done|failed|cancelled|superseded)
            type log &>/dev/null && log "[requeue] sid=${sid} 已终态 (${st}), 放弃重试" || true
            return 0 ;;
    esac

    type log &>/dev/null && log "[requeue] 重试派发 sid=${sid} pane=${pane} retry=${retry}" || true
    type emit_event &>/dev/null && \
        emit_event "$sid" "dispatch_requeue_retry" "coordinator" \
            "{\"pane\":\"${pane}\",\"retry\":${retry}}" || true
    if type dispatch_with_gate &>/dev/null; then
        dispatch_with_gate "$pane" "$sid" "" "$ifile" || true
    fi
    return 0
}

dispatch_requeue_depth() {
    [[ -f "$_REQUEUE_FILE" ]] || { echo 0; return 0; }
    python3 -c "
import json, sys
n = 0
for line in open(sys.argv[1]):
    line = line.strip()
    if not line: continue
    try:
        if not json.loads(line).get('consumed', False): n += 1
    except Exception: pass
print(n)
" "$_REQUEUE_FILE" 2>/dev/null || echo 0
}

# ── 配额闸门 (P0-D3 配额感知) ─────────────────────────────────────────────────
# 读 quota-providers.sh 的缓存; 仅在缓存明确显示耗尽时拦截 (fail-open:
# 缓存缺失 / N/A / 解析失败一律放行, 与现状行为一致, 不引入新阻塞面)。
dispatch_quota_gate() {
    local provider="${SOLAR_DISPATCH_QUOTA_PROVIDER:-anthropic}"
    local cache="${HARNESS_DIR:-$HOME/.solar/harness}/state/quota-providers/${provider}.json"
    [[ -f "$cache" ]] || return 0
    python3 -c "
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)  # fail-open
status = str(d.get('status', '')).lower()
value = d.get('value')
if status == 'exhausted':
    sys.exit(1)
try:
    if float(value) <= 0:
        sys.exit(1)
except (TypeError, ValueError):
    pass  # 'N/A' 等非数值 → 放行
sys.exit(0)
" "$cache" 2>/dev/null
}
