#!/usr/bin/env python3
"""隔离单测: solard 4 个新 Reconciler
shadow 不写/active 真动/异常上抛
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import tempfile
import unittest
import contextlib
import io
from unittest.mock import MagicMock, patch, call

# ── 把 harness lib 加入 path ──────────────────────────────────────────────────
_HARNESS_LIB = pathlib.Path(__file__).resolve().parent.parent / "lib"
if str(_HARNESS_LIB) not in sys.path:
    sys.path.insert(0, str(_HARNESS_LIB))


# ── 最小 stub 解决 graph_scheduler / architecture_guard 的 import ─────────────
def _make_stubs():
    """在 sys.modules 里插最小 stub, 避免真实 harness 依赖缺失时 import 爆炸。"""
    import types

    # graph_scheduler stub
    gs = types.ModuleType("graph_scheduler")
    gs.load_graph = lambda path: {"nodes": [], "node_results": {}, "sprint_id": "stub"}
    gs.save_graph = lambda path, g: None
    gs.ready_nodes = lambda g: []
    gs.set_node_status = lambda g, nid, s, **kw: None
    sys.modules.setdefault("graph_scheduler", gs)

    # architecture_guard stub
    ag = types.ModuleType("architecture_guard")
    ag._rel = lambda p: p
    ag.PROTECTED_CORE = []
    sys.modules.setdefault("architecture_guard", ag)

    # scope_arbiter stub
    sa = types.ModuleType("scope_arbiter")
    sa._iter_nonterminal = lambda: iter([])
    sa.arbitrate = lambda g, **kw: {"ok": True, "sprint_id": "", "apply": kw.get("apply", False), "results": []}
    sys.modules.setdefault("scope_arbiter", sa)

    # graph_redispatch stub
    grd = types.ModuleType("graph_redispatch")
    grd._iter_nonterminal_graphs = lambda: iter([])
    grd.redispatch_failed_nodes = lambda g, **kw: {
        "ok": True, "sprint_id": "", "apply": kw.get("apply", False),
        "max_retry": 2, "limit": 3, "failed_total": 0,
        "redispatched": [], "escalated": [], "skipped": [],
    }
    sys.modules.setdefault("graph_redispatch", grd)

    # capability_supply_registry stub
    csr = types.ModuleType("capability_supply_registry")
    csr.cmd_worker_blocked_probe = lambda **kw: None
    sys.modules.setdefault("capability_supply_registry", csr)


_make_stubs()

# ── 导入被测模块 ─────────────────────────────────────────────────────────────
import importlib
import solard  # noqa: E402  (after stubs)

# 刷新 solard 里的 scope_arbiter / graph_redispatch 引用 (防 import 缓存)
importlib.reload(solard)


# ── 辅助 ─────────────────────────────────────────────────────────────────────
def _reconciler(name: str):
    for r in solard.RECONCILERS:
        if r.name == name:
            return r
    raise KeyError(f"reconciler {name!r} not in RECONCILERS")


# ═══════════════════════════════════════════════════════════════════════════════
# 1. ScopeArbiterReconciler
# ═══════════════════════════════════════════════════════════════════════════════
class TestScopeArbiterReconciler(unittest.TestCase):

    def setUp(self):
        self.rec = _reconciler("scope_arbiter")

    # --- shadow: 不写任何文件 ---------------------------------------------------
    @patch.dict(os.environ, {"SOLAR_SOLARD_MODE": "shadow"})
    def test_shadow_no_write(self):
        """shadow 模式: arbitrate apply=False, save_graph 不调用。"""
        import scope_arbiter as sa
        import graph_scheduler as gs

        sprints = [
            ("sprint-001", pathlib.Path("/fake/sprint-001.task_graph.json")),
        ]
        fake_graph = {"nodes": [], "node_results": {"n1": {"status": "failed"}},
                      "sprint_id": "sprint-001"}

        with patch.object(sa, "_iter_nonterminal", return_value=iter(sprints)), \
             patch.object(sa, "arbitrate", return_value={
                 "ok": True, "sprint_id": "sprint-001", "apply": False,
                 "results": [{"action": "expand_and_redispatch", "node": "n1",
                               "added": ["f.py"], "expand_count": 1, "protected_core": []}]
             }) as mock_arb, \
             patch.object(gs, "load_graph", return_value=fake_graph), \
             patch.object(gs, "save_graph") as mock_save:

            result = self.rec.reconcile()

        # arbitrate 调用时 apply=False
        mock_arb.assert_called_once()
        _, kw = mock_arb.call_args
        self.assertFalse(kw.get("apply", True), "shadow 下 apply 必须 False")

        # save_graph 不调用
        mock_save.assert_not_called()

        # 返回结构正确
        self.assertTrue(result["ok"])
        self.assertFalse(result["apply"])
        self.assertIn("expanded", result)

    # --- active: save_graph 调用 -----------------------------------------------
    @patch.dict(os.environ, {"SOLAR_SOLARD_MODE": "active"})
    def test_active_save_called(self):
        """active 模式: arbitrate apply=True, 有 expand 时调 save_graph。"""
        import scope_arbiter as sa
        import graph_scheduler as gs

        fake_graph = {"nodes": [], "node_results": {}, "sprint_id": "sprint-001"}
        fake_tg = pathlib.Path("/fake/sprint-001.task_graph.json")

        with patch.object(sa, "_iter_nonterminal", return_value=iter([("sprint-001", fake_tg)])), \
             patch.object(sa, "arbitrate", return_value={
                 "ok": True, "sprint_id": "sprint-001", "apply": True,
                 "results": [{"action": "expand_and_redispatch", "node": "n1",
                               "added": ["f.py"], "expand_count": 1, "protected_core": []}]
             }) as mock_arb, \
             patch.object(gs, "load_graph", return_value=fake_graph), \
             patch.object(gs, "save_graph") as mock_save:

            result = self.rec.reconcile()

        _, kw = mock_arb.call_args
        self.assertTrue(kw.get("apply"), "active 下 apply 必须 True")
        mock_save.assert_called_once()
        self.assertTrue(result["apply"])
        self.assertEqual(result["expanded"], 1)

    # --- 异常上抛 ---------------------------------------------------------------
    @patch.dict(os.environ, {"SOLAR_SOLARD_MODE": "shadow"})
    def test_exception_propagates(self):
        """内部异常必须上抛 (框架会 catch 并落 error 事件)。"""
        import scope_arbiter as sa
        import graph_scheduler as gs

        with patch.object(sa, "_iter_nonterminal", return_value=iter([("s1", pathlib.Path("/x"))])), \
             patch.object(gs, "load_graph", side_effect=RuntimeError("disk_boom")):
            with self.assertRaises(RuntimeError, msg="异常必须上抛给框架"):
                self.rec.reconcile()


# ═══════════════════════════════════════════════════════════════════════════════
# 2. GraphRedispatchReconciler
# ═══════════════════════════════════════════════════════════════════════════════
class TestGraphRedispatchReconciler(unittest.TestCase):

    def setUp(self):
        self.rec = _reconciler("graph_redispatch")

    @patch.dict(os.environ, {"SOLAR_SOLARD_MODE": "shadow"})
    def test_shadow_no_write(self):
        import graph_redispatch as grd
        import graph_scheduler as gs

        fake_tg = pathlib.Path("/fake/s1.task_graph.json")
        fake_graph = {"nodes": [], "node_results": {"n1": {"status": "failed"}},
                      "sprint_id": "s1"}

        with patch.object(grd, "_iter_nonterminal_graphs",
                          return_value=iter([("s1", fake_tg)])), \
             patch.object(grd, "redispatch_failed_nodes", return_value={
                 "ok": True, "sprint_id": "s1", "apply": False, "max_retry": 2,
                 "limit": 3, "failed_total": 1,
                 "redispatched": [{"node_id": "n1", "retry": 1}],
                 "escalated": [], "skipped": [],
             }) as mock_rd, \
             patch.object(gs, "load_graph", return_value=fake_graph), \
             patch.object(gs, "save_graph") as mock_save:

            result = self.rec.reconcile()

        _, kw = mock_rd.call_args
        self.assertFalse(kw.get("apply", True), "shadow 下 apply 必须 False")
        mock_save.assert_not_called()
        self.assertFalse(result["apply"])
        self.assertIn("redispatched", result)

    @patch.dict(os.environ, {"SOLAR_SOLARD_MODE": "active"})
    def test_active_save_called(self):
        import graph_redispatch as grd
        import graph_scheduler as gs

        fake_tg = pathlib.Path("/fake/s1.task_graph.json")
        fake_graph = {"nodes": [], "node_results": {}, "sprint_id": "s1"}

        with patch.object(grd, "_iter_nonterminal_graphs",
                          return_value=iter([("s1", fake_tg)])), \
             patch.object(grd, "redispatch_failed_nodes", return_value={
                 "ok": True, "sprint_id": "s1", "apply": True, "max_retry": 2,
                 "limit": 3, "failed_total": 1,
                 "redispatched": [{"node_id": "n1", "retry": 1}],
                 "escalated": [], "skipped": [],
             }) as mock_rd, \
             patch.object(gs, "load_graph", return_value=fake_graph), \
             patch.object(gs, "save_graph") as mock_save:

            result = self.rec.reconcile()

        _, kw = mock_rd.call_args
        self.assertTrue(kw.get("apply"), "active 下 apply 必须 True")
        mock_save.assert_called_once()
        self.assertTrue(result["apply"])
        self.assertEqual(result["redispatched"], 1)

    @patch.dict(os.environ, {"SOLAR_SOLARD_MODE": "active", "SOLAR_DAG_REDISPATCH_LIMIT": "1"})
    def test_active_budget_counts_escalated_nodes(self):
        import graph_redispatch as grd
        import graph_scheduler as gs

        fake_graph = {"nodes": [], "node_results": {}, "sprint_id": "s1"}
        graphs = iter([
            ("s1", pathlib.Path("/fake/s1.task_graph.json")),
            ("s2", pathlib.Path("/fake/s2.task_graph.json")),
        ])

        with patch.object(grd, "_iter_nonterminal_graphs", return_value=graphs), \
             patch.object(grd, "redispatch_failed_nodes", return_value={
                 "ok": True, "sprint_id": "s1", "apply": True, "max_retry": 2,
                 "limit": 1, "failed_total": 1,
                 "redispatched": [],
                 "escalated": [{"node_id": "n1"}],
                 "skipped": [],
             }) as mock_rd, \
             patch.object(gs, "load_graph", return_value=fake_graph), \
             patch.object(gs, "save_graph") as mock_save:

            result = self.rec.reconcile()

        self.assertEqual(mock_rd.call_count, 1)
        mock_save.assert_called_once()
        self.assertEqual(result["redispatched"], 0)
        self.assertEqual(result["escalated"], 1)
        self.assertEqual(result["sprints_touched"], 1)

    @patch.dict(os.environ, {"SOLAR_SOLARD_MODE": "shadow"})
    def test_exception_propagates(self):
        import graph_redispatch as grd
        import graph_scheduler as gs

        with patch.object(grd, "_iter_nonterminal_graphs",
                          return_value=iter([("s1", pathlib.Path("/x"))])), \
             patch.object(gs, "load_graph", side_effect=OSError("no file")):
            with self.assertRaises(OSError):
                self.rec.reconcile()


# ═══════════════════════════════════════════════════════════════════════════════
# 3. InboxPumpReconciler
# ═══════════════════════════════════════════════════════════════════════════════
class TestInboxPumpReconciler(unittest.TestCase):

    def setUp(self):
        self.rec = _reconciler("inbox_pump")

    @patch.dict(os.environ, {"SOLAR_SOLARD_MODE": "shadow", "SOLAR_INBOX_PUMP_LIMIT": "2"})
    def test_shadow_no_kick(self):
        """shadow 模式: 报告待踢 operator, kick_pid=None, 不真 kick。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            # reconcile() 内: inbox_root = H / "run" / "operator-inbox"
            inbox_root = pathlib.Path(tmpdir) / "run" / "operator-inbox"
            op1 = inbox_root / "op-alpha"
            op1.mkdir(parents=True)
            (op1 / "task1.json").write_text("{}")
            (pathlib.Path(tmpdir) / "run" / "operator-daemons").mkdir(parents=True)

            with patch("solard.H", pathlib.Path(tmpdir)):
                result = self.rec.reconcile()

        self.assertFalse(result["apply"])
        self.assertEqual(len(result["kicked"]), 1)
        self.assertIsNone(result["kicked"][0]["kick_pid"])

    @patch.dict(os.environ, {"SOLAR_SOLARD_MODE": "active", "SOLAR_INBOX_PUMP_LIMIT": "2"})
    def test_active_kick_called(self):
        """active 模式: 调 _kick_operatord_once, 返回 pid。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            inbox_root = pathlib.Path(tmpdir) / "run" / "operator-inbox"
            op1 = inbox_root / "op-beta"
            op1.mkdir(parents=True)
            (op1 / "task1.json").write_text("{}")
            (pathlib.Path(tmpdir) / "run" / "operator-daemons").mkdir(parents=True)

            import types
            fake_or = types.ModuleType("operator_runtime")
            fake_or._kick_operatord_once = MagicMock(return_value=9999)
            sys.modules["operator_runtime"] = fake_or

            with patch("solard.H", pathlib.Path(tmpdir)):
                result = self.rec.reconcile()

        self.assertTrue(result["apply"])
        self.assertEqual(len(result["kicked"]), 1)
        self.assertEqual(result["kicked"][0]["kick_pid"], 9999)
        fake_or._kick_operatord_once.assert_called_once_with("op-beta")

    @patch.dict(os.environ, {"SOLAR_SOLARD_MODE": "active"})
    def test_exception_propagates(self):
        """inbox_root.iterdir() 抛 PermissionError → 上抛给框架。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            inbox_root = pathlib.Path(tmpdir) / "operator-inbox"
            inbox_root.mkdir(parents=True)  # is_dir() 返回 True
            (pathlib.Path(tmpdir) / "operator-daemons").mkdir()

            # 用 MagicMock 替换 inbox_root 目录对象, 让 iterdir() raise
            mock_inbox_root = MagicMock(spec=pathlib.Path)
            mock_inbox_root.is_dir.return_value = True
            mock_inbox_root.iterdir.side_effect = PermissionError("no perm")

            with patch("solard.H", pathlib.Path(tmpdir)), \
                 patch("pathlib.Path.__truediv__", side_effect=lambda self, other: (
                     mock_inbox_root if "operator-inbox" in str(other)
                     else pathlib.Path.__class__.__truediv__(self, other)
                 )):
                # 更直接：直接 patch solard.H / "run/operator-inbox" 链
                pass  # 用下面更简单的方式

        # 更简洁: 用 with patch 链替换 inbox_root 的父路径, 让 is_dir 触发 OSError
        # reconcile() 的容错设计是 inbox_root.is_dir() 保护了 iterdir()
        # 所以要测试 iterdir 本身. 直接 mock H.run.operator-inbox 路径对象
        import types

        class _FakePath:
            """最小 fake Path, is_dir()=True 但 iterdir() raise。"""
            def is_dir(self): return True
            def iterdir(self): raise PermissionError("no perm")

        # 构造 fake H 使得 H / "run" / "operator-inbox" 返回 _FakePath()
        fake_run = MagicMock()
        fake_run.__truediv__ = MagicMock(return_value=_FakePath())
        fake_H = MagicMock()
        fake_H.__truediv__ = MagicMock(return_value=fake_run)

        with patch("solard.H", fake_H), \
             patch.dict(os.environ, {"SOLAR_SOLARD_MODE": "active"}):
            with self.assertRaises(PermissionError):
                self.rec.reconcile()


# ═══════════════════════════════════════════════════════════════════════════════
# 4. PaneHygieneReconciler
# ═══════════════════════════════════════════════════════════════════════════════
class TestPaneHygieneReconciler(unittest.TestCase):

    def setUp(self):
        self.rec = _reconciler("pane_hygiene")

    def _make_hygiene(self, tmpdir: str, entries: dict) -> pathlib.Path:
        p = pathlib.Path(tmpdir) / "pane-hygiene.json"
        p.write_text(json.dumps(entries, ensure_ascii=False, indent=1), encoding="utf-8")
        return p

    @patch.dict(os.environ, {"SOLAR_SOLARD_MODE": "shadow"})
    def test_shadow_no_tmux(self):
        """shadow 模式: 只报告 needs_respawn 清单, 不调任何 tmux 命令。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            hygiene_data = {
                "fake:0.1": {"state": "needs_respawn", "pane_role": "builder",
                             "persona": None},
                "fake:0.2": {"state": "clean", "pane_role": "evaluator",
                             "persona": None},
            }
            hp = self._make_hygiene(tmpdir, hygiene_data)

            with patch.object(self.rec, "_HYGIENE", hp):
                result = self.rec.reconcile()

        self.assertFalse(result["apply"])
        self.assertEqual(result["needs_respawn_count"], 1)
        self.assertIn("fake:0.1", result["needs_respawn"])
        # tmux 命令不调用 (通过不 mock subprocess 来验证 — shadow 路径根本不走 tmux)

    @patch.dict(os.environ, {"SOLAR_SOLARD_MODE": "active"})
    def test_active_pane_not_found_skip(self):
        """active 模式: tmux 返回非零 (pane 不存在) → 只报告 skipped, 不写 hygiene。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            hygiene_data = {
                "ghost:0.1": {"state": "needs_respawn", "pane_role": "builder",
                              "persona": None},
            }
            hp = self._make_hygiene(tmpdir, hygiene_data)

            with patch.object(self.rec, "_HYGIENE", hp), \
                 patch.object(self.rec, "_pane_exists", return_value=False), \
                 patch.object(self.rec, "_save_hygiene") as mock_save:
                result = self.rec.reconcile()

        self.assertTrue(result["apply"])
        self.assertEqual(result["respawned_count"], 0)
        self.assertEqual(len(result["skipped"]), 1)
        self.assertEqual(result["skipped"][0]["reason"], "pane_not_found")
        mock_save.assert_not_called()

    @patch.dict(os.environ, {"SOLAR_SOLARD_MODE": "active"})
    def test_active_respawn_success_writes_clean(self):
        """active 模式: respawn 成功 + pane_dead=0 → 回写 state=clean。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            hygiene_data = {
                "solar-harness:0.2": {"state": "needs_respawn", "pane_role": "builder",
                                      "persona": "builder"},
            }
            hp = self._make_hygiene(tmpdir, hygiene_data)

            saved_data: list[dict] = []

            def _fake_save(data: dict):
                saved_data.append(json.loads(json.dumps(data)))

            with patch.object(self.rec, "_HYGIENE", hp), \
                 patch.object(self.rec, "_pane_exists", return_value=True), \
                 patch.object(self.rec, "_build_respawn_cmd",
                              return_value=["tmux", "respawn-pane", "-k", "-t", "solar-harness:0.2", "echo ok"]), \
                 patch("subprocess.run", return_value=MagicMock(returncode=0, stderr="")), \
                 patch("time.sleep"), \
                 patch.object(self.rec, "_pane_dead_flag", return_value=False), \
                 patch.object(self.rec, "_save_hygiene", side_effect=_fake_save):
                result = self.rec.reconcile()

        self.assertEqual(result["respawned_count"], 1)
        self.assertEqual(result["respawned"][0]["pane_id"], "solar-harness:0.2")
        self.assertEqual(len(saved_data), 1)
        self.assertEqual(saved_data[0]["solar-harness:0.2"]["state"], "clean")
        self.assertEqual(saved_data[0]["solar-harness:0.2"]["last_transition_trigger"],
                         "solard_auto_respawn")

    @patch.dict(os.environ, {"SOLAR_SOLARD_MODE": "active"})
    def test_active_pane_dead_after_respawn_no_clean(self):
        """active 模式: respawn 后 pane_dead=1 → 不写 clean, 加入 failed_respawn。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            hygiene_data = {
                "solar-harness:0.2": {"state": "needs_respawn", "pane_role": "builder",
                                      "persona": "builder"},
            }
            hp = self._make_hygiene(tmpdir, hygiene_data)

            with patch.object(self.rec, "_HYGIENE", hp), \
                 patch.object(self.rec, "_pane_exists", return_value=True), \
                 patch.object(self.rec, "_build_respawn_cmd",
                              return_value=["tmux", "respawn-pane", "-k", "-t", "x", "y"]), \
                 patch("subprocess.run", return_value=MagicMock(returncode=0, stderr="")), \
                 patch("time.sleep"), \
                 patch.object(self.rec, "_pane_dead_flag", return_value=True), \
                 patch.object(self.rec, "_save_hygiene") as mock_save:
                result = self.rec.reconcile()

        self.assertEqual(result["respawned_count"], 0)
        self.assertEqual(len(result["failed_respawn"]), 1)
        self.assertEqual(result["failed_respawn"][0]["error"], "pane_dead_after_respawn")
        mock_save.assert_not_called()

    def test_build_respawn_cmd_clears_anthropic_api_route_env(self):
        cmd = self.rec._build_respawn_cmd("solar-harness:0.2", "builder")

        joined = " ".join(cmd)
        self.assertIn("-u ANTHROPIC_BASE_URL", joined)
        self.assertIn("-u ANTHROPIC_AUTH_TOKEN", joined)
        self.assertIn("-u ANTHROPIC_API_KEY", joined)
        self.assertIn("-u ANTHROPIC_DEFAULT_SONNET_MODEL", joined)

    @patch.dict(os.environ, {"SOLAR_SOLARD_MODE": "active"})
    def test_exception_propagates(self):
        """hygiene 文件不可读 → RuntimeError 上抛。"""
        with patch.object(self.rec, "_load_hygiene",
                          side_effect=RuntimeError("hygiene_gone")):
            with self.assertRaises(RuntimeError, msg="异常必须上抛给框架"):
                self.rec.reconcile()


# ═══════════════════════════════════════════════════════════════════════════════
# 5. GraphDispatchReconciler
# ═══════════════════════════════════════════════════════════════════════════════
class TestGraphDispatchReconciler(unittest.TestCase):

    def setUp(self):
        self.rec = _reconciler("graph_dispatch")

    @patch.dict(os.environ, {"SOLAR_SOLARD_MODE": "active"})
    def test_active_dispatch_error_keeps_stdout_context(self):
        import graph_scheduler as gs

        with tempfile.TemporaryDirectory() as tmpdir:
            sprint_dir = pathlib.Path(tmpdir) / "sprints"
            sprint_dir.mkdir(parents=True)
            sid = "sprint-error-context"
            (sprint_dir / f"{sid}.task_graph.json").write_text("{}", encoding="utf-8")

            proc = MagicMock()
            proc.returncode = 2
            proc.stdout = '{"ok":false,"reason":"worker_blocked","node":"N1"}'
            proc.stderr = ""

            with patch("solard.SPRINTS", sprint_dir), \
                 patch.object(gs, "load_graph", return_value={"nodes": [{"id": "N1"}]}), \
                 patch.object(gs, "ready_nodes", return_value=[{"id": "N1"}]), \
                 patch("subprocess.run", return_value=proc):
                with self.assertRaises(RuntimeError) as raised:
                    self.rec.reconcile(sid)

        message = str(raised.exception)
        self.assertIn("sprint-error-context", message)
        self.assertIn("worker_blocked", message)
        self.assertIn("N1", message)


class TestDirtyScanner(unittest.TestCase):

    def test_status_change_uses_bounded_metadata_reader(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = pathlib.Path(tmpdir)
            sprints = root / "sprints"
            state_dir = root / "state"
            sprints.mkdir()
            sid = "sprint-large-status"
            status_path = sprints / f"{sid}.status.json"
            status_path.write_text(
                json.dumps({"status": "active", "history": ["x" * 1024] * 1024}),
                encoding="utf-8",
            )

            with patch("solard.SPRINTS", sprints), \
                 patch("solard.STATE_DIR", state_dir), \
                 patch("solard.SNAPSHOT", state_dir / "dirty-snapshot.json"), \
                 patch("solard.read_status_metadata", return_value={"status": "active"}) as reader:
                scanner = solard.DirtyScanner()
                dirty = scanner.scan()

        self.assertEqual(dirty, [sid])
        reader.assert_called_once_with(status_path)


# ═══════════════════════════════════════════════════════════════════════════════
# 6. solard status
# ═══════════════════════════════════════════════════════════════════════════════
class TestSolardStatus(unittest.TestCase):

    def test_status_uses_fresh_heartbeat_when_process_probe_unavailable(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            state_dir = pathlib.Path(tmpdir)
            heartbeat = state_dir / "heartbeat.json"
            heartbeat.write_text(json.dumps({
                "ts": solard._now(),
                "pid": 12345,
                "mode": "active",
                "loop": 1,
                "dirty": 0,
                "loop_ms": 1.2,
            }), encoding="utf-8")

            def fake_run(*args, **kwargs):
                proc = MagicMock()
                proc.returncode = 3
                proc.stdout = ""
                proc.stderr = "Cannot get process list"
                return proc

            buf = io.StringIO()
            with patch("solard.HEARTBEAT", heartbeat), \
                 patch("subprocess.run", side_effect=fake_run), \
                 contextlib.redirect_stdout(buf):
                rc = solard.cmd_status()

        self.assertEqual(rc, 0)
        payload = json.loads(buf.getvalue())
        self.assertTrue(payload["heartbeat_fresh"])
        self.assertIsNone(payload["process_alive"])
        self.assertTrue(payload["alive"])
        self.assertIn("process_probe_error", payload)


# ═══════════════════════════════════════════════════════════════════════════════
# 7. RECONCILERS 列表完整性检查
# ═══════════════════════════════════════════════════════════════════════════════
class TestReconcilerRegistry(unittest.TestCase):

    def test_all_four_registered(self):
        names = {r.name for r in solard.RECONCILERS}
        for expected in ("graph_dispatch", "scope_arbiter", "graph_redispatch", "inbox_pump", "pane_hygiene"):
            self.assertIn(expected, names, f"reconciler {expected!r} 缺失")

    def test_global_scope_intervals(self):
        for name, expected_interval in [
            ("scope_arbiter", 300),
            ("graph_redispatch", 300),
            ("inbox_pump", 120),
            ("pane_hygiene", 300),
        ]:
            rec = _reconciler(name)
            self.assertEqual(rec.scope, "global", f"{name} scope 必须 global")
            self.assertEqual(rec.interval, expected_interval,
                             f"{name} interval 应为 {expected_interval}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
