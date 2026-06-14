import sys, os, json, datetime, tempfile, pathlib
sys.path.insert(0, 'lib')
import post_result_verifier as v

def iso(dt_obj): return dt_obj.replace(microsecond=0).isoformat().replace('+00:00','Z')
now = datetime.datetime.now(datetime.timezone.utc)

passed = failed_cnt = 0
def check(name, cond):
    global passed, failed_cnt
    if cond: passed+=1; print(f'  PASS {name}')
    else: failed_cnt+=1; print(f'  FAIL {name}')

# 1. write_scope 空 → passed (不误伤分析节点)
r = v.check_write_scope_touched({"write_scope": [], "started_at": iso(now)})
check("空scope→passed", r["status"]=="passed")

# 2. write_scope 缺失 → passed
r = v.check_write_scope_touched({"started_at": iso(now)})
check("无scope字段→passed", r["status"]=="passed")

# 3. started_at 缺失 → passed/warn (不误杀)
r = v.check_write_scope_touched({"write_scope": ["/x"]})
check("无started_at→passed不误杀", r["status"]=="passed")

with tempfile.TemporaryDirectory() as td:
    real = pathlib.Path(td)/"changed.py"
    old  = pathlib.Path(td)/"untouched.py"
    # 任务开始时间 = 现在
    started = now
    # 4. 真改动: 文件 mtime 在 started 之后
    real.write_text("new code")  # mtime=now (刚写)
    r = v.check_write_scope_touched({"write_scope":[str(real)], "started_at": iso(started - datetime.timedelta(seconds=2))})
    check("真改动→passed", r["status"]=="passed")

    # 5. 全缺失: 声称改了但磁盘没文件 → failed
    r = v.check_write_scope_touched({"write_scope":["/nonexistent/fake_abc.py"], "started_at": iso(started)})
    check("全缺失→failed(造假)", r["status"]=="failed" and "absent" in r["message"])

    # 6. 全陈旧: 文件存在但 mtime 早于 started → failed
    old.write_text("old")
    old_time = (started - datetime.timedelta(hours=1)).timestamp()
    os.utime(old, (old_time, old_time))
    r = v.check_write_scope_touched({"write_scope":[str(old)], "started_at": iso(started)})
    check("全陈旧未改→failed", r["status"]=="failed" and "no real change" in r["message"])

    # 7. 混合: 一个真改+一个陈旧 → passed (有真改就算过)
    r = v.check_write_scope_touched({"write_scope":[str(real),str(old)], "started_at": iso(started - datetime.timedelta(seconds=2))})
    check("混合有真改→passed", r["status"]=="passed")

print(f"\n  结果: {passed} passed, {failed_cnt} failed")
sys.exit(0 if failed_cnt==0 else 1)
