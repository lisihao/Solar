import sys,os,json,tempfile,datetime,glob; sys.path.insert(0,'lib')
import datetime as dt
now=dt.datetime.now(dt.timezone.utc)
def iso(d): return d.replace(microsecond=0).isoformat().replace('+00:00','Z')

# 用临时 HARNESS_DIR 隔离测试
td=tempfile.mkdtemp()
os.environ['HARNESS_DIR']=td
os.makedirs(f'{td}/sprints',exist_ok=True)
os.makedirs(f'{td}/run/operator-results',exist_ok=True)
os.makedirs(f'{td}/events',exist_ok=True)

# 重新 import 让它读新 HARNESS_DIR
for m in ['orphan_reaper','occupancy_liveness']:
    if m in sys.modules: del sys.modules[m]
import orphan_reaper as orp

P=F=0
def chk(name,cond):
    global P,F
    if cond: P+=1; print(f'  PASS {name}')
    else: F+=1; print(f'  FAIL {name}')

def make_sprint(sid, nodes):
    json.dump({'sprint_id':sid,'nodes':nodes}, open(f'{td}/sprints/{sid}.task_graph.json','w'))
    # 非终态 status
    json.dump({'status':'active'}, open(f'{td}/sprints/{sid}.status.json','w'))

# === 注入1: dispatched 幽灵 (dispatch_id 3天前, 无 operatord) → 应 requeue ===
make_sprint('sprint-ghost-1',[
    {'id':'N1','status':'dispatched','assigned_to':'pane:0','dispatch_id':'g-sprint-ghost-1-N1-20260613T000000Z'},
])
o=orp.scan_orphans()
ghost1=[x for x in o if x['sid']=='sprint-ghost-1']
chk('注入dispatched幽灵(3天前)→识别为孤儿', len(ghost1)==1 and ghost1[0]['action']=='requeue')

# === 注入2: 刚派发的活节点 (dispatch_id 1分钟前) → 不应回收 ===
make_sprint('sprint-fresh',[
    {'id':'N1','status':'dispatched','dispatch_id':f'g-sprint-fresh-N1-{now.strftime("%Y%m%dT%H%M%S")}Z'},
])
o=orp.scan_orphans()
fresh=[x for x in o if x['sid']=='sprint-fresh']
chk('刚派发节点(1分钟内)→不误回收', len(fresh)==0)

# === 注入3: dispatched + operatord completed + handoff → harvest_passed ===
make_sprint('sprint-done',[
    {'id':'N1','status':'dispatched','dispatch_id':'g-sprint-done-N1-20260613T000000Z'},
])
opdir=f'{td}/run/operator-results/op1/pm-sprint-done-N1-abc'
os.makedirs(opdir,exist_ok=True)
json.dump({'status':'completed','exit_code':0}, open(f'{opdir}/result.json','w'))
open(f'{td}/sprints/sprint-done.N1-handoff.md','w').write('done')
o=orp.scan_orphans()
done=[x for x in o if x['sid']=='sprint-done']
chk('completed+handoff幽灵→harvest_passed', len(done)==1 and done[0]['action']=='harvest_passed')

# === 注入4: pending 节点 (非占用态) → 不扫 ===
make_sprint('sprint-pending',[{'id':'N1','status':'pending'}])
o=orp.scan_orphans()
chk('pending节点→不当孤儿', not any(x['sid']=='sprint-pending' for x in o))

# === 注入5: 终态 sprint 的占用节点 → 跳过 ===
json.dump({'sprint_id':'sprint-term','nodes':[{'id':'N1','status':'dispatched','dispatch_id':'g-x-N1-20260613T000000Z'}]}, open(f'{td}/sprints/sprint-term.task_graph.json','w'))
json.dump({'status':'passed'}, open(f'{td}/sprints/sprint-term.status.json','w'))
o=orp.scan_orphans()
chk('终态sprint→跳过其占用节点', not any(x['sid']=='sprint-term' for x in o))

# === 注入6: reap apply 真回收 dispatched 幽灵 → 节点变 pending ===
r=orp.reap_orphans(apply=True, limit=50)
g=json.load(open(f'{td}/sprints/sprint-ghost-1.task_graph.json'))
n1=next(n for n in g['nodes'] if n['id']=='N1')
chk('reap后dispatched幽灵→pending', n1['status']=='pending')
chk('reap后清了assigned_to', 'assigned_to' not in n1)

# === 注入7: grace 失效场景 — updated_at每轮刷新但dispatch_id时间戳不变 ===
make_sprint('sprint-grace',[
    {'id':'N1','status':'dispatched','dispatch_id':'g-sprint-grace-N1-20260613T000000Z','updated_at':iso(now)},
])
o=orp.scan_orphans()
grace=[x for x in o if x['sid']=='sprint-grace']
chk('updated_at刷新但dispatch_id旧→仍识别孤儿(治grace失效)', len(grace)==1)

print(f'\n  {P} passed, {F} failed')
import shutil; shutil.rmtree(td,ignore_errors=True)
sys.exit(0 if F==0 else 1)
