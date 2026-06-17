import sys,os,datetime; sys.path.insert(0,'lib')
import occupancy_liveness as ol

now=datetime.datetime.now(datetime.timezone.utc)
def iso(d): return d.replace(microsecond=0).isoformat().replace('+00:00','Z')
P=F=0
def chk(name,cond):
    global P,F
    if cond: P+=1; print(f'  PASS {name}')
    else: F+=1; print(f'  FAIL {name}')

# === 信号1: holder pid ===
# 活 pid (当前进程)
chk('活pid→alive', ol.is_holder_alive({'worker_pid':os.getpid()}))
# 死 pid
chk('死pid→orphan', ol.is_orphan({'worker_pid':999999}))
# pid 字段别名
chk('pid别名agent_pid活→alive', ol.is_holder_alive({'agent_pid':os.getpid()}))
chk('pid别名holder_pid死→orphan', ol.is_orphan({'holder_pid':888888}))

# === 信号2: heartbeat (无pid) ===
chk('心跳新鲜→alive', ol.is_holder_alive({'last_heartbeat_at':iso(now)}))
chk('心跳陈旧→orphan', ol.is_orphan({'last_heartbeat_at':iso(now-datetime.timedelta(seconds=600)),'heartbeat_timeout_sec':180}))

# === 信号3: occupied_since + grace (无pid无心跳) ===
chk('grace内→alive', ol.is_holder_alive({'occupied_since':iso(now-datetime.timedelta(seconds=60))},grace_sec=900))
chk('grace超时→orphan', ol.is_orphan({'occupied_since':iso(now-datetime.timedelta(seconds=1000))},grace_sec=900))
chk('acquired_at别名grace内→alive', ol.is_holder_alive({'acquired_at':iso(now-datetime.timedelta(seconds=10))},grace_sec=900))

# === 关键: G4 真实场景 — multi-task 旧status无pid无心跳, occupied久 ===
chk('旧multi-task(无pid无心跳,11天前)→orphan', ol.is_orphan({'status':'running','created_at':iso(now-datetime.timedelta(days=11)),'updated_at':iso(now)}))
# 注意: updated_at 每轮刷新也不影响 — 用 created_at(occupied_since)判, 治grace失效

# === 无任何证据 → 保守孤儿 ===
chk('无证据→orphan', ol.is_orphan({'status':'running'}))
chk('空dict→orphan', ol.is_orphan({}))

# === pid优先于文字state ===
chk('state=running但pid死→orphan(活性优先)', ol.is_orphan({'runtime_state':'running','worker_pid':777777}))

# === verdict 结构 ===
v=ol.liveness_verdict({'worker_pid':os.getpid()})
chk('verdict有signal=pid', v.get('signal')=='pid' and v.get('alive')==True)

print(f'\n  {P} passed, {F} failed')
sys.exit(0 if F==0 else 1)
